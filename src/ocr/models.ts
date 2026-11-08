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
 * 인식 모델은 언어별로 다르다.
 * 여행 지역에 따라 전환하는 것이 이 프로젝트의 개선 포인트다 (docs/OCR-ENGINE.md 참고).
 *
 * P4 에서는 korean 하나만 붙여 동작을 확인하고,
 * 라틴 문자권 모델 추가는 P6 에서 다룬다.
 */
export const RECOGNITION_MODELS = {
  korean: {
    modelName: 'korean_PP-OCRv5_mobile_rec',
    url: '/models/korean_PP-OCRv5_mobile_rec.tar',
    approxMB: 12.8,
  },
} as const satisfies Record<string, ModelAsset>;

export type RecognitionLanguage = keyof typeof RECOGNITION_MODELS;

/** 기본 인식 언어 */
export const DEFAULT_LANGUAGE: RecognitionLanguage = 'korean';

/** 모델 전체 용량 합계 (첫 진입 시 다운로드량 안내용) */
export function totalModelMB(lang: RecognitionLanguage = DEFAULT_LANGUAGE): number {
  return DETECTION_MODEL.approxMB + RECOGNITION_MODELS[lang].approxMB;
}
