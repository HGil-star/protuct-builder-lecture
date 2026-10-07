# DWG → PDF 변환

메인 페이지(`/`, `/index.html`)는 DWG → PDF 변환 화면입니다. 로또 메뉴는 제거했고, 영수증 스캐너와 누끼 메이커의 기능은 유지합니다. 이전 주소 `/dwg-pdf.html`도 메인 페이지로 연결됩니다.

## 현재 구현

- 기준 도곽 DWG / 실제 도면 DWG / 관련 파일 ZIP 업로드
- APS AutoCAD Automation 작업 제출·조회·취소
- 블록·XREF 내부의 닫힌 사각형 도곽 우선 검출, 폴리라인·4개 선분 사각형의 크기 비교
- 삽입점·회전·축척·중첩 블록 변환을 반영한 실제 경계 계산
- 윗줄 왼쪽→오른쪽 후 다음 줄 정렬, 사용자 순서 변경·페이지 제외
- 기존 Layout의 탭 순서 출력
- CAD 엔진으로 생성한 한 페이지 PDF 미리보기, A4/A3/A2/A1 또는 기존 Layout 용지 선택
- 도곽 종횡비 유지, 회전된 뷰의 DCS Window Plot, 벡터 PDF 병합·다운로드
- 작업별 접근 토큰, 제한된 ZIP 압축 해제, 임시 보관과 삭제

**APS 자격 증명과 AppBundle/Activity를 등록해야 실제 변환이 실행됩니다.** 설정 전에는 분석 버튼을 비활성화합니다. 화면에 가짜 검출 결과를 표시하는 기능은 없습니다. `test/mock-aps.js`의 합성 PDF는 통합 테스트 프로세스에서만 사용하는 데이터입니다.

## 로컬 실행 / Codespaces

Node.js 22 이상을 사용합니다.

```bash
cd dwg-service
npm ci
cp .env.example .env
npm start
```

`http://localhost:3000/index.html`에서 확인합니다. Codespaces에서는 3000 포트를 열어 페이지를 확인할 수 있습니다. APS가 입력을 받고 결과를 보내려면 해당 포트를 공개 HTTPS로 접근할 수 있어야 합니다. Codespaces는 개발용이며 운영 서버로 사용하지 않습니다.

`.env`에는 다음을 설정합니다. Client Secret은 브라우저 파일이나 저장소에 넣지 않습니다.

| 변수 | 의미 |
|---|---|
| `APS_CLIENT_ID`, `APS_CLIENT_SECRET` | APS 앱 자격 증명 |
| `PUBLIC_BASE_URL` | APS가 접근할 수 있는 API 서버의 HTTPS 주소. `/api`를 포함하지 않은 기본 주소 |
| `APS_ACTIVITY_ID` | 등록 결과의 `nickname.DwgPdf+production` |
| `APS_REGION` | `us-east` 또는 `eu-west`; Activity와 같은 리전 |
| `FRONTEND_ORIGIN` | 별도 정적 사이트 주소의 origin. 같은 서버면 비워 둠 |
| `MAX_UPLOAD_MB` | 파일당 업로드 크기, 기본 100 MB |
| `MAX_JOBS` | 미만료 작업 수 제한, 기본 4 |
| `JOB_TTL_MINUTES` | 업로드 시작부터 만료까지, 기본 60분, 최대 240분 |
| `DWG_WORK_DIR` | 전용 임시 작업 폴더, 기본 OS 임시 폴더 아래 `dwg-pdf-service` |

정적 사이트를 별도 배포하면 루트의 `dwg-pdf-config.js`에서 `apiBase`를 HTTPS API 주소로 지정합니다. API 서버의 `FRONTEND_ORIGIN`에도 정적 사이트의 정확한 origin을 설정합니다.

## CAD 플러그인 빌드와 APS 등록

플러그인은 공식 `AutoCAD.NET.Core 25.1.0` 참조로 .NET 8을 대상으로 빌드합니다. 기본 엔진은 AutoCAD 2026의 `Autodesk.AutoCAD+25_1`입니다. APS 앱이 해당 엔진을 사용할 수 있는지 확인하고, 버전 변경 시 NuGet 참조와 `PackageContents.xml`의 시리즈도 함께 변경하세요.

```bash
cd dwg-service/cad
dotnet build -c Release
cd ..
npm run register
```

등록 스크립트는 `DwgPdf.zip`을 만들고 **APS 계정에 AppBundle과 Activity를 생성하거나 새 버전을 등록한 뒤 `production` 별칭을 갱신합니다.** 계정 설정 후 명시적으로 실행하는 도구이며, 서버 시작 시 자동 실행되지 않습니다. 같은 별칭을 사용하는 운영 서비스에 적용되는 변경이므로 업데이트 시 검증용 별칭을 먼저 사용하는 편이 좋습니다.

등록 출력의 `APS_ACTIVITY_ID=...` 값을 `.env`에 넣고 API 서버를 다시 시작합니다. APS 가입·계정 활성화·사용량 한도/결제 설정은 별도로 필요합니다. Autodesk 런타임 DLL은 플러그인 ZIP에 포함하지 않습니다. 이 저장소에는 플러그인 소스가 포함되며 빌드 출력은 Git에서 제외합니다.

## 도면과 ZIP 준비

기준 DWG는 **도곽 하나의 사각형 경계**를 Model Space에 포함해야 합니다. 닫힌 4점 직선 폴리라인 또는 연결된 4개 직선으로 된 경계를 지원합니다. 기준 안에 큰 사각형이 여러 개라면 자동으로 하나를 선택해 출력하지 않고 기준 파일 정리를 요청합니다. Layout 모드에서는 기준 파일이 업로드 형식상 필요하지만 검출에는 사용하지 않습니다.

실제 DWG에서는 중첩 블록과 XREF의 변환 행렬을 누적해 경계를 구합니다. 동적 블록의 실제 정의와 원래 이름을 사용합니다. 블록 이름·객체 종류별 구성·경계 종횡비로 후보를 비교하고, 보완 검출은 크기와 단위를 비교합니다. **형상 후보가 실제 도곽인지 미리보기에서 확인해야 합니다.** 같은 크기의 표나 다른 사각형까지 후보가 될 수 있습니다.

ZIP 허용 확장자: DWG, SHX, TTF, CTB, STB, PNG, JPG/JPEG, TIF/TIFF, BMP, PC3, PMP, FMP. eTransmit ZIP의 보고서 TXT·XML·실행 파일 등은 제거하고 관련 파일만 압축하세요. 경로 탈출·심볼릭 링크·암호화·중복 경로·크기 제한 초과 ZIP은 거부합니다. 압축 해제 총량은 300 MB, 항목 수는 2,000개로 제한합니다. XREF/이미지 매핑은 파일명 기준이며 동일 파일명이 여러 폴더에 있으면 잘못 매핑하는 대신 오류를 표시합니다.

SHX는 스타일 경로에 연결하고, TTF는 Windows CAD 프로세스에만 등록합니다. CTB/STB는 APS 작업의 출력 스타일 폴더에 추가합니다. 선택한 스타일을 찾지 못하면 잘못된 굵기로 조용히 출력하지 않고 작업을 중단합니다. PC3/PMP는 업로드를 허용하지만 최종 출력 장치는 제공되는 `DWG To PDF.pc3`로 통일합니다. 사용자 PC3/PMP 설정을 완전히 복제하는 기능은 구현하지 않았습니다.

## 현재 지원 범위와 실제 CAD 검증

- 평면 2D 사각형 도곽, 페이지당 하나의 경계, 작업당 최대 200페이지를 대상으로 합니다.
- 회전·반전·직교하는 축척 변환은 처리합니다. 기울어진 3D 평면·전단 변형·사각형이 아닌 경계·블록이 없는 자유 형상 도곽은 지원하지 않습니다.
- 객체 수가 200,000개를 초과하면 작업을 중단합니다. 한 블록의 직선이 10,000개를 초과하면 4개 선분 보완 검출을 생략하고 안내합니다.
- 닫힌 사각형을 찾는 경우에만 영역을 자동 결정합니다. 블록 전체 Bounding Box를 도곽으로 오인하는 출력을 하지 않습니다.
- XCLIP·다중 삽입 MINSERT·연관 배열·프록시/전용 CAD 객체 및 깊은 중첩 XREF는 실제 자료 검증과 추가 처리가 필요합니다.
- XREF 누락 시 삽입 정보만으로 내용이나 영역을 복원하지 않습니다. 누락 상태를 표시합니다. 중첩 XREF는 파일 패키지 안의 상대 경로도 유지해 주세요.
- 출력 축척은 용지 맞춤입니다. 사용자 지정 용지·실제 축척 지정·기준 도곽 직접 선택·검출 실패 시 수동 영역 추가는 후속 확장 항목입니다.
- Layout 모드에서 기존 용지를 선택하면 기존 출력 영역·축척·방향을 유지하고 PDF 장치로 바꿉니다. 기존 용지 이름을 PDF 장치에 대응시키지 못하면 오류를 표시합니다. A4~A1을 선택하면 종횡비를 유지해 Layout 객체의 Extents를 맞춤 출력합니다.
- 원본 파일은 수정·저장하지 않습니다. 작업 중 설정 변경은 APS의 임시 복사본에만 적용됩니다.

이 환경에서 서버 통합 테스트와 공식 SDK 빌드를 검증했습니다. **APS에서 실제 DWG를 열어 플롯하는 검증은 APS 계정 연결과 샘플 도면이 있어야 가능합니다.** 다음 자료를 원본 AutoCAD PDF와 비교한 뒤 운영에 사용하세요: Block/XREF 각각, 분해된 도곽, 회전·축척·반전·중첩 블록, 한글 SHX/Big Font/TTF, 치수·해치·이미지, CTB/STB, 서로 다른 용지의 Layout. 도곽 수·순서·회전·영역 밖 객체 클리핑·선 굵기·문자 폭·한글을 확인해야 합니다. 검색 가능한 문자·특수 객체의 완전한 재현을 보장하지 않습니다.

## 삭제·보안·배포

변환 중 재출력이 필요하므로 입력 ZIP은 분석 후 사용자 확인 동안만 임시 보관합니다. 최종 PDF 생성 또는 실패 시 원본 ZIP을 삭제합니다. 성공 후 페이지별 중간 PDF도 삭제하고 최종 PDF만 만료까지 보관합니다. 취소/삭제 버튼은 입력·결과를 모두 삭제하며, 원격 WorkItem 취소도 요청합니다. 만료 정리는 30초마다 실행합니다. 서버 재시작 시 전용 작업 폴더의 남은 작업을 삭제합니다. 입력·결과는 영구 저장·백업하지 않고 로그에 파일 본문이나 접근 토큰을 기록하지 않습니다.

APS 임시 작업/로그의 보관은 Autodesk 정책에 따릅니다. 이 서버의 삭제와 Autodesk 측 삭제를 같은 보장으로 설명하지 마세요. 도면의 외부 전송이 금지되어 있으면 ODA 자체 워커 방식으로 교체해야 합니다.

현재 작업 상태는 단일 프로세스 메모리 큐입니다. **전용 작업 폴더마다 서버 프로세스를 하나만 실행하세요.** 다중 프로세스/다중 복제본에서 폴더를 공유하면 안 됩니다. 서버 재시작 시 작업 재개는 지원하지 않습니다. 대규모 운영에는 Redis 작업 큐와 수명 제한 객체 저장소를 추가해야 합니다.

운영 환경에서는 HTTPS, 앞단 사용자 인증·계정별 사용량 제한, 요청 제한을 적용하세요. CORS와 작업 토큰은 사용자 인증 또는 과금 방지 수단을 대신하지 않습니다. APS의 `/api/dwg/transfer/*`는 짧은 수명의 작업별 capability URL로 보호하며, 앞단 로그인 화면으로 리디렉션하지 않도록 별도로 라우팅합니다. 업로드 ZIP의 실행 파일·스크립트는 허용하지 않고 신뢰할 수 있는 플러그인만 로드합니다. DWG 변환은 APS 격리 환경에서 실행됩니다.

Docker 빌드는 저장소 루트에서 실행합니다.

```bash
docker build -f dwg-service/Dockerfile -t dwg-pdf .
docker run --rm -p 3000:3000 --env-file dwg-service/.env dwg-pdf
```

이미지에 `.env`를 복사하지 않습니다. API 서버가 종료되면 원격 작업 취소와 임시 폴더 삭제를 시도합니다. 컨테이너를 강제 종료하는 상황에서는 재시작 청소 또는 호스트 임시 볼륨의 만료 정책을 함께 사용하세요.

## 검증

```bash
cd dwg-service
npm test
npm audit --omit=dev
npx playwright install chromium
npm run test:ui
cd cad
dotnet build -c Release
```

서버 통합 테스트는 합성 APS 응답으로 업로드→분석→순서 변경→PDF 병합→다운로드→삭제와 권한·비정상 ZIP·비정상 DWG 헤더·재시작 청소를 확인합니다. 실제 DWG 호환성 테스트와는 구분됩니다.

브라우저 테스트는 PC/모바일 화면의 가로 넘침, 설정 전 분석 차단, 파일 선택·미리보기·순서 변경·페이지 제외·용지 변경·생성 요청을 검증합니다. 브라우저 테스트의 CAD 응답도 테스트 데이터이며 실제 변환 검증을 대신하지 않습니다.

## 공식 참고 문서

- [APS AutoCAD Automation](https://aps.autodesk.com/automation-apis)
- [AppBundle 업로드](https://aps.autodesk.com/en/docs/design-automation/v3/tutorials/autocad/task3-upload-appbundle)
- [Plot Window의 DCS 좌표](https://help.autodesk.com/cloudhelp/2026/ENU/OARX-ManagedRefGuide/files/OARX-ManagedRefGuide-Autodesk_AutoCAD_DatabaseServices_PlotSettingsValidator_SetPlotWindowArea_PlotSettings_Extents2d.html)
- [BlockReference 변환 행렬](https://help.autodesk.com/cloudhelp/2024/ENU/OARX-ManagedRefGuide/files/OARX-ManagedRefGuide-Autodesk_AutoCAD_DatabaseServices_BlockReference_BlockTransform.html)
- [공식 AutoCAD.NET.Core 25.1.0](https://www.nuget.org/packages/AutoCAD.NET.Core/25.1.0)
