// 把三块新文字插进三份文档，全部按 CRLF 落盘。
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'G:/My Drive/Workplace/China KG Platform';
const SCRATCH = `${ROOT}/hualong-teacher/.scratch/screen-operations`;

const crlf = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

let failed = 0;
function commit(file, before, after, label, checks) {
  for (const [what, ok] of checks) {
    if (!ok) { console.error(`FAIL ${label}: ${what}`); failed++; return; }
  }
  writeFileSync(file, crlf(after));
  const lone = (after.match(/(?<!\r)\n/g) || []).length;
  console.log(`OK   ${label}: ${before.split('\n').length} 行 -> ${after.split('\n').length} 行，孤立 LF ${lone}`);
}

// 1. decision.md —— 追加到文件末尾
{
  const file = `${ROOT}/hualong-teacher/decision.md`;
  const before = read(file);
  const add = read(`${SCRATCH}/append-decision.md`);
  const trimmed = before.replace(/\n+$/, '');
  const after = `${trimmed}\n${add}`;
  commit(file, before, after, 'decision.md 追加', [
    ['原文不是新文件的完整前缀', after.startsWith(trimmed)],
    ['新章节标题没进去', after.includes('## 2026-09-11：Swagger 加一层「按屏幕查看」')],
    ['末段原文丢失', after.includes('圆点渲染仍待用户在微信开发者工具人工复查')],
  ]);
}

// 2. db/spec/README.md —— 插在「生成的六个文件」那句之前
{
  const file = `${ROOT}/hualong-backend/db/spec/README.md`;
  const before = read(file);
  const add = read(`${SCRATCH}/readme-insert.md`);
  const anchor = '生成的六个文件**不要手工编辑**。';
  const at = before.indexOf(anchor);
  if (at < 0) { console.error('FAIL README: 找不到锚点'); failed++; }
  else {
    const lineStart = before.lastIndexOf('\n', at) + 1;
    const after = before.slice(0, lineStart) + add + before.slice(lineStart);
    commit(file, before, after, 'README.md 插入', [
      ['待建小节没进去', after.includes('待建：再加两份表')],
      ['锚点丢了', after.includes(anchor)],
      ['screens.tsv 一行描述丢失', after.includes('手工维护** | 84')],
    ]);
  }
}

// 3. hualong-backend/CLAUDE.md —— 插在「手工维护的只有…」那段之后
{
  const file = `${ROOT}/hualong-backend/CLAUDE.md`;
  const before = read(file);
  const add = read(`${SCRATCH}/claude-insert.md`);
  const anchor = '手工维护的只有 `screens.tsv`、`scope-rules.json`、`enum-registry-exceptions.json`、`db/rubric/*.json`，以及 `db/layout/*.json`。';
  const at = before.indexOf(anchor);
  if (at < 0) { console.error('FAIL CLAUDE: 找不到锚点'); failed++; }
  else {
    const lineEnd = before.indexOf('\n', at + anchor.length) + 1;
    const after = before.slice(0, lineEnd) + '\n' + add + before.slice(lineEnd);
    commit(file, before, after, 'CLAUDE.md 插入', [
      ['待落小节没进去', after.includes('已定、未落：`db/spec/` 再加两份表')],
      ['锚点丢了', after.includes(anchor)],
      ['下一节标题丢了', after.includes('## UI 改版不得破坏数据映射')],
      ['八步那一节标题丢了', after.includes('### 八步全绿，任何一步变红都是真的坏了')],
    ]);
  }
}

process.exit(failed ? 1 : 0);
