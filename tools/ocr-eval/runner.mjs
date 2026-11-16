// 목록의 PNG 를 앱의 'OCR 테스트' 화면(전처리 끔)에 차례로 넣고 결과 JSON 을 저장한다.
// 이미 결과가 있으면 건너뛰므로 중간에 끊겨도 이어서 돌릴 수 있다.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import pw from 'playwright';
const { chromium } = pw;
const [,, listFile, outDir, port = '4500'] = process.argv;
const files = fs.readFileSync(listFile, 'utf8').split('\n').filter(Boolean);
fs.mkdirSync(outDir, { recursive: true });
const ROOT = process.env.TRIPRECEIPT_DIST ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../dist');
const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.tar':'application/x-tar'};
const server = http.createServer((req,res)=>{let p=path.join(ROOT,decodeURIComponent(req.url.split('?')[0].split('#')[0]));
  if(!fs.existsSync(p)||fs.statSync(p).isDirectory())p=path.join(ROOT,'index.html');
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  res.setHeader('Content-Type',MIME[path.extname(p)]??'application/octet-stream');fs.createReadStream(p).pipe(res);});
await new Promise(r=>server.listen(+port,r));
const b = await chromium.launch();
const page = await (await b.newContext({viewport:{width:900,height:900}})).newPage();
await page.goto(`http://localhost:${port}/#/settings/ocr-test`,{waitUntil:'networkidle'});
await page.waitForSelector('#pp-enable');
// OCR_MODE: raw = 이미지를 그대로 1회 인식 (전처리 조합 이미지를 넣을 때)
//           app = 앱의 실제 처리 (1차 → 회전·자르기·32px·흑백 → 2차, 기울기 1도 미만이면 2차 생략)
//           app-noskip = 앱 처리, 2차 생략 없이 항상
const MODE = process.env.OCR_MODE ?? 'raw';
const LANG = process.env.OCR_LANG ?? 'korean';    // korean | zh_ja
await page.selectOption('#ocr-lang', LANG);
const setBox = async (sel, want) => { if ((await page.isChecked(sel)) !== want) await page.click(sel); };
await setBox('#pp-enable', MODE !== 'raw');
if (MODE !== 'raw') await setBox('#pp-skip', MODE === 'app');
console.log(`mode=${MODE} lang=${LANG}`);
let done = 0;
for (const f of files) {
  const out = path.join(outDir, path.basename(f).replace(/\.(png|jpe?g)$/i, '.json'));
  if (fs.existsSync(out)) { done++; continue; }
  await page.setInputFiles('#ocr-file', f);
  await page.evaluate(()=>{ globalThis.__ocrLast = null; });
  const t0 = Date.now();
  await page.click('button:has-text("인식 실행")');
  await page.waitForFunction(() => globalThis.__ocrLast || document.querySelector('.ocr-status.fail'), null, { timeout: 600000, polling: 200 });
  const raw = await page.evaluate(() => globalThis.__ocrLast);
  if (!raw) { console.log('실패', f); continue; }
  raw.wallMsRunner = Date.now() - t0;
  fs.writeFileSync(out, JSON.stringify(raw));
  done++; console.log(`${done}/${files.length} ${path.basename(f)} ${(raw.result.metrics.totalMs/1000).toFixed(1)}s`);
}
await b.close(); server.close();
