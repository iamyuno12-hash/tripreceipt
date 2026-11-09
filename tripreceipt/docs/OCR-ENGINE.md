# OCR 엔진 조사 및 선택 근거

조사일: 2026-11-06

제안서에서 확정한 OCR 엔진은 **PaddleOCR** 이다. 제안서는 Flask 서버에서 파이썬
PaddleOCR 을 돌리는 구성이었고, 지금은 백엔드 없이 브라우저에서 직접 추론한다.
이 문서는 그 전환에 필요한 조사 결과와 결정을 기록한다. (최종보고서의 근거 자료)

## 1. 브라우저에서 PaddleOCR 을 돌리는 방법

PaddleOCR 공식 저장소가 **브라우저 배포용 SDK** 를 제공한다.

| 항목 | 값 |
|---|---|
| 패키지 | `@paddleocr/paddleocr-js` 0.4.2 |
| 라이선스 | Apache-2.0 |
| 추론 엔진 | ONNX Runtime Web (WASM, WebGPU 선택 가능) |
| 이미지 처리 | OpenCV.js (`@techstark/opencv-js` 4.10.0, 의존성에 포함) |
| 기준 모델 | PP-OCRv5 |

**선택 이유**

1. 공식 지원 경로다. 비공식 래퍼를 쓰지 않아도 된다.
2. **제안서의 OpenCV 전처리를 그대로 쓸 수 있다.** SDK 가 OpenCV.js 를 이미 의존성으로
   포함하므로 별도 설치 없이 같은 인스턴스로 전처리 파이프라인을 짤 수 있다.
3. **PP-OCRv5 기준이라 한국어 모델이 그대로 맞는다** (아래 2절).

### 모바일(안드로이드) 안을 접은 이유

중간에 안드로이드 앱으로 검토했을 때는 공식 안드로이드 SDK 가 **PP-OCRv6** 기준이었다.
그런데 PP-OCRv6 가 지원하는 50개 언어는 중국어·영어·일본어 + 라틴 문자 46개이고
**한글은 사전에 없다.** 한국어를 쓰려면 PP-OCRv5 계열 한국어 모델을 v6용 SDK 에 끼워야 해서
전처리·CTC 디코딩 호환성을 따로 검증해야 하는 부담이 있었다.

웹 SDK 는 PP-OCRv5 기준이므로 이 문제가 발생하지 않는다. **웹 전환으로 리스크가 사라진 셈이다.**

## 2. 사용할 모델

SDK 는 모델을 **압축하지 않은 `.tar`** 로 받는다. tar 안에 `inference.onnx` 와
`inference.yml` 이 있어야 하고, yml 의 `model_name` 이 코드에서 넘기는 이름과 **정확히**
같아야 한다. 다르면 초기화 단계에서 바로 오류가 난다.

공식 HuggingFace 저장소가 이 형식 그대로 제공한다. (둘 다 Apache-2.0)

| 역할 | 저장소 | `model_name` | 용량 |
|---|---|---|---|
| 검출 | `PaddlePaddle/PP-OCRv5_mobile_det_onnx` | `PP-OCRv5_mobile_det` | 4.6MB |
| 인식(한국어) | `PaddlePaddle/korean_PP-OCRv5_mobile_rec_onnx` | `korean_PP-OCRv5_mobile_rec` | 12.8MB |

확인된 세부 사항

- 검출 모델 후처리는 `DBPostProcess`, 언어와 무관하므로 모든 여행에서 공용으로 쓴다.
- 인식 모델 후처리는 `CTCLabelDecode` 이고, **문자 사전 11,945자가 `inference.yml` 안에
  들어 있다.** 별도 사전 파일(`ppocrv5_korean_dict.txt`)을 따로 관리할 필요가 없다.
- 모델 합계 17.4MB. 첫 진입 때만 내려받고 이후에는 캐시를 쓴다.

모델 파일은 용량이 커서 git 에 올리지 않는다. `scripts/fetch-models.sh` 가 내려받아
`.tar` 로 묶고 `model_name` 까지 검증한다. 코드 쪽 상수는 `src/ocr/models.ts` 에 있다.

## 3. 성능 관련 설정

### cross-origin isolation (중요)

ONNX Runtime Web 의 멀티스레드 WASM 은 `SharedArrayBuffer` 를 쓰고, 이것은
**cross-origin isolation 이 걸린 페이지에서만** 허용된다. 서버가 아래 두 헤더를
내려주지 않으면 단일 스레드로 떨어져 추론이 크게 느려진다.

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

이 설정은 **두 곳에 있고 항상 같이 유지해야 한다.**

- 개발 서버: `vite.config.ts`
- 배포 서버: `docker/nginx.conf`

P0 의 환경 점검 화면에서 적용 여부를 바로 확인할 수 있다.

### 그 외

- 입력 이미지 긴 변을 960px 정도로 줄인 뒤 검출에 넣는다 (정확도 손실 대비 속도 이득이 큼)
- WebGPU 를 쓸 수 있는 환경이면 WASM 대신 선택할 수 있다. P4 에서 두 백엔드 처리시간을
  비교해 기록한다 (보고서 자료)
- `predict()` 가 `detMs` / `recMs` / `totalMs` 를 돌려주므로 측정에 따로 코드가 필요 없다

## 4. 개선 포인트 (과목 평가 대응)

과목 평가 기준에 "오픈소스 재현 후 개선"이 있다. 이 프로젝트의 개선 지점은 두 가지다.

1. **한국 영수증 특화 전처리** — 공식 예제는 일반 장면 텍스트 기준이다. 영수증은 감열지라
   대비가 낮고 구겨짐·기울기가 많아 전처리 효과가 크다. 전처리 적용 전후 인식률을 측정해
   비교표를 만든다 (P7 산출물).
2. **언어별 인식 모델 전환** — 여행 영수증은 국내/해외가 섞인다. 여행 생성 시 지역을 고르면
   인식 모델을 바꾸는 구조로 간다. 한국 여행은 한국어 모델, 라틴 문자권은 PP-OCRv5 라틴
   모델을 쓴다. 단일 모델로 전부 처리할 때와의 정확도 차이가 그대로 보고서 근거가 된다.

구조상 `src/ocr/models.ts` 의 `RECOGNITION_MODELS` 에 항목을 추가하면 되도록 열어 두었다.

## 5. 알려진 함정

| 문제 | 증상 | 대응 |
|---|---|---|
| tar 압축 | SDK 가 모델을 읽지 못함 | 반드시 `tar -cf` (gzip 금지). `fetch-models.sh` 가 이미 그렇게 묶는다 |
| `model_name` 불일치 | 초기화 단계에서 오류 | `fetch-models.sh` 가 yml 값을 검증한다 |
| COOP/COEP 누락 | 추론이 느려짐 | 위 3절. P0 점검 화면에서 확인 |
| 브라우저 데이터 삭제 | 저장한 영수증 소실 | P2 에서 영구 저장 권한 요청, P6 에서 CSV 내보내기 제공 |
| wasm MIME 타입 | 스트리밍 컴파일 실패 | `nginx.conf` 에 `application/wasm` 지정함 |

## 6. 라이선스

| 구성요소 | 라이선스 |
|---|---|
| PaddleOCR SDK / 모델 | Apache-2.0 |
| ONNX Runtime Web | MIT |
| OpenCV.js | Apache-2.0 |

모두 Apache-2.0 / MIT 계열이라 과제 공개에 제약이 없다. 상용 API(Google Cloud Vision,
CLOVA OCR)를 쓰지 않는 근거는 제안서의 사례 분석에 이미 서술돼 있다.

## 참고

- 브라우저 배포 문서: https://www.paddleocr.ai/main/version3.x/inference_deployment/cross_platform/browser.html
- PaddleOCR 저장소: https://github.com/PaddlePaddle/PaddleOCR
- 한국어 인식 모델: https://huggingface.co/PaddlePaddle/korean_PP-OCRv5_mobile_rec_onnx
- 검출 모델: https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx
