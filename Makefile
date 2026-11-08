# TripReceipt 개발용 명령 모음
# 백엔드가 없어서 명령이 단순하다. 개발 서버 / 빌드 / 정적 서빙 세 가지다.

DC := docker compose

.PHONY: help image models dev build serve typecheck test shell clean

help:
	@echo "make image      - 개발용 도커 이미지 생성 (최초 1회)"
	@echo "make models     - OCR 모델 다운로드 (최초 1회, 약 17MB)"
	@echo "make dev        - 개발 서버 실행 -> http://localhost:5173"
	@echo "make build      - 정적 파일 빌드 (dist/)"
	@echo "make serve      - 빌드 결과를 nginx 로 서비스 -> http://localhost:8080"
	@echo "make typecheck  - 타입 검사"
	@echo "make test       - 단위 테스트"
	@echo "make clean      - 빌드 산출물 삭제"

image:
	$(DC) build dev

models:
	$(DC) run --rm dev sh scripts/fetch-models.sh

# 개발 서버. 소스를 고치면 브라우저가 자동 갱신된다.
dev:
	$(DC) up dev

build:
	$(DC) run --rm dev sh -c "npm install && npm run build"

# 시연용. 반드시 make build 를 먼저 실행해야 한다.
serve:
	$(DC) up -d serve
	@echo "http://localhost:8080 에서 확인하세요 (COOP/COEP 헤더 적용됨)"

typecheck:
	$(DC) run --rm dev sh -c "npm install && npm run typecheck"

test:
	$(DC) run --rm dev sh -c "npm install && npm test"

shell:
	$(DC) run --rm dev bash

clean:
	rm -rf dist
	$(DC) down
