/**
 * P0 의 스모크 테스트.
 * CI 가 테스트를 실제로 돌리는지 확인하는 용도이며, P5 에서 영수증 파서 테스트로 확장된다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DETECTION_MODEL, RECOGNITION_MODELS, totalModelMB } from '../src/ocr/models.ts';

test('모델 이름은 공식 저장소의 model_name 과 일치해야 한다', () => {
  // 이 값이 inference.yml 의 model_name 과 다르면 SDK 초기화가 실패한다.
  assert.equal(DETECTION_MODEL.modelName, 'PP-OCRv5_mobile_det');
  assert.equal(RECOGNITION_MODELS.korean.modelName, 'korean_PP-OCRv5_mobile_rec');
});

test('모델 경로는 압축하지 않은 .tar 여야 한다', () => {
  for (const m of [DETECTION_MODEL, ...Object.values(RECOGNITION_MODELS)]) {
    assert.ok(m.url.endsWith('.tar'), `${m.modelName} 의 경로가 .tar 가 아님: ${m.url}`);
    assert.ok(!m.url.endsWith('.tar.gz'), `${m.modelName} 은 gzip 이면 SDK 가 읽지 못함`);
  }
});

test('첫 진입 다운로드 용량 안내값이 계산된다', () => {
  const total = totalModelMB();
  assert.ok(total > 10 && total < 50, `예상 범위를 벗어남: ${total}MB`);
});
