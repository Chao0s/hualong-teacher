// 登记 G108：db_growth_book_task_item 有表、无端点。
// 连带更新汇总表、修订记录、README 两处的缺口数。
// 规矩：缺口数**不用箭头写**（check-consistency 的 CHAIN_RE 会把任意「N → M」当表数链验，见 GAPS.md:2444 自记的坑）。
import { readFileSync, writeFileSync } from 'node:fs';

const B = 'G:/My Drive/Workplace/China KG Platform/hualong-backend';
const crlf = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// ── 先算计数（改之前）──────────────────────────────────────────────────
let g = read(`${B}/db/GAPS.md`);
const gapCount = (g.match(/^### G\d+/gm) || []).length;
const rowOf = (lvl) => (g.match(new RegExp(`^\\|\\s*${lvl}\\s*\\|(.+)\\|\\s*$`, 'm')) || [, ''])[1];
const countIn = (row) => row.split('、').filter((s) => /G\d+/.test(s)).length;
const before = { gap: gapCount, blocker: countIn(rowOf('BLOCKER')), ambiguous: countIn(rowOf('AMBIGUOUS')), gapLvl: countIn(rowOf('GAP')) };
console.log(`改前：合计 ${before.gap}｜BLOCKER ${before.blocker}｜AMBIGUOUS ${before.ambiguous}｜GAP ${before.gapLvl}`);

if (before.gap !== 103) { console.error(`✗ 预期合计 103，实测 ${before.gap} —— 文件变过了，先看清楚再改`); process.exit(1); }

// ── 1. 插入 G108 小节（放在 ## 汇总 之前）──────────────────────────────
const SECTION = `
### G108 · \`db_growth_book_task_item\` 有表、无端点，教师端把亲子时光入册顺序存在本机 —— GAP（2026-09-11，按屏幕扫 API 时撞上）

\`db/01_schema.sql\` 有这张表：\`db_growth_book_task_item -- 亲子时光入册顺序；FK compilation\`。
\`api/openapi.yaml\` 里**没有任何端点读写它** —— \`GET /teacher/growth-book/time-topics\` 管的是**在园时光主题**，
不是这张表（G91 已记它们的注释不变量无人强制，那是另一件事）。

客户端把这份顺序放在**本机存储**里：\`miniprogram/pages/growth-book-task-manage/index.js\`
（「亲子时光管理」，2026 春季学期编册 → 栏目管理 → 亲子时光）经由 \`utils/growth-book.js\` 的
\`readBookConfig()\`／\`writeBookConfig()\` 读写 \`wx.setStorageSync\`，候选项 \`BOOK_TASKS\` 是同一个文件里的
写死数组。**那个文件自己的头注就写着「一台机器上的本机状态锁不住」。**

后果不是「少一个功能」，是**编册的一部分不受服务端约束**：换一台设备、清一次缓存，教师挑的入册顺序就没了；
而这张表是 \`FK compilation\` 的，定稿（\`b2\`）之后整册按契约永久唯读 —— **本机状态与 \`b2\` 之间没有任何一致性保证**。

**两条出路，要拍板：**

1. 补一对端点（读 + 写）读写 \`db_growth_book_task_item\`，客户端改调它。这要先进契约与 \`action-registry.tsv\`。
2. 认定这张表**暂无消费方**，登记进 \`api/action-coverage.tsv\` 的 \`no-action\` 行并从 DDL 摘除。

**在那之前客户端不得为它造第二个假出口。** 页面现在按 \`hualong-teacher/decision.md\` 的 2026-09-11 一条
记作 \`source=planned\`、\`path=/teacher/growth-book/task-items\`（目标形态，不是已存在的端点）。

**DDL 一个字不改，表数 62 不变。**

**怎么发现的**：给教师端做「按屏幕看 API」时，\`db/spec/screen-operations.tsv\` 把 55 屏逐屏扫过一遍，
这一屏是全表**唯一**落在 \`planned\` 的那一格 —— 一屏要做的事，契约里没有端点。
`;

const anchor = '\n## 汇总';
if (!g.includes(anchor)) { console.error('✗ 找不到 ## 汇总'); process.exit(1); }
g = g.replace(anchor, `${SECTION}${anchor}`);

// ── 2. 汇总表的 GAP 行追加 G108 ────────────────────────────────────────
const gapRowRe = /^(\|\s*GAP\s*\|)(.+)(\|\s*)$/m;
const gm = g.match(gapRowRe);
if (!gm) { console.error('✗ 找不到汇总表的 GAP 行'); process.exit(1); }
g = g.replace(gapRowRe, `${gm[1]}${gm[2]}、**G108 \`db_growth_book_task_item\` 有表、无端点，亲子时光入册顺序存在本机（2026-09-11）**${gm[3]}`);

// ── 3. 修订记录 ────────────────────────────────────────────────────────
const after = { gap: (g.match(/^### G\d+/gm) || []).length, gapLvl: countIn(g.match(gapRowRe)[2]) };
const LOG = `
2026-09-11：给教师端做「按屏幕看 API」时新登记 **G108** —— \`db_growth_book_task_item\`（亲子时光入册顺序，FK compilation）在 DDL 里、在契约里没有任何端点，而「亲子时光管理」那一屏把这份顺序存在 \`wx.setStorageSync\`（\`utils/growth-book.js\` 自己头注写着「一台机器上的本机状态锁不住」）。这不是少一个功能：它是编册的一部分，而定稿 \`b2\` 之后整册永久唯读，本机状态与 \`b2\` 之间没有一致性保证。两条出路要拍板（补端点，或认它无消费方并从 DDL 摘）。**DDL、契约、登记表一个字节没改。** **计数变动：缺口合计 由 ${before.gap} 条增为 ${after.gap} 条，GAP 由 ${before.gapLvl} 条增为 ${after.gapLvl} 条，BLOCKER 仍为 ${before.blocker}，AMBIGUOUS 与已决待实作、已解、已修均不变。** 数字不用箭头写，理由见上面 2026-09-09 那条（\`check-consistency\` 把任意一对「数字 箭头 数字」当表数链的一步来验）。**paths 137／operations 167／schemas 153／动作数 135／表数 62 全部不变。** \`README.md\` 与 \`db/README.md\` 的缺口数已同步。
`;
g = `${g.replace(/\s+$/, '')}\n${LOG}`;
writeFileSync(`${B}/db/GAPS.md`, crlf(g));
console.log(`OK   GAPS.md：合计 ${before.gap} → ${after.gap}，GAP 级 ${before.gapLvl} → ${after.gapLvl}`);

// ── 4. README 两处的缺口数（断言查的就是这个句式）──────────────────────
for (const [file, pairs] of [
  ['README.md', [['**8 项 BLOCKER，103 项合计**', `**8 项 BLOCKER，${after.gap} 项合计**`],
                 ['schema 与规格之间的 103 项已知缺口', `schema 与规格之间的 ${after.gap} 项已知缺口`]]],
  ['db/README.md', [['（103 项 schema 与规格的缺口，8 项 BLOCKER）', `（${after.gap} 项 schema 与规格的缺口，8 项 BLOCKER）`],
                    ['schema 与上游规格之间的 103 项已知缺口', `schema 与上游规格之间的 ${after.gap} 项已知缺口`]]],
]) {
  let t = read(`${B}/${file}`);
  for (const [from, to] of pairs) {
    if (!t.includes(from)) { console.error(`✗ ${file} 找不到：${from}`); process.exit(1); }
    t = t.replace(from, to);
  }
  writeFileSync(`${B}/${file}`, crlf(t));
  console.log(`OK   ${file} 缺口数 103 → ${after.gap}`);
}
