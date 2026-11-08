# syntax=docker/dockerfile:1
#
# TripReceipt 개발/빌드 환경
# 팀원 3명이 OS(Windows/macOS/Linux)와 무관하게 같은 Node 버전으로 작업하기 위한 이미지.
#
# 이 프로젝트는 백엔드가 없다. OCR 추론과 데이터 저장이 모두 브라우저에서 일어나므로
# 이 컨테이너가 하는 일은 (1) 개발 서버 실행 (2) 정적 파일 빌드 두 가지뿐이다.

FROM node:22-bookworm-slim

LABEL org.opencontainers.image.title="tripreceipt-web"
LABEL org.opencontainers.image.description="Dev/build environment for TripReceipt (browser-only OCR web app)"
LABEL org.opencontainers.image.licenses="Apache-2.0"

# scripts/fetch-models.sh 가 curl 과 tar 를 쓴다.
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        tar \
        git \
        make \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

EXPOSE 5173 4173
CMD ["bash"]
