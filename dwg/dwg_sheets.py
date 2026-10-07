"""DXF 도면에서 도곽을 찾아 도곽 하나를 PDF 한 페이지로 출력합니다.

브라우저(Pyodide)와 일반 Python 모두에서 동작하며 외부 서비스를 사용하지 않습니다.
DWG는 LibreDWG(dwg2dxf)로 DXF로 바꾼 뒤 이 모듈에 전달합니다.
"""
from __future__ import annotations

import copy
import re
import statistics
import zlib
from typing import Iterable

from ezdxf import bbox, recover
from ezdxf.addons.drawing import Frontend, RenderContext, layout, svg
from ezdxf.addons.drawing.config import (
    BackgroundPolicy,
    ColorPolicy,
    Configuration,
)
from ezdxf.fonts import fonts
from ezdxf.math import BoundingBox2d, Vec2
from ezdxf.path import Command

FRAME_NAME = re.compile(r"도곽|표제|title|frame|border|sheet|form|dogak", re.I)
NAME_TAG = re.compile(r"도면명|명칭|title|name|dwg_?nm|dwgname", re.I)
NUMBER_TAG = re.compile(r"도면\s*번호|번호|no\b|num|dwg_?no|dwgno", re.I)
PAPERS = {"A4": (297, 210), "A3": (420, 297), "A2": (594, 420), "A1": (841, 594), "A0": (1189, 841)}
MAX_PAGES = 300

_doc = None
_pages: list[dict] = []
_cache = None


# --------------------------------------------------------------------- 폰트
def setup_fonts(folder: str, fallback: str) -> None:
    """도면 폰트(SHX 포함)를 찾지 못하면 한글이 있는 fallback TTF로 그립니다."""
    fonts.font_manager.clear()
    fonts.font_manager.scan_all([folder])
    fonts.font_manager._fallback_font_name = fallback


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
    for e in block:
        pts = _polyline_points(e)
        box = _rect_box(pts) if pts else None
        if box and box.size.x >= full.size.x * 0.97 and box.size.y >= full.size.y * 0.97:
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

    rects = []
    for e in msp:
        pts = _polyline_points(e)
        box = _rect_box(pts) if pts else None
        if box and abs(_ratio(box) - 2 ** 0.5) < 0.03:  # A계열 용지 비율
            rects.append({"box": box, "source": "사각형", "block": "", "name": "", "number": ""})
    if rects:
        areas = [f["box"].size.x * f["box"].size.y for f in found]
        limit = min(areas) * 0.5 if areas else max(r["box"].size.x * r["box"].size.y for r in rects) * 0.2
        found += [r for r in rects if r["box"].size.x * r["box"].size.y >= limit]

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


def _contains(outer: BoundingBox2d, inner: BoundingBox2d, tol: float) -> bool:
    return (outer.extmin.x - tol <= inner.extmin.x and outer.extmin.y - tol <= inner.extmin.y
            and inner.extmax.x <= outer.extmax.x + tol and inner.extmax.y <= outer.extmax.y + tol)


# ------------------------------------------------------------------- 분석
def analyze(dxf_path: str, mode: str = "model") -> dict:
    """도면을 읽고 페이지 후보 목록을 돌려줍니다."""
    global _doc, _pages, _cache
    _doc, auditor = recover.readfile(dxf_path)
    _cache = bbox.Cache()
    warnings: list[str] = []
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
        frames, more = _find_frames(_doc.modelspace())
        warnings += more
        for i, f in enumerate(frames, 1):
            b = f["box"]
            _pages.append({"id": f"P{i}", "box": b, "name": f["name"] or f["block"], "number": f["number"],
                           "source": f["source"], "width": b.size.x, "height": b.size.y})
        if not _pages:
            warnings.append("도곽을 찾지 못했습니다. 도곽이 닫힌 사각형(폴리라인)이나 블록으로 그려져 있는지 확인하세요.")
    return {"pages": [{k: v for k, v in p.items() if k != "box"} for p in _pages], "warnings": warnings}


# ----------------------------------------------------------------- 렌더링
def _config(mono: bool) -> Configuration:
    return Configuration(
        background_policy=BackgroundPolicy.WHITE,
        color_policy=ColorPolicy.BLACK if mono else ColorPolicy.COLOR_SWAP_BW,
        min_lineweight=1.2,  # 1/300 inch 단위 ≈ 0.1 mm
    )


def _record(page: dict, mono: bool, backend) -> tuple:
    """페이지 하나의 객체만 backend에 기록하고 (layout.Page, render_box)를 돌려줍니다."""
    ctx = RenderContext(_doc)
    frontend = Frontend(ctx, backend, config=_config(mono))
    if "layout" in page:
        lay = _doc.layouts.get(page["layout"])
        frontend.draw_layout(lay)
        return lay, None
    box: BoundingBox2d = page["box"]
    pad = max(box.size.x, box.size.y) * 0.003
    render_box = BoundingBox2d([box.extmin - Vec2(pad, pad), box.extmax + Vec2(pad, pad)])

    def inside(e) -> bool:
        ext = bbox.extents([e], cache=_cache)
        return ext.has_data and render_box.has_intersection(BoundingBox2d([ext.extmin, ext.extmax]))

    frontend.draw_layout(_doc.modelspace(), filter_func=inside)
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
