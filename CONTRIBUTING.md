# 협업 규칙

과목 평가에 "개발 과정이 Git 로그로 남는가"가 포함되므로, 커밋을 단계별로 쪼개는 것을
규칙으로 정한다. 한 번에 몰아서 올리지 않는다.

## 브랜치 전략

```
main      ← 각 단계 완료 시점만 머지하고 태그를 붙인다
develop   ← 통합 브랜치, 평소 작업은 여기로 머지
feature/* ← 개인 작업 브랜치
```

브랜치 이름 예시

```
feature/p2-indexeddb-schema
feature/p4-ocr-korean-model
fix/p3-camera-ios-safari
```

## 커밋 메시지 규칙 (Conventional Commits)

```
<타입>(<범위>): <요약>

본문 (선택, 왜 바꿨는지)
```

| 타입 | 쓰는 때 |
|---|---|
| `feat` | 기능 추가 |
| `fix` | 버그 수정 |
| `docs` | 문서만 변경 |
| `build` | 도커·빌드 설정·의존성 변경 |
| `test` | 테스트 추가·수정 |
| `refactor` | 동작 변화 없는 구조 개선 |
| `chore` | 그 외 잡일 |

예시

```
build(docker): Node 22 개발 환경 추가
feat(ocr): 한국어 PP-OCRv5 모델 로딩 추가
fix(parser): 합계 금액이 품목으로 잡히는 문제 수정
docs(readme): COOP/COEP 설정 설명 보강
```

## 단계별 태그

각 단계가 끝나면 `develop` → `main` 머지 후 태그를 붙인다.
태그 목록은 [docs/ROADMAP.md](docs/ROADMAP.md) 에 있다.

```bash
git checkout main
git merge --no-ff develop
git tag -a v0.1-env -m "P0: 브라우저 실행 환경 구축"
git push origin main --tags
```

`--no-ff` 는 머지 커밋을 남겨 단계 경계가 로그에 보이게 하기 위함이다.

## 역할 분담 (3인)

초기 분담안이며 단계마다 조정한다.

| 역할 | 담당 영역 |
|---|---|
| A | 화면 / UI 흐름 (P1, P6 통계 화면) |
| B | IndexedDB / 이미지 입력 / 전처리 (P2, P3) |
| C | OCR 연동 / 파서 / 평가 (P4, P5, P7) |

공통: 문서(README·보고서), 발표 자료, 코드 리뷰

## 코드 리뷰

- `feature/*` → `develop` 은 **PR 로만** 머지한다 (리뷰 기록이 남아야 함)
- 리뷰어는 최소 1명
- PR 제목도 커밋 규칙을 따른다
- PR 전에 `make typecheck` 와 `make test` 를 통과시킨다

## 올리지 말아야 할 것

- OCR 모델 파일(`*.tar`, `*.onnx`) — 용량이 커서 `.gitignore` 에 제외돼 있다
- `node_modules/`, `dist/`
- 실제 영수증 사진 중 개인정보(카드번호 전체·이름)가 보이는 것
