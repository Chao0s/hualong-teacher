// 验 bodyOf 的 bug：签名里带解构参数时，它把参数的花括号当成函数体。
import { readFileSync } from 'node:fs';

const src = readFileSync('G:/My Drive/Workplace/China KG Platform/hualong-teacher/miniprogram/services/co-education.js', 'utf8').replace(/\r\n/g, '\n');

// 这是 emit-screen-operations.mjs 里现在的实现
function bodyOfNow(s, name) {
  const re = new RegExp(`(?:^|\\n)(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = re.exec(s);
  if (!m) return '';
  const open = s.indexOf('{', m.index);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return s.slice(open, i + 1); }
    else if (ch === '`') { const j = s.indexOf('`', i + 1); i = j < 0 ? s.length : j; }
    else if (ch === "'" || ch === '"') { const j = s.indexOf(ch, i + 1); i = j < 0 ? s.length : j; }
    else if (ch === '/' && s[i + 1] === '/') { const j = s.indexOf('\n', i); i = j < 0 ? s.length : j; }
  }
  return '';
}

// 应该先跳过参数表（配平圆括号），再从签名之后找函数体
function bodyOfFixed(s, name) {
  const re = new RegExp(`(?:^|\\n)(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = re.exec(s);
  if (!m) return '';
  // 跳过参数表：从第一个 ( 开始配平圆括号（跳过字符串与模板）
  let i = s.indexOf('(', m.index);
  if (i < 0) return '';
  let pd = 0;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') pd++;
    else if (ch === ')') { pd--; if (pd === 0) { i++; break; } }
    else if (ch === '`') { const j = s.indexOf('`', i + 1); i = j < 0 ? s.length : j; }
    else if (ch === "'" || ch === '"') { const j = s.indexOf(ch, i + 1); i = j < 0 ? s.length : j; }
  }
  const open = s.indexOf('{', i);
  if (open < 0) return '';
  let depth = 0;
  for (let k = open; k < s.length; k++) {
    const ch = s[k];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return s.slice(open, k + 1); }
    else if (ch === '`') { const j = s.indexOf('`', k + 1); k = j < 0 ? s.length : j; }
    else if (ch === "'" || ch === '"') { const j = s.indexOf(ch, k + 1); k = j < 0 ? s.length : j; }
  }
  return '';
}

const names = ['parentEvalPeriods', 'listParentEvaluations', 'weeklyCoverage', 'classRoster', 'home', 'loadChildBook'];
console.log('函数名'.padEnd(24) + '现在取到'.padEnd(14) + '修后取到'.padEnd(14) + '现在里面有 api 调用吗');
for (const n of names) {
  const a = bodyOfNow(src, n);
  const b = bodyOfFixed(src, n);
  console.log(
    n.padEnd(24)
    + String(a.length + 'B').padEnd(14)
    + String(b.length + 'B').padEnd(14)
    + (/\bapi\.(get|post|put|patch|del|getPage|getRoster)\s*\(/.test(a) ? '有' : '**没有**'),
  );
}
