// 八步 → 十步：改 CLAUDE.md 的步数字样 + 步表新增两行 + 把「未落」段改成已落，然后同步 AGENTS.md。
import { readFileSync, writeFileSync } from 'node:fs';

const B = 'G:/My Drive/Workplace/China KG Platform/hualong-backend';
const crlf = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

let t = read(`${B}/CLAUDE.md`);
const orig = t;
const edits = [
  ['#    2026-08-14 起全步全绿、exit 0（2026-08-20 起为八步）。任何一步变红都是真的坏了',
   '#    2026-08-14 起全步全绿、exit 0（2026-08-20 起为八步，2026-09-11 起为十步）。任何一步变红都是真的坏了'],

  ['`check-all.mjs` 按依赖顺序跑八步，前三步的输出是后面的输入（4-8 相互独立，但第 8 步读第 1 步的 `enums.tsv`，不得提前）：',
   '`check-all.mjs` 按依赖顺序跑十步，前三步的输出是后面的输入（4-10 相互独立，但第 8 步读第 1 步的 `enums.tsv`，第 10 步读第 9 步产出的 `screen-operations.tsv` 与 `api/action-registry.tsv`，都不得提前）：'],

  ['### 八步全绿，任何一步变红都是真的坏了',
   '### 十步全绿，任何一步变红都是真的坏了'],

  ['（2026-08-20 由六步增为七步，同日再增为八步）',
   '（2026-08-20 由六步增为七步，同日再增为八步；2026-09-11 再增为十步）'],

  ['**第七、八步不是全部闸门。** `db/tools/check-action-registry.mjs`（动作登记表的校验器）**刻意不在这八步里**',
   '**第七、八步不是全部闸门。** `db/tools/check-action-registry.mjs`（动作登记表的校验器）**刻意不在这十步里**'],

  ['**两份表已落地，两个检查器也已写好**（`db/tools/check-screen-operations.mjs`、`db/tools/check-eli10.mjs`），但**刻意还没进 `check-all.mjs`**：今天 55 屏里 47 屏有行、167 个操作里 38 个已起草，现在挂进去就是 2 步常红。**判准与 `check-action-registry.mjs` 同一条 —— 全绿才准入，不是先挂上等它变绿**（本文第 82 行那段写的就是这个理由：常红的步骤等于没人再看红）。两份表填满那天，`check-all.mjs` 由八步变十步，**本文第 62、65、78、80、82、84 行的步数字样届时一起改**；`check-consistency` 数的是 `DECISIONS.md` 的表数链（45 → 62），不是 `check-all` 的步数，所以**改这几处字样不会弄红任何一步**，第 80 行那句增步沿革保留、追加新的一笔。',
   '**同日填满，同日准入，现在是第 9 与第 10 步。** 55 屏全部有行、167 个操作全部有「说人话」。判准与 `check-action-registry.mjs` 同一条 —— **全绿才准入，不是先挂上等它变绿**（本文「十步全绿」那段写的就是这个理由：常红的步骤等于没人再看红）。第 9 步在 47/55 屏、第 10 步在 38/167 时都还是红的，那两天它们**不在** `check-all.mjs` 里。'],
];

for (const [from, to] of edits) {
  if (!t.includes(from)) { console.error(`FAIL 找不到：${from.slice(0, 48)}…`); process.exit(1); }
  t = t.replace(from, to);
}

// 步表补两行（插在第 8 步那行之后）
const anchor = '| 8 | `check-enum-registry.mjs` |';
const lineEnd = t.indexOf('\n', t.indexOf(anchor));
if (lineEnd < 0) { console.error('FAIL 找不到第 8 步那一行'); process.exit(1); }
const twoRows = [
  '',
  '| 9 | `check-screen-operations.mjs` | `spec/screen-operations.tsv`（一屏一操作一行；生成器在前端 `hualong-teacher/tools/scan-wiring.mjs --emit`）→ 校验列、`state` 受控词、`source` 受控词、`operation_id` 是契约里真有的 `operationId`、以及**每个教师屏至少一行**。生成器只重写 `source=gen` 的行；上一轮是 gen、这一轮算不出来的行由它标 `stale`，本步报红交人判断 |',
  '| 10 | `check-eli10.mjs` | `spec/operation-eli10.tsv`（一操作一段人话，`碰到誰` 由生成器算）→ 校验每个契约操作都有一行、两列手写人话非空且不超长、`碰到誰` 以 `调用: ` 开头（说明它没被手改过）。**两个模块标签与全部取舍见 `../hualong-teacher/decision.md` 的 2026-09-11 一条** |',
].join('\n');
t = `${t.slice(0, lineEnd)}${twoRows}${t.slice(lineEnd)}`;

if (t === orig) { console.error('FAIL 什么都没改'); process.exit(1); }
writeFileSync(`${B}/CLAUDE.md`, crlf(t));
writeFileSync(`${B}/AGENTS.md`, crlf(t));   // 两份必须逐字相同（第 6 步会查）
console.log(`OK  CLAUDE.md / AGENTS.md 已同步，${orig.split('\n').length} 行 -> ${t.split('\n').length} 行`);
console.log(`   孤立 LF ${(t.match(/(?<!\r)\n/g) || []).length}`);
for (const k of ['八步', '十步']) console.log(`   出现「${k}」 ${(t.match(new RegExp(k, 'g')) || []).length} 次`);
