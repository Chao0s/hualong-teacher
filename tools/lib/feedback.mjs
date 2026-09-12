/**
 * 檢測結論的**唯一儲存** —— 人對機器發現的判斷。
 *
 *   docs/audit/checker-feedback.tsv     五欄：key · status · note · reviewer · updated_at
 *
 * 為什麼要有它：檢測器只會產出「發現」，不會判「這是不是問題」。人判的那一半
 * 從前活在 `wiring.allowlist.json` 裡，只蓋 `wire` 那一層（38 條）。
 * 現在十層共用同一份，而且**可以寫**（表單直接寫回這份 tsv，另有一條 HTTP 路由讀寫）。
 *
 * 三條規矩：
 *
 * 1. **一份，不是兩份。** 舊的 `wiring.allowlist.json` 已遷進這裡並退役；
 *    兩個儲存一定會漂，而這一整輪撞到的毛病一半是「第二份不該存在」。
 *
 * 2. **key 必須穩定。** 它由發現自己帶（`Run.add({ key })`），不是從 `what` 那句
 *    切出來的 —— `what` 句裡有數字（「42 operation(s)…」），每次跑都不一樣。
 *    取不到穩定 key 的發現**不可審**，報告會照實說。
 *
 * 3. **壞掉的行當場拋，不靜默跳過。** 少一個 tab、狀態詞不在表裡，都直接報。
 *    靜默跳過與靜默截短是同一種毛病（本倉已撞過多次）。
 *
 * 詞表（六個值）—— 它**不是決議**。表上選了只代表「這條已審、結論是什麼、誰審的」。
 * 要變成正式決議，按原規矩改 `decision.md`／`DECISIONS.md`，那裡才寫得出理由與代價。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..');
export const FEEDBACK_PATH = join(REPO, 'docs', 'audit', 'checker-feedback.tsv');

export const COLUMNS = ['key', 'status', 'note', 'reviewer', 'updated_at'];

/** 六個值，各說一件不同的事。加值前先想清楚它與現有的差在哪。 */
export const STATUS = {
  误报: '檢測器錯了 —— 這條不是問題',
  接: '接受，要去接／去修',
  不建: '接受，但刻意不做（理由寫在 note）',
  已修: '已經修好（note 帶 commit）',
  待決: '需要一個決定，已轉成一張票',
  已知: '知道，且容忍（例：佔位頁沒 TLS）',
};

export const STATUS_VALUES = Object.keys(STATUS);

const fail = (msg) => { throw new Error(`checker-feedback: ${msg}`); };

const assertClean = (v, field) => {
  const s = String(v ?? '');
  if (s.includes('\t')) fail(`${field} 含 tab`);
  if (s.includes('\n')) fail(`${field} 含換行`);
  return s;
};

/**
 * 讀全部結論。回 `Map<key, row>`。
 * 檔不存在回空 Map（**但會說出來** —— 呼叫方要印「還沒有任何審核結論」，
 * 不能讓它看起來像「全都審過了」）。
 */
export function readFeedback(path = FEEDBACK_PATH) {
  const rows = new Map();
  if (!existsSync(path)) return rows;
  const lines = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const head = lines[0].split('\t');
  const missing = COLUMNS.filter((c) => !head.includes(c));
  if (missing.length) fail(`表頭缺欄 ${missing.join(', ')}；實際表頭 ${head.join(' | ')}`);
  lines.slice(1).forEach((line, i) => {
    if (!line.trim()) return;
    const cells = line.split('\t');
    if (cells.length !== head.length) {
      fail(`第 ${i + 2} 行有 ${cells.length} 格，表頭有 ${head.length} 格（少／多一個 tab 會讓整行錯位）`);
    }
    const row = Object.fromEntries(head.map((h, k) => [h, cells[k]]));
    if (!row.key) fail(`第 ${i + 2} 行沒有 key`);
    if (!STATUS_VALUES.includes(row.status)) {
      fail(`第 ${i + 2} 行的 status 「${row.status}」不在詞表（${STATUS_VALUES.join(' / ')}）`);
    }
    rows.set(row.key, row);
  });
  return rows;
}

/** 寫全部結論。先排序，讓 diff 穩定（key 字母序）。 */
export function writeFeedback(rows, path = FEEDBACK_PATH) {
  const list = [...rows.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const out = [COLUMNS.join('\t')];
  for (const r of list) {
    if (!STATUS_VALUES.includes(r.status)) fail(`status 「${r.status}」不在詞表`);
    out.push(COLUMNS.map((c) => assertClean(r[c], c)).join('\t'));
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, out.join('\n') + '\n', 'utf8');
  return list.length;
}

/** 新增或更新一條。回 { row, created }。 */
export function upsertFeedback({ key, status, note = '', reviewer = '', updated_at = '' }, path = FEEDBACK_PATH) {
  if (!key) fail('要一個 key');
  if (!STATUS_VALUES.includes(status)) {
    fail(`status 「${status}」不在詞表（${STATUS_VALUES.join(' / ')}）`);
  }
  if (!reviewer) fail('要一個 reviewer —— 沒署名就分不出誰判的');
  const rows = readFeedback(path);
  const created = !rows.has(key);
  const row = {
    key,
    status,
    note,
    reviewer,
    updated_at: updated_at || new Date().toISOString().slice(0, 10),
  };
  rows.set(key, row);
  writeFeedback(rows, path);
  return { row, created };
}

/**
 * 把結論套回發現清單。回三類 —— **已審的不靜默消失**，它被挪到另一欄。
 *   reviewed   有結論的
 *   unreviewed 沒結論的（要人看的就是這批）
 *   unkeyable  沒有穩定 key、因此**不可審**的（本身是一個發現）
 */
export function applyFeedback(findings, path = FEEDBACK_PATH) {
  const rows = readFeedback(path);
  const reviewed = [], unreviewed = [], unkeyable = [];
  for (const f of findings) {
    if (!f.key) { unkeyable.push(f); continue; }
    const r = rows.get(f.key);
    if (r) reviewed.push({ ...f, feedback: r });
    else unreviewed.push(f);
  }
  return { reviewed, unreviewed, unkeyable, rows };
}
