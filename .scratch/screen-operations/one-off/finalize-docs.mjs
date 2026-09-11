// 收尾：把「还在等准入」的说法改成「已准入」，三份文件。
import { readFileSync, writeFileSync } from 'node:fs';

const B = 'G:/My Drive/Workplace/China KG Platform/hualong-backend';
const F = 'G:/My Drive/Workplace/China KG Platform/hualong-teacher';
const crlf = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

function patch(p, pairs, syncTo) {
  let t = read(p);
  for (const [from, to] of pairs) {
    if (!t.includes(from)) { console.error(`FAIL ${p}\n  找不到：${from.slice(0, 56)}…`); process.exit(1); }
    t = t.replace(from, to);
  }
  writeFileSync(p, crlf(t));
  if (syncTo) writeFileSync(syncTo, crlf(t));
  console.log(`OK   ${p}${syncTo ? ' （并同步 ' + syncTo.split('/').pop() + '）' : ''}`);
}

// ── 后端 CLAUDE.md（＋ AGENTS.md）────────────────────────────────────────
patch(`${B}/CLAUDE.md`, [
  ['**第七、八步不是全部闸门。**',
   '**这几步不是全部闸门。**'],
], `${B}/AGENTS.md`);

// ── db/spec/README.md ──────────────────────────────────────────────────
patch(`${B}/db/spec/README.md`, [
  ['**两个检查器已写好**（`db/tools/check-screen-operations.mjs`、`db/tools/check-eli10.mjs`），但**刻意还没进 `check-all.mjs`**：表还没填满，现在挂进去就是常红。判准与 `check-action-registry.mjs` 同一条 —— 全绿才准入。**上面「手工维护的只有……」那句要按新的两份表读。**',
   '**两个检查器是 `check-all.mjs` 的第 9 与第 10 步**（`db/tools/check-screen-operations.mjs`、`db/tools/check-eli10.mjs`）。它们**先写好、等表填满、全绿之后才准进的列**，判准与仍在列外的 `check-action-registry.mjs` 同一条 —— 常红的步骤等于没人再看红。**上面「手工维护的只有……」那句要按新的两份表读。**'],
]);

// ── 前端 decision.md ───────────────────────────────────────────────────
patch(`${F}/decision.md`, [
  ['**两个检查器刻意没进 `check-all.mjs`**（表没填满，挂进去就是常红）。判准照 `check-action-registry.mjs` 的先例：全绿才准入。',
   '**两个检查器先写好、没进 `check-all.mjs`，等两份表填满、全绿之后才进的列。** 判准照 `check-action-registry.mjs` 的先例：全绿才准入。'],
  ['**`check-screen-operations` 现在绿了**（137 行 / 55 屏 / 无悬空外键 / 无 stale）。**但两个检查器仍不单独入列** —— `check-eli10` 还没绿（101 条未起草），按已定的判准「全绿才准入」两条一起进，那一步届时 `check-all` 由八步变十步。',
   '**两份表都填满了，两个检查器都在 2026-09-11 当天进了列。** `check-all.mjs` 由八步变十步（第 9 步 `check-screen-operations`：137 行 / 55 屏 / 无悬空外键 / 无 stale；第 10 步 `check-eli10`：167/167 已起草），**十步全绿、exit 0**。后端 `CLAUDE.md` 与 `AGENTS.md` 的步数字样同批改完（两份逐字相同，「八步」只剩历史沿革那一句）。'],
  ['- **ELI10 起草：96/167。** 剩下 71 条（`home-school` 已完成；`org`／`admin-content` 36 条、`growth-book` 35 条在排队）。\n- **两个检查器挂进 `check-all`**（`check-screen-operations` 已绿，`check-eli10` 等表填满），那一步后端 CLAUDE.md 的步数字样一起改。',
   '- **ELI10 起草：167/167，已毕。** 六批草稿加一个修正批次，合并表查过：分页 0 缺口、次序 0 缺口、长度 0 超长。\n- **两个检查器已挂进 `check-all`**（八步 → 十步），十步全绿。'],
]);
