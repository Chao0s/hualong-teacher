/**
 * 复查一份 ELI10 草稿，合并进表之前跑。
 *
 * 我在前四批里把同一段检查手打了四遍，每一遍都要凭记忆列一遍「次序有没有提」的关键词，
 * 结果漏了「升序」与「名册整取」两个说法，白报两条假警。这个脚本把那件事固定下来。
 *
 *   node .scratch/screen-operations/verify-drafts.mjs b05.json
 *   node .scratch/screen-operations/verify-drafts.mjs --all
 *
 * 退出码 1 = 有问题（条数不对、空白、超长、分页/次序没提、与其它草稿撞 key）。
 * 「次序没提」是**提醒不是错误** —— 措辞可以很多样，机器猜不准；打印出来由人扫一眼。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DRAFTS = join(HERE, 'eli10-drafts');
const FACTS = join(HERE, 'eli10-facts.jsonl');

const MAX = { '幹嘛': 60, '怎麼走': 120 };
// 「说了次序」的各种说法。宁可多列几个 —— 这是提醒，不是闸门。
// 撞过三次：`升序`、`名册整取`、`降序` 都不在第一版词表里，白报了三条假警。
const ORDER_WORDS = /倒序|升序|降序|从新到旧|从旧到新|从早到晚|从晚到早|先后|次序|顺序|正序|反序|最新|最早|名册|字母|字典|拼音/;
// 只说「翻」就够：这个语料里没有「翻身／翻新」之类的歧义。写过 翻页／翻到／往下翻 三种，
// 前两版的关键词只认前两种，白报了一条假警（listTrainings）。
const PAGE_WORDS = /翻|游标|分页|整取/;

const facts = new Map(readFileSync(FACTS, 'utf8').trim().split('\n').map((l) => {
  const r = JSON.parse(l);
  return [r.key, r];
}));

const args = process.argv.slice(2);

/**
 * `--merged` 查**合并后的 tsv**，也就是真状态。
 *
 * 查单份草稿只能看到那一批当时的文本：b02 的 10 处提醒里有 7 处早就被 b99 修正批次改掉了，
 * 拿草稿当靶子会把已修好的又报一遍。要判断「现在还有没有漏」，查合并结果。
 *
 * 这一段要排在下面的「没给文件名」守卫**之前** —— 只传 --merged 时 files 是空的。
 */
if (args.includes('--merged')) {
  const TSV = resolve(HERE, '..', '..', '..', 'hualong-backend', 'db', 'spec', 'operation-eli10.tsv');
  const lines = readFileSync(TSV, 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n');
  const H = lines[0].split('\t');
  const rows = lines.slice(1).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [H[i], v ?? ''])));
  const done = rows.filter((r) => r['幹嘛']);
  const noPage = [], noOrder = [], overlong = [];
  for (const r of done) {
    const f = facts.get(r.key) || {};
    if (f.paginated && !PAGE_WORDS.test(r['怎麼走'])) noPage.push(`${r.key}（${f.sort}）`);
    if (f.sort && !ORDER_WORDS.test(r['幹嘛'] + r['怎麼走'])) noOrder.push(`${r.key}（${String(f.sort).slice(0, 40)}）`);
    if ((r['幹嘛'] || '').length > MAX['幹嘛'] || (r['怎麼走'] || '').length > MAX['怎麼走']) overlong.push(r.key);
  }
  console.log(`合并表：${done.length}/${rows.length} 已起草`);
  console.log(`分页没提 ${noPage.length}${noPage.length ? ':\n  ' + noPage.join('\n  ') : ''}`);
  console.log(`次序没提 ${noOrder.length}${noOrder.length ? ':\n  ' + noOrder.join('\n  ') : ''}`);
  console.log(`超长 ${overlong.length}${overlong.length ? ': ' + overlong.join(', ') : ''}`);
  process.exit(overlong.length ? 1 : 0);
}

const files = args.includes('--all')
  ? readdirSync(DRAFTS).filter((f) => f.endsWith('.json')).sort()
  : args.filter((a) => a.endsWith('.json'));
if (!files.length) { console.error('用法：verify-drafts.mjs <文件名.json> | --all | --merged'); process.exit(1); }

const owner = new Map();   // key → 哪份草稿先占了
const overrideOwner = new Map();
let errors = 0, warns = 0;

for (const f of files) {
  const j = JSON.parse(readFileSync(join(DRAFTS, f), 'utf8'));
  const entries = Object.entries(j.entries || {});
  const isOverride = j.overrides === true;
  console.log(`\n=== ${f}  ${entries.length} 条  tags=${(j.tags || []).join(',')}${isOverride ? '  【修正批次】' : ''} ===`);

  for (const [k, v] of entries) {
    const f0 = facts.get(k);
    if (!f0) { console.log(`  x ${k} 不在契约里`); errors++; continue; }
    const a = (v['幹嘛'] || '').length, b = (v['怎麼走'] || '').length;
    if (!a || !b) { console.log(`  x ${k} 有空白列`); errors++; continue; }
    if (a > MAX['幹嘛'] || b > MAX['怎麼走']) { console.log(`  x ${k} 超长（幹嘛 ${a} / 怎麼走 ${b}）`); errors++; }

    // 撞 key：普通批次之间不许有同一个 key；修正批次允许覆盖
    if (isOverride) {
      if (!owner.has(k)) { console.log(`  ! ${k} 是修正条目但没有原文可修正`); warns++; }
      overrideOwner.set(k, f);
    } else if (owner.has(k)) {
      console.log(`  x ${k} 已被 ${owner.get(k)} 占用（并行起草撞车）`);
      errors++;
    } else owner.set(k, f);

    if (f0.paginated && !PAGE_WORDS.test(v['怎麼走'])) { console.log(`  ! ${k} 是分页的，怎麼走没提翻页`); warns++; }
    if (f0.sort && !ORDER_WORDS.test(v['幹嘛'] + v['怎麼走'])) { console.log(`  ! ${k} 有排序（${f0.sort}），没提次序`); warns++; }
  }
}

console.log(`\n错误 ${errors}，提醒 ${warns}`);
if (errors) process.exit(1);
