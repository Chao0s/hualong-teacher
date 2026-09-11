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
  const wxmlOnly = ops.filter((o) => flag(o) === '只wxml');
  const protoNoButton = ops.filter((o) => flag(o) === '原型无按钮');
  const silent = ops.filter((o) => !flag(o) && !(o.trigger_prototype ?? '').trim() && !(o.trigger_wxml ?? '').trim());

  console.log(`   [proto/triggers] ${both.length} compared and matched, ${wxmlOnly.length} wxml-only, ` +
    `${protoNoButton.length} prototype-has-no-button, ${silent.length} with no trigger at all (pure reads)`);

  // ── the client wires it, the prototype shows no such control ────────────
  // Either the prototype is behind, or the client invented something. One
  // finding for the class, with the list — a decision is owed per row, but the
  // list is what a human reads.
  if (wxmlOnly.length) {
    r.add({
      layer: 'proto', severity: 'low', kind: 'prototype-behind',
      what: `${wxmlOnly.length} operation(s) the mini-program reaches with no matching prototype control`,
      detail: `${wxmlOnly.map((o) => `${describe(o)}  (wxml: ${o.trigger_wxml})`).join('\n')}\n` +
        '每一行要么是原型该补这个控件，要么是客户端做了原型没表达的事 —— 逐条要一个结论，但不能靠沉默代替。',
    });
  }

  // ── the prototype has no button for this operation ──────────────────────
  if (protoNoButton.length) {
    r.add({
      layer: 'proto', severity: 'low', kind: 'prototype-behind',
      what: `${protoNoButton.length} operation(s) the prototype gives no button for`,
      detail: protoNoButton.map(describe).join('\n'),
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
      what: `${explained.length} operation(s) the prototype does not show, each traced to a decision — the prototype is behind, not the client`,
      detail: explained.map(({ o, why }) => `${describe(o)}\n    ${why}`).join('\n'),
    });
  }

  if (writes.length) {
    r.add({
      layer: 'proto', severity: 'low', kind: 'coverage',
      what: `${writes.length} write operation(s) with no prototype control — an intent is unrecorded`,
      detail: `${writes.map(describe).join('\n')}\n` +
        '写入而原型没有对应控件：要么原型该补，要么这个写入由一次点按隐式触发而扫描器看不见。\n' +
        '逐条要一个结论 —— 不能靠「表里没这行」代替说明。',
    });
  }
  console.log(`   [proto/behind] ${explained.length} traced to a decision; ${writes.length} write(s) with no prototype control`);
}
