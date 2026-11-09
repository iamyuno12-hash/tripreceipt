# TripReceipt — 여행 영수증 OCR 지출 관리

오픈소스기초설계 팀 프로젝트. 여행 중 받은 영수증을 사진으로 올리면 OCR 로 품목과 금액을
읽어 구조화하고, 여행 단위로 지출을 집계해 주는 **웹 앱**이다.

**서버가 없다.** 문자 인식과 데이터 저장이 모두 브라우저 안에서 일어난다.
영수증 사진은 네트워크로 전송되지 않으며, 모델을 한 번 받은 뒤에는 오프라인에서도 동작한다.

## 현재 상태

| 단계 | 내용 | 상태 |
|---|---|---|
| P0 | 저장소 뼈대, 도커 개발환경, 브라우저 환경 검증 | 완료 (`v0.1-env`) |
| P1 | 화면 구조와 도메인 타입·교차검증 | 완료 (`v0.2-ui`) |
| P2 | IndexedDB 저장, 여행·영수증 입력 | 완료 (`v0.3-db`) |
| P3 | 카메라·파일 입력과 이미지 전처리 | 다음 차례 |
| P4~P8 | [docs/ROADMAP.md](docs/ROADMAP.md) 참고 | 예정 |

**지금 할 수 있는 것**: 여행을 만들고 영수증을 직접 입력하면 브라우저에 저장되고,
품목 합계와 총액이 맞지 않으면 자동으로 "검수 필요" 로 표시된다.
사진 촬영과 OCR 자동 인식은 P3·P4 에서 붙는다.

## 개발 환경

로컬에 Node 를 깔 필요가 없다. **도커만 있으면 된다.**

| 항목 | 버전 |
|---|---|
| Node | 22 (이미지에 포함) |
| TypeScript | 7.0.2 |
| Vite | 8.3.5 |
| PaddleOCR SDK | `@paddleocr/paddleocr-js` 0.4.2 |

버전은 `package.json` 한 곳에서만 바꾼다.

## 빠른 시작

처음 설치하는 경우 [docs/SETUP.md](docs/SETUP.md) 에 Docker 설치부터
단계별로 정리돼 있다. 아래는 요약이다.

```bash
git clone <저장소 주소>
cd tripreceipt

make image      # 개발용 도커 이미지 생성 (최초 1회)
make models     # OCR 모델 다운로드 (최초 1회, 약 17MB)
make dev        # 개발 서버 실행
```

브라우저에서 <http://localhost:5173> 을 연다. P0 단계에서는 **브라우저 환경 점검 화면**이
떠서, 이후 단계에 필요한 기능(WASM, IndexedDB, 카메라 등)이 이 브라우저에서 쓸 수 있는지
보여준다. 필수 항목이 전부 통과하면 P0 완료다.

`make` 가 없는 환경(Windows PowerShell 등)이면 아래를 직접 쓰면 된다.

```bash
docker compose build dev
docker compose run --rm dev sh scripts/fetch-models.sh
docker compose up dev
```

## 시연용 실행

개발 서버 대신 빌드된 정적 파일을 nginx 로 서비스한다.

```bash
make build      # dist/ 생성
make serve      # http://localhost:8080
```

시연은 **최신 Chrome 또는 Edge** 를 권장한다. 발표 직전에 한 번 열어 모델을 미리
받아두면 시연 중 다운로드 대기가 없다.

## 왜 서버가 없는가

교수님 미팅에서 백엔드 규모가 커진다는 조언을 받아, 서버에 데이터를 두지 않고
브라우저 내부에 저장하는 구조로 정리했다. 제안서의 처리 파이프라인(OpenCV 전처리 →
PaddleOCR 인식 → 자체 파싱 → 관계형 저장)은 그대로 유지하고 실행 위치만 옮겼다.

자세한 비교는 [docs/ROADMAP.md](docs/ROADMAP.md) 의 "제안서 대비 변경점" 을 참고한다.

## 중요: COOP/COEP 헤더

OCR 추론을 빠르게 하려면 멀티스레드 WASM 이 필요하고, 그러려면 서버가 아래 헤더를
내려줘야 한다.

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

설정이 **두 군데**에 있으니 한쪽만 바꾸면 개발과 배포가 어긋난다.

- 개발 서버: `vite.config.ts`
- 배포 서버: `docker/nginx.conf`

적용 여부는 P0 환경 점검 화면의 "Cross-origin isolation" 항목에서 바로 확인된다.

## 프로젝트 구조

```
tripreceipt/
├── src/
│   ├── main.ts              # 진입점 (P0: 환경 점검 화면)
│   ├── env-check.ts         # 브라우저 기능 점검
│   ├── ocr/models.ts        # OCR 모델 설정 (model_name, 경로)
│   ├── storage/             # P2 에서 IndexedDB 코드
│   └── ui/                  # P1 에서 화면들
├── scripts/fetch-models.sh  # 모델 다운로드 + 형식 검증
├── docker/
│   ├── Dockerfile           # Node 개발/빌드 환경
│   └── nginx.conf           # 정적 서빙 (COOP/COEP 포함)
├── test/                    # 단위 테스트
└── docs/
    ├── SETUP.md             # 처음 설치하기 (팀원용)
    ├── ROADMAP.md           # 단계별 계획과 산출물 매핑
    └── OCR-ENGINE.md        # OCR 구성 조사 결과와 근거
```

## 기술 스택

- **언어/빌드**: TypeScript + Vite (프레임워크 없음)
- **OCR**: PaddleOCR PP-OCRv5 (ONNX) + ONNX Runtime Web
- **이미지 전처리**: OpenCV.js
- **저장**: IndexedDB (`idb`)
- **환경**: Docker, nginx, GitHub Actions

## 기여 방법

브랜치 전략과 커밋 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md) 에 있다.

## 라이선스

Apache License 2.0 ([LICENSE](LICENSE)). 사용한 오픈소스의 라이선스 고지는
[NOTICE](NOTICE) 에 있다. (P8 에서 최종 점검)
