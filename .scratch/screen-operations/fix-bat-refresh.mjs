// launch api-doc.bat 加一段「先刷新数据」，并把浏览器直接开到 /pages（按屏幕看）。
// 用户的诉求：别让人手打一堆命令才看得到页面。CRLF 原样保留。
import { readFileSync, writeFileSync } from 'node:fs';

const F = 'G:/My Drive/Workplace/China KG Platform/hualong-teacher/launch api-doc.bat';
const crlf = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
let t = readFileSync(F, 'utf8').replace(/\r\n/g, '\n');

// ── 1) 在 dry-run 之前插一段「刷新数据」 ──────────────────────────────
const anchor = "rem dry-run: report what would happen, then exit (no windows spawned)";
const refresh = [
  'rem ---- 3a) refresh the two spec tables BEFORE serving ----',
  'rem /pages 与 /roles 是**每次请求现读** db/spec 的两份 tsv 的（screen-operations.tsv、operation-eli10.tsv）。',
  'rem 所以改了小程序页面之后要重扫一次，否则页面上还是旧数据 —— 这段就是那一步，省得手打。',
  'rem 扫的是 miniprogram/ 的 55 页与契约，不写库、不需要后端在跑。',
  'echo   refreshing the spec tables ^(npm run emit:screens^) ...',
  'if defined HL_NO_REFRESH (',
  '  echo   [skipped] HL_NO_REFRESH is set',
  ') else (',
  '  if not exist "..\\hualong-backend\\db\\spec" (',
  '    echo   [WARN] ..\\hualong-backend\\db\\spec not found - serving existing tables as-is.',
  '  ) else (',
  '    call npm run --silent emit:screens',
  '    if errorlevel 1 echo   [WARN] emit:screens failed - serving whatever is on disk.',
  '  )',
  ')',
  '',
].join('\n');
if (!t.includes(anchor)) { console.error('FAIL 找不到 dry-run 锚点'); process.exit(1); }
t = t.replace(anchor, `${refresh}${anchor}`);

// ── 2) dry-run 也报一下刷新 ─────────────────────────────────────────
t = t.replace(
  '  echo   [dry-run] mock start flag = %STARTMOCK%  ^(1=would start, 0=already running^)',
  '  echo   [dry-run] mock start flag = %STARTMOCK%  ^(1=would start, 0=already running^)\r\n  echo   [dry-run] would run npm run emit:screens first  ^(skip with HL_NO_REFRESH=1^)',
);

// ── 3) 浏览器直接开到 /pages（按屏幕看），并把它排在横幅第一行 ────────
t = t.replace(
  'start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:!PICKED!/"',
  'start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:!PICKED!/pages"',
);
t = t.replace(
  'echo   Swagger UI    http://127.0.0.1:!PICKED!/\r\n',
  'echo   By screen     http://127.0.0.1:!PICKED!/pages        ^<-- opens automatically\r\n',
);
// 去掉原来那条重复的 By screen 行
t = t.replace(
  'echo   By screen     http://127.0.0.1:!PICKED!/pages\r\necho   Role matrix',
  'echo   By module     http://127.0.0.1:!PICKED!/            ^(Swagger UI^)\r\necho   Role matrix',
);

writeFileSync(F, crlf(t));
console.log('OK  launch api-doc.bat 改好；行数', t.split('\n').length);
console.log('  孤立 LF', (t.match(/(?<!\r)\n/g) || []).length);
