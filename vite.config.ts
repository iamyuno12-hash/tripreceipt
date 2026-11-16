import { defineConfig } from 'vite';

// onnxruntime-web 의 멀티스레드 WASM 은 SharedArrayBuffer 를 쓰고,
// SharedArrayBuffer 는 cross-origin isolation 이 걸린 페이지에서만 허용된다.
// 그래서 개발 서버와 배포 서버 모두 아래 두 헤더를 반드시 내려줘야 한다.
// (docker/nginx.conf 에 같은 설정이 있다 — 한쪽만 바꾸면 개발/배포가 어긋난다)
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  server: {
    host: '0.0.0.0', // 도커 컨테이너 밖(호스트 브라우저)에서 접속하기 위함
    port: 5173,
    headers: crossOriginIsolation,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    headers: crossOriginIsolation,
  },
  build: {
    outDir: 'dist',
    // 모델과 wasm 이 커서 경고가 뜨는 건 정상이다. 임계값만 올려 둔다.
    chunkSizeWarningLimit: 2048,
  },
  // onnxruntime-web 은 사전 번들링에서 제외한다 (wasm 파일 경로를 스스로 찾기 때문).
  // OpenCV.js 는 제외하면 안 된다: CommonJS/UMD 형식이라 Vite 가 사전 번들링으로
  // ES 모듈로 바꿔 줘야 `import cv from '@techstark/opencv-js'` 가 개발 서버에서 동작한다.
  // (제외했을 때 개발 서버에서만 "does not provide an export named 'default'" 오류가 났다)
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
});
