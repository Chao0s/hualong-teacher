/**
 * Intent: what the prototype expresses, against what the mini-program wired.
 *
 * This layer exists because of what the prototype IS here. It is not the
 * last-resort authority on field names — for that, `db/01_schema.sql` wins.
 * It is the **record of interaction intent**: the buttons, the sections, the
 * things a screen was designed to let a teacher do. The standing question this
 * whole skill answers is whether the mini-program ever grew the calls to carry
 * all of that intent. So the prototype is the reference for THIS question, not
 * a fallback below the code.
 *
 * The comparison is already made, in the `trigger_flag` column of
 * `screen-operations.tsv`. Measured 2026-09-12 across 142 rows:
 *
 *   both columns filled   29    compared and matched
 *   `只wxml`              22    the client wires it, the prototype shows no such control
 *   `原型无按钮`           20    the prototype has no button for this operation
 *   neither column        71    pure reads — nothing to compare
 *
 * A row with an empty `trigger_prototype` is therefore NORMAL, not a finding.
 * Reading it as one reported 99 non-defects, which is how a gate teaches people
 * to stop reading it.
 *
 * **One finding per class, carrying the count and the list.** Forty-two
 * individually-filed findings that all say the same sentence are one finding
 * with a list, and they stay comparable between runs.
 *
 * Two classes, never merged (2026-09-12):
 *
 *   intent-missing     the prototype shows it and neither the contract nor the
 *                      client has it — a real gap, machine-provable
 *   prototype-behind   the prototype shows it, a decision has since changed it,
 *                      and the prototype has not caught up — the PROTOTYPE is
 *                      what needs editing, not the client
 *
 * Merging them would file "the mini-program never wired this" and "the prototype
 * is behind the decisions" as one pile. They go to different people.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO } from '../lib/findings.mjs';

const BACKEND = resolve(REPO, '..', 'hualong-backend');
const SPEC = join(BACKEND, 'db', 'spec');

const readTsv = (p) => {
  const rows = readFileSync(p, 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n');
  const head = rows[0].split('\t');
  return rows.slice(1).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [head[i], v ?? ''])));
};

/**
 * Operations the prototype does NOT show but decisions established. Each was
 * traced to a decision on 2026-09-12. This list is a STORED EXPECTATION, so it
 * is declared here where a human reads it, and a new operation with no
 * prototype intent and no entry here is reported.
 */
const DECIDED_WITHOUT_PROTOTYPE = new Map([
  ['publishMonthEval', 'F17／§10.4 — 教师人工把关后发布给家长；原型那页只有「保存评价」'],
  ['closeParentTask', 'F11／F16／Q60-l — 任务要能从 s2 走到 s3'],
  ['deleteMoment', 'Q59-m1a／m3／m4／n6 — 教师删自己发的那条'],
  ['updateParentTaskDraft', '§4／§7.3／F16 — 草稿可回头改'],
  ['createResourceDownloadLink', '§10／§4／F5 — 取档要签短链、要记一笔'],
  ['createSession', '§8 — 整套原型没有登录页，刻意没做'],
  ['revokeSession', '§8 — 同上'],
  ['listMyProfileChanges', 'G45 — 档案修改走申请制'],
]);

const describe = (o) => `${o.screen} → ${o.operation_id || o.path || '(no operation)'}`;

export async function proto(r) {
  if (!existsSync(join(SPEC, 'screen-operations.tsv'))) {
    r.skip('proto', `no ${join(SPEC, 'screen-operations.tsv')}`,
      'whether the prototype expresses anything the client and the contract both lack');
    return;
  }
  const ops = readTsv(join(SPEC, 'screen-operations.tsv'));
  const flag = (o) => (o.trigger_flag ?? '').trim();

  const both = ops.filter((o) => (o.trigger_prototype ?? '').trim() && (o.trigger_wxml ?? '').trim());
  // **2026-09-12 旗標換名**：舊的 `只wxml`(22) 與 `原型无按钮`(20) 併成 `原型有意圖未對上`(42)。
  // 為什麼併：原型的意圖現在有機讀標記（data-intent，709 個／55 份），而比對函式從前
  // 只比對**按鈕文案** —— 所以「文案不匹配」與「原型沒有這個控件」落到同一個旗標。
  // 現在分得開：標了意圖而對不上，是**比對失敗**，不是原型沒有。
  // 舊名仍要認，否則這一層會靜默報 0 —— 那與「掃描器悄悄停止掃描」是同一個毛病。
  const intentUnmatched = ops.filter((o) => /原型有意圖未對上/.test(flag(o)));
  const wxmlOnly = ops.filter((o) => flag(o) === '只wxml');
  const protoNoButton = ops.filter((o) => flag(o) === '原型无按钮');
  const silent = ops.filter((o) => !flag(o) && !(o.trigger_prototype ?? '').trim() && !(o.trigger_wxml ?? '').trim());

  console.log(`   [proto/triggers] ${both.length} compared and matched, ` +
    `${intentUnmatched.length} prototype-has-intents-but-text-unmatched, ` +
    `${silent.length} with no trigger at all (pure reads)`);

  // ── 原型標了意圖、文案沒對上 ───────────────────────────────────────────
  // 這一批是**下一步要做的活**：把意圖 id 對到操作。一個類別、一個發現、帶清單 ——
  // 不是 42 條各說同一句話的發現。
  if (intentUnmatched.length) {
    r.add({
      layer: 'proto', severity: 'medium', kind: 'coverage',
      subject: 'intent-unmatched',
      what: `${intentUnmatched.length} operation(s) whose prototype intent is not yet paired with the client call`,
      detail: `${intentUnmatched.map((o) => `${describe(o)}  (wxml: ${o.trigger_wxml || '(無)'})`).join('\n')}\n` +
        '原型的意圖已有機讀標記（data-intent，709 個／55 份），而這一格只做到「文案沒對上」。\n' +
        '缺的是**把意圖 id 對到操作**那一步 —— 那正是對稱表的本體。',
    });
  }

  // 舊旗標若又出現，報出來：它們已不該再產生，而這一層從前正是靠那兩個名字過濾的。
  if (wxmlOnly.length || protoNoButton.length) {
    r.add({
      layer: 'proto', severity: 'medium', kind: 'check-failed',
      subject: 'old-flags-returned',
      what: 'the old trigger flags came back — this layer would have silently stopped reporting them',
      detail: `只wxml ${wxmlOnly.length}, 原型无按钮 ${protoNoButton.length}\n` +
        '這兩個旗標 2026-09-12 已併入 `原型有意圖未對上`；又出現說明產生器被改回去了。',
    });
  }

  // ── no prototype intent, and whether a decision explains it ─────────────
  // A row with no prototype control is NORMAL for a read — a list or detail
  // load has no button. What is worth a decision is a WRITE with no prototype
  // intent, or an operation whose decision is not recorded. Measured
  // 2026-09-12: of 106 rows with an operation and no prototype trigger, 70 are
  // GET. Filing all 106 reported mostly non-defects.
  const noProto = ops.filter((o) => !(o.trigger_prototype ?? '').trim() && (o.operation_id ?? '').trim());
  const explained = [];
  const writes = [];
  for (const o of noProto) {
    const why = DECIDED_WITHOUT_PROTOTYPE.get(o.operation_id);
    if (why) explained.push({ o, why });
    else if ((o.method ?? '') !== 'GET') writes.push(o);
  }

  if (explained.length) {
    r.add({
      layer: 'proto', severity: 'low', kind: 'prototype-behind',
      subject: 'decided-not-in-prototype',
      what: `${explained.length} operation(s) the prototype does not show, each traced to a decision — the prototype is behind, not the client`,
      detail: explained.map(({ o, why }) => `${describe(o)}\n    ${why}`).join('\n'),
    });
  }

  if (writes.length) {
    r.add({
      layer: 'proto', severity: 'low', kind: 'coverage',
      subject: 'writes-without-prototype-control',
      what: `${writes.length} write operation(s) with no prototype control — an intent is unrecorded`,
      detail: `${writes.map(describe).join('\n')}\n` +
        '写入而原型没有对应控件：要么原型该补，要么这个写入由一次点按隐式触发而扫描器看不见。\n' +
        '逐条要一个结论 —— 不能靠「表里没这行」代替说明。',
    });
  }
  console.log(`   [proto/behind] ${explained.length} traced to a decision; ${writes.length} write(s) with no prototype control`);
}
