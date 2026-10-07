"""기준 도곽(reference.dwg)과 그 도곽을 사용하는 도면(drawing.dwg) 테스트 자료를 만듭니다.

도곽: 블록 이름에 키워드가 없고(SHEET_K) A계열 비율이 아닌 800x500 양식.
도면: 블록 3개(축척 다름), 선분 4개로 분해된 도곽 1개, 같은 비율의 일반 사각형과
A계열 비율의 큰 사각형(오검출 유도용)을 포함합니다.
"""
import subprocess
import ezdxf

W, H = 800, 500
INNER = [(10, 10, 790, 490), (560, 10, 790, 90), (560, 50, 790, 90)]  # 내곽선, 표제란, 표제란 윗칸


def frame_geometry(add_rect, add_text):
    add_rect(0, 0, W, H)
    for r in INNER:
        add_rect(*r)
    add_text("도면명", 570, 65)


def split_border_lines(over=0.0):
    """바깥 테두리를 표제란 경계(x=560)와 임의 위치에서 끊고, 모서리를 over만큼 튀어나오게 그립니다."""
    return [((-over, 0), (560, 0)), ((560, 0), (W + over, 0)),
            ((W, -over), (W, 90)), ((W, 90), (W, H + over)),
            ((W + over, H), (300, H)), ((300, H), (-over, H)),
            ((0, H + over), (0, -over))]


def make_reference_variants():
    """실제 도곽 파일에서 흔한 그리기 방식 4가지 (DXF)"""
    def base(doc):
        doc.styles.add("KOR", font="NanumGothic.ttf")
        return doc

    # 1) 끊기고 모서리가 튀어나온 선 + 도곽 밖 메모
    doc = base(ezdxf.new("R2000")); msp = doc.modelspace()
    for a, b in split_border_lines(over=3):
        msp.add_line(a, b)
    for x0, y0, x1, y1 in INNER:
        msp.add_lwpolyline([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], close=True)
    msp.add_text("※ 도곽 사용 안내 메모", dxfattribs={"height": 10, "style": "KOR"}).set_placement((0, -60))
    doc.saveas("ref-lines.dxf")

    # 2) 꼭짓점 8개인 닫힌 폴리라인 테두리 + 선분 내부
    doc = base(ezdxf.new("R2000")); msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (300, 0), (560, 0), (W, 0), (W, 90), (W, H), (300, H), (0, H)], close=True)
    for x0, y0, x1, y1 in INNER:
        for a, b in [((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))]:
            msp.add_line(a, b)
    doc.saveas("ref-poly8.dxf")

    # 3) 중첩 블록 (FRAME_BODY를 담은 HDR_BLOCK)
    doc = base(ezdxf.new("R2000"))
    inner = doc.blocks.new("FRAME_BODY")
    inner.add_lwpolyline([(0, 0), (W, 0), (W, H), (0, H)], close=True)
    for x0, y0, x1, y1 in INNER:
        inner.add_lwpolyline([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], close=True)
    outer = doc.blocks.new("HDR_BLOCK")
    outer.add_blockref("FRAME_BODY", (0, 0))
    doc.modelspace().add_blockref("HDR_BLOCK", (1000, 2000), dxfattribs={"xscale": 2, "yscale": 2})
    doc.saveas("ref-nested.dxf")

    # 4) Layout(Paper Space)에 그린 도곽, Model Space는 비어 있음
    doc = base(ezdxf.new("R2000"))
    ps = doc.layouts.get("Layout1")
    for a, b in split_border_lines():
        ps.add_line(a, b)
    for x0, y0, x1, y1 in INNER:
        ps.add_lwpolyline([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], close=True)
    doc.saveas("ref-layout.dxf")


def make_reference():
    doc = ezdxf.new("R2000")
    doc.styles.add("KOR", font="NanumGothic.ttf")
    blk = doc.blocks.new("SHEET_K")
    frame_geometry(lambda *r: blk.add_lwpolyline([(r[0], r[1]), (r[2], r[1]), (r[2], r[3]), (r[0], r[3])], close=True),
                   lambda t, x, y: None)
    blk.add_attdef("TITLE", (570, 65), dxfattribs={"height": 12, "style": "KOR"})
    blk.add_attdef("NO", (570, 25), dxfattribs={"height": 12, "style": "KOR"})
    doc.modelspace().add_blockref("SHEET_K", (0, 0))
    return doc


def make_drawing(ref_doc):
    doc = ezdxf.new("R2000")
    doc.styles.add("KOR", font="NanumGothic.ttf")
    blk = doc.blocks.new("SHEET_K")
    for e in ref_doc.blocks.get("SHEET_K"):
        blk.add_entity(e.copy())
    msp = doc.modelspace()
    sheets = [((0, 0), 10, "배치도", "C-001"), ((10000, 0), 10, "단면도", "C-002"), ((0, -8000), 5, "상세도", "C-003")]
    for (x, y), s, name, no in sheets:
        ins = msp.add_blockref("SHEET_K", (x, y), dxfattribs={"xscale": s, "yscale": s})
        ins.add_auto_attribs({"TITLE": name, "NO": no})
        msp.add_circle((x + 300 * s, y + 280 * s), 120 * s)
        msp.add_text(name, dxfattribs={"height": 20 * s, "style": "KOR"}).set_placement((x + 40 * s, y + 440 * s))

    # 선분으로 분해된 도곽 (축척 5)
    ox, oy, s = 10000, -8000, 5

    def lines(x0, y0, x1, y1):
        pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        for a, b in zip(pts, pts[1:] + pts[:1]):
            msp.add_line((ox + a[0] * s, oy + a[1] * s), (ox + b[0] * s, oy + b[1] * s))
    for a, b in split_border_lines():
        msp.add_line((ox + a[0] * s, oy + a[1] * s), (ox + b[0] * s, oy + b[1] * s))
    for r in INNER[1:]:
        lines(*r)
    lines(*INNER[0])
    msp.add_text("분해된 도곽", dxfattribs={"height": 20 * s, "style": "KOR"}).set_placement((ox + 40 * s, oy + 440 * s))

    # 오검출 유도: 도곽과 같은 비율이지만 표제란이 없는 사각형, A계열 비율의 큰 사각형
    msp.add_lwpolyline([(20000, 0), (24000, 0), (24000, 2500), (20000, 2500)], close=True)
    msp.add_lwpolyline([(20000, -8000), (25940, -8000), (25940, -3800), (20000, -3800)], close=True)
    return doc


make_reference_variants()
ref = make_reference()
ref.saveas("reference.dxf")
make_drawing(ref).saveas("drawing.dxf")
for name in ("reference", "drawing"):
    subprocess.run(["dxf2dwg", "-y", "-o", f"{name}.dwg", f"{name}.dxf"], check=True, capture_output=True)
