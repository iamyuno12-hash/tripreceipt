# 처음 설치하기

팀원 모두가 같은 환경에서 작업하기 위한 절차다. **로컬에 Node 를 설치할 필요는 없다.**
Docker 와 Git 두 가지만 있으면 된다.

처음 저장소를 만드는 사람은 1~6단계를 모두 하고, 나머지 팀원은 **5단계부터** 하면 된다.

---

## 1. Docker 설치

| OS | 설치 방법 |
|---|---|
| Windows | [Docker Desktop](https://www.docker.com/products/docker-desktop/) 설치. 설치 중 "Use WSL 2" 옵션을 켠다 |
| macOS | [Docker Desktop](https://www.docker.com/products/docker-desktop/) 설치. Apple Silicon / Intel 버전을 구분해서 받는다 |
| Linux | `sudo apt install docker.io docker-compose-plugin` 후 `sudo usermod -aG docker $USER` (재로그인 필요) |

설치 후 **Docker Desktop 을 실행해 둔 상태**여야 한다. 터미널에서 확인한다.

```bash
docker --version
docker compose version
```

둘 다 버전이 나오면 성공이다.
`Cannot connect to the Docker daemon` 이 나오면 Docker Desktop 이 꺼져 있는 것이다.

## 2. Git 설치

```bash
git --version
```

없으면 [git-scm.com](https://git-scm.com/downloads) 에서 받는다.
처음 쓰는 경우 이름과 이메일을 한 번 설정해야 커밋이 된다.

```bash
git config --global user.name "본인 이름"
git config --global user.email "GitHub에 등록한 이메일"
```

## 3. GitHub 저장소 만들기 (팀에서 한 명만)

GitHub 에서 **New repository** 를 누르고,

- Repository name: `tripreceipt`
- Public 또는 Private (과제 제출 방식에 맞게)
- **Add a README file / .gitignore / license 는 모두 체크하지 않는다**

세 가지를 체크하지 않는 이유는, 체크하면 GitHub 쪽에 커밋이 먼저 생겨서
로컬에서 올릴 때 충돌이 나기 때문이다. README·.gitignore·LICENSE 는 이미 들어 있다.

## 4. 프로젝트 올리기 (팀에서 한 명만)

받은 zip 을 풀고 그 폴더에서 아래를 실행한다.
단계별로 커밋을 나누는 이유는 과목 평가에 개발 과정 로그가 포함되기 때문이다.

```bash
cd tripreceipt

git init
git branch -M main

git add .gitignore LICENSE NOTICE README.md package.json package-lock.json tsconfig.json vite.config.ts
git commit -m "chore: 저장소 초기화"

git add docker/ docker-compose.yml Makefile
git commit -m "build(docker): Node 22 개발 환경과 정적 서빙 설정 추가"

git add scripts/ src/ocr/
git commit -m "feat(ocr): PP-OCRv5 모델 설정과 다운로드 스크립트 추가"

git add index.html src/main.ts src/env-check.ts src/style.css test/
git commit -m "feat(app): 브라우저 환경 점검 화면 추가"

git add docs/ CONTRIBUTING.md
git commit -m "docs: 로드맵·OCR 조사 결과·설치 가이드 추가"

git add .github/
git commit -m "ci: 타입검사·테스트·빌드 워크플로 추가"

git remote add origin https://github.com/<본인계정>/tripreceipt.git
git push -u origin main

git checkout -b develop
git push -u origin develop
```

`<본인계정>` 부분은 실제 GitHub 아이디로 바꾼다.
비밀번호를 물으면 계정 비밀번호가 아니라
[Personal Access Token](https://github.com/settings/tokens) 을 넣어야 한다.

## 5. 내려받아 실행하기 (모든 팀원)

```bash
git clone https://github.com/<저장소주인계정>/tripreceipt.git
cd tripreceipt

make image      # 개발용 도커 이미지 생성 (최초 1회, 수 분 소요)
make models     # OCR 모델 다운로드 (최초 1회, 약 17MB)
make dev        # 개발 서버 실행
```

`make` 가 없는 환경(주로 Windows PowerShell)에서는 아래를 대신 쓴다.

```bash
docker compose build dev
docker compose run --rm dev sh scripts/fetch-models.sh
docker compose up dev
```

## 6. 확인

브라우저에서 <http://localhost:5173> 을 연다.
**브라우저 환경 점검** 화면이 뜨고, 아래 항목이 전부 초록색이면 P0 완료다.

- WebAssembly
- WASM SIMD
- Cross-origin isolation
- IndexedDB
- 카메라 API
- 이미지 처리 API

"영구 저장 권한" 은 경고(노란색)로 떠도 정상이다. P2 에서 처리한다.

확인이 끝나면 저장소 주인이 태그를 붙인다.

```bash
git checkout main
git tag -a v0.1-env -m "P0: 브라우저 실행 환경 구축"
git push origin --tags
```

---

## 문제가 생기면

| 증상 | 원인과 해결 |
|---|---|
| `Cannot connect to the Docker daemon` | Docker Desktop 이 실행 중이 아니다. 켜고 다시 시도 |
| `permission denied ... docker.sock` (Linux) | `sudo usermod -aG docker $USER` 후 로그아웃·재로그인 |
| `port is already allocated` | 5173 포트를 다른 프로그램이 쓰고 있다. `docker compose down` 후 재시도하거나 `docker-compose.yml` 의 포트를 `5174:5173` 으로 변경 |
| 화면이 안 뜨고 `make dev` 가 멈춘 듯 보임 | 최초 실행은 `npm install` 때문에 1~2분 걸린다. `ready in ...` 로그가 나올 때까지 기다린다 |
| Cross-origin isolation 이 경고로 뜸 | 개발 서버가 아닌 경로(파일 직접 열기 등)로 접속한 경우다. 반드시 `http://localhost:5173` 으로 접속 |
| 모델 다운로드 실패 | 학교 네트워크가 huggingface.co 를 막는 경우가 있다. 다른 네트워크에서 `make models` 만 다시 실행 |
| `make: command not found` (Windows) | 위 5단계의 `docker compose` 명령을 직접 사용 |

## 평소 작업 흐름

```bash
git checkout develop
git pull
git checkout -b feature/p1-화면구조     # 작업 브랜치

# ... 코드 수정 ...

make typecheck    # 타입 검사
make test         # 단위 테스트
git add -A && git commit -m "feat(ui): 홈 화면 추가"
git push -u origin feature/p1-화면구조
# GitHub 에서 develop 으로 Pull Request 생성
```

자세한 브랜치·커밋 규칙은 [CONTRIBUTING.md](../CONTRIBUTING.md) 를 참고한다.
