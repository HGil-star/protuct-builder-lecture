"""DXF 도면에서 도곽을 찾아 도곽 하나를 PDF 한 페이지로 출력합니다.

브라우저(Pyodide)와 일반 Python 모두에서 동작하며 외부 서비스를 사용하지 않습니다.
DWG는 LibreDWG(dwg2dxf)로 DXF로 바꾼 뒤 이 모듈에 전달합니다.
"""
from __future__ import annotations

import bisect
import copy
import re
import statistics
import unicodedata
import zlib
from collections import Counter
from typing import Iterable

import ezdxf
from ezdxf import bbox, recover
from ezdxf.addons import Importer
from ezdxf.lldxf.const import DXFStructureError
from ezdxf.addons.drawing import Frontend, RenderContext, layout, svg
from ezdxf.addons.drawing.config import (
    BackgroundPolicy,
    ColorPolicy,
    Configuration,
)
from ezdxf.fonts import fonts
import numpy as np
from ezdxf.math import BoundingBox2d, Vec2, Vec3
from ezdxf.path import Command

FRAME_NAME = re.compile(r"도곽|표제|title|frame|border|sheet|form|dogak", re.I)
NAME_TAG = re.compile(r"도면명|명칭|title|name|dwg_?nm|dwgname", re.I)
NUMBER_TAG = re.compile(r"도면\s*번호|번호|no\b|num|dwg_?no|dwgno", re.I)
PAPERS = {"A4": (297, 210), "A3": (420, 297), "A2": (594, 420), "A1": (841, 594), "A0": (1189, 841)}
MAX_PAGES = 300

_doc = None
_reference: dict | None = None
_ref_doc = None
_ref_space = None
_pages: list[dict] = []
_cache = None


# --------------------------------------------------------------------- 폰트
def setup_fonts(folder: str, fallback: str) -> None:
    """도면 폰트(SHX 포함)를 찾지 못하면 한글이 있는 fallback TTF로 그립니다."""
    fonts.font_manager.clear()
    fonts.font_manager.scan_all([folder])
    fonts.font_manager._fallback_font_name = fallback


# --------------------------------------------------------------- DXF 읽기
def _is_group_code(line: bytes) -> bool:
    line = line.strip()
    return 0 < len(line) <= 6 and line.lstrip(b"-").isdigit()


def _valid_handle(value: bytes) -> bool:
    value = value.strip()
    try:
        return int(value, 16) > 0
    except ValueError:
        return False


TABLE_ENTRIES = {b"LAYER", b"LTYPE", b"STYLE", b"BLOCK_RECORD", b"DIMSTYLE", b"APPID", b"UCS", b"VIEW", b"VPORT"}
NAME_REFS = {b"INSERT", b"DIMENSION", b"ARC_DIMENSION", b"LARGE_RADIAL_DIMENSION", b"ACAD_TABLE"}
UPLUS = re.compile(rb"\\U\+([0-9A-Fa-f]{4})")


def _uplus(match) -> bytes:
    code = int(match.group(1), 16)
    if 0xD800 <= code <= 0xDFFF:  # 짝이 없는 서로게이트는 그대로 둠
        return match.group(0)
    return chr(code).encode("utf-8")


def _to_pairs(data: bytes) -> tuple[list[bytes], int]:
    """DXF를 [코드, 값, 코드, 값, ...]으로 나눕니다. 코드는 공백을 뗀 값입니다.

    LibreDWG는 줄 끝을 항상 CRLF로 쓰므로 CRLF로 나누면, 값 안에 섞인 LF/CR(문자열의 줄바꿈)이
    줄을 쪼개지 않습니다. 구조가 정상이면 한 번에 처리하고, 아니면 한 줄씩 고칩니다.
    """
    crlf = b"\r\n" in data[:4096]
    lines = data.split(b"\r\n") if crlf else data.splitlines()
    while lines and not lines[-1].strip():
        lines.pop()
    lone_breaks = crlf and (data.count(b"\n") != data.count(b"\r\n") or data.count(b"\r") != data.count(b"\r\n"))
    codes = lines[0::2]
    distinct = set(codes)
    if len(lines) % 2 == 0 and not lone_breaks and all(_is_group_code(c) for c in distinct):
        stripped = {c: c.strip() for c in distinct}
        lines[0::2] = [stripped[c] for c in codes]
        return lines, 0
    out: list[bytes] = []
    fixes = i = 0
    n = len(lines)
    while i < n:
        code = lines[i]
        if not _is_group_code(code):
            if out:  # 앞 값에서 줄바꿈으로 떨어져 나온 부분
                out[-1] += b" " + code.replace(b"\r", b" ").replace(b"\n", b" ").strip()
            fixes += 1
            i += 1
            continue
        value = lines[i + 1] if i + 1 < n else b""
        if b"\n" in value or b"\r" in value:
            value = value.replace(b"\r", b" ").replace(b"\n", b" ")
            fixes += 1
        out += [code.strip(), value]
        i += 2
    return out, fixes


def _sections(pairs: list[bytes]) -> dict[bytes, tuple[int, int]]:
    """섹션 이름 → (시작, 끝) 쌍 인덱스. (0, SECTION) (2, 이름) ... (0, ENDSEC)"""
    out = {}
    starts = [k for k, v in enumerate(pairs) if v == b"SECTION" and k % 2 and pairs[k - 1] == b"0"]
    ends = [k for k, v in enumerate(pairs) if v == b"ENDSEC" and k % 2 and pairs[k - 1] == b"0"]
    for s in starts:
        start = s - 1
        end = next((e + 1 for e in ends if e > s), len(pairs))
        if start + 3 < len(pairs) and pairs[start + 2] == b"2":
            out[pairs[start + 3].strip()] = (start, end)
    return out


def _entries(pairs: list[bytes], lo: int, hi: int):
    """[lo, hi) 범위의 객체마다 (시작, 끝) 쌍 인덱스를 냅니다. 객체는 (0, 종류)로 시작합니다."""
    zeros = [k for k in range(lo, hi - 1, 2) if pairs[k] == b"0"]
    for a, b in zip(zeros, zeros[1:] + [hi]):
        yield a, b


def _name_table_entries(pairs: list[bytes], sections: dict) -> int:
    """TABLES 섹션에서 이름(그룹 코드 2)이 없거나 빈 항목에 고유한 이름을 붙입니다 (제자리 수정)."""
    if b"TABLES" not in sections:
        return 0
    lo, hi = sections[b"TABLES"]
    fixes = []  # (시작, 끝, 이름 위치, 하위 클래스 표시 위치, 핸들, 종류)
    for a, b in _entries(pairs, lo, hi):
        kind = pairs[a + 1].strip()
        if kind not in TABLE_ENTRIES:
            continue
        name_at = next((k for k in range(a + 2, b - 1, 2) if pairs[k] == b"2"), None)
        if name_at is not None and pairs[name_at + 1].strip():
            continue
        handle = next((pairs[k + 1].strip() for k in range(a + 2, b - 1, 2) if pairs[k] in (b"5", b"105")), b"%d" % a)
        marker = next((k for k in range(b - 2, a + 1, -2) if pairs[k] == b"100" and pairs[k + 1].strip().endswith(b"TableRecord")), None)
        fixes.append((a, b, name_at, marker, handle, kind))
    if not fixes:
        return 0
    block_names = _block_record_names(pairs, sections) if any(f[5] == b"BLOCK_RECORD" for f in fixes) else {}
    for a, b, name_at, marker, handle, kind in reversed(fixes):  # 뒤에서부터 넣어야 인덱스가 안 밀림
        name = (block_names.get(handle) if kind == b"BLOCK_RECORD" else None) or "_이름없음_".encode() + handle
        if name_at is not None:
            pairs[name_at + 1] = name
        else:
            # 이름은 마지막 하위 클래스 표시(예: AcDbLinetypeTableRecord) 다음에 와야 함
            at = marker + 2 if marker is not None else b
            pairs[at:at] = [b"2", name]
    return len(fixes)


def _block_record_names(pairs: list[bytes], sections: dict) -> dict[bytes, bytes]:
    """블록 레코드 핸들 → BLOCKS 섹션의 BLOCK 이름 (BLOCK의 소유자가 블록 레코드)"""
    out = {}
    if b"BLOCKS" not in sections:
        return out
    for a, b in _entries(pairs, *sections[b"BLOCKS"]):
        if pairs[a + 1].strip() != b"BLOCK":
            continue
        owner = next((pairs[k + 1].strip() for k in range(a + 2, b - 1, 2) if pairs[k] == b"330"), None)
        name = next((pairs[k + 1].strip() for k in range(a + 2, b - 1, 2) if pairs[k] == b"2" and pairs[k + 1].strip()), None)
        if owner and name:
            out[owner] = name
    return out


def _fix_handles(pairs: list[bytes]) -> int:
    """객체 핸들(그룹 코드 5, DIMSTYLE은 105)이 0이거나 16진수가 아니면 새 핸들을 붙입니다."""
    seed_at = next((k + 3 for k in range(0, len(pairs) - 3, 2) if pairs[k] == b"9" and pairs[k + 1].strip() == b"$HANDSEED"), None)
    used = 0
    bad = []
    for k in range(2, len(pairs) - 1, 2):
        if (pairs[k] == b"5" or pairs[k] == b"105") and pairs[k - 2] == b"0":  # 객체 시작 바로 다음의 핸들
            value = pairs[k + 1]
            if _valid_handle(value):
                used = max(used, int(value.strip(), 16))
            else:
                bad.append(k + 1)
    if not bad:
        return 0
    if seed_at is not None and seed_at < len(pairs) and _valid_handle(pairs[seed_at]):
        used = max(used, int(pairs[seed_at].strip(), 16) - 1)
    for k in bad:
        used += 1
        pairs[k] = b"%X" % used
    if seed_at is not None and seed_at < len(pairs):
        pairs[seed_at] = b"%X" % (used + 1)
    return len(bad)


def _prune_blocks(pairs: list[bytes], sections: dict) -> list[bytes]:
    """Model Space·Layout에서 (중첩까지) 쓰지 않는 블록 정의를 뺍니다.

    도면 양식 파일에는 쓰지 않는 블록(로고·기호 등)이 수십만 객체씩 남아 있는 경우가 많아
    읽기 시간을 크게 줄입니다. 이름(INSERT·치수·표의 그룹 코드 2)이나 핸들(340~349, 360~369)로
    참조되는 블록은 남깁니다.
    """
    if b"BLOCKS" not in sections:
        return pairs

    def refs(lo: int, hi: int, names: set, handles: set) -> None:
        for a, b in _entries(pairs, lo, hi):
            by_name = pairs[a + 1].strip() in NAME_REFS
            for k in range(a + 2, b - 1, 2):
                code = pairs[k]
                if by_name and code == b"2":
                    names.add(pairs[k + 1].strip().lower())
                elif len(code) == 3 and code[:2] in (b"34", b"36"):
                    handles.add(pairs[k + 1].strip().upper())

    lo, hi = sections[b"BLOCKS"]
    blocks = []  # (시작, 끝, 이름, 블록 레코드 핸들)
    start = None
    for a, b in _entries(pairs, lo, hi):
        kind = pairs[a + 1].strip()
        if kind == b"BLOCK":
            start = a
            name = next((pairs[k + 1].strip() for k in range(a + 2, b - 1, 2) if pairs[k] == b"2"), b"")
            owner = next((pairs[k + 1].strip().upper() for k in range(a + 2, b - 1, 2) if pairs[k] == b"330"), b"")
        elif kind == b"ENDBLK" and start is not None:
            blocks.append((start, b, name.lower(), owner))
            start = None
    if not blocks:
        return pairs
    names: set = set()
    handles: set = set()
    for sec in (b"ENTITIES", b"OBJECTS"):
        if sec in sections:
            refs(*sections[sec], names, handles)
    keep: set = set()
    changed = True
    while changed:
        changed = False
        for start, end, name, owner in blocks:
            if (start, end) not in keep and (name.startswith((b"*model_space", b"*paper_space"))
                                             or name in names or (owner and owner in handles)):
                keep.add((start, end))
                refs(start, end, names, handles)
                changed = True
    drop = [(s, e) for s, e, _, _ in blocks if (s, e) not in keep]
    if not drop:
        return pairs
    out: list[bytes] = []
    pos = 0
    for s, e in drop:
        out += pairs[pos:s]
        pos = e
    out += pairs[pos:]
    return out


DROP_OBJECTS = {b"SORTENTSTABLE"}  # LibreDWG 0.13이 잘못된 형식으로 쓰는 그리기 순서 객체 (출력에 영향 없음)


def _drop_objects(pairs: list[bytes], sections: dict) -> list[bytes]:
    """OBJECTS 섹션에서 DROP_OBJECTS 종류의 객체를 뺍니다."""
    if b"OBJECTS" not in sections:
        return pairs
    drop = [(a, b) for a, b in _entries(pairs, *sections[b"OBJECTS"]) if pairs[a + 1].strip() in DROP_OBJECTS]
    if not drop:
        return pairs
    out: list[bytes] = []
    pos = 0
    for a, b in drop:
        out += pairs[pos:a]
        pos = b
    return out + pairs[pos:]


def _fix_all_layers_off(pairs: list[bytes], sections: dict) -> int:
    """모든 레이어가 꺼져 있으면(색 번호가 음수) 다시 켭니다.

    LibreDWG 0.13은 일부 DWG(R2010 등)에서 레이어 색을 잘못 써서 모든 레이어가 꺼진 것으로
    나옵니다. 실제 도면에서 모든 레이어가 꺼진 경우는 없으므로 이때만 고칩니다.
    일부만 꺼진 레이어는 작성자의 의도이므로 그대로 둡니다.
    """
    if b"TABLES" not in sections:
        return 0
    colors = []
    for a, b in _entries(pairs, *sections[b"TABLES"]):
        if pairs[a + 1].strip() == b"LAYER":
            colors += [k + 1 for k in range(a + 2, b - 1, 2) if pairs[k] == b"62"]
    if len(colors) < 2 or not all(pairs[k].strip().startswith(b"-") for k in colors):
        return 0
    for k in colors:
        pairs[k] = pairs[k].strip()[1:]
    return 1


def _repair_dxf(path: str) -> tuple[int, bool]:
    """LibreDWG 출력을 ezdxf가 빠르고 안전하게 읽을 수 있게 정리합니다.

    1) 줄바꿈이 섞인 문자열로 깨진 줄 구조 복구
    2) 이름이 없는 레이어·선종류·블록 등 테이블 항목에 이름 붙이기
    3) 핸들이 0이거나 잘못된 객체에 새 핸들 붙이기
    4) 쓰지 않는 블록 정의 제거
    5) LibreDWG의 \\U+XXXX 한글 표기를 UTF-8 글자로 풀기
    (고친 곳 수, UTF-8로 읽어도 되는지)를 돌려줍니다.
    """
    with open(path, "rb") as f:
        data = f.read()
    if b"\\U+" in data:
        data = UPLUS.sub(_uplus, data)
    pairs, fixes = _to_pairs(data)
    del data
    sections = _sections(pairs)
    fixes += _name_table_entries(pairs, sections)
    fixes += _fix_handles(pairs)
    fixes += _fix_all_layers_off(pairs, sections)
    pairs = _prune_blocks(pairs, _sections(pairs))
    pairs = _drop_objects(pairs, _sections(pairs))
    text = b"\n".join(pairs) + b"\n"
    try:
        text.decode("utf-8")
        utf8 = True
    except UnicodeDecodeError:  # 코드 페이지(예: CP949)로 쓰인 오래된 DXF
        utf8 = False
    with open(path, "wb") as f:
        f.write(text)
    return fixes, utf8


def _read(path: str):
    """DXF를 읽고 (문서, 복구한 곳 수)를 돌려줍니다.

    LibreDWG 출력을 _repair_dxf로 정리한 뒤, UTF-8이면 빠른 ezdxf.readfile + audit로 읽고
    아니면(또는 실패하면) 느리지만 관대한 ezdxf recover로 읽습니다.
    바이너리 DXF는 정리하지 않고 recover로 읽습니다.
    """
    with open(path, "rb") as f:
        binary = f.read(22).startswith(b"AutoCAD Binary DXF")
    fixes, utf8 = (0, False) if binary else _repair_dxf(path)
    doc = None
    if utf8:
        try:
            doc = ezdxf.readfile(path, encoding="utf-8")
            doc.audit()
        except Exception:
            doc = None
    if doc is None:
        doc, _ = recover.readfile(path)
    return doc, fixes + _clean_names(doc)


def _clean_names(doc) -> int:
    """레이어·선종류 이름이 비어 있는 객체를 렌더링할 수 있게 고칩니다."""
    fixed = 0
    for e in doc.entitydb.values():
        dxf = getattr(e, "dxf", None)
        if dxf is None or not e.is_alive:
            continue
        try:
            if dxf.hasattr("layer") and not isinstance(dxf.layer, str):
                dxf.layer = "0"
                fixed += 1
            if dxf.hasattr("linetype") and not isinstance(dxf.linetype, str):
                dxf.discard("linetype")
                fixed += 1
        except Exception:
            pass
    return fixed


def _repair_warning(fixes: int, what: str) -> list[str]:
    if not fixes:
        return []
    return [f"{what}의 DWG 변환 결과에서 읽을 수 없는 부분 {fixes}곳을 복구했습니다(깨진 문자열·잘못된 객체 번호·이름 없는 레이어/블록·꺼진 레이어 등). 줄바꿈이 포함된 글자는 한 줄로 표시될 수 있습니다."]


# --------------------------------------------------------------- 도곽 검출
def _rect_box(points: list[Vec2]) -> BoundingBox2d | None:
    """4점 축 정렬 사각형이면 경계를, 아니면 None을 돌려줍니다."""
    if len(points) == 5 and points[0].isclose(points[-1]):
        points = points[:4]
    if len(points) != 4:
        return None
    box = BoundingBox2d(points)
    w, h = box.size.x, box.size.y
    if w <= 0 or h <= 0:
        return None
    tol = max(w, h) * 1e-3
    for p in points:  # 모든 꼭짓점이 경계의 모서리에 있어야 함
        on_x = abs(p.x - box.extmin.x) < tol or abs(p.x - box.extmax.x) < tol
        on_y = abs(p.y - box.extmin.y) < tol or abs(p.y - box.extmax.y) < tol
        if not (on_x and on_y):
            return None
    return box


def _polyline_points(e) -> list[Vec2] | None:
    t = e.dxftype()
    if t == "LWPOLYLINE" and (e.closed or len(e) == 5):
        if any(b for *_, b in e.get_points("xyseb")):
            return None  # 호가 섞인 폴리라인
        return [Vec2(p) for p in e.get_points("xy")]
    if t == "POLYLINE" and e.is_2d_polyline and (e.is_closed or len(e) == 5):
        return [Vec2(v.dxf.location) for v in e.vertices]
    return None


def _line_rects(entities, limit: int = 200_000) -> list[BoundingBox2d]:
    """축에 나란한 LINE 4개로 이루어진 사각형(분해된 도곽)을 찾습니다."""
    q = lambda v: round(v, 3)
    spans: dict[tuple, list[float]] = {}
    verticals = set()
    for e in entities:
        if e.dxftype() != "LINE":
            continue
        a, b = Vec2(e.dxf.start), Vec2(e.dxf.end)
        if abs(a.y - b.y) < 1e-6 and abs(a.x - b.x) > 1e-6:
            spans.setdefault((q(min(a.x, b.x)), q(max(a.x, b.x))), []).append(q(a.y))
        elif abs(a.x - b.x) < 1e-6 and abs(a.y - b.y) > 1e-6:
            verticals.add((q(a.x), q(min(a.y, b.y)), q(max(a.y, b.y))))
    out, checked = [], 0
    for (x0, x1), ys in spans.items():
        ys = sorted(set(ys))
        for i, y0 in enumerate(ys):
            for y1 in ys[i + 1:]:
                checked += 1
                if checked > limit:
                    return out
                if (x0, y0, y1) in verticals and (x1, y0, y1) in verticals:
                    out.append(BoundingBox2d([(x0, y0), (x1, y1)]))
    return out


def _rects(entities) -> list[BoundingBox2d]:
    entities = list(entities)
    out = []
    for e in entities:
        pts = _polyline_points(e)
        box = _rect_box(pts) if pts else None
        if box:
            out.append(box)
    return out + _line_rects(entities)


def _is_xref(block) -> bool:
    try:
        return bool(block.block.dxf.flags & 4)
    except AttributeError:  # 손상된 블록 정의
        return False


def _ratio(box: BoundingBox2d) -> float:
    w, h = box.size.x, box.size.y
    return max(w, h) / min(w, h)


def _block_border(block) -> BoundingBox2d | None:
    """블록 정의에서 블록 전체를 감싸는 사각형 테두리를 찾습니다."""
    ext = bbox.extents(block, cache=_cache)
    if not ext.has_data:
        return None
    full = BoundingBox2d([ext.extmin, ext.extmax])
    best = None
    for box in _rects(block):
        if box.size.x >= full.size.x * 0.97 and box.size.y >= full.size.y * 0.97:
            if best is None or box.size.x * box.size.y > best.size.x * best.size.y:
                best = box
    return best


def _attribs(insert) -> tuple[str, str]:
    name = number = ""
    for a in insert.attribs:
        tag, text = a.dxf.tag or "", (a.dxf.text or "").strip()
        if not text:
            continue
        if not number and NUMBER_TAG.search(tag):
            number = text
        elif not name and NAME_TAG.search(tag):
            name = text
    return name, number


def _find_frames(msp) -> tuple[list[dict], list[str]]:
    found: list[dict] = []
    borders: dict[str, BoundingBox2d | None] = {}
    for ins in msp.query("INSERT"):
        block = ins.block()
        if block is None or _is_xref(block):
            continue
        bname = block.name
        if bname not in borders:
            borders[bname] = _block_border(block)
        border = borders[bname]
        named = bool(FRAME_NAME.search(bname))
        if border is None and not named:
            continue
        if border is not None and not named and not 1.25 <= _ratio(border) <= 1.6:
            continue
        if border is not None:
            m = ins.matrix44()
            corners = [border.extmin, Vec2(border.extmax.x, border.extmin.y), border.extmax, Vec2(border.extmin.x, border.extmax.y)]
            box = BoundingBox2d(Vec2(p) for p in m.transform_vertices(corners))
        else:
            ext = bbox.extents([ins], cache=_cache)
            if not ext.has_data:
                continue
            box = BoundingBox2d([ext.extmin, ext.extmax])
        name, number = _attribs(ins)
        found.append({"box": box, "source": "블록", "block": bname, "name": name, "number": number})

    rects = [{"box": box, "source": "사각형", "block": "", "name": "", "number": ""}
             for box in _rects(msp) if abs(_ratio(box) - 2 ** 0.5) < 0.03]  # A계열 용지 비율
    if rects:
        areas = [f["box"].size.x * f["box"].size.y for f in found]
        limit = min(areas) * 0.5 if areas else max(r["box"].size.x * r["box"].size.y for r in rects) * 0.2
        found += [r for r in rects if r["box"].size.x * r["box"].size.y >= limit]
    return _arrange(found)


def _arrange(found: list[dict]) -> tuple[list[dict], list[str]]:
    # 다른 도곽 안의 사각형(내곽선·표 등)과 같은 위치의 중복 제거
    found.sort(key=lambda f: -(f["box"].size.x * f["box"].size.y))
    frames: list[dict] = []
    for f in found:
        b = f["box"]
        tol = max(b.size.x, b.size.y) * 0.01
        if any(_contains(o["box"], b, tol) for o in frames):
            continue
        frames.append(f)

    warnings = []
    if len(frames) > MAX_PAGES:
        warnings.append(f"도곽이 {len(frames)}개라 앞의 {MAX_PAGES}개만 표시합니다.")
        frames = frames[:MAX_PAGES]
    # 윗줄의 왼쪽 → 오른쪽, 다음 줄 순서
    if frames:
        row = statistics.median(f["box"].size.y for f in frames) * 0.5
        frames.sort(key=lambda f: -f["box"].extmax.y)
        line_top, line = frames[0]["box"].extmax.y, 0
        for f in frames:
            if line_top - f["box"].extmax.y > row:
                line_top, line = f["box"].extmax.y, line + 1
            f["row"] = line
        frames.sort(key=lambda f: (f["row"], f["box"].extmin.x))
    return frames, warnings


# ------------------------------------------------- 기준 도곽 (선분 기반 인식)
# 도곽을 "사각형 객체"가 아니라 가로·세로 선분의 집합으로 봅니다. 끊어진 선, 모서리에서
# 튀어나온 선, 꼭짓점이 많은 폴리라인, 분해된 도곽, 중첩 블록을 모두 같은 방식으로 다룹니다.
H, V = 0, 1  # 가로 선분: (y, x0, x1), 세로 선분: (x, y0, y1)
MAX_DEPTH = 4


def _segments(entities, depth: int = 0, out: list | None = None) -> list[tuple]:
    """축에 나란한 선분 (방향, 좌표, 시작, 끝)을 모읍니다. 블록은 MAX_DEPTH까지 펼칩니다."""
    out = [] if out is None else out
    for e in entities:
        t = e.dxftype()
        pts = None
        if t == "LINE":
            pts = [Vec2(e.dxf.start), Vec2(e.dxf.end)]
            closed = False
        elif t == "LWPOLYLINE":
            pts = [Vec2(p) for p in e.get_points("xy")]
            closed = e.closed
        elif t == "POLYLINE" and e.is_2d_polyline:
            pts = [Vec2(v.dxf.location) for v in e.vertices]
            closed = e.is_closed
        elif t == "INSERT" and depth < MAX_DEPTH:
            try:
                block = e.block()
                if block is not None and not _is_xref(block):
                    _segments(e.virtual_entities(), depth + 1, out)
            except Exception:  # 변환할 수 없는 블록(비균일 축척 등)은 건너뜀
                pass
            continue
        if not pts or len(pts) < 2:
            continue
        pairs = list(zip(pts, pts[1:])) + ([(pts[-1], pts[0])] if closed else [])
        for a, b in pairs:
            dx, dy = abs(a.x - b.x), abs(a.y - b.y)
            length = max(dx, dy)
            if length <= 0:
                continue
            # 손으로 그린 도곽은 선이 살짝 기울어 있는 경우가 많아 약 0.6°까지 허용
            if dy <= length * 0.01:
                out.append((H, (a.y + b.y) / 2, min(a.x, b.x), max(a.x, b.x)))
            elif dx <= length * 0.01:
                out.append((V, (a.x + b.x) / 2, min(a.y, b.y), max(a.y, b.y)))
    return out


class SegIndex:
    """같은 직선 위의 선분을 합치고, 사각형 변이 선으로 덮인 비율을 빠르게 계산합니다."""

    def __init__(self, segments: list[tuple]) -> None:
        self.box = None
        if segments:
            xs = [s[2] for s in segments if s[0] == H] + [s[3] for s in segments if s[0] == H] + [s[1] for s in segments if s[0] == V]
            ys = [s[2] for s in segments if s[0] == V] + [s[3] for s in segments if s[0] == V] + [s[1] for s in segments if s[0] == H]
            self.box = BoundingBox2d([(min(xs), min(ys)), (max(xs), max(ys))])
        size = max(self.box.size.x, self.box.size.y) if self.box else 1.0
        grid = size * 1e-7 or 1e-9
        buckets: dict[tuple, list] = {}
        for o, c, a0, a1 in segments:
            buckets.setdefault((o, round(c / grid)), []).append((a0, a1, c))
        self.lines: list[list[tuple]] = [[], []]
        for (o, _), items in buckets.items():
            items.sort()
            c = items[0][2]
            cur0, cur1 = items[0][0], items[0][1]
            for a0, a1, _ in items[1:]:
                if a0 <= cur1 + grid:
                    cur1 = max(cur1, a1)
                else:
                    self.lines[o].append((c, cur0, cur1))
                    cur0, cur1 = a0, a1
            self.lines[o].append((c, cur0, cur1))
        for o in (H, V):
            self.lines[o].sort()
        self.coords = [[l[0] for l in self.lines[o]] for o in (H, V)]

    def coverage(self, o: int, c: float, a0: float, a1: float, tol: float) -> float:
        """좌표 c(±tol)에서 [a0, a1] 구간이 선으로 덮인 비율 (0~1)."""
        if a1 <= a0:
            return 0.0
        i = bisect.bisect_left(self.coords[o], c - tol)
        j = bisect.bisect_right(self.coords[o], c + tol)
        spans = sorted((max(a0, s), min(a1, e)) for _, s, e in self.lines[o][i:j] if e > a0 and s < a1)
        covered, end = 0.0, a0
        for s, e in spans:
            if e > end:
                covered += e - max(s, end)
                end = e
        return covered / (a1 - a0)

    def is_rect(self, box: BoundingBox2d, need: float = 0.9) -> bool:
        x0, y0, x1, y1 = box.extmin.x, box.extmin.y, box.extmax.x, box.extmax.y
        tol = min(box.size.x, box.size.y) * 0.003
        return (self.coverage(H, y0, x0, x1, tol) >= need and self.coverage(H, y1, x0, x1, tol) >= need
                and self.coverage(V, x0, y0, y1, tol) >= need and self.coverage(V, x1, y0, y1, tol) >= need)

    def long_lines(self, min_len: float):
        for o in (H, V):
            for c, a0, a1 in self.lines[o]:
                if a1 - a0 >= min_len:
                    yield o, c, a0, a1

    def score(self, outer: BoundingBox2d, pattern: list[tuple]) -> float:
        """기준 도곽의 내부 선 배치(pattern)가 outer 안에 같은 상대 위치로 있는 비율."""
        if not pattern:
            return 1.0
        w, h = outer.size.x, outer.size.y
        x, y = outer.extmin.x, outer.extmin.y
        hit = 0
        for o, c, a0, a1 in pattern:
            if o == H:
                ok = self.coverage(H, y + c * h, x + a0 * w, x + a1 * w, h * 0.008) >= 0.8
            else:
                ok = self.coverage(V, x + c * w, y + a0 * h, y + a1 * h, w * 0.008) >= 0.8
            hit += ok
        return hit / len(pattern)


def _rect_from_line(index: SegIndex, o: int, c: float, a0: float, a1: float, ratio: float | None = None) -> list[BoundingBox2d]:
    """긴 선 하나를 도곽의 한 변으로 보고, 닿아 있는 수직선과 맞은편 평행선으로 사각형을 만듭니다.

    모서리에서 선이 튀어나오거나 덜 닿아도 되도록 양 끝은 수직선 위치로, 맞은편 변은
    가장 가까운 평행선 위치로 맞춥니다. ratio를 주면 그 가로세로 비율로 맞은편 변을 찾습니다.
    """
    p = 1 - o  # 수직 방향
    span = a1 - a0
    tol = span * 0.01
    lo_i = bisect.bisect_left(index.coords[p], a0 - tol)
    hi_i = bisect.bisect_right(index.coords[p], a1 + tol)
    touching = [l for l in index.lines[p][lo_i:hi_i][:5000]
                if l[1] - tol <= c <= l[2] + tol and l[2] - l[1] >= span * 0.15]
    if len(touching) < 2:
        return []
    lo, hi = touching[0][0], touching[-1][0]  # 좌표순 정렬되어 있음
    if hi - lo < span * 0.5:
        return []
    width = hi - lo
    results = []
    for direction in (1, -1):
        if ratio is not None:
            depth = width / ratio if o == H else width * ratio
        else:  # 양 끝 수직선이 뻗은 길이
            ends = [(l[2] - c) if direction > 0 else (c - l[1]) for l in touching if abs(l[0] - lo) < tol or abs(l[0] - hi) < tol]
            depth = max(ends, default=0)
        if depth <= span * 0.05:
            continue
        target = c + direction * depth
        # 맞은편 변: target 근처(±2%)에서 [lo, hi]를 가장 많이 덮는 평행선
        snap_tol = depth * 0.02
        i = bisect.bisect_left(index.coords[o], target - snap_tol)
        j = bisect.bisect_right(index.coords[o], target + snap_tol)
        best = None
        for oc, s0, s1 in index.lines[o][i:j]:
            if s1 > lo and s0 < hi:
                cov = index.coverage(o, oc, lo, hi, tol * 0.3)
                if cov >= 0.9 and (best is None or abs(oc - target) < abs(best - target)):
                    best = oc
        if best is None:
            continue
        lo_c, hi_c = sorted((c, best))
        box = BoundingBox2d([(lo, lo_c), (hi, hi_c)] if o == H else [(lo_c, lo), (hi_c, hi)])
        if index.is_rect(box):
            results.append(box)
    return results


def _largest_rect(index: SegIndex) -> BoundingBox2d | None:
    """선들이 이루는 가장 큰 사각형 (바깥 테두리)."""
    if index.box is None:
        return None
    if index.is_rect(index.box):
        return index.box
    size = max(index.box.size.x, index.box.size.y)
    longest = sorted(index.long_lines(size * 0.2), key=lambda l: l[2] - l[3])[:200]
    best = None
    for line in longest:
        for box in _rect_from_line(index, *line):
            if best is None or box.size.x * box.size.y > best.size.x * best.size.y:
                best = box
    return best


def _pattern(index: SegIndex, outer: BoundingBox2d) -> list[tuple]:
    """outer 안의 긴 선(표제란·내곽선 등)을 outer 기준 0~1 좌표로 바꿉니다. 긴 것부터 최대 60개."""
    w, h = outer.size.x, outer.size.y
    x, y = outer.extmin.x, outer.extmin.y
    edge = min(w, h) * 0.003
    out = []
    for o, c, a0, a1 in index.long_lines(min(w, h) * 0.03):
        if o == H:
            if not (y - edge < c < y + h + edge) or a1 < x or a0 > x + w:
                continue
            if abs(c - y) <= edge or abs(c - y - h) <= edge:
                continue  # 바깥 테두리
            out.append((H, (c - y) / h, max(0.0, (a0 - x) / w), min(1.0, (a1 - x) / w)))
        else:
            if not (x - edge < c < x + w + edge) or a1 < y or a0 > y + h:
                continue
            if abs(c - x) <= edge or abs(c - x - w) <= edge:
                continue
            out.append((V, (c - x) / w, max(0.0, (a0 - y) / h), min(1.0, (a1 - y) / h)))
    out.sort(key=lambda s: s[2] - s[3])
    return out[:60]


def _frame_space(doc):
    """도곽이 그려진 공간: Model Space에 선이 없으면 선이 가장 많은 Layout."""
    spaces = [doc.modelspace()] + [l for l in doc.layouts if not l.is_modelspace]
    best, best_count = spaces[0], -1
    for space in spaces:
        count = len(_segments(space))
        if count > best_count:
            best, best_count = space, count
        if space is spaces[0] and count:
            break
    return best


def _file_stem(path: str) -> str:
    """'..\\도면\\도곽.dwg' → '도곽' (대소문자·한글 정규화 차이 무시)"""
    name = unicodedata.normalize("NFC", path.replace("\\", "/").rsplit("/", 1)[-1]).strip().lower()
    return name.rsplit(".", 1)[0] if "." in name else name


def reference(dxf_path: str, file_name: str = "") -> dict:
    """기준 도곽 파일에서 도곽의 블록 이름·가로세로 비율·내부 선 배치를 읽습니다."""
    global _reference, _ref_doc, _ref_space
    doc, fixes = _read(dxf_path)
    space = _frame_space(doc)
    _ref_doc, _ref_space = doc, space
    index = SegIndex(_segments(space))
    if index.box is None:
        kinds = Counter(e.dxftype() for e in space)
        listing = ", ".join(f"{k} {n}개" for k, n in kinds.most_common(6)) or "객체 없음"
        raise ValueError(f"기준 도곽 파일에서 가로·세로 선을 찾지 못했습니다. ({listing})")
    warnings = _repair_warning(fixes, "기준 도곽 파일")
    outer = _largest_rect(index)
    if outer is None:
        if min(index.box.size.x, index.box.size.y) <= 0:
            raise ValueError("기준 도곽 파일의 선이 사각형 도곽을 이루지 않습니다. 도곽 하나가 그려진 파일인지 확인하세요.")
        outer = index.box
        warnings.append("기준 도곽의 바깥 테두리를 닫힌 사각형으로 확인하지 못해 선 전체 범위를 도곽으로 사용했습니다.")
    names = set()
    for ins in space.query("INSERT"):
        block = ins.block()
        if block is None or _is_xref(block):
            continue
        b = SegIndex(_segments([ins])).box
        if b is not None and b.size.x * b.size.y >= outer.size.x * outer.size.y * 0.8:
            names.add(block.name)
    base = Vec2(doc.header.get("$INSBASE", (0, 0, 0)))  # 외부참조로 삽입될 때의 기준점
    labels = _title_labels(space, outer)
    _reference = {"names": sorted(names), "ratio": outer.size.x / outer.size.y, "pattern": _pattern(index, outer),
                  "width": outer.size.x, "height": outer.size.y, "stem": _file_stem(file_name),
                  "box": BoundingBox2d([outer.extmin - base, outer.extmax - base]), "base": base, "labels": labels}
    return {"names": _reference["names"], "ratio": round(_reference["ratio"], 4), "width": outer.size.x,
            "labels": sorted(labels),
            "height": outer.size.y, "lineCount": len(_reference["pattern"]),
            "space": "Model" if space.is_modelspace else space.name, "warnings": warnings}


def _bind_reference_xrefs(doc) -> list[str]:
    """도면의 외부참조 중 기준 도곽 파일을 가리키는 것을 찾아, 기준 도곽 내용을 블록으로 넣습니다.

    외부참조 내용은 도면 파일에 없으므로, 사용자가 올린 기준 도곽 파일이 그 내용입니다.
    파일 이름(경로 제외)이나 외부참조 이름이 기준 도곽 파일 이름과 같으면 연결합니다.
    """
    stem = _reference.get("stem") if _reference else ""
    if not stem:
        return []
    bound = []
    for layout in doc.blocks:
        block = layout.block
        if not _is_xref(layout):
            continue
        path = block.dxf.get("xref_path", "") or ""
        if _file_stem(path) != stem and _file_stem(layout.name) != stem:
            continue
        block.dxf.flags = block.dxf.flags & ~(4 | 8 | 32 | 64)  # XREF·오버레이·해석됨 표시 해제
        block.dxf.discard("xref_path")
        block.dxf.base_point = Vec3(_reference["base"])
        try:
            importer = Importer(_ref_doc, doc)
            importer.import_entities([e for e in _ref_space if e.dxftype() not in ("OLE2FRAME", "IMAGE", "VIEWPORT")], layout)
            importer.finalize()
        except Exception:  # 내용을 못 넣어도 도곽 위치는 찾을 수 있음
            pass
        bound.append(layout.name)
    return bound


NUMBER_LABEL = re.compile(r"drawing\s*no|dwg\.?\s*no|도\s*면\s*번\s*호", re.I)
TITLE_LABEL = re.compile(r"^\s*(drawing\s*)?title\s*:?\s*$|도\s*면\s*명|^\s*명\s*칭\s*$", re.I)


def _text_height(e) -> float:
    return (e.dxf.get("char_height", 0) if e.dxftype() == "MTEXT" else e.dxf.get("height", 0)) or 0


def _plain(e) -> str:
    try:
        return (e.plain_text() if e.dxftype() == "MTEXT" else e.dxf.text or "").strip()
    except Exception:
        return ""


def _title_labels(space, outer: BoundingBox2d) -> dict:
    """기준 도곽 표제란의 'DRAWING NO', 'TITLE' 같은 라벨 위치(도곽 기준 0~1)와 그 칸의 범위."""
    w, h = outer.size.x, outer.size.y
    texts = []
    for e in space.query("TEXT MTEXT"):
        p = e.dxf.insert
        height = _text_height(e) or 0
        texts.append((_plain(e), (p.x - outer.extmin.x) / w, (p.y - outer.extmin.y) / h, height / h))
    labels = {}
    for kind, pattern in (("number", NUMBER_LABEL), ("title", TITLE_LABEL)):
        found = next((t for t in texts if pattern.search(t[0])), None)
        if found is None:
            continue
        _, x, y, th = found
        # 칸의 오른쪽 끝: 같은 높이대에서 오른쪽에 있는 가장 가까운 다른 라벨
        right = min((tx for s, tx, ty, _ in texts if tx > x + 0.02 and abs(ty - y) < max(th, 0.002) * 2 and s), default=1.0)
        labels[kind] = (x, y, max(th, 0.002), right)
    return labels


def _page_titles(pages: list[dict]) -> None:
    """기준 도곽 라벨 위치를 이용해 각 페이지의 도면번호·도면명을 읽어 넣습니다."""
    labels = _reference.get("labels") or {}
    if not labels or not pages:
        return
    texts = []
    for e in _doc.modelspace().query("TEXT MTEXT"):
        text = _plain(e)
        if text:
            p = e.dxf.insert
            texts.append((p.x, p.y, text, _text_height(e) or 0))
    if not texts:
        return
    xy = np.array([(x, y) for x, y, _, _ in texts])
    heights = np.array([t[3] for t in texts])
    strip = max(lab[1] + lab[2] * 3 for lab in labels.values())  # 표제란 높이대
    for page in pages:
        b = page["box"]
        nx = (xy[:, 0] - b.extmin.x) / b.size.x
        ny = (xy[:, 1] - b.extmin.y) / b.size.y
        if "number" in labels:
            x, y, th, right = labels["number"]
            hit = np.flatnonzero((nx > x + 0.005) & (nx < right) & (np.abs(ny - y) < th * 2))
            parts = [texts[i][2] for i in sorted(hit, key=lambda i: nx[i])]
            if parts:
                page["number"] = "".join(p if p.endswith(("-", "_")) else p + " " for p in parts).strip()
        if "title" in labels:
            x, y, th, right = labels["title"]
            hit = np.flatnonzero((nx > x - 0.005) & (nx < right) & (ny < y + th * 2) & (ny > -0.001))
            parts = [texts[i][2] for i in sorted(hit, key=lambda i: (-round(ny[i], 3), nx[i]))
                     if not TITLE_LABEL.search(texts[i][2])]
            if parts:
                page["name"] = " ".join(parts)
        if not page["name"]:  # 간지 등 표제란에 도면명이 없으면 도면 안의 가장 큰 글자
            inside = np.flatnonzero((nx > 0) & (nx < 1) & (ny > strip) & (ny < 1))
            if len(inside):
                page["name"] = texts[inside[np.argmax(heights[inside])]][2][:60]
        page["name"] = " ".join(page["name"].split())
        page["number"] = " ".join(page["number"].split())


def _ratio_ok(w: float, h: float) -> bool:
    return w > 0 and h > 0 and abs((w / h) / _reference["ratio"] - 1) < 0.01


def _pattern_ok(index: SegIndex, outer: BoundingBox2d) -> bool:
    pattern = _reference["pattern"]
    return len(pattern) < 3 or index.score(outer, pattern) >= 0.6


def _match_reference(msp, xrefs: Iterable[str] = ()) -> tuple[list[dict], list[str]]:
    names = set(_reference["names"])
    found: list[dict] = []
    # 블록 이름 → 블록 좌표의 도곽 경계 (일치하지 않으면 None). 기준 도곽 외부참조는 기준 도곽 경계 그대로
    blocks: dict[str, BoundingBox2d | None] = {name: _reference["box"] for name in xrefs}
    for ins in msp.query("INSERT"):
        block = ins.block()
        if block is None or (_is_xref(block) and block.name not in blocks):
            continue
        if block.name not in blocks:
            index = SegIndex(_segments(block))
            border = None
            if index.box is not None:
                if block.name in names:
                    border = _largest_rect(index) or index.box
                elif (_ratio_ok(index.box.size.x, index.box.size.y) and index.is_rect(index.box)
                      and _pattern_ok(index, index.box)):
                    border = index.box
            blocks[block.name] = border
        border = blocks[block.name]
        if border is None:
            continue
        corners = [border.extmin, Vec2(border.extmax.x, border.extmin.y), border.extmax, Vec2(border.extmin.x, border.extmax.y)]
        try:
            box = BoundingBox2d(Vec2(p) for p in ins.matrix44().transform_vertices(corners))
        except Exception:
            continue
        name, number = _attribs(ins)
        source = "기준 외부참조" if block.name in xrefs else "기준 블록"
        found.append({"box": box, "source": source, "block": block.name, "name": name, "number": number})

    # 블록이 아닌 선으로 그려진(분해된) 도곽: 긴 선 하나를 한 변으로 가정하고 나머지 세 변을 확인
    index = SegIndex(_segments(msp, depth=MAX_DEPTH))  # 블록은 펼치지 않음 (위에서 처리)
    if index.box is not None:
        min_len = max(index.box.size.x, index.box.size.y) * 0.01
        seen = set()
        for line in index.long_lines(min_len):
            for box in _rect_from_line(index, *line, ratio=_reference["ratio"]):
                key = tuple(round(v / (min(box.size.x, box.size.y) * 0.01)) for v in (*box.extmin, *box.extmax))
                if key in seen:
                    continue
                seen.add(key)
                if _ratio_ok(box.size.x, box.size.y) and _pattern_ok(index, box):
                    found.append({"box": box, "source": "기준 형상", "block": "", "name": "", "number": ""})
    return _arrange(found)


def _contains(outer: BoundingBox2d, inner: BoundingBox2d, tol: float) -> bool:
    return (outer.extmin.x - tol <= inner.extmin.x and outer.extmin.y - tol <= inner.extmin.y
            and inner.extmax.x <= outer.extmax.x + tol and inner.extmax.y <= outer.extmax.y + tol)


# ------------------------------------------------------------------- 분석
def analyze(dxf_path: str, mode: str = "model", use_reference: bool = False) -> dict:
    """도면을 읽고 페이지 후보 목록을 돌려줍니다."""
    global _doc, _pages, _cache, _entity_index
    _doc, fixes = _read(dxf_path)
    _cache = bbox.Cache()
    _entity_index = None
    warnings: list[str] = _repair_warning(fixes, "도면 파일")
    unsupported = {e.dxftype() for e in _doc.modelspace() if e.dxftype() in ("IMAGE", "OLE2FRAME", "3DSOLID", "REGION", "BODY")}
    if unsupported:
        warnings.append("표시하지 못하는 객체가 있습니다: " + ", ".join(sorted(unsupported)))
    bound = _bind_reference_xrefs(_doc) if use_reference and mode != "layouts" else []
    xrefs = [b for b in _doc.blocks if _is_xref(b)]
    if xrefs:
        listed = ", ".join(f"{b.name}({b.block.dxf.get('xref_path', '') or '경로 없음'})" for b in xrefs[:5]) + (" 외" if len(xrefs) > 5 else "")
        warnings.append(f"외부참조(XREF) 내용은 도면 파일에 없어 출력되지 않습니다: {listed}. "
                        "도곽이 외부참조라면 그 파일을 기준 도곽 파일로 올려 주세요.")
    if bound:
        count = sum(1 for e in _doc.modelspace().query("INSERT") if e.dxf.name in bound)
        warnings.append(f"외부참조 {', '.join(bound)}를 기준 도곽 파일로 연결했습니다 ({count}곳). 도곽 내용도 함께 출력합니다.")

    _pages = []
    if mode == "layouts":
        for lay in _doc.layouts:
            if lay.is_modelspace or len(lay) <= 1:
                continue
            w = lay.dxf.paper_width or 420
            h = lay.dxf.paper_height or 297
            _pages.append({"id": f"L{len(_pages) + 1}", "layout": lay.name, "name": lay.name, "number": "",
                           "source": "Layout", "width": w, "height": h})
        if not _pages:
            warnings.append("내용이 있는 Layout이 없습니다. Model Space 도곽 검출을 사용하세요.")
    else:
        if use_reference and _reference is None:
            raise ValueError("기준 도곽 파일을 먼저 읽어야 합니다.")
        frames, more = _match_reference(_doc.modelspace(), bound) if use_reference else _find_frames(_doc.modelspace())
        warnings += more
        for i, f in enumerate(frames, 1):
            b = f["box"]
            name = f["name"] or ("" if f["source"] == "기준 외부참조" else f["block"])
            _pages.append({"id": f"P{i}", "box": b, "name": name, "number": f["number"],
                           "source": f["source"], "width": b.size.x, "height": b.size.y})
        if use_reference:
            _page_titles(_pages)
        if not _pages:
            warnings.append("기준 도곽과 같은 도곽을 찾지 못했습니다. 기준 파일과 도면의 도곽이 같은 양식인지 확인하세요." if use_reference
                            else "도곽을 찾지 못했습니다. 도곽이 닫힌 사각형(폴리라인)이나 블록으로 그려져 있는지 확인하세요.")
    return {"pages": [{k: v for k, v in p.items() if k != "box"} for p in _pages], "warnings": warnings}


# ----------------------------------------------------------------- 렌더링
def _config(mono: bool, flatten: float = 0.01) -> Configuration:
    return Configuration(
        # 곡선을 직선으로 근사하는 허용 오차(도면 단위). 기본값 0.01은 큰 도면에서 지나치게 촘촘해 느림
        max_flattening_distance=flatten,
        # 점선의 가장 짧은 대시. 용지에서 약 0.2 mm보다 짧으면 보이지 않고 선 조각만 많아짐
        min_dash_length=max(flatten * 4, 0.1),
        background_policy=BackgroundPolicy.WHITE,
        color_policy=ColorPolicy.BLACK if mono else ColorPolicy.COLOR_SWAP_BW,
        min_lineweight=1.2,  # 1/300 inch 단위 ≈ 0.1 mm
    )


class EntityIndex:
    """Model Space 객체의 대략적인 경계를 한 번만 계산해 두고, 페이지 범위의 객체를 빠르게 고릅니다.

    렌더링 대상을 고르는 용도라 넉넉하게 잡습니다(문자는 글자 수만큼 넓게). 블록은 정의의
    경계를 한 번 구해 삽입 행렬로 옮기므로, 같은 블록이 많아도 빠릅니다.
    """

    def __init__(self, msp) -> None:
        self.entities = list(msp)
        block_boxes: dict[str, tuple | None] = {}
        boxes = np.empty((len(self.entities), 4))
        for i, e in enumerate(self.entities):
            boxes[i] = self._box(e, block_boxes)
        self.boxes = boxes

    @staticmethod
    def _points_box(points) -> tuple:
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        return min(xs), min(ys), max(xs), max(ys)

    def _box(self, e, block_boxes) -> tuple:
        nan = (np.nan,) * 4
        try:
            t = e.dxftype()
            if t == "LINE":
                return self._points_box([e.dxf.start, e.dxf.end])
            if t == "LWPOLYLINE":
                b = self._points_box(list(e.get_points("xy")))
                pad = max(abs(e.dxf.const_width or 0), 0)
                return b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad
            if t in ("CIRCLE", "ARC"):
                c, r = e.dxf.center, e.dxf.radius
                return c[0] - r, c[1] - r, c[0] + r, c[1] + r
            if t in ("TEXT", "ATTRIB", "MTEXT"):
                p = e.dxf.insert
                h = _text_height(e) or 1
                text = e.plain_text() if t == "MTEXT" else (e.dxf.text or "")
                reach = h * max(len(text), 1) * 1.2 + (e.dxf.get("width", 0) or 0)
                return p[0] - reach, p[1] - reach, p[0] + reach, p[1] + reach
            if t == "INSERT":
                name = e.dxf.name
                if name not in block_boxes:
                    block = e.block()
                    ext = bbox.extents(block, cache=_cache) if block is not None else None
                    # 블록 좌표의 경계. 기준점(base point)은 matrix44()가 반영함
                    block_boxes[name] = (ext.extmin, ext.extmax) if ext is not None and ext.has_data else None
                bb = block_boxes[name]
                if bb is None:
                    return nan
                (x0, y0, _), (x1, y1, _) = bb
                corners = Vec3.list([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])
                m = e.matrix44()
                pts = list(m.transform_vertices(corners))
                if e.dxf.get("column_count", 1) > 1 or e.dxf.get("row_count", 1) > 1:
                    ext = bbox.extents([e], cache=_cache)  # MINSERT는 정확히 계산
                    pts += [ext.extmin, ext.extmax] if ext.has_data else []
                for a in e.attribs:  # 속성 문자는 삽입점 주변으로 넉넉히
                    p, h = a.dxf.insert, a.dxf.get("height", 1) or 1
                    reach = h * max(len(a.dxf.text or ""), 1) * 1.2
                    pts += [(p[0] - reach, p[1] - reach), (p[0] + reach, p[1] + reach)]
                return self._points_box(pts)
            if t == "SPLINE":  # 곡선은 조정점(또는 맞춤점)들의 볼록 껍질 안에 있음
                pts = list(e.control_points) or list(e.fit_points)
                return self._points_box(pts) if pts else nan
            if t == "HATCH":
                pts = []
                for path in e.paths:
                    if hasattr(path, "vertices"):
                        pts += [v[:2] for v in path.vertices]
                    else:
                        for edge in path.edges:
                            for name in ("start", "end", "center"):
                                if hasattr(edge, name):
                                    pts.append(getattr(edge, name))
                            if hasattr(edge, "radius"):
                                c, r = edge.center, edge.radius
                                pts += [(c[0] - r, c[1] - r), (c[0] + r, c[1] + r)]
                            if hasattr(edge, "major_axis"):
                                c, r = edge.center, Vec2(edge.major_axis).magnitude
                                pts += [(c[0] - r, c[1] - r), (c[0] + r, c[1] + r)]
                            if hasattr(edge, "control_points"):
                                pts += list(edge.control_points)
                if not pts:
                    return nan
                ocs = e.ocs()  # 경계는 OCS 좌표
                return self._points_box([ocs.to_wcs((p[0], p[1], e.dxf.elevation.z)) for p in pts])
            if t == "ELLIPSE":
                c, r = e.dxf.center, Vec3(e.dxf.major_axis).magnitude
                return c[0] - r, c[1] - r, c[0] + r, c[1] + r
            if t in ("SOLID", "TRACE", "3DFACE"):
                return self._points_box([e.dxf.get(f"vtx{i}") for i in range(4) if e.dxf.hasattr(f"vtx{i}")])
            if t == "POINT":
                p = e.dxf.location
                return p[0], p[1], p[0], p[1]
            if t == "DIMENSION":  # 정의점과 치수 문자 위치로 대략
                pts = [e.dxf.get(n) for n in ("defpoint", "defpoint2", "defpoint3", "defpoint4", "defpoint5", "text_midpoint") if e.dxf.hasattr(n)]
                if pts:
                    b = self._points_box(pts)
                    pad = max(b[2] - b[0], b[3] - b[1]) * 0.2 + 1
                    return b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad
            ext = bbox.extents([e], cache=_cache)
            return (ext.extmin.x, ext.extmin.y, ext.extmax.x, ext.extmax.y) if ext.has_data else nan
        except Exception:
            return nan

    def select(self, box: BoundingBox2d) -> list:
        b = self.boxes
        with np.errstate(invalid="ignore"):
            hit = (b[:, 2] >= box.extmin.x) & (b[:, 0] <= box.extmax.x) & (b[:, 3] >= box.extmin.y) & (b[:, 1] <= box.extmax.y)
        unknown = np.isnan(b[:, 0])  # 경계를 모르는 객체는 그려 보고 잘리도록 둠
        return [self.entities[i] for i in np.flatnonzero(hit | unknown)]


_entity_index: EntityIndex | None = None
_skipped = 0  # 그리지 못하고 건너뛴 객체 수 (render_pdf가 보고)


def _record(page: dict, mono: bool, backend) -> tuple:
    """페이지 하나의 객체만 backend에 기록하고 (layout.Page, render_box)를 돌려줍니다."""
    global _entity_index
    ctx = RenderContext(_doc)
    # 도곽 폭의 1/8000 (A3 출력 기준 약 0.05 mm) 정도면 눈으로 구분되지 않음
    flatten = max(page["width"], page["height"]) / 8000 if "box" in page else 0.01
    frontend = Frontend(ctx, backend, config=_config(mono, flatten))
    if "layout" in page:
        lay = _doc.layouts.get(page["layout"])
        frontend.draw_layout(lay)
        return lay, None
    box: BoundingBox2d = page["box"]
    pad = max(box.size.x, box.size.y) * 0.003
    render_box = BoundingBox2d([box.extmin - Vec2(pad, pad), box.extmax + Vec2(pad, pad)])
    msp = _doc.modelspace()
    if _entity_index is None:
        _entity_index = EntityIndex(msp)
    # Frontend.draw_layout과 같은 준비를 하고, 페이지 범위의 객체만 그림
    ctx.set_current_layout(msp)
    frontend.set_background(ctx.current_layout_properties.background_color)
    frontend.parent_stack = []
    global _skipped
    for e in _entity_index.select(render_box):
        try:
            frontend.draw_entities([e])
        except Exception:  # 손상된 객체 하나 때문에 페이지 전체가 실패하지 않게
            _skipped += 1
    frontend.pipeline.finalize()
    return None, render_box


def _paper(page: dict, paper: str, lay) -> layout.Page:
    if paper == "layout" and lay is not None:
        return layout.Page.from_dxf_layout(lay)
    w, h = PAPERS.get(paper, PAPERS["A3"])
    if page["width"] < page["height"]:
        w, h = h, w
    # 일반 도면처럼 사방에 여백: 짧은 변의 4% (A3 12 mm, A4 8 mm) → 도곽은 용지의 약 92~94% 크기
    return layout.Page(w, h, layout.Units.mm, margins=layout.Margins.all(min(w, h) * 0.04))


def thumbnail(page_id: str, mono: bool = True) -> str:
    page = _get(page_id)
    be = svg.SVGBackend()
    lay, box = _record(page, mono, be)
    ratio = page["width"] / page["height"] if page["height"] else 1.414
    w = 240 if ratio >= 1 else 240 * ratio
    out = layout.Page(w, w / ratio if ratio >= 1 else 240, layout.Units.mm)
    return be.get_string(out, settings=layout.Settings(fit_page=True, output_coordinate_space=1200), render_box=box, xml_declaration=False)


def take_skipped() -> int:
    """마지막 확인 이후 그리지 못하고 건너뛴 객체 수를 돌려주고 0으로 되돌립니다."""
    global _skipped
    count, _skipped = _skipped, 0
    return count


def render_pdf(page_ids: Iterable[str], paper: str = "A3", mono: bool = True, progress=None) -> bytes:
    writer = PdfWriter()
    page_ids = list(page_ids)
    for done, pid in enumerate(page_ids):
        if progress is not None:
            progress(done, len(page_ids))
        page = _get(pid)
        be = PdfBackend()
        lay, box = _record(page, mono, be)
        writer.add_page(*be.get_page(_paper(page, paper, lay), render_box=box))
    return writer.to_bytes()


def _get(page_id: str) -> dict:
    for p in _pages:
        if p["id"] == page_id:
            return p
    raise KeyError(f"페이지 {page_id}를 찾을 수 없습니다.")


# ---------------------------------------------------------------- PDF 출력
class PdfRenderBackend(svg.SVGRenderBackend):
    """ezdxf SVG 백엔드와 같은 좌표계로 PDF 콘텐츠 스트림을 만듭니다."""

    def __init__(self, page: layout.Page, settings: layout.Settings) -> None:
        super().__init__(page, settings)
        self.view_box = svg.make_view_box(page, settings.output_coordinate_space)
        self.ops: list[str] = []
        self.background_color = "#ffffff"

    def set_background(self, color) -> None:
        self.background_color = color[:7]

    @staticmethod
    def _rgb(color: str) -> str:
        return " ".join(f"{int(color[i:i + 2], 16) / 255:.3f}" for i in (1, 3, 5))

    def add_strokes(self, d: str, properties) -> None:
        if d and properties.color[7:9] != "00":
            self.ops.append(f"{self._rgb(properties.color)} RG {self.resolve_stroke_width(properties.lineweight)} w\n{d} S")

    def add_filling(self, d: str, properties) -> None:
        if d and properties.color[7:9] != "00":
            self.ops.append(f"{self._rgb(properties.color)} rg\n{d} f*")

    @staticmethod
    def make_polyline_str(points, close=False) -> str:
        if len(points) < 2:
            return ""
        d = [f"{points[0].x:.0f} {points[0].y:.0f} m"] + [f"{p.x:.0f} {p.y:.0f} l" for p in points[1:]]
        if close:
            d.append("h")
        return " ".join(d)

    @staticmethod
    def make_multi_line_str(lines) -> str:
        return " ".join(f"{s.x:.0f} {s.y:.0f} m {e.x:.0f} {e.y:.0f} l" for s, e in lines)

    @staticmethod
    def make_path_str(path, close=False) -> str:
        if len(path) == 0:
            return ""
        d = [f"{path.start.x:.0f} {path.start.y:.0f} m"]
        cur = path.start
        for cmd in path.commands():
            end = cmd.end
            if cmd.type == Command.MOVE_TO:
                d.append(f"{end.x:.0f} {end.y:.0f} m")
            elif cmd.type == Command.LINE_TO:
                d.append(f"{end.x:.0f} {end.y:.0f} l")
            elif cmd.type == Command.CURVE3_TO:  # PDF는 3차 곡선만 지원
                c1 = cur + (cmd.ctrl - cur) * (2 / 3)
                c2 = end + (cmd.ctrl - end) * (2 / 3)
                d.append(f"{c1.x:.0f} {c1.y:.0f} {c2.x:.0f} {c2.y:.0f} {end.x:.0f} {end.y:.0f} c")
            elif cmd.type == Command.CURVE4_TO:
                d.append(f"{cmd.ctrl1.x:.0f} {cmd.ctrl1.y:.0f} {cmd.ctrl2.x:.0f} {cmd.ctrl2.y:.0f} {end.x:.0f} {end.y:.0f} c")
            cur = end
        if close:
            d.append("h")
        return " ".join(d)

    def content(self, page: layout.Page) -> tuple[float, float, bytes]:
        pt = 72 / 25.4
        w, h = page.width_in_mm * pt, page.height_in_mm * pt
        s = w / self.view_box[0]
        head = [f"{self._rgb(self.background_color)} rg 0 0 {w:.2f} {h:.2f} re f",
                f"{s:.8f} 0 0 {-s:.8f} 0 {h:.2f} cm 1 J 1 j"]
        return w, h, "\n".join(head + self.ops).encode("ascii")


class PdfBackend(svg.SVGBackend):
    @staticmethod
    def make_backend(page, settings):
        return PdfRenderBackend(page, settings)

    def get_page(self, page: layout.Page, render_box=None) -> tuple[float, float, bytes]:
        # SVGBackend.get_xml_root_element의 배치 과정을 그대로 사용
        settings = layout.Settings(fit_page=True)
        player = self.player()
        if render_box is None:
            render_box = player.bbox()
        out = layout.Layout(render_box, flip_y=True)
        final = out.get_final_page(page, settings)
        settings = copy.copy(settings)
        player.transform(out.get_placement_matrix(final, settings=settings, top_origin=True))
        backend = PdfRenderBackend(final, settings)
        player.replay(backend)
        return backend.content(final)


class PdfWriter:
    """여러 페이지 벡터 PDF를 만드는 최소 구현입니다."""

    def __init__(self) -> None:
        self.pages: list[tuple[float, float, bytes]] = []

    def add_page(self, width: float, height: float, content: bytes) -> None:
        self.pages.append((width, height, content))

    def to_bytes(self) -> bytes:
        objs: list[bytes] = [b"", b""]  # 1: Catalog, 2: Pages
        kids = []
        for w, h, content in self.pages:
            data = zlib.compress(content, 6)
            objs.append(b"<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(data) + data + b"\nendstream")
            objs.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.2f %.2f] /Contents %d 0 R /Resources << >> >>" % (w, h, len(objs)))
            kids.append(len(objs))
        objs[0] = b"<< /Type /Catalog /Pages 2 0 R >>"
        objs[1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % k for k in kids), len(kids))
        out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = []
        for i, obj in enumerate(objs, 1):
            offsets.append(len(out))
            out += b"%d 0 obj\n" % i + obj + b"\nendobj\n"
        xref = len(out)
        out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
        out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
        out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
        return bytes(out)
