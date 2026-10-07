"""DXF 도면에서 도곽을 찾아 도곽 하나를 PDF 한 페이지로 출력합니다.

브라우저(Pyodide)와 일반 Python 모두에서 동작하며 외부 서비스를 사용하지 않습니다.
DWG는 LibreDWG(dwg2dxf)로 DXF로 바꾼 뒤 이 모듈에 전달합니다.
"""
from __future__ import annotations

import bisect
import copy
import re
import statistics
import zlib
from collections import Counter
from typing import Iterable

from ezdxf import bbox, recover
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


def _name_table_entries(pairs: list[bytes]) -> tuple[list[bytes], int]:
    """TABLES 섹션에서 이름(그룹 코드 2)이 없거나 빈 항목에 고유한 이름을 붙입니다."""
    block_names: dict[bytes, bytes] = {}  # 블록 레코드 핸들 → BLOCK 이름
    for k in range(0, len(pairs) - 1, 2):
        if pairs[k] == b"0" and pairs[k + 1].strip() == b"BLOCK":
            owner = name = None
            j = k + 2
            while j < len(pairs) - 1 and pairs[j] != b"0":
                if pairs[j] == b"330" and owner is None:
                    owner = pairs[j + 1].strip()
                elif pairs[j] == b"2" and name is None and pairs[j + 1].strip():
                    name = pairs[j + 1].strip()
                j += 2
            if owner and name:
                block_names[owner] = name
    out: list[bytes] = []
    fixed = 0
    in_tables = False
    k = 0
    n = len(pairs)
    while k < n - 1:
        code, value = pairs[k], pairs[k + 1]
        if code == b"2" and k >= 2 and pairs[k - 2] == b"0" and pairs[k - 1].strip() == b"SECTION":
            in_tables = value.strip() == b"TABLES"
        if not (in_tables and code == b"0" and value.strip() in TABLE_ENTRIES):
            out += [code, value]
            k += 2
            continue
        # 항목 하나: 다음 (0, ...)까지
        end = k + 2
        while end < n - 1 and pairs[end] != b"0":
            end += 2
        entry = pairs[k:end]
        names = [i for i in range(2, len(entry) - 1, 2) if entry[i] == b"2"]
        if not names or not entry[names[0] + 1].strip():
            handle = next((entry[i + 1].strip() for i in range(2, len(entry) - 1, 2) if entry[i] in (b"5", b"105")), b"%d" % k)
            # 블록 레코드는 BLOCKS 섹션의 BLOCK(소유자=이 레코드)에 원래 이름이 있음
            name = block_names.get(handle) if value.strip() == b"BLOCK_RECORD" else None
            name = name or "_이름없음_".encode() + handle
            if names:
                entry[names[0] + 1] = name
            else:
                # 이름은 마지막 하위 클래스 표시(예: AcDbLinetypeTableRecord) 다음에 와야 함
                marker = next((i for i in range(len(entry) - 2, 1, -2) if entry[i] == b"100" and entry[i + 1].strip().endswith(b"TableRecord")), None)
                at = marker + 2 if marker is not None else len(entry)
                entry[at:at] = [b"2", name]
            fixed += 1
        out += entry
        k = end
    out += pairs[k:]
    return out, fixed


def _repair_dxf(path: str) -> int:
    """LibreDWG 출력에서 ezdxf가 읽지 못하는 부분을 고치고, 고친 곳의 수를 돌려줍니다.

    1) 줄바꿈이 섞인 문자열: LibreDWG의 줄 끝은 항상 CRLF이므로 CRLF로만 줄을 나누고,
       값 안의 단독 LF/CR은 공백으로 바꿉니다. 그래도 그룹 코드 자리에 값이 오면 앞 값에 합칩니다.
    2) 이름이 없는 레이어·선종류·블록 등 테이블 항목: 고유한 이름을 붙입니다.
    3) 핸들이 0이거나 잘못된 객체: 쓰지 않는 새 핸들을 붙이고 $HANDSEED를 늘립니다.
    """
    with open(path, "rb") as f:
        data = f.read()
    lines = data.split(b"\r\n") if b"\r\n" in data[:4096] else data.splitlines()
    out: list[bytes] = []
    fixes = i = 0
    n = len(lines)
    while i < n:
        code = lines[i]
        if not _is_group_code(code):
            if not code.strip() and i == n - 1:
                break  # 파일 끝 빈 줄
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

    out, named = _name_table_entries(out)
    fixes += named

    # 객체 핸들(그룹 코드 5, DIMSTYLE은 105)이 0이거나 16진수가 아니면 새 핸들 부여
    seed_at = None
    used = 0
    bad = []
    for k in range(0, len(out) - 1, 2):
        code, value = out[k], out[k + 1]
        if code == b"9" and value.strip() == b"$HANDSEED":
            seed_at = k + 3  # 다음 쌍(5, 값)의 값
        elif code in (b"5", b"105") and k + 1 != seed_at:
            if k >= 2 and out[k - 2] == b"0":  # 객체 시작(0, 종류) 바로 다음의 핸들만
                if _valid_handle(value):
                    used = max(used, int(value.strip(), 16))
                else:
                    bad.append(k + 1)
    if seed_at is not None and seed_at < len(out) and _valid_handle(out[seed_at]):
        used = max(used, int(out[seed_at].strip(), 16) - 1)
    for k in bad:
        used += 1
        out[k] = b"%X" % used
    if bad and seed_at is not None and seed_at < len(out):
        out[seed_at] = b"%X" % (used + 1)
    fixes += len(bad)

    with open(path, "wb") as f:
        f.write(b"\n".join(out) + b"\n")
    return fixes


def _read(path: str):
    """DXF를 읽고 (문서, 복구한 곳 수)를 돌려줍니다.

    ezdxf recover는 LibreDWG의 \\U+XXXX 한글 표기를 풀고 잘못된 객체를 고쳐 주므로
    일반 읽기보다 느려도 이것을 씁니다. 읽지 못하면 _repair_dxf로 고친 뒤 다시 읽습니다.
    """
    try:
        doc, _ = recover.readfile(path)
        fixes = 0
    except Exception:  # 줄 구조·핸들 0·이름 없는 테이블 항목 등
        fixes = _repair_dxf(path)
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
    return [f"{what}의 DWG 변환 결과에서 읽을 수 없는 부분 {fixes}곳을 복구했습니다(깨진 문자열·잘못된 객체 번호·이름 없는 레이어/블록 등). 줄바꿈이 포함된 글자는 한 줄로 표시될 수 있습니다."]


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
            if dy <= length * 1e-6:
                out.append((H, (a.y + b.y) / 2, min(a.x, b.x), max(a.x, b.x)))
            elif dx <= length * 1e-6:
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


def reference(dxf_path: str) -> dict:
    """기준 도곽 파일에서 도곽의 블록 이름·가로세로 비율·내부 선 배치를 읽습니다."""
    global _reference
    doc, fixes = _read(dxf_path)
    space = _frame_space(doc)
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
    _reference = {"names": sorted(names), "ratio": outer.size.x / outer.size.y, "pattern": _pattern(index, outer),
                  "width": outer.size.x, "height": outer.size.y}
    return {"names": _reference["names"], "ratio": round(_reference["ratio"], 4), "width": outer.size.x,
            "height": outer.size.y, "lineCount": len(_reference["pattern"]),
            "space": "Model" if space.is_modelspace else space.name, "warnings": warnings}


def _ratio_ok(w: float, h: float) -> bool:
    return w > 0 and h > 0 and abs((w / h) / _reference["ratio"] - 1) < 0.01


def _pattern_ok(index: SegIndex, outer: BoundingBox2d) -> bool:
    pattern = _reference["pattern"]
    return len(pattern) < 3 or index.score(outer, pattern) >= 0.6


def _match_reference(msp) -> tuple[list[dict], list[str]]:
    names = set(_reference["names"])
    found: list[dict] = []
    blocks: dict[str, BoundingBox2d | None] = {}  # 블록 이름 → 블록 좌표의 도곽 경계 (일치하지 않으면 None)
    for ins in msp.query("INSERT"):
        block = ins.block()
        if block is None or _is_xref(block):
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
        found.append({"box": box, "source": "기준 블록", "block": block.name, "name": name, "number": number})

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
    xrefs = [b.name for b in _doc.blocks if _is_xref(b)]
    if xrefs:
        warnings.append("외부참조(XREF)는 포함되지 않습니다: " + ", ".join(xrefs[:5]) + (" 외" if len(xrefs) > 5 else ""))

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
        frames, more = (_match_reference if use_reference else _find_frames)(_doc.modelspace())
        warnings += more
        for i, f in enumerate(frames, 1):
            b = f["box"]
            _pages.append({"id": f"P{i}", "box": b, "name": f["name"] or f["block"], "number": f["number"],
                           "source": f["source"], "width": b.size.x, "height": b.size.y})
        if not _pages:
            warnings.append("기준 도곽과 같은 도곽을 찾지 못했습니다. 기준 파일과 도면의 도곽이 같은 양식인지 확인하세요." if use_reference
                            else "도곽을 찾지 못했습니다. 도곽이 닫힌 사각형(폴리라인)이나 블록으로 그려져 있는지 확인하세요.")
    return {"pages": [{k: v for k, v in p.items() if k != "box"} for p in _pages], "warnings": warnings}


# ----------------------------------------------------------------- 렌더링
def _config(mono: bool) -> Configuration:
    return Configuration(
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
                h = e.dxf.get("height", 0) or e.dxf.get("char_height", 0) or 1
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
                if e.dxf.get("column_count", 1) > 1 or e.dxf.get("row_count", 1) > 1 or len(e.attribs):
                    ext = bbox.extents([e], cache=_cache)  # MINSERT·속성은 정확히 계산
                    pts += [ext.extmin, ext.extmax] if ext.has_data else []
                return self._points_box(pts)
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
    frontend = Frontend(ctx, backend, config=_config(mono))
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
    return layout.Page(w, h, layout.Units.mm)


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


def render_pdf(page_ids: Iterable[str], paper: str = "A3", mono: bool = True) -> bytes:
    writer = PdfWriter()
    for pid in page_ids:
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
