// launch api-doc.bat 的横幅补两行新路由（按屏幕看 / 按屏幕看的规格）。CRLF 原样保留。
import { readFileSync, writeFileSync } from 'node:fs';

const F = 'G:/My Drive/Workplace/China KG Platform/hualong-teacher/launch api-doc.bat';
const crlf = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
let t = readFileSync(F, 'utf8').replace(/\r\n/g, '\n');

const from = [
  'echo   Swagger UI    http://127.0.0.1:!PICKED!/',
  'echo   Role matrix   http://127.0.0.1:!PICKED!/roles',
  'echo   Raw contract  http://127.0.0.1:!PICKED!/openapi.yaml',
].join('\n');

const to = [
  'echo   Swagger UI    http://127.0.0.1:!PICKED!/',
  'echo   By screen     http://127.0.0.1:!PICKED!/pages',
  'echo   Role matrix   http://127.0.0.1:!PICKED!/roles',
  'echo   Screen spec   http://127.0.0.1:!PICKED!/pages.yaml',
  'echo   Raw contract  http://127.0.0.1:!PICKED!/openapi.yaml',
].join('\n');

if (!t.includes(from)) { console.error('FAIL 找不到横幅那三行'); process.exit(1); }
t = t.replace(from, to);

// 标题那行也提一句：这一份现在有两种看法
const h = 'echo   Hualong API contract - Swagger UI launcher';
if (!t.includes(h)) { console.error('FAIL 找不到标题行'); process.exit(1); }
t = t.replace(h, 'echo   Hualong API contract - Swagger UI launcher (by module / by screen)');

writeFileSync(F, crlf(t));
console.log('OK  横幅已补两行；CRLF 保留（孤立 LF ' + (t.match(/(?<!\r)\n/g) || []).length + '）');
