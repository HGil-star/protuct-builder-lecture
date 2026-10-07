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
    lines(0, 0, W, H)
    for r in INNER:
        lines(*r)
    msp.add_text("분해된 도곽", dxfattribs={"height": 20 * s, "style": "KOR"}).set_placement((ox + 40 * s, oy + 440 * s))

    # 오검출 유도: 도곽과 같은 비율이지만 표제란이 없는 사각형, A계열 비율의 큰 사각형
    msp.add_lwpolyline([(20000, 0), (24000, 0), (24000, 2500), (20000, 2500)], close=True)
    msp.add_lwpolyline([(20000, -8000), (25940, -8000), (25940, -3800), (20000, -3800)], close=True)
    return doc


ref = make_reference()
ref.saveas("reference.dxf")
make_drawing(ref).saveas("drawing.dxf")
for name in ("reference", "drawing"):
    subprocess.run(["dxf2dwg", "-y", "-o", f"{name}.dwg", f"{name}.dxf"], check=True, capture_output=True)
