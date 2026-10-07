# DWG → PDF (브라우저 변환)

서버·APS 없이 브라우저에서 DWG/DXF의 도곽을 찾아 도곽 하나를 PDF 한 페이지로 출력합니다.

- `worker.mjs` — 페이지(`../dwg-pdf.js`)가 띄우는 Web Worker
- `engine.mjs` — LibreDWG(WASM)로 DWG→DXF, Pyodide에서 `dwg_sheets.py` 실행
- `dwg_sheets.py` — 도곽 검출, 정렬, SVG 미리보기, 벡터 PDF 생성
  - 기준 도곽 파일이 있으면: 도곽을 가로·세로 선분의 집합으로 인식(끊긴 선·튀어나온 모서리·꼭짓점 많은 폴리라인·중첩 블록·Layout에 그린 도곽 지원). 도면에서는 같은 블록 이름, 또는 비율(±1%)과 내부 선 배치(60% 이상 일치)가 같은 블록·선 도곽을 찾음
  - 없으면: 이름에 도곽·TITLE·FRAME 등이 있거나 사각형 테두리를 가진 블록, A계열 비율의 사각형
- `vendor/` — LibreDWG WASM, ezdxf wheel, 나눔고딕 (고지: `NOTICE.md`)

## 테스트

```bash
cd dwg
npm ci
npm test   # 실제 WASM + Pyodide로 test/fixtures의 DWG 변환 (자동 검출·기준 도곽 모드)
```

Pyodide 패키지(numpy 등)는 jsDelivr에서 내려받으므로 인터넷 연결이 필요합니다.

## 성능

객체 경계를 한 번만 계산해 페이지별로 numpy로 골라 그립니다. 객체 12만 개(DXF 300만 줄) 기준 브라우저 엔진에서 분석 약 35초, 미리보기 장당 2초, PDF 10쪽 4초입니다. 분석 시간은 대부분 ezdxf recover 읽기입니다.

## 한계

XREF·이미지·3D 솔리드(ACIS)는 그리지 않고 경고로 표시합니다. SHX 글꼴은 나눔고딕으로 대체합니다. 선 굵기는 객체 Lineweight를 따르며 CTB/STB는 적용하지 않습니다. 매우 큰 도면은 브라우저 메모리와 속도의 영향을 받습니다.
