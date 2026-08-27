/**
 * 成长册服务 —— 生成与预览（票据 21）。
 *
 * Boundary: `packages/growth-book` 这个分包，一个分包一个服务模块（票据 12 定的规则）。
 * 与 `services/evaluation` 同一条理由：结构契约上这两页属 `co-education` 模块，但模块与
 * 分包不是一回事，一个 tabBar 模块可以带不止一个分包。
 *
 * ── 客户端不排版，也不数页 ───────────────────────────────────────────────────
 *
 * ADR-0013／§4 规则 93：**预检、教师预览、正式定稿与家长查看必须共用同一个 composer**，
 * 禁止近似页数公式。那个 composer 在服务端。所以本模块做的是四件事：
 *
 *   要一份 manifest（`GET /growth-book/books/{id}/manifest`）
 *   按 ordinal 要一页（`GET /growth-book/books/{id}/pages/{ordinal}`）
 *   把回来的格坐标交给 `utils/layout` 映射成像素并**校验**
 *   在教师明确确认时定稿（`POST /teacher/growth-book/books/{id}/publication`）
 *
 * **预览与家长端读的是同两条路径**（契约给它们的角色是 `[teacher, parent]`，不带
 * `/teacher/` 前缀），fingerprint 也是同一个。这就是「预览呈现的内容与版式，与家庭端最终
 * 看到的成长册一致」在代码上的样子 —— 不是两份实现凑得很像，是同一份。
 *
 * ── 没有一份版式包发布的时候 ─────────────────────────────────────────────────
 *
 * 那两条路径在契约上都带着
 * `x-hualong-blocked-on: "0/12 released layout pack —— 端点可实作，但没有 pack 可解析"`
 * （ADR-0015 Follow-ups）。**这是当前的事实，不是异常路径**：一份版式包也没有发布。
 *
 * 所以本模块把它当成一种**状态**来读，不当成一次故障：服务端在这种情形下回 409，
 * `details.rule` 为 `layout_pack_unreleased`；`manifest()` 把它翻译成
 * `{ released: false, reason }`，其余错误照样抛给页面。页面据此显示一句说明，
 * **不画空白页、不编一份版面、也不弹错误**。理由有三条：
 *
 *   1. 编一份版面会违反上面那条「共用同一个 composer」—— 教师看到的将不是家庭会看到的；
 *   2. 空白页会让教师以为册子就长这样，而真相是版式包还没做出来；
 *   3. 错误弹窗把一件已知的、有确定完成条件的待办说成了服务故障。
 *
 * ── 不得建造 ─────────────────────────────────────────────────────────────────
 *
 * DO-NOT-BUILD 3：成长册**不做导出、下载、分享**。册子只存在于应用内，无 PDF、无图册、
 * 无 `wx.shareFileMessage`。契约那一侧同一句：定稿「不生成任何文件、不签发下载链接」。
 * 本模块因此一个取档、一个短链、一个分享入口也没有，界面文案里也不出现这些说法。
 */

const api = require('../utils/request');
const guard = require('../utils/guard');
const moderation = require('../utils/moderation');
const layout = require('../utils/layout');
const coEducation = require('./co-education');
const evaluation = require('./evaluation');

const COMPILATION_PATH = '/teacher/growth-book/compilation';
const BOOK_PATH = '/teacher/growth-book/books';
const SECTION_PATH = '/teacher/growth-book/sections';
const PRECHECK_PATH = '/teacher/growth-book/precheck';
// 预览与家长端共用的两条路径。**没有 `/teacher/` 前缀**，这一点是承重的。
const READ_PATH = '/growth-book/books';

// api/action-registry.tsv 的 action_key。
const ACTIONS = {
  compilationEnsure: 'compilation.ensure',
  compilationUpdate: 'compilation.update',
  compilationLock: 'compilation.lock',
  sectionCreate: 'book_section.create',
  sectionUpdate: 'book_section.update',
  widgetsSave: 'book_widget.save',
  bookEnsure: 'book.ensure',
  bookPublish: 'book.publish',
};

// db_growth_book_compilation.compilation_status：e1 编辑中／e2 已锁定（**单向**）。
const COMPILATION_STATUS = { e1: '编辑中', e2: '已锁定' };
// db_growth_book.book_status：b1 准备中／b2 已定稿（**永久唯读**）。
const BOOK_STATUS = { b1: '准备中', b2: '已定稿' };
// db_growth_book_section.section_status：d1 草稿（版面可改）／d2 已发布（**版面永久冻结**，W16）。
const SECTION_STATUS = { d1: '草稿', d2: '已发布' };
// db_growth_book_section.collection_status：c1 未征集／c2 征集中。只有 c2 才向家长开放。
const COLLECTION_STATUS = { c1: '未征集', c2: '征集中' };

/**
 * 「插入位置」的取值（契约 `BookSectionWrite.anchor_type`）。
 *
 * a1—a4 是四类锚点，`anchor_after` 指名插在哪一个之后。固定前置页与预设页不在 DB 里，
 * 它们的键来自版式包，所以这份表是**客户端能提供的那几个**，不是全集。
 */
const SECTION_ANCHORS = [
  { key: 'time', anchor_type: 'a1', label: '在园时光 之后' },
  { key: 'task', anchor_type: 'a1', label: '亲子时光 之后' },
  { key: 'term', anchor_type: 'a2', label: '学期评价 之后' },
  { key: 'comp', anchor_type: 'a3', label: '综合评价 之后' },
  { key: 'message', anchor_type: 'a4', label: '教师寄语 之后' },
];

/** 服务端说「没有版式包可解析」时，`details.rule` 的取值。 */
const PACK_UNRELEASED = 'layout_pack_unreleased';

// ══════════════════════════════════════════════════════════════════════════
// 勾选面板
// ══════════════════════════════════════════════════════════════════════════

/**
 * 册子会纳入的内容来源。
 *
 * **可勾选的只有两类，其余是固定书脊。** F19 与契约的 `Compilation.enabled_sections` 逐字
 * 写着：`enabled_sections` 只存 `time`、`task` 与班级自订 `section_id`；`term`、`comp`、
 * `message` 固定启用、不进开关、不得换序。所以面板分两组，而不是给每一行都画一个勾。
 * 给固定项画一个点不动的勾，是在假装教师有一个他并没有的选择。
 *
 * 三处**契约与票据对不上**的地方，如实标出来而不是抹平：
 *
 *   月度评价  票据 21 要求面板列出它，但 F19 的固定书脊里**没有月度评价这一栏**
 *             （固定正文是 在园时光／亲子时光／教师综合评估／五大领域评估／学期寄语）。
 *             月度评价进的是成长档案与家长报告流，不是册子的一栏。这里照票据列出它并
 *             给出件数，标明它随成长档案纳入。已记进交接。
 *   班级介绍  同样没有对应栏目，也没有任何教师端端点读得到它。列出并说明。
 *   园所介绍  有栏目（`school_intro` 页），但内容由**管理端**的园所设置维护，教师端读不到
 *             （那几条路径挂在管理端前缀下，教师端到不了）。所以件数是 `null`，不是 0 ——
 *             `null` 是「这一端看不到」，0 是「确实没有」，两者不能混。
 */
const SOURCES = Object.freeze([
  Object.freeze({
    key: 'time',
    label: '在园时光',
    desc: '本班已发布的活动记录与照片',
    selectable: true,
  }),
  Object.freeze({
    key: 'task',
    label: '亲子任务与家园社共育',
    desc: '已发布的亲子任务与家庭提交',
    selectable: true,
  }),
  Object.freeze({
    key: 'month',
    label: '月度评价',
    desc: '随成长档案纳入；固定书脊里没有单独的月度评价栏目',
    selectable: false,
  }),
  Object.freeze({
    key: 'term',
    label: '学期评价',
    desc: '固定纳入「教师综合评估」一栏，不可取消',
    selectable: false,
  }),
  Object.freeze({
    key: 'intro',
    label: '园所介绍',
    desc: '由管理端的园所设置提供，教师端只纳入不编辑',
    selectable: false,
  }),
  Object.freeze({
    key: 'class',
    label: '班级介绍',
    desc: '班级内容随在园时光与亲子任务进册；契约没有单独的班级介绍栏目',
    selectable: false,
  }),
  Object.freeze({
    key: 'message',
    label: '教师寄语',
    desc: '本学期寄语由管理端按学期维护，全园同一学期共用',
    selectable: false,
  }),
]);

/**
 * 四类教师端读得到的件数。
 *
 * 读的是**已经存在的东西**，不是册子的页数 —— 页数由服务端 composer 算（见头注）。
 * 四个并发请求：它们互不依赖。
 */
async function sourceCounts() {
  const [moments, tasks, months, terms] = await Promise.all([
    coEducation.listMoments({ publish_status: 's3' }),
    coEducation.listTasks({ publish_status: 's2' }),
    evaluation.listMonthEvals({}),
    evaluation.listTermEvaluations(),
  ]);
  return {
    time: moments.items.length,
    task: tasks.items.length,
    month: months.items.filter((r) => r.done).length,
    term: terms.filter((r) => r.done).length,
    // 教师端读不到的两类。`null` 是「这一端看不到」，与 0 不是同一件事。
    intro: null,
    class: null,
    message: null,
  };
}

/**
 * 勾选面板，可直接绑定。
 *
 * `enabled` 只对可勾选的两类有意义，取自 `Compilation.enabled_sections`；固定项恒为 true
 * 且 `selectable` 为 false，界面显示「固定纳入」。
 *
 * **纯函数**：喂 compilation 与件数进去，拿行出来。测试因此不必起服务就能问「面板列全了
 * 没有」。
 */
function sourcePanel(compilation, counts) {
  const enabled = (compilation && compilation.enabled_sections) || [];
  const c = counts || {};
  return SOURCES.map((source) => {
    const count = c[source.key] === undefined ? null : c[source.key];
    return {
      key: source.key,
      label: source.label,
      desc: source.desc,
      selectable: source.selectable,
      enabled: source.selectable ? enabled.indexOf(source.key) !== -1 : true,
      count,
      count_label: count === null ? '由园所设置提供' : `${count} 项`,
      fixed_label: source.selectable ? '' : '固定纳入',
    };
  });
}

/**
 * 面板上一共有多少件教师端数得出来的内容。
 *
 * `null` 的三类不计入 —— 数不到的东西不能当成 0，也不能当成有。这个数只回答一个问题：
 * **「现在生成，册子里会不会一件内容也没有」**。
 */
function selectedItemCount(panel) {
  return (panel || [])
    .filter((row) => row.enabled && typeof row.count === 'number')
    .reduce((n, row) => n + row.count, 0);
}

/**
 * 可勾选来源为空时的那一句话，否则空串。
 *
 * **一句说明，不是一份空册子**（票据验收项 7）。返回文案而不是布尔，理由与
 * `services/assessment.writeEntry` 相同：教师要知道下一步该做什么，而不只是不能做什么。
 */
function emptyReason(panel) {
  if (selectedItemCount(panel) > 0) return '';
  return '本班这学期还没有可以纳入成长册的内容。先发布在园时光或亲子任务，'
    + '再回来生成，否则生成出来的是一本空册子。';
}

// ══════════════════════════════════════════════════════════════════════════
// 编册
// ══════════════════════════════════════════════════════════════════════════

/**
 * 建立或取回本班本学期的编册（NONE→e1）。
 *
 * `UNIQUE(class_id, term_id)`，所以这个端点本身是幂等的取回或建立 —— 200 与 201 都是成功。
 * 前置是园所设置已 d2；不满足时服务端回 409，页面照实说，不假装编册已经在了。
 *
 * `class_id` 与 `school_id` 是 derived，请求体给了也会被忽略（§7.3），所以这里**无请求体**。
 */
function ensureCompilation() {
  return api.post(COMPILATION_PATH, { action: ACTIONS.compilationEnsure });
}

/**
 * 改栏目勾选（仅 e1，revision CAS）。
 *
 * `revision` 是 §5.1 三处 CAS 之一：带上读到的那一版，服务端比对不上就回 409，客户端
 * **重读后再改**，绝不盲写覆盖同事的编排。
 */
function updateEnabledSections({ compilationId, revision, enabledSections }) {
  return api.patch(`${COMPILATION_PATH}/${compilationId}`, {
    action: ACTIONS.compilationUpdate,
    revision,
    body: { enabled_sections: (enabledSections || []).slice() },
  });
}

/**
 * 锁定编册（e1 -> e2，**单向**）。
 *
 * e2 是逐幼儿 b1 -> b2 的前置：不锁定就没有一本册子能定稿。锁了不能回头，所以调用方
 * 必须先问一次。`revision` 是 §5.1 的 CAS，带上读到的那一版。
 */
function lockCompilation({ compilationId, revision, idempotencyKey }) {
  return api.post(`${COMPILATION_PATH}/${compilationId}/lock`, {
    action: ACTIONS.compilationLock,
    idempotencyKey,
    body: { revision },
  });
}

/** 栏目的可绑定形状。 */
function decorateSection(row) {
  const published = row.section_status === 'd2';
  return {
    section_id: row.section_id,
    name: row.name,
    anchor_after: row.anchor_after,
    anchor_type: row.anchor_type,
    section_status: row.section_status,
    status_label: SECTION_STATUS[row.section_status] || '未知状态',
    collection_status: row.collection_status,
    collection_label: COLLECTION_STATUS[row.collection_status] || '未知状态',
    // W16：发布之后版面**永久冻结**。这是「还能不能改」的唯一判据，页面不自己再算一遍。
    published,
    editable: !published,
  };
}

/**
 * 本班本学期的栏目清单（契约 v0.6.1）。
 *
 * 这一条 2026-08-27 才补进契约：此前栏目只有写没有读，教师新建一个栏目、退出、再进来
 * 就列不出来了。**名册型集合，整取不分页**（§3.5）。
 */
async function listSections() {
  const data = await api.get(SECTION_PATH);
  return (data.items || []).map(decorateSection);
}

/** 新增班级栏目（NONE -> d1）。 */
async function createSection({ name, anchorAfter, anchorType, idempotencyKey }) {
  const row = await api.post(SECTION_PATH, {
    action: ACTIONS.sectionCreate,
    idempotencyKey,
    body: { name: String(name).trim(), anchor_after: anchorAfter, anchor_type: anchorType },
  });
  return decorateSection(row);
}

/** 改栏目名称或位置（仅 d1）。发布之后服务端一律 409，客户端也不该发。 */
async function updateSection({ sectionId, name, anchorAfter, anchorType }) {
  const row = await api.patch(`${SECTION_PATH}/${sectionId}`, {
    action: ACTIONS.sectionUpdate,
    body: { name: String(name).trim(), anchor_after: anchorAfter, anchor_type: anchorType },
  });
  return decorateSection(row);
}

/**
 * 整栏目保存版面（仅 d1）。
 *
 * **PUT 整份，不是逐 widget PATCH** —— 契约原话：整个栏目一次提交、一次校验、一次存档，
 * 任一处重叠则拒绝整个栏目。逐个提交表达不了「要么全存要么全拒」。
 *
 * 请求体按 `BookWidgetWrite` 白名单重建：草稿上还挂着只给界面看的字段（选中态、像素
 * 矩形），送出去就是 422。
 */
function saveWidgets({ sectionId, widgets }) {
  return api.put(`${SECTION_PATH}/${sectionId}/widgets`, {
    action: ACTIONS.widgetsSave,
    body: { widgets: (widgets || []).map(buildWidgetBody) },
  });
}

/** 一个 widget 的请求体。派生与界面字段一个也不送。 */
function buildWidgetBody(w) {
  const body = {
    page_index: Number(w.page_index),
    grid_x: Number(w.grid_x),
    grid_y: Number(w.grid_y),
    grid_w: Number(w.grid_w),
    grid_h: Number(w.grid_h),
    widget_type: w.widget_type,
    binding_key: w.binding_key,
  };
  // 已有的 widget 带上编号；新增的缺席即可（契约：缺席或 null 表示新增）。
  if (w.widget_id) body.widget_id = Number(w.widget_id);
  // **只有 literal 才可非空**（DDL ck_bw_literal）。别的绑定送了 content 就是 422。
  if (w.binding_key === 'literal') body.content = w.content || null;
  return body;
}

/** 编册的可绑定形状。 */
function decorateCompilation(row) {
  return {
    compilation_id: row.compilation_id,
    class_id: row.class_id,
    term_id: row.term_id,
    enabled_sections: (row.enabled_sections || []).slice(),
    revision: row.revision,
    locked: row.compilation_status === 'e2',
    // §1.1：服务端可以先于本次构建增加编码，所以每一处查表都带兜底。
    status_label: COMPILATION_STATUS[row.compilation_status] || '未知状态',
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 建册、预检与定稿
// ══════════════════════════════════════════════════════════════════════════

/**
 * 建立或取回这名幼儿本学期的册（NONE→b1）。
 *
 * `UNIQUE(child_id, term_id)` —— **一幼儿一学期一本**。所以「重复点击只存在一份成长册」
 * 的第一半由这个唯一键保证，第二半由定稿那一步的幂等键保证。
 */
function ensureBook(childId) {
  return api.post(BOOK_PATH, {
    action: ACTIONS.bookEnsure,
    body: { child_id: Number(childId) },
  });
}

function decorateBook(row) {
  return {
    growth_book_id: row.growth_book_id,
    child_id: row.child_id,
    term_id: row.term_id,
    pack_code: row.pack_code || null,
    layout_seed: row.layout_seed === undefined ? null : row.layout_seed,
    published: row.book_status === 'b2',
    status_label: BOOK_STATUS[row.book_status] || '未知状态',
  };
}

/**
 * 全班预检（**零写入**）。
 *
 * §4 规则 87：按幼儿返回总页数、缺失内容与超限原因，并返回 roster 加内容的 fingerprint。
 * 定稿请求必须把 fingerprint 带回去，漂移回 409 且零写入 —— 那是「你预检时看到的班，
 * 和你现在要定稿的班，不是同一个班」的唯一防线。
 *
 * `problems` **只回问题码与栏目键，不回内容**（红线 4 最小必要），所以中文说法在客户端。
 */
async function precheck() {
  const data = await api.get(PRECHECK_PATH);
  return {
    content_fingerprint: data.content_fingerprint,
    children: (data.children || []).map((row) => ({
      child_id: row.child_id,
      total_pages: row.total_pages,
      publishable: Boolean(row.publishable),
      blocked_by_class_shared_content: Boolean(row.blocked_by_class_shared_content),
      published: row.book_status === 'b2',
      over_limit: row.total_pages > layout.PAGE_LIMIT,
      pages_label: `${row.total_pages} 页`,
      problems: (row.problems || []).map((p) => ({
        rule: p.rule,
        section_key: p.section_key || null,
        text: precheckText(p),
      })),
    })),
  };
}

/** 预检问题码的中文说法。一处措辞。 */
const PRECHECK_TEXT = {
  page_count_over_limit: `整本超过 ${layout.PAGE_LIMIT} 页的硬上限`,
  collected_incomplete: '这一栏的家庭素材还没交齐',
  section_incomplete: '这一栏还缺内容',
  material_without_topic: '有在园活动没有归入主题',
  term_message_missing: '本学期寄语还没填',
};

function precheckText(problem) {
  const base = PRECHECK_TEXT[problem.rule] || `未完成项：${problem.rule}`;
  return problem.section_key ? `${problem.section_key}：${base}` : base;
}

/**
 * 逐册定稿（b1→b2，**永久唯读**）。
 *
 * 三件事在这一次调用里同时成立：
 *
 *   把关     `HUMAN_PREVIEW_CONFIRM`（教师读完了整本预览，并另做一次确认）加
 *            `IMAGE_MEDIA_CHECK_ASYNC`（册里有图片这一类内容）。声明**必填、无默认值**，
 *            由页面显式给。带图而只声明一条等同未声明，`assertGate` 按 `imageCount` 查。
 *   幂等     契约把 `Idempotency-Key` 写成 **required**。一次逻辑确认生成一个键，重发复用；
 *            重放回原始状态码与原始响应体，**不重复通知**家长（§4 规则 89 的 n5）。
 *   指纹     `content_fingerprint` 来自预检。不符回 409 `fingerprint_drift`，零写入。
 *
 * 定稿**不生成任何文件、不签发下载链接**（F17）—— 所以这个函数回来之后没有第二步。
 */
async function publishBook({
  gates, growthBookId, contentFingerprint, imageCount,
  previewedInFull, confirmed, idempotencyKey,
}) {
  moderation.assertGate(gates, {
    what: '成长册',
    previewedInFull,
    confirmed,
    // 图片走先发后审，教师端没有「审核中」中间态（D1／D2）。
    claimsPending: false,
    imageCount: imageCount || 0,
  });
  return api.post(`${BOOK_PATH}/${growthBookId}/publication`, {
    action: ACTIONS.bookPublish,
    idempotencyKey,
    body: { content_fingerprint: contentFingerprint },
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 预览
// ══════════════════════════════════════════════════════════════════════════

/**
 * 解析正本 manifest。**与家长端同一条路径、同一个 fingerprint。**
 *
 * 回 `{ released: true, ... }` 或 `{ released: false, reason }`。后者是当前的事实：
 * 一份版式包也没有发布（ADR-0015 Follow-ups，0／12）。服务端用 409 加
 * `details.rule = 'layout_pack_unreleased'` 说这件事 —— 409 是契约给本端点声明过的状态码，
 * `details` 带 rule 是 §2.2 的错误形状，两者都不是这里发明的。
 *
 * 其余错误照样抛：把所有 409 都读成「没有版式包」会把一次真的状态冲突藏起来。
 */
async function manifest(growthBookId) {
  try {
    const data = await api.get(`${READ_PATH}/${growthBookId}/manifest`);
    return {
      released: true,
      growth_book_id: data.growth_book_id,
      fingerprint: data.fingerprint,
      pack_code: data.pack_code || null,
      total_pages: data.total_pages,
      // 硬上限 200（契约 `total_pages` 的 maximum，与 F17）。超了是服务端的事，客户端
      // 如实显示，不自动截断（契约：**禁止自动截断**）。
      over_limit: data.total_pages > layout.PAGE_LIMIT,
      pages: (data.pages || []).map((p) => ({
        ordinal: p.ordinal,
        folio: p.folio === undefined ? null : p.folio,
        page_role: p.page_role,
        section_key: p.section_key || null,
        layout_code: p.layout_code,
      })),
      toc: (data.toc || []).map((t) => ({ level: t.level, title: t.title, ordinal: t.ordinal })),
    };
  } catch (err) {
    if (err && err.statusCode === 409 && err.details && err.details.rule === PACK_UNRELEASED) {
      return {
        released: false,
        reason: '还没有任何一份版式包发布，所以这本册子暂时排不出版面。'
          + '版式包由开发方维护并随版本发布，发布之后这一页会显示与家庭端一模一样的册子。',
        pages: [],
        toc: [],
      };
    }
    throw err;
  }
}

/**
 * 取一页，并**当场校验它的版式**。
 *
 * `fingerprint` 必填且必须与本次 manifest 一致，漂移回 409（§4 规则 93）。`dpr` 是客户端
 * 唯一提供的量（只有它知道），服务端按 ADR-0015 第一条**钳到 ≤ 2** 再算派生尺寸 ——
 * 所以这里照实送，不预先钳、也不假设送多少就得到多少，`applied_dpr` 才是服务端实际用的值。
 *
 * 校验用 `utils/layout`：越界、小于 2 × 2、重叠、文字超框各有一条规则，规则名与服务端存档
 * 时回的 `details.rule` 逐字相同。**有问题的一页不画**，页面显示这一页出了什么问题 ——
 * 把重叠画出来比说一句话难懂得多，而且会让教师以为册子本来就长这样。
 */
async function bookPage(growthBookId, ordinal, { fingerprint, dpr, pageWidthPx, fontPx }) {
  const data = await api.get(`${READ_PATH}/${growthBookId}/pages/${ordinal}`, {
    query: { fingerprint, dpr },
  });
  const grid = layout.gridForPageWidth(pageWidthPx);
  layout.assertPageSurface(grid);
  const page = layout.layoutPage(data, grid, { fontPx });
  return {
    ...page,
    applied_dpr: data.applied_dpr === undefined ? null : data.applied_dpr,
    grid,
    problem_texts: page.problems.map((p) => layout.problemText(p.rule)),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 去向
// ══════════════════════════════════════════════════════════════════════════

const MODULE_ID = 'co-education';
const PAGES = {
  create: '/packages/growth-book/pages/create/index',
  preview: '/packages/growth-book/pages/preview/index',
  compile: '/packages/growth-book/pages/compile/index',
  section: '/packages/growth-book/pages/section/index',
};

function openCreate() {
  guard.navigateTo(PAGES.create, MODULE_ID);
}

/** 学期编册页（原型「编辑样板 ›」那一条）。 */
function openCompile() {
  guard.navigateTo(PAGES.compile, MODULE_ID);
}

/** 栏目版面。不带编号就是新建（原型 `?new=1`）。 */
function openSection(sectionId) {
  const url = sectionId ? `${PAGES.section}?section_id=${sectionId}` : PAGES.section;
  guard.navigateTo(url, MODULE_ID);
}

function openPreview(growthBookId, childId) {
  const parts = [`growth_book_id=${growthBookId}`];
  if (childId) parts.push(`child_id=${childId}`);
  guard.navigateTo(`${PAGES.preview}?${parts.join('&')}`, MODULE_ID);
}

module.exports = {
  SOURCES,
  COMPILATION_STATUS,
  BOOK_STATUS,
  PACK_UNRELEASED,
  sourceCounts,
  sourcePanel,
  selectedItemCount,
  emptyReason,
  SECTION_ANCHORS,
  ensureCompilation,
  updateEnabledSections,
  lockCompilation,
  decorateCompilation,
  decorateSection,
  listSections,
  createSection,
  updateSection,
  saveWidgets,
  buildWidgetBody,
  ensureBook,
  decorateBook,
  precheck,
  publishBook,
  manifest,
  bookPage,
  // 名册。评价链与成长册用同一个来源，不问第二个名册端点。
  listChildren: evaluation.listChildren,
  newAttemptKey: api.uuid,
  openCreate,
  openPreview,
  openCompile,
  openSection,
};
