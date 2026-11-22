import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateTax } from '../src/ui/tax-field.ts';

test('포함세액: 11,000원에 포함된 10% 부가세는 1,000원이다', () => {
  assert.equal(calculateTax(11_000, 10, 'included', 'KRW'), 1_000);
});

test('금액의 %: 11,000원의 10%는 1,100원이다', () => {
  assert.equal(calculateTax(11_000, 10, 'percentage', 'KRW'), 1_100);
});

test('소수 비율과 통화 표시 자릿수에 맞게 계산한다', () => {
  assert.equal(calculateTax(100, 8.5, 'included', 'USD'), 7.83);
  assert.equal(calculateTax(100, 8.5, 'included', 'KRW'), 8);
  assert.equal(calculateTax(100, 8.5, 'percentage', 'JPY'), 9);
  assert.equal(calculateTax(100, 8.5, 'percentage', 'EUR'), 8.5);
});

test('0%와 총액 0은 부가세 0으로 계산한다', () => {
  assert.equal(calculateTax(11_000, 0, 'included', 'KRW'), 0);
  assert.equal(calculateTax(11_000, 0, 'percentage', 'USD'), 0);
  assert.equal(calculateTax(0, 10, 'included', 'KRW'), 0);
});
