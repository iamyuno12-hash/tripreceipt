#!/usr/bin/env sh
# OCR 모델을 공식 HuggingFace 저장소에서 내려받아 SDK 가 요구하는 형식으로 묶는다.
#
# @paddleocr/paddleocr-js 는 모델을 "압축하지 않은 .tar" 로 받는다.
# .tar 안에는 inference.onnx 와 inference.yml 이 있어야 하고,
# inference.yml 의 model_name 이 코드에서 넘기는 이름과 정확히 같아야 한다.
#
# 모델 파일은 용량이 커서 git 에 올리지 않는다(.gitignore). 팀원은 각자 이 스크립트를 한 번 실행한다.
#
# 사용법:  sh scripts/fetch-models.sh

set -eu

OUT_DIR="public/models"
BASE="https://huggingface.co"

# 형식: <저장소>|<출력 파일명>|<기대 model_name>
MODELS="
PaddlePaddle/PP-OCRv5_mobile_det_onnx|PP-OCRv5_mobile_det.tar|PP-OCRv5_mobile_det
PaddlePaddle/korean_PP-OCRv5_mobile_rec_onnx|korean_PP-OCRv5_mobile_rec.tar|korean_PP-OCRv5_mobile_rec
"

mkdir -p "$OUT_DIR"

echo "$MODELS" | while IFS='|' read -r repo out name; do
    [ -z "${repo:-}" ] && continue

    if [ -f "$OUT_DIR/$out" ]; then
        echo "[skip] $out (이미 있음)"
        continue
    fi

    echo "[get ] $repo"
    tmp=$(mktemp -d)

    # inference.onnx 와 inference.yml 두 파일만 필요하다.
    for f in inference.onnx inference.yml; do
        if ! curl -fsSL --retry 3 --max-time 300 \
                "$BASE/$repo/resolve/main/$f" -o "$tmp/$f"; then
            echo "  !! $f 다운로드 실패 — 네트워크를 확인하세요" >&2
            rm -rf "$tmp"
            exit 1
        fi
    done

    # yml 의 model_name 이 기대값과 같은지 확인한다.
    # 이 값이 어긋나면 SDK 초기화 단계에서 바로 오류가 난다.
    actual=$(grep -E '^[[:space:]]*model_name:' "$tmp/inference.yml" \
             | head -1 | sed 's/.*model_name:[[:space:]]*//' | tr -d '"'"'"'\r')
    if [ "$actual" != "$name" ]; then
        echo "  !! model_name 불일치: 기대='$name' 실제='$actual'" >&2
        echo "     src/ocr/models.ts 의 상수를 실제 값으로 맞추세요." >&2
        rm -rf "$tmp"
        exit 1
    fi

    # 압축하지 않은 tar (반드시 -cf, gzip 쓰면 SDK 가 읽지 못한다)
    tar -cf "$OUT_DIR/$out" -C "$tmp" inference.onnx inference.yml
    rm -rf "$tmp"

    size=$(du -h "$OUT_DIR/$out" | cut -f1)
    echo "[ok  ] $out ($size, model_name=$name)"
done

echo ""
echo "완료. $OUT_DIR 내용:"
ls -lh "$OUT_DIR"
