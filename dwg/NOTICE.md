# 오픈소스 고지

DWG → PDF 변환은 아래 오픈소스 소프트웨어를 사용해 브라우저 안에서 실행됩니다. 도면 파일은 서버로 전송되지 않습니다.

| 구성 요소 | 용도 | 라이선스 | 소스 |
|---|---|---|---|
| LibreDWG 0.13.3 (`vendor/libredwg/dwg2dxf.*`) | DWG → DXF 변환 (WebAssembly) | GPL-3.0-or-later | https://ftp.gnu.org/gnu/libredwg/libredwg-0.13.3.tar.xz · 빌드 방법: `build-libredwg.sh` (원본 수정 없음) |
| ezdxf 1.4.4 (`vendor/ezdxf-1.4.4-py3-none-any.whl`) | DXF 읽기·렌더링 | MIT | https://github.com/mozman/ezdxf |
| Pyodide 0.28.3 (jsDelivr CDN) | 브라우저용 Python | MPL-2.0 | https://github.com/pyodide/pyodide |
| 나눔고딕 (`vendor/fonts/NanumGothic.ttf`) | 한글·SHX 대체 글꼴 | SIL OFL 1.1 (`vendor/fonts/LICENSE-NanumGothic.txt`) | https://hangeul.naver.com/ |

LibreDWG는 GNU GPL v3 이상으로 배포됩니다. 전체 라이선스: https://www.gnu.org/licenses/gpl-3.0.html
