import ezdxf, math
doc = ezdxf.new("R2000", setup=True)
doc.styles.add("KOR", font="NanumGothic.ttf")
msp = doc.modelspace()
# A3 도곽 블록 (420x297) + 표제란
blk = doc.blocks.new("도곽_A3")
blk.add_lwpolyline([(0,0),(420,0),(420,297),(0,297)], close=True)
blk.add_lwpolyline([(10,10),(410,10),(410,287),(10,287)], close=True, dxfattribs={"const_width":0.7})
blk.add_lwpolyline([(290,10),(410,10),(410,50),(290,50)], close=True)
blk.add_line((290,30),(410,30))
blk.add_attdef("DWGNAME", (295,36), dxfattribs={"height":5,"style":"KOR"})
blk.add_attdef("DWGNO", (295,16), dxfattribs={"height":5,"style":"KOR"})

def content(ox, oy, s, kind):
    if kind == 0:   # 평면도: 방 구획
        for x in range(4):
            msp.add_lwpolyline([(ox+(40+x*70)*s,oy+80*s),(ox+(100+x*70)*s,oy+80*s),(ox+(100+x*70)*s,oy+220*s),(ox+(40+x*70)*s,oy+220*s)], close=True)
        msp.add_text("평면도  1/%d" % s, dxfattribs={"height":6*s,"style":"KOR"}).set_placement((ox+40*s, oy+235*s))
        d = msp.add_linear_dim(base=(ox+40*s, oy+70*s), p1=(ox+40*s,oy+80*s), p2=(ox+100*s,oy+80*s), dimstyle="EZDXF"); d.render()
    elif kind == 1: # 입면도: 원, 해치
        msp.add_circle((ox+150*s, oy+150*s), 60*s)
        h = msp.add_hatch(color=3); h.paths.add_polyline_path([(ox+230*s,oy+100*s),(ox+330*s,oy+100*s),(ox+330*s,oy+200*s),(ox+230*s,oy+200*s)]); h.set_pattern_fill("ANSI31", scale=2*s)
        msp.add_text("입면도  1/%d" % s, dxfattribs={"height":6*s,"style":"KOR"}).set_placement((ox+40*s, oy+235*s))
    else:           # 상세도: 곡선
        pts=[(ox+(40+i*6)*s, oy+(150+50*math.sin(i/4))*s) for i in range(45)]
        msp.add_spline(pts)
        msp.add_text("상세도  1/%d" % s, dxfattribs={"height":6*s,"style":"KOR"}).set_placement((ox+40*s, oy+235*s))

sheets = [((0,0),100,"1층 평면도","A-101"), ((50000,0),100,"정면도","A-201"), ((0,-40000),50,"계단 상세도","A-501")]
for i,((x,y),s,name,no) in enumerate(sheets):
    ins = msp.add_blockref("도곽_A3", (x,y), dxfattribs={"xscale":s,"yscale":s})
    ins.add_auto_attribs({"DWGNAME":name,"DWGNO":no})
    content(x,y,s,i)
# 4번째: 블록이 아닌, 분해된(선으로만 그린) 도곽 — 휴리스틱 테스트
x,y,s=50000,-40000,50
msp.add_lwpolyline([(x,y),(x+420*s,y),(x+420*s,y+297*s),(x,y+297*s)], close=True)
msp.add_lwpolyline([(x+10*s,y+10*s),(x+410*s,y+10*s),(x+410*s,y+287*s),(x+10*s,y+287*s)], close=True)
msp.add_text("배치도 (분해된 도곽)", dxfattribs={"height":6*s,"style":"KOR"}).set_placement((x+300*s,y+20*s))
content(x,y,s,0)
doc.saveas("test_sheets.dxf")
