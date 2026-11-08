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
  // OpenCV.js / onnxruntime-web 은 사전 번들링에서 제외해야 로딩이 안정적이다.
  optimizeDeps: {
    exclude: ['@techstark/opencv-js', 'onnxruntime-web'],
  },
});
