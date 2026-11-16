/**
 * OCR 모델 설정.
 *
 * @paddleocr/paddleocr-js 는 모델을 "압축하지 않은 .tar" URL 로 받는다.
 * tar 안에는 inference.onnx 와 inference.yml 이 있어야 하며,
 * inference.yml 의 model_name 이 아래 modelName 과 정확히 같아야 한다.
 * (다르면 SDK 초기화에서 바로 오류가 난다)
 *
 * 파일은 scripts/fetch-models.sh 로 public/models/ 에 내려받는다.
 * 용량이 커서 git 에는 올리지 않는다.
 */

import type { OcrLanguage } from '../types.ts';

export interface ModelAsset {
  /** inference.yml 의 Global.model_name 과 반드시 일치해야 하는 값 */
  readonly modelName: string;
  /** 브라우저가 가져갈 .tar 경로 */
  readonly url: string;
  /** 참고용 대략 용량 */
  readonly approxMB: number;
}

/** 글자 위치를 찾는 검출 모델. 언어와 무관하므로 모든 여행에서 공용. */
export const DETECTION_MODEL: ModelAsset = {
  modelName: 'PP-OCRv5_mobile_det',
  url: '/models/PP-OCRv5_mobile_det.tar',
  approxMB: 4.6,
};

/**
 * 인식 모델은 언어별로 다르다. 여행마다 언어를 정한다 (Trip.ocrLanguage).
 *
 * - korean: 한국어 전용 모델. 영어·숫자도 읽는다. 일본어 가나·한자는 못 읽는다.
 * - zh_ja : PaddleOCR 기본(중국어) 모델. 중국어·일본어·영어를 읽는다. 한글은 못 읽는다.
 *
 * 라틴 문자권(유럽 등) 모델도 같은 방법으로 항목만 추가하면 된다. 아직 시험할 영수증이 없어 넣지 않았다.
 */
export const RECOGNITION_MODELS: Record<OcrLanguage, ModelAsset> = {
  korean: {
    modelName: 'korean_PP-OCRv5_mobile_rec',
    url: '/models/korean_PP-OCRv5_mobile_rec.tar',
    approxMB: 12.8,
  },
  zh_ja: {
    modelName: 'PP-OCRv5_mobile_rec',
    url: '/models/PP-OCRv5_mobile_rec.tar',
    approxMB: 16.7,
  },
};

export type RecognitionLanguage = OcrLanguage;

/** 기본 인식 언어 */
export const DEFAULT_LANGUAGE: RecognitionLanguage = 'korean';

/** 모델 전체 용량 합계 (첫 진입 시 다운로드량 안내용) */
export function totalModelMB(lang: RecognitionLanguage = DEFAULT_LANGUAGE): number {
  return DETECTION_MODEL.approxMB + RECOGNITION_MODELS[lang].approxMB;
}
