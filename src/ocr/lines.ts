/**
 * 검출된 텍스트 박스를 "줄" 단위로 묶는다.
 *
 * P5 파서의 1단계에 해당하는 부분을 먼저 떼어 놓은 것이다.
 * 여기서는 전처리(기울기 보정)의 효과를 측정하는 용도로 쓰고,
 * P5 에서 금액 분리·품목 매칭을 이 위에 얹는다.
 */
import type { TextLine } from './engine.ts';
import type { OcrLineRecord } from '../types.ts';
import { median } from '../image/geometry.ts';

export interface GroupedLine {
  /** 왼쪽부터 정렬된 조각들 */
  readonly parts: readonly TextLine[];
  readonly centerY: number;
  /** 이 줄 안의 y 편차. 작을수록 깔끔하게 묶인 것 */
  readonly span: number;
  readonly text: string;
}

/**
 * y 좌표가 tolerance 안에 있는 박스끼리 같은 줄로 본다.
 *
 * 기울어진 이미지에서는 이 방법이 통하지 않는다. 한 줄 안의 y 편차가
 * 줄 사이 간격보다 커지기 때문이다 (docs/OCR-ENGINE.md 3.5 절).
 * 그래서 P3 의 기울기 보정이 선행돼야 한다.
 */
export function groupLinesByY(lines: readonly TextLine[], tolerance = 12): GroupedLine[] {
  const sorted = [...lines].sort((a, b) => a.centerY - b.centerY);
  const groups: TextLine[][] = [];

  for (const line of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(line.centerY - (last[0]?.centerY ?? 0)) <= tolerance) {
      last.push(line);
    } else {
      groups.push([line]);
    }
  }

  return groups.map((parts) => {
    const ordered = [...parts].sort((a, b) => a.minX - b.minX);
    const ys = parts.map((p) => p.centerY);
    return {
      parts: ordered,
      centerY: ys.reduce((a, b) => a + b, 0) / ys.length,
      span: Math.max(...ys) - Math.min(...ys),
      text: ordered.map((p) => p.text).join('  '),
    };
  });
}

/**
 * 박스 자체의 기울기(도)로 잔여 기울기를 추정한다.
 *
 * 각 박스의 위쪽 변 기울기를 모아 중앙값을 낸다. 전처리가 제대로 됐다면
 * 0 에 가까워야 하고, 0 에서 멀수록 줄 묶기가 깨진다.
 * 정답 데이터 없이 계산할 수 있어 측정 지표로 쓰기 좋다.
 */
export function residualSkewDegrees(lines: readonly TextLine[]): number {
  const angles: number[] = [];
  for (const line of lines) {
    const p = line.poly;
    if (p.length < 2) continue;
    const a = p[0];
    const b = p[1];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dx) < 1) continue;
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (Math.abs(deg) <= 30) angles.push(deg);
  }
  if (angles.length === 0) return 0;
  angles.sort((x, y) => x - y);
  const mid = Math.floor(angles.length / 2);
  return angles.length % 2 === 0
    ? ((angles[mid - 1] ?? 0) + (angles[mid] ?? 0)) / 2
    : (angles[mid] ?? 0);
}

export interface GroupingQuality {
  readonly groups: number;
  /** 한 줄 안 y 편차의 최댓값 */
  readonly maxSpan: number;
  /** 줄 사이 간격의 최솟값 */
  readonly minGap: number;
  /**
   * 고정 임계값으로 줄을 분리할 수 있는가.
   * maxSpan < minGap 이면 안전하게 묶을 수 있다.
   */
  readonly separable: boolean;
}

/** 줄 묶기가 신뢰할 만한지 평가한다. 전처리 효과 측정의 핵심 지표. */
export function gradeGrouping(grouped: readonly GroupedLine[]): GroupingQuality {
  const spans = grouped.map((g) => g.span);
  const centers = grouped.map((g) => g.centerY).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < centers.length; i++) {
    gaps.push((centers[i] ?? 0) - (centers[i - 1] ?? 0));
  }
  const maxSpan = spans.length ? Math.max(...spans) : 0;
  const minGap = gaps.length ? Math.min(...gaps) : Infinity;
  return {
    groups: grouped.length,
    maxSpan: Math.round(maxSpan),
    minGap: Number.isFinite(minGap) ? Math.round(minGap) : 0,
    separable: maxSpan < minGap,
  };
}

/** 저장된 OCR 상자(좌표만 있음)를 줄 묶기에 쓰는 TextLine 으로 바꾼다. */
export function toTextLines(records: readonly OcrLineRecord[]): TextLine[] {
  return records.map((r) => {
    const ys = r.poly.map((p) => p.y);
    const xs = r.poly.map((p) => p.x);
    return {
      text: r.text,
      score: r.score,
      poly: r.poly,
      centerY: ys.reduce((a, b) => a + b, 0) / (ys.length || 1),
      minX: xs.length ? Math.min(...xs) : 0,
      maxX: xs.length ? Math.max(...xs) : 0,
    };
  });
}

/** 글자 높이의 절반을 줄 묶기 허용치로 쓴다 (평가 도구의 '같은 줄' 기준과 같음). */
export function lineTolerance(lines: readonly TextLine[]): number {
  const hs = lines.map((l) => {
    const ys = l.poly.map((p) => p.y);
    return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  });
  return Math.max(4, median(hs) * 0.5);
}
