# OCR 전처리 평가 도구

영수증 사진 전처리 방법을 **사람이 적은 정답과 비교해서** 고르기 위한 도구다.
측정 결과와 결론은 [docs/OCR-ENGINE.md](../../docs/OCR-ENGINE.md) 3.8 절(1차, 5장), 3.9 절(2차, 11장 추가),
3.10 절(앱에 넣은 뒤 앱 안에서 다시 잼)에 있다.

## 개인정보 주의

영수증 사진과 정답지에는 구매 내역(언제, 어디서, 무엇을 샀는지)과 카드번호 일부가 들어 있다.
저장소가 공개라서 **`data/` 폴더는 `.gitignore` 로 막아 두었다.** 여기에는 코드만 올린다.

## 폴더 구조

```
tools/ocr-eval/
├── scoring.py        채점기 (지표 정의는 파일 맨 위 주석)
├── test_scoring.py   채점기 테스트 — 채점 규칙이 의도대로 동작하는지 확인
├── score_one.py      결과 JSON 하나 채점
├── pipeline.py       전처리 파이프라인 (앱에 옮길 순서 그대로)
├── make_grid.py      전처리 조합 이미지 생성 (--only, --no-sharpen)
├── runner.mjs        이미지를 앱의 OCR 테스트 화면에 넣고 결과 JSON 저장 (Playwright, OCR_MODE·OCR_LANG)
├── analyze.py        미리 정한 규칙으로 최적 조합 선택 + 교차검증
├── make_sensitivity_gt.py  민감도 분석용 정답지 생성
├── factors.py        요인별 효과, 영수증별 분포
├── heldout.py        2차 영수증만 따로 채점 (1차 선택 조합 검증)
├── ja_compare.py     일본어 영수증: 한국어 모델 vs 다른 인식 모델
├── compare_app.py    앱이 실제로 처리한 결과를 채점해 평가 조합과 나란히 비교
├── gt_sheet.py       정답지 대조표(사진 옆에 정답) 생성
└── data/             ← 커밋 안 됨
    ├── photos/<이름>.jpg          원본 사진
    ├── prev/<이름>.raw.json        1차 인식 결과 (기울기·글자 높이 측정용)
    ├── groundtruth.json           정답지
    ├── variants/  results/        생성물
    └── results-ja/                다른 인식 모델로 돌린 결과 (일본어 비교용)
```

## 지표

`scoring.py` 맨 위에 정의가 있다. 요약:

| 지표 | 정의 |
|---|---|
| 숫자 정확도 | 정답 금액·수량 중 한 자리도 틀리지 않고 읽은 비율. 같은 값이 여러 번이면 개수까지 맞아야 한다. 글자에 붙은 숫자(`2인분`의 2)·날짜·전화번호·바코드는 금액 후보에서 뺀다 |
| 품목명 CER | (삽입+삭제+치환) ÷ 정답 글자 수. 띄어쓰기만 무시 |
| 줄 맞춤 | 품목명(또는 바코드·라벨)과 그 줄의 금액이 OCR 결과에서 같은 높이(글자 높이의 절반 이내)에 있는가 |
| 날짜 | 거래일시를 한 글자도 틀리지 않았는가 |

모델이 스스로 매기는 신뢰도는 쓰지 않는다. 신뢰도 99.8% 로 틀리는 경우가 실제로 있었다.

## 사용법

필요한 것: Python 3, `pip install opencv-python pillow`

**채점기 테스트**
```bash
python3 tools/ocr-eval/test_scoring.py
```

**사진 한 장 채점 (수동)**
1. `make dev` 후 앱의 **설정 > OCR 테스트** 에서 사진을 넣고 인식 실행
2. **결과 JSON 저장** 으로 받은 파일을 채점
```bash
python3 tools/ocr-eval/score_one.py tools/ocr-eval/data 결과.json r1-yukmian
```

**전체 조합 실행 (자동)** — Playwright 와 Chromium 이 필요하다 (`npm i -D playwright && npx playwright install chromium`).
```bash
D=tools/ocr-eval/data
make build                                        # dist/ 생성
python3 tools/ocr-eval/make_grid.py $D            # 조합 이미지 생성 (5장 기준 445개, 약 1.4GB)
node tools/ocr-eval/runner.mjs $D/variants/list.txt $D/results 4500   # 약 70분, 끊겨도 이어서 실행됨
python3 tools/ocr-eval/analyze.py $D                 # → 분석 결과 출력, $D/results-all.csv
python3 tools/ocr-eval/factors.py $D                 # 요인별 효과
# 민감도 분석: 결과가 불안정한 육미안 세트 하위 메뉴 숫자 12개를 빼고 다시
python3 tools/ocr-eval/make_sensitivity_gt.py $D
python3 tools/ocr-eval/analyze.py $D $D/groundtruth-sensitivity.json
python3 tools/ocr-eval/factors.py $D $D/groundtruth-sensitivity.json
```

`make_grid.py` 는 정답지에 있는 영수증마다 `data/prev/<이름>.raw.json`(원본 사진을 앱에 넣어 받은 결과 JSON)이
있어야 한다. 기울기와 글자 높이를 거기서 잰다.

정답지 대조표(사진 옆에 정답을 붙인 이미지)는 `python3 tools/ocr-eval/gt_sheet.py $D` → `$D/sheet/`.

### 2차: 영수증을 추가했을 때

새 영수증을 `data/photos/` 에 넣고, 앱에 원본을 넣어 받은 결과 JSON 을 `data/prev/<이름>.raw.json` 으로 둔 뒤
정답지에 추가한다. 2차에서 실제로 돌린 순서:

```bash
D=tools/ocr-eval/data; NEW=r6-kaldi,r7-epost,...   # 새 영수증 이름들
python3 tools/ocr-eval/make_grid.py $D --only $NEW --no-sharpen --list $D/variants/list2.txt
node tools/ocr-eval/runner.mjs $D/variants/list2.txt $D/results     # 원본·회전만·1차 선택 조합·잡음 측정이 먼저 돈다
python3 tools/ocr-eval/heldout.py $D raw,rot,c1_g0_tnone_s0_h32       # 1차 선택 조합이 처음 보는 영수증에서도 맞는가
python3 tools/ocr-eval/analyze.py $D                                  # 전체 장수로 다시 고르기 (모든 영수증에 있는 조합만)
```

### 일본어 모델 비교

앱 코드는 그대로 두고, 저장소를 임시 폴더에 복사해 `src/ocr/models.ts` 의 인식 모델만
`PP-OCRv5_mobile_rec`(중·일·영)으로 바꿔 빌드했다. 모델은 `fetch-models.sh` 와 같은 방법으로
`https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_rec_onnx` 에서 받아 `tar -cf` 로 묶는다.

```bash
TRIPRECEIPT_DIST=/tmp/dist-ja node tools/ocr-eval/runner.mjs <일본어 이미지 목록> $D/results-ja
python3 tools/ocr-eval/ja_compare.py $D $D/results-ja raw,rot,c1_g0_tnone_s0_h32
```

### 앱 안에서 다시 재기

앱의 OCR 테스트 화면은 앱과 같은 처리(`src/ocr/pipeline.ts`)를 쓴다. 원본 사진을 넣고 모드만 바꿔 돌린다.

```bash
ls $D/photos/*.jpg > /tmp/photos.txt
OCR_MODE=app        node tools/ocr-eval/runner.mjs /tmp/photos.txt $D/app-skip     # 앱 기본 (기울기 1도 미만이면 2차 생략)
OCR_MODE=app-noskip node tools/ocr-eval/runner.mjs /tmp/photos.txt $D/app-noskip   # 항상 2차
OCR_MODE=app OCR_LANG=zh_ja node tools/ocr-eval/runner.mjs <일본어 사진 목록> $D/app-ja
python3 tools/ocr-eval/compare_app.py $D $D/app-skip $D/app-noskip --ref raw,c1_g1_tnone_s0_h32
```

`OCR_MODE` 기본값 `raw` 는 넣은 이미지를 그대로 한 번 인식한다 (전처리 조합 이미지를 채점할 때).



## 정답지 형식

`data/groundtruth.json` — 영수증마다 인쇄된 줄 순서대로 칸을 적는다.
```json
"r1-yukmian": [
  [{"t":"테라 500mL","k":"item"},{"t":"4,900","k":"num"},{"t":"2","k":"num"},{"t":"9,800","k":"num"}],
  [{"t":"합계","k":"label"},{"t":"78,800","k":"num"}]
]
```
`k`: merchant(상호) date(일시) item(품목명) label(합계·할인 등) num(금액·수량) code(바코드)
인쇄가 애매해 정답을 확정할 수 없는 칸은 `"uncertain": true` 와 `"note"` 를 달면 채점에서 빠진다.
