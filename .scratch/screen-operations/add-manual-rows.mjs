/**
 * 把 55 屏里剩下 8 屏的「人工行」写进 screen-operations.tsv。
 *
 * 这 8 屏的 handler 全是导航／本地状态，机器列不出调用（它只会写 gen 行），
 * 所以由人判。判据是实测的：每屏的 Page 方法、导航调用次数、以及它渲染的是不是写死的数组。
 *
 * 分类（用户 2026-09-11 定）：
 *   no-api   6 屏 —— handler 全是导航，按设计不调任何操作
 *   human    1 屏 —— coordination-file-list 用写死的 CATALOG，而契约里两条真端点闲置
 *   planned  1 屏 —— growth-book-task-manage 写本机存储，契约里没有对应端点
 *
 * 幂等：先删掉这 8 屏已有的非 gen 行再加，重复跑不会堆叠。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const TSV = resolve(REPO, '..', 'hualong-backend', 'db', 'spec', 'screen-operations.tsv');

const HEAD = ['screen', 'mp_file', 'screen_title', 'state', 'operation_id', 'method', 'path',
  'source', 'trigger_wxml', 'trigger_prototype', 'trigger_flag', 'gap', 'notes'];

// 每行固定 9 格：[screen, title, state, op, method, path, source, flag, 说明]
// 说明的去向由 source 决定：no-api → notes；human／planned → gap（见下面的组装）。
const rows = [
  // ── 6 屏中转页：handler 全是导航 ───────────────────────────────────────
  ['comprehensive-coordination', '综合协调部', 'empty', '', '', '', 'no-api', '',
    '只有一个 onEntryTap，1 次导航。这一屏是分类入口，内容在别的页。'],
  ['training-center', '教研培训部', 'empty', '', '', '', 'no-api', '',
    '6 个 handler 全是轮播与导航（onBannerChange／onEntryTap／onResourceTap／onResourceMore／onCaseTap／onCaseMore），5 次导航。'],
  ['resource-center', '课程资源', 'empty', '', '', '', 'no-api', '',
    '7 个 handler 全是搜索与导航（onQueryInput／onSearch／onHubTap 等），6 次导航。这一屏是入口，内容在资源库与案例库。'],
  ['teacher-evaluation', '教师评价', 'empty', '', '', '', 'no-api', '',
    '只有一个 onEntryTap，1 次导航。这一屏是入口，内容在月度评价与学期评价。'],
  ['course-building', '课程建设', 'empty', '', '', '', 'no-api', '',
    '全静态文案（衣／食／住／行／艺 写死在 index.js）。唯一的 onDownload 只弹提示 —— 原型那个附件是 data: URI，小程序下不了，没有数据源。'],
  ['growth-book-sample', '成长册样本', 'empty', '', '', '', 'no-api', '',
    '版式样张预览（onPageTap／onPrev／onNext／onReset／onEdit），翻的不是真实数据。正本要 composer 解析 manifest，而 0/12 版式包已发布。'],

  // ── coordination-file-list：用假数据，而真端点闲置 ─────────────────────
  ['coordination-file-list', '文件列表', 'list', 'listCoordDocuments', 'GET', '/coordination/documents', 'human', '',
    '该调 listCoordDocuments'],
  ['coordination-file-list', '文件列表', 'overlay', 'getCoordDocument', 'GET', '/coordination/documents/{document_id}', 'human', '',
    '该调 getCoordDocument'],

  // ── growth-book-task-manage：要一个端点，契约里没有 ───────────────────
  ['growth-book-task-manage', '亲子时光管理', 'form', '', '', '/teacher/growth-book/task-items', 'planned', '',
    '契约没有这一条；路径是目标形态'],
];

const crlf = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
const lines = readFileSync(TSV, 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n');
const head = lines[0].split('\t');
if (head.join('\t') !== HEAD.join('\t')) { console.error('表头与预期不符，放弃'); process.exit(1); }
let body = lines.slice(1).filter(Boolean).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [head[i], v ?? ''])));

const TOUCH = new Set(rows.map((r) => r[0]));
const before = body.length;
body = body.filter((r) => !(TOUCH.has(r.screen) && r.source !== 'gen'));

const mp = (screen) => `miniprogram/pages/${screen}/index.wxml`;
for (const [screen, title, state, op, method, path, source, flag, text] of rows) {
  // 说明的去向：no-api 写 notes（那是在说「为什么不调」），
  // human／planned 写 gap（那是在说「缺什么」），notes 留给一句判据来源。
  const push = {
    screen, mp_file: mp(screen), screen_title: title, state,
    operation_id: op, method, path, source,
    trigger_wxml: '', trigger_prototype: '', trigger_flag: flag,
    gap: '', notes: '',
  };
  if (source === 'no-api') push.notes = text;
  else if (source === 'human') { push.gap = text; push.notes = '人工判定：这一屏该调契约里已有的端点'; }
  else if (source === 'planned') { push.gap = text; push.notes = '本机存储（wx.setStorageSync），候选项写死在 utils/growth-book.js；要上服务端就缺这一条端点'; }
  else { push.notes = text; }
  body.push(push);
}

body.sort((a, b) => a.screen.localeCompare(b.screen) || String(a.state).localeCompare(String(b.state)) || String(a.operation_id).localeCompare(String(b.operation_id)));

writeFileSync(TSV, crlf(`${[HEAD, ...body.map((r) => HEAD.map((h) => String(r[h] ?? '').replace(/[\t\r\n]/g, ' ')))].map((c) => c.join('\t')).join('\n')}\n`));

const screens = new Set(body.map((r) => r.screen));
console.log(`人工行 ${rows.length} 条（${TOUCH.size} 屏）写入 → ${TSV}`);
console.log(`行数 ${before} → ${body.length}；覆盖屏幕 ${screens.size}`);
for (const r of body.filter((x) => x.source !== 'gen')) console.log(`  ${r.source.padEnd(8)} ${r.screen} / ${r.state} / ${r.operation_id || '(无)'}`);
