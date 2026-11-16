/**
 * 1차 인식 결과로 기울기·글자 높이를 재는 계산 (src/image/geometry.ts).
 * 평가 도구(tools/ocr-eval/pipeline.py first_pass_stats)와 같은 값을 내야 한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boxStats, median, normalizeAngle, needsSecondPass, orientationAmbiguous,
  meanScore, scaleToTextHeight, DEFAULT_PLAN,
} from '../src/image/geometry.ts';

/** 가로 w, 세로 h 인 글자 상자를 (cx, cy) 중심으로 deg 도 돌린 꼭짓점 4개 (y 는 아래로 증가) */
function box(text: string, cx: number, cy: number, w: number, h: number, deg: number, score = 0.95) {
  const r = (deg * Math.PI) / 180;
  const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as const;
  return { text, score, poly: pts.map(([x, y]) => ({ x: cx + x * Math.cos(r) - y * Math.sin(r), y: cy + x * Math.sin(r) + y * Math.cos(r) })) };
}
const close = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;

test('중앙값', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), 0);
});

test('각도는 -90 이상 90 미만으로 정규화된다 (긴 변은 방향이 없음)', () => {
  assert.ok(close(normalizeAngle(178), -2));
  assert.ok(close(normalizeAngle(-91), 89));
  assert.ok(close(normalizeAngle(90), -90));
  assert.ok(close(normalizeAngle(-3), -3));
});

test('기울어진 영수증의 각도와 글자 높이를 잰다', () => {
  const boxes = [box('M.커플세트', 100, 100, 200, 40, -2.7), box('69,000', 400, 100, 120, 40, -2.7),
                 box('테라 500mL', 100, 200, 220, 40, -2.7), box('합계', 100, 300, 80, 40, -2.7)];
  const s = boxStats(boxes);
  assert.ok(close(s.angle, -2.7, 1e-9), `angle=${s.angle}`);
  assert.ok(close(s.textHeight, 40, 1e-9), `h=${s.textHeight}`);
  assert.equal(s.used, 3, "'합계' 처럼 4글자 미만 상자는 각도 계산에서 뺀다");
});

test('꼭짓점 순서가 세로 변부터 시작해도 긴 변을 찾는다', () => {
  const b = box('첫수확조생햇귤', 0, 0, 300, 50, 5);
  const rotated = { ...b, poly: [b.poly[1]!, b.poly[2]!, b.poly[3]!, b.poly[0]!] };
  const s = boxStats([rotated]);
  assert.ok(close(s.angle, 5, 1e-9), `angle=${s.angle}`);
  assert.ok(close(s.textHeight, 50, 1e-9));
});

test('옆으로 누운 사진(77도)은 위아래 판정이 필요하다', () => {
  const s = boxStats([box('일본제 포니카세이', 0, 0, 300, 50, 77), box('치약걸이(3개입)', 0, 80, 280, 50, 77)]);
  assert.ok(close(s.angle, 77, 1e-9));
  assert.equal(orientationAmbiguous(s), true);
  assert.equal(orientationAmbiguous(boxStats([box('프리미엄 카츠', 0, 0, 200, 30, -2)])), false);
});

test('1도 미만이면 2차 인식을 생략하고, 글자를 못 찾았으면 다시 돌리지 않는다', () => {
  assert.equal(needsSecondPass({ angle: -0.78, textHeight: 41, used: 50 }), false);
  assert.equal(needsSecondPass({ angle: -1.3, textHeight: 50, used: 50 }), true);
  assert.equal(needsSecondPass({ angle: 16.9, textHeight: 45, used: 10 }), true);
  assert.equal(needsSecondPass({ angle: 30, textHeight: 0, used: 0 }), false);
  assert.equal(DEFAULT_PLAN.targetTextHeight, 32);
});

test('글자 높이를 32px 로 맞추는 배율', () => {
  assert.ok(close(scaleToTextHeight(64, 32), 0.5));
  assert.ok(close(scaleToTextHeight(23, 32), 32 / 23));
  assert.equal(scaleToTextHeight(0, 32), 1);
});

test('평균 신뢰도', () => {
  assert.equal(meanScore([]), 0);
  assert.ok(close(meanScore([box('a', 0, 0, 1, 1, 0, 0.9), box('b', 0, 0, 1, 1, 0, 0.7)]), 0.8));
});
