/**
 * 把 .scratch/screen-operations/eli10-drafts/*.json 的草稿合进
 * hualong-backend/db/spec/operation-eli10.tsv 的「幹嘛」「怎麼走」两列。
 *
 * 为什么要这一步：那两份表由 `npm run emit:screens` 生成（`source=gen` 行全量重写），
 * 但生成器**保留已有的「幹嘛」「怎麼走」**。所以草稿要落到那份文件上，之后每次重跑
 * 生成器都带得走。
 *
 * 只碰这两列。`碰到誰` 与 `derived_from` 每次由生成器重算 —— 它们是事实，不是文字。
 *
 *   node .scratch/screen-operations/apply-eli10-drafts.mjs
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const TSV = resolve(REPO, '..', 'hualong-backend', 'db', 'spec', 'operation-eli10.tsv');
const DRAFTS = join(HERE, 'eli10-drafts');

const HEAD = ['key', '幹嘛', '怎麼走', '碰到誰', 'derived_from'];
const lines = readFileSync(TSV, 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n');
const head = lines[0].split('\t');
for (const c of HEAD) if (!head.includes(c)) { console.error(`表头缺列 ${c}`); process.exit(1); }
const rows = lines.slice(1).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [head[i], v ?? ''])));

const files = existsSync(DRAFTS) ? readdirSync(DRAFTS).filter((f) => f.endsWith('.json')).sort() : [];
const draft = new Map();
const seenIn = new Map();

// 修正批次（`"overrides": true`）最后跑，允许覆盖已存在的条目。
// 普通批次之间**不许**有同一个 key —— 那是并行起草撞车，静默取一份会把另一份的错处藏起来。
// 但修正批次的存在本身说明前面那份漏了东西（例如事实文件后来才发现分页参数），
// 所以要留一条明说的路，而不是让人去手改那份 tsv。
const isOverride = (j) => j.overrides === true;
const parsed = files.map((f) => ({ f, j: JSON.parse(readFileSync(join(DRAFTS, f), 'utf8')) }));
const ordered = [...parsed.filter((x) => !isOverride(x.j)), ...parsed.filter((x) => isOverride(x.j))];

let replaced = 0;
for (const { f, j } of ordered) {
  for (const [k, v] of Object.entries(j.entries || {})) {
    if (!v['幹嘛'] || !v['怎麼走']) { console.error(`${f}: ${k} 缺「幹嘛」或「怎麼走」—— 起草不许留空`); process.exit(1); }
    if (isOverride(j)) {
      if (!draft.has(k)) console.warn(`⚠ ${f}: ${k} 是修正条目，但没有被修正的原文 —— 检查文件名是不是太早（修正批次排最后）`);
      else replaced++;
    } else if (draft.has(k)) {
      console.error(`${k} 在两份草稿里都出现： ${seenIn.get(k)} 与 ${f}`);
      process.exit(1);
    }
    draft.set(k, v);
    seenIn.set(k, f);
  }
}

let filled = 0;
const unknown = [];
for (const r of rows) {
  const d = draft.get(r.key);
  if (!d) continue;
  r['幹嘛'] = d['幹嘛'];
  r['怎麼走'] = d['怎麼走'];
  filled++;
}
for (const k of draft.keys()) if (!rows.some((r) => r.key === k)) unknown.push(k);

writeFileSync(TSV, `${[head, ...rows.map((r) => head.map((h) => String(r[h] ?? '').replace(/[\t\r\n]/g, ' ')))].map((c) => c.join('\t')).join('\n')}\n`);

const done = rows.filter((r) => r['幹嘛']).length;
console.log(`草稿文件 ${files.length} 份（修正批次 ${parsed.filter((x) => isOverride(x.j)).length}），条目 ${draft.size} 个，落到 ${filled} 行（其中覆盖 ${replaced} 行）→ ${TSV}`);
console.log(`已起草 ${done}/${rows.length}，剩 ${rows.length - done}`);
if (unknown.length) console.log(`⚠ 草稿里有契约里没有的 key（没落盘）：${unknown.join(', ')}`);
for (const f of files) {
  const j = JSON.parse(readFileSync(join(DRAFTS, f), 'utf8'));
  console.log(`  ${f}  ${Object.keys(j.entries || {}).length} 条  tags=${(j.tags || []).join(',')}`);
}
