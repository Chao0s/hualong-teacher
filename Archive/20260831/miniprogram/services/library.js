/**
 * 资源库与案例库服务 — the library module's reads (ticket 13).
 *
 * Boundary: the 资源库／案例库 module, and it is also the subpackage boundary. The
 * pages in `packages/library` read this file and no other service module — one
 * subpackage, one service module, the rule `npm run verify:build` enforces. 案例
 * 与资源同属 `/library/*`，同属一个分包，所以案例的读取写进本文件，不另立并列服务。
 *
 * 案例的三张枚举表**不在这里**。`case_field`／`case_grade`／`case_area` 归
 * services/case.js，票据 08 评审第 4 条就是为防「案例库开工时最省事的动作是复制那几张
 * 表」才把它们单独拆出来的。本文件需要文案时 require 它，不抄。`db_resource.grade` 与
 * `db_case.case_grade` 是同一个值域（k1／k2／k3），一份映射服务两张表。
 *
 * 状态列与可见范围，资源与案例**分别**确认的结论（票据 13 验收项）：
 *
 *   资源  状态列 `db_resource.resource_status`，值域 s1—s5 **五态俱全**。
 *         teacher 的可见范围 openapi 逐字写出（`/library/resources` 的 description）：
 *           `school_id = $ctx_school AND (resource_status = 's3' OR created_by = $ctx_teacher)`
 *         也就是：本园已发布的，加上**自己写的全部**（含草稿、待审、被驳回）。
 *         **这一条是抄录。**
 *   案例  状态列 `db_case.case_status`，值域同为 s1—s5。可见范围：
 *           `school_id = $ctx_school AND (case_status = 's3' OR created_by = $ctx_teacher)`
 *         **这一条是转述，不是抄录。** 案例页开工前按上面那句头注回契约取过了，
 *         `openapi.yaml` 的 `GET /library/cases` 只有一行 summary
 *         「案例列表（predicate 与资源同构）」——**既没有 description，也没有
 *         `x-hualong-scope`**，逐字 predicate 在契约里根本不存在。这是一个契约缺口，
 *         记在交接里；上面那条 predicate 是按「与资源同构」这五个字推出来的，接真服务
 *         时必须重对。资源那条不得复制过来当作案例的依据，两条各有各的来处。
 *
 * 与党建／综合协调最大的差别也在这里：那两个模块只看得到 s3，状态文案是一个恒定值，
 * 恒定值不是信息，所以它们一律不读状态列。资源与案例不同 —— 教师看得到自己那几条非
 * s3，状态是真信息，必须显示，否则教师分不清「已发布」与「还在我手里」。
 *
 * **上传与提交审核（票据 15）也在本文件**，不另立一个 services/library-submit.js。理由不是
 * 省事：`packages/library` 这个分包只对应一个服务模块，`npm run verify:build` 会拦下
 * 第二个（票据 12 定的规则）。而且票据 15 的验收项要求「分类与标签取值取自资源库与案例库
 * 共用的同一份来源」—— 取值表就在本文件，写入面挨着它，就没有第二份可抄。
 * 与 pages/task/submit 不同的地方只有这一点：那一页在主包，所以它拆得出
 * services/task-submit.js。
 *
 * Everything returned is view-ready (spec 实现决定 7): a page binds it and
 * formats nothing.
 */

const api = require('../utils/request');
const guard = require('../utils/guard');
const moderation = require('../utils/moderation');
const { present } = require('../utils/present');
// `case` is a reserved word; the module is named for what it holds, the binding
// for what JavaScript allows（services/home.js 已是这个写法）。
const kase = require('./case');
const identity = require('./identity');

const RESOURCE_PATH = '/library/resources';
const CASE_PATH = '/library/cases';

// db_resource.resource_tag —— 衣食住行艺，五类固定。这就是原型里的「衣食住行艺分类」，
// 也是资源库的主轴。形态定案：横排标签，不进滚轮（form-control-spec.md §2.1）。
const RESOURCE_TAG = { g1: '衣', g2: '食', g3: '住', g4: '行', g5: '艺' };

// db_resource.resource_type —— 资源本体是哪种文件。DDL 注释逐字：
// `r1=docx|r2=xlsx|r3=jpg|r4=html|r5=pdf|r6=wiki`。中文取教师读得懂的说法，不直译扩展名。
// 阅读页不显示这一列（原型详情页没有它），上传表单必须填（DDL NOT NULL）。
const RESOURCE_TYPE = { r1: '文档', r2: '表格', r3: '图片', r4: '网页', r5: 'PDF', r6: '百科' };

// db_resource.resource_status / db_case.case_status —— 同一个值域，两张表各持一列。
// §1.1: 服务端可以先于本次构建增加编码，所以每一处查表都带兜底。
const CONTENT_STATUS = {
  s1: '草稿',
  s2: '待审核',
  s3: '已发布',
  s4: '已驳回',
  s5: '已下架',
};

// 只有 s3 是「所有人都看得到」的那一态。其余四态出现在列表里只可能是教师自己写的，
// 所以它们要显眼；s3 是常态，不必挂一枚徽章去重复「一切正常」。
const STATUS_PILL = {
  // s3 needs an entry even though the list hides its pill: the list guards on
  // `status_label`, which is blank for s3, but the DETAIL page renders the pill
  // unconditionally — it is showing one known resource, so the status is never
  // absent there. Without this key the lookup falls through to the unknown
  // style, and 已发布, the most ordinary state there is, would wear the warning
  // colours on every detail screen.
  s3: 'hl-pill--ok',
  s1: 'hl-pill--info',
  s2: 'hl-pill--pending',
  s4: 'hl-pill--danger',
  s5: 'hl-pill--danger',
};

// db_file_ref.owner_object —— 取档要按这张业务表重跑一次授权（§8.4）。
const FILE_OWNER = 'db_resource';

/**
 * 筛选取值的唯一来源（票据 13 验收项：分类与标签取值来自服务层的同一份来源，
 * 供筛选、详情与上传表单复用）。
 *
 * `全部` 用空串表示，因为 utils/request.js 的 buildQuery 会丢掉空串 —— 「不筛」就是
 * 「不发这个参数」，而不是发一个服务端不认识的 `all`。
 */
function tagFilters() {
  return [{ key: '', label: '全部' }]
    .concat(Object.keys(RESOURCE_TAG).map((key) => ({ key, label: RESOURCE_TAG[key] })));
}

/** 年级筛选。取值借自 services/case.js，同一个值域不抄第二份。 */
function gradeFilters() {
  return [{ key: '', label: '全部' }]
    .concat(Object.keys(kase.CASE_GRADE).map((key) => ({ key, label: kase.CASE_GRADE[key] })));
}

/** 五大领域筛选。`db_case.case_field`，取值同样借自 services/case.js。 */
function fieldFilters() {
  return [{ key: '', label: '全部' }]
    .concat(Object.keys(kase.CASE_FIELD).map((key) => ({ key, label: kase.CASE_FIELD[key] })));
}

/**
 * 活动形式筛选。`db_case.case_area`。
 *
 * 这一列在 DDL 上是多选数组，但契约的**筛选参数是单值** enum（`case_area` 的 schema
 * 是 `type: string`，不是数组）。所以筛的语义是「包含这一项」，界面上也就只让选一项。
 * 形态仍是横排标签：form-control-spec.md §2.1 按第 1 问（该列多选）判它是标签，
 * 按第 2 问（5 项＋全部，取值固定）判出来也是标签，两条路同一个答案。
 */
function areaFilters() {
  return [{ key: '', label: '全部' }]
    .concat(Object.keys(kase.CASE_AREA).map((key) => ({ key, label: kase.CASE_AREA[key] })));
}

/** `['k1','k3']` -> `小班 · 大班`。可空的数组列，null 与空数组都读作没有。 */
function gradeLabel(grade) {
  return (grade || [])
    .map((k) => kase.CASE_GRADE[k])
    .filter(Boolean)
    .join(' · ');
}

/** `['a1','a5']` -> `集体教学 · 数字化`。未知码丢掉的是那一项，不是整行。 */
function areaLabel(area) {
  return (area || [])
    .map((a) => kase.CASE_AREA[a])
    .filter(Boolean)
    .join(' · ');
}

/** The list-row shape. */
function decorateCard(row) {
  const tag = RESOURCE_TAG[row.resource_tag] || '';
  return {
    resource_id: row.resource_id,
    resource_name: row.resource_name,
    // 状态码本身，给列表做去向判断用：教师自己的草稿与被驳回的那几条点进上传表单，
    // 其余点进详情（票据 15）。文案用不着它，`status_label` 才是给人读的。
    resource_status: row.resource_status,
    // 未知分类码丢掉的是缩略图上的那个字，不是整张卡片。
    thumb_label: tag || '资',
    tag_label: [tag, gradeLabel(row.grade)].filter(Boolean).join(' · '),
    // s3 不挂徽章：它是常态，挂上去只是在重复「一切正常」。
    status_label: row.resource_status === 's3' ? '' : (CONTENT_STATUS[row.resource_status] || '未知状态'),
    status_pill: STATUS_PILL[row.resource_status] || 'hl-pill--unknown',
    excerpt: row.resource_explain || '',
  };
}

/**
 * One page of 资源, newest first (§3.1 cursor pagination).
 *
 * 契约只给了这两个筛选参数（外加 admin 才用得上的 `resource_status` 与 `class_id`）。
 * **五大领域与活动形式不是资源的列** —— 它们是 `db_case` 的 `case_field` 与
 * `case_area`，只能筛案例。票据正文把五个筛选维度并列，实际横跨两张表，这一条记在
 * 交接里，不靠这里发明第三、第四个参数来抹平。
 */
async function listResources({ resource_tag: tag, grade, cursor, limit } = {}) {
  const page = await api.getPage(RESOURCE_PATH, {
    cursor,
    limit,
    resource_tag: tag,
    grade,
  });
  return { items: page.items.map(decorateCard), nextCursor: page.nextCursor };
}

/**
 * One 资源, whole.
 *
 * §2.3: a resource outside the caller's scope comes back as 404, identical to
 * one that never existed. This module passes that through untouched.
 *
 * `related_cases` 是**服务端做的反向连接**，不是本客户端拼的。方向要看清楚：
 * `db_case.resource_ids` 记着案例引用了哪些资源，`db_resource` 上没有反向列。所以
 * 「这个资源被哪些案例用了」只有服务端答得出来，客户端既不该逐个拉案例去比对，也不该
 * 拿 `/library/cases` 去筛 —— 契约的案例列表没有 `resource_id` 这个参数。
 * 该字段目前只在本地契约服务上成立，与 `/home/cases` 同类，记在交接的契约缺口里。
 */
async function resourceDetail(resourceId) {
  const row = await api.get(`${RESOURCE_PATH}/${resourceId}`);
  const tag = RESOURCE_TAG[row.resource_tag] || '';
  return {
    resource_id: row.resource_id,
    resource_name: row.resource_name,
    // 资源简介：契约里**没有** `resource_intro` 这一列。原型的详情页也没有这一节。
    // 「简介」在这里就是这条资源的身份 —— 名称加分类加年级，别无他物。
    tag_label: [tag, gradeLabel(row.grade)].filter(Boolean).join(' · '),
    status_label: CONTENT_STATUS[row.resource_status] || '未知状态',
    status_pill: STATUS_PILL[row.resource_status] || 'hl-pill--unknown',
    resource_explain: row.resource_explain || '',
    resource_access: row.resource_access || '',
    resource_trans: row.resource_trans || '',
    // Word 详案。没有附件的资源照常显示，只是少一个下载入口。
    word_file_id: row.word_file_id || null,
    related_cases: (row.related_cases || []).map(kase.decorateCard),
  };
}

/**
 * The case list-row shape.
 *
 * 与 `kase.decorateCard` **不是同一张卡**：那张是首页推荐架子与资源详情的关联案例用的
 * 三行小卡，这张要多显示状态徽章、活动形式与简介摘要。两者共用的是枚举表，不是卡片
 * 形状 —— 复用形状会让两处中的一处显示它不该显示的东西。
 */
function decorateCaseCard(row) {
  const field = kase.CASE_FIELD[row.case_field] || '';
  const grade = kase.CASE_GRADE[row.case_grade] || '';
  return {
    case_id: row.case_id,
    case_name: row.case_name,
    // 状态码本身，给列表做去向判断用。与资源那张卡同一条理由。
    case_status: row.case_status,
    // 未知领域码丢掉的是缩略图上的那个字，不是整张卡片。
    thumb_label: field ? field.charAt(0) : '案',
    tag_label: [grade, field, areaLabel(row.case_area)].filter(Boolean).join(' · '),
    // s3 不挂徽章：它是常态，挂上去只是在重复「一切正常」。与资源同一条规则。
    status_label: row.case_status === 's3' ? '' : (CONTENT_STATUS[row.case_status] || '未知状态'),
    status_pill: STATUS_PILL[row.case_status] || 'hl-pill--unknown',
    excerpt: row.case_intro || '',
  };
}

/**
 * One page of 案例, newest first (§3.1 cursor pagination).
 *
 * 契约给了三个筛选参数（外加 admin 才用得上的 `case_status`）：`case_grade`、
 * `case_field`、`case_area`。**衣食住行艺分类不是案例的列** —— 那是
 * `db_resource.resource_tag`，只能筛资源。票据正文把五个筛选维度并列，实际横跨两张
 * 表，这一条与资源那边记的是同一件事。
 */
async function listCases({ case_grade: grade, case_field: field, case_area: area, cursor, limit } = {}) {
  const page = await api.getPage(CASE_PATH, {
    cursor,
    limit,
    case_grade: grade,
    case_field: field,
    case_area: area,
  });
  return { items: page.items.map(decorateCaseCard), nextCursor: page.nextCursor };
}

/**
 * One 案例, whole.
 *
 * §2.3: 不在可见范围内与不存在同为 404，本模块原样透传。
 *
 * **教师自评、他评与活动反思没有对应的列。** `db_case` 只有 `case_intro`（活动简介）
 * 与 `case_trans`（活动转化），契约的 `Case` schema 亦然。原型 case-detail.html 把
 * 「七、自评」「八、他评」「九、活动反思」放在 **Word 详案的正文里**，不是页面上的三
 * 个字段。所以本页把这三节留在详案中，由下载入口通向；此处不发明三个契约里没有的
 * 字段。这条差异记在交接的「契约与原型对不上」里。
 *
 * `related_resources` 是**服务端做的正向展开**：`db_case.resource_ids` 只有整数 ID，
 * 没有名称，而契约的 `Case` schema 也只回 ID。客户端若逐个去拉资源详情，就是 N+1 次
 * 请求，且其中任一条不在可见范围时会拿到 404 把整页拖垮。该字段与 `related_cases`、
 * `/home/cases` 同类：只在本地契约服务上成立，接真服务时必须重对。
 */
async function caseDetail(caseId) {
  const row = await api.get(`${CASE_PATH}/${caseId}`);
  const field = kase.CASE_FIELD[row.case_field] || '';
  const grade = kase.CASE_GRADE[row.case_grade] || '';
  return {
    case_id: row.case_id,
    case_name: row.case_name,
    tag_label: [grade, field, areaLabel(row.case_area)].filter(Boolean).join(' · '),
    status_label: CONTENT_STATUS[row.case_status] || '未知状态',
    status_pill: STATUS_PILL[row.case_status] || 'hl-pill--unknown',
    case_intro: row.case_intro || '',
    case_trans: row.case_trans || '',
    // Word 详案。没有附件的案例照常显示，只是少一个下载入口。
    word_file_id: row.word_file_id || null,
    related_resources: (row.related_resources || []).map((r) => ({
      resource_id: r.resource_id,
      resource_name: r.resource_name,
      thumb_label: RESOURCE_TAG[r.resource_tag] || '资',
      tag_label: [RESOURCE_TAG[r.resource_tag], gradeLabel(r.grade)].filter(Boolean).join(' · '),
    })),
  };
}

/** 打不开就说一句中文，绝不留白。几条失败路径共用一个出口。 */
function sayCannotOpen(text) {
  wx.showToast({ title: text, icon: 'none' });
}

/**
 * 下载详案。
 *
 * §8.4 / F5：客户端只调 `POST .../download-link`，服务端在**同一个事务里**写
 * `db_content_access_event(link_issued)`。**客户端不再发第二个「我看过了」的请求** ——
 * 那会是一条既拼不对、也无从核对的记录（票据 13 验收项）。
 *
 * 短链指向我们自己的 `/dl/{link_id}`，不是对象存储；在那里逐次复核内容状态后才
 * 302 到真正的地址。所以这里不缓存短链，也不把它交给页面留存。
 *
 * 资源与案例走同一段实作：两条路的契约条文逐字相同（openapi 的两个
 * `createXDownloadLink` 是同一份 description 与同一个 F5／§8.4 依据），只有前缀不同。
 * 抄第二遍就意味着「客户端只发一个请求」这条要在两处各记一次。
 */
async function downloadWord(contentPath) {
  let link;
  try {
    link = await api.post(`${contentPath}/download-link`);
  } catch (err) {
    // 会话失效是门的决定，不是一句提示。
    if (guard.endSessionOnAuthFailure(err)) return;
    sayCannotOpen(present(err).message);
    return;
  }

  wx.downloadFile({
    url: link.url,
    success: (res) => {
      if (res.statusCode !== 200) {
        sayCannotOpen('详案下载失败，请稍后再试');
        return;
      }
      wx.openDocument({
        filePath: res.tempFilePath,
        fileType: 'docx',
        fail: () => sayCannotOpen('详案打开失败，请到电脑上查看'),
      });
    },
    fail: () => sayCannotOpen('详案下载失败，请检查网络后再试'),
  });
}

/** 资源详情的详案下载。 */
function downloadWordFile(resourceId) {
  return downloadWord(`${RESOURCE_PATH}/${resourceId}`);
}

/** 案例详情的详案下载。自评、他评与活动反思都在这份文档里。 */
function downloadCaseWordFile(caseId) {
  return downloadWord(`${CASE_PATH}/${caseId}`);
}

/**
 * 统一入口页的两条去向，以及案例详情的三个入口（首页推荐卡片、资源详情的关联案例、
 * 案例列表的行）。
 *
 * `page` 为 null 表示那个屏幕还没落地，点击**在跳转前被拦下并说出原因**，与
 * services/module-entry.js 的拒绝方式相同。案例两页在本轮落地，两处 null 因此换成了
 * 路径，那条拒绝自己就消失了 —— 拒绝的措辞留在这里没删，下一个未落地的去向照样用它。
 */
const DESTINATIONS = {
  resource: { label: '课程资源库', page: '/packages/library/pages/resource/list' },
  resourceDetail: { label: '课程资源', page: '/packages/library/pages/resource/detail' },
  case: { label: '课程案例库', page: '/packages/library/pages/case/list' },
  caseDetail: { label: '课程案例', page: '/packages/library/pages/case/detail' },
  upload: { label: '上传资源与案例', page: '/packages/library/pages/upload/form' },
};

/** 入口页的两张卡片，ready to bind。 */
function entries() {
  return [
    { key: 'resource', title: '课程资源库', desc: '按衣食住行艺进入主题资源' },
    { key: 'case', title: '课程案例库', desc: '按年级、领域、活动形式筛选' },
  ];
}

/**
 * 走一条去向，或者说清楚为什么走不了。两种结果，没有第三种叫「什么也没发生」。
 *
 * 反馈留在服务里，与 `guard.navigateTo`、`coordination.openFile` 同理：一种措辞，
 * 一个地方（票据 08 样板评审未采纳项的同一判断）。
 */
function open(key, query) {
  const target = DESTINATIONS[key];
  if (!target) return;
  if (!target.page) {
    wx.showToast({ title: `${target.label}尚未上线`, icon: 'none' });
    return;
  }
  guard.navigateTo(query ? `${target.page}?${query}` : target.page, 'resource-library');
}

/**
 * 案例详情的唯一入口。
 *
 * 三条路都走这里：首页推荐课程案例卡片、资源详情的关联案例、案例列表的行。id 由调用者
 * 给，因为只有调用者知道点的是哪一条 —— 但**去哪个页面**这件事只在这里说一次，
 * 首页与资源库因此不可能与案例库各说各的（services/home.js 头注的同一条判断）。
 */
function openCase(caseId) {
  open('caseDetail', `case_id=${caseId}`);
}

/**
 * 资源详情的跨模块入口，与 `openCase` 一一对应。
 *
 * 分包**内部**的两处（资源列表的行、案例详情的关联资源）直接 navigateTo 就够了，它们
 * 已经在资源库里。这个函数是给分包**外面**的调用方用的 —— 现在是教研培训入口页的推荐
 * 轮播 —— 因为跨模块要过 `resource-library` 那道门。
 */
function openResource(resourceId) {
  open('resourceDetail', `resource_id=${resourceId}`);
}

/**
 * 上传表单的唯一入口（票据 15 验收项 1）。
 *
 * 待办事项与案例库都调这一个函数，所以「两个入口进入同一张表单」不是靠两处各写一条
 * 路径然后互相看齐 —— 路径只在上面的 DESTINATIONS 里说了一次。
 *
 * @param {string} [target] 'resource' 或 'case'。缺省进资源，教师在表单顶部改。
 *        待办事项**不带**这个参数：`db_home_todo` 没有一列说得出这条待办是资源还是
 *        案例，替它猜一个，教师十次里有五次要改回来。
 * @param {number} [contentId] 已有的资源／案例编号。带上它就是继续改自己的那一条
 *        （草稿或被驳回的），不带就是新建。
 */
function openUpload(target, contentId) {
  const parts = [];
  if (target) parts.push(`target=${target}`);
  if (contentId) parts.push(`content_id=${contentId}`);
  open('upload', parts.join('&'));
}

// ══════════════════════════════════════════════════════════════════════════
// 上传与提交审核（票据 15）
// ══════════════════════════════════════════════════════════════════════════
//
// 状态机就是契约的那一条，客户端不发明第二条：
//
//   NONE --POST /library/{x}--> s1 草稿 --POST .../submission--> s2 待审核
//   s2｜s3｜s4 --POST .../withdrawal--> s1 草稿
//   s1 --PATCH /library/{x}/{id}--> s1
//
// **s4 已驳回对资源与案例不是终局**（契约的 `withdrawResourceToDraft` 特意写了这一句）：
// 作者撤回到 s1，改完再提交。研修反馈的 s4 才是终局，两套规则不得互串。
// **「撤回」不是「下架」**：作者撤回目标是 s1（回到自己手里），管理者强制下架目标是 s5，
// 后者只在管理端存在，教师端一个按钮也没有。
//
// 必填以 `db/01_schema.sql` 的 NOT NULL 为准，**不以契约的 `ResourceWrite` 为准**：
// 契约把 `resource_explain`／`resource_access`／`resource_trans` 写成 `[string,'null']`，
// DDL 三列都是 NOT NULL。AGENTS.md 规则 1 说 DDL 是唯一的字段级权威。这条不一致记进交接。

const UPLOAD_TARGETS = [
  { key: 'resource', label: '课程资源库', desc: '本土材料、解读、获取与转化' },
  { key: 'case', label: '课程案例库', desc: '活动案例、年级领域与关联资源' },
];

// 长度上限抄 DDL 的 VARCHAR(n)。页面用它做 `maxlength` 与计数，服务端仍独立复验（§6.4）。
const LIMITS = Object.freeze({
  resource_name: 20,
  resource_explain: 200,
  resource_access: 300,
  resource_trans: 200,
  case_name: 20,
  case_intro: 100,
  case_trans: 100,
});

// CONTEXT.md §3 / 契约 §8.2：处理前单档 10 MB。这是**平台与产品共同的硬上限**，
// 所以在选文件的那一刻就要用它，不能等上传失败再说（票据 15 验收项 3）。
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// 每张表的写入白名单。顺序即表单顺序，`label` 是缺项提示里教师看到的名字。
// `required` 抄 DDL 的 NOT NULL。
const WRITE_FIELDS = {
  resource: [
    { key: 'resource_type', label: '资源格式', required: true, control: 'chips' },
    { key: 'resource_name', label: '资源名称', required: true, control: 'text' },
    { key: 'resource_tag', label: '资源分类', required: true, control: 'chips' },
    { key: 'grade', label: '适用年级', required: false, control: 'chips_multi' },
    { key: 'resource_explain', label: '资源解读', required: true, control: 'text' },
    { key: 'resource_access', label: '资源获取', required: true, control: 'text' },
    { key: 'resource_trans', label: '资源转化', required: true, control: 'text' },
    { key: 'cover_file_id', label: '封面图片', required: false, control: 'file' },
    { key: 'word_file_id', label: 'Word 详案', required: false, control: 'file' },
  ],
  case: [
    { key: 'case_name', label: '案例名称', required: true, control: 'text' },
    { key: 'case_grade', label: '年级', required: true, control: 'chips' },
    { key: 'case_field', label: '五大领域', required: true, control: 'chips' },
    { key: 'case_area', label: '活动形式', required: true, control: 'chips_multi' },
    { key: 'case_intro', label: '活动简介', required: true, control: 'text' },
    { key: 'case_trans', label: '活动转化', required: true, control: 'text' },
    { key: 'resource_ids', label: '关联资源', required: false, control: 'picker_multi' },
    { key: 'cover_file_id', label: '封面图片', required: false, control: 'file' },
    { key: 'word_file_id', label: 'Word 详案', required: false, control: 'file' },
  ],
};

const WRITE_PATH = { resource: RESOURCE_PATH, case: CASE_PATH };
const ID_KEY = { resource: 'resource_id', case: 'case_id' };
const STATUS_KEY = { resource: 'resource_status', case: 'case_status' };

// api/action-registry.tsv 的 action_key。带上它，登记册与代码可以对眼。
const ACTIONS = {
  resource: {
    create: 'resource.create',
    update: 'resource.update_draft',
    submit: 'resource.submit',
    withdraw: 'resource.withdraw_to_draft',
  },
  case: {
    create: 'case.create',
    update: 'case.update_draft',
    submit: 'case.submit',
    withdraw: 'case.withdraw_to_draft',
  },
};

/** `{k1:'小班'}` -> `[{key:'k1',label:'小班'}]`。 */
function optionsFrom(table) {
  return Object.keys(table).map((key) => ({ key, label: table[key] }));
}

/**
 * 表单里每一个选择位的取值。
 *
 * **这就是筛选用的那几张表**，一份不多。`tagFilters()` 与这里的 `resource_tag` 差的只有
 * 开头那一项「全部」—— 筛选可以不筛，表单不能不填，所以表单这边没有它。票据 15 验收项
 * 「分类与标签取值取自资源库与案例库共用的同一份来源」说的就是这件事。
 */
function uploadOptions() {
  return {
    resource_type: optionsFrom(RESOURCE_TYPE),
    resource_tag: optionsFrom(RESOURCE_TAG),
    // `db_resource.grade` 与 `db_case.case_grade` 是同一个值域（k1／k2／k3），
    // 一份映射服务两张表 —— 本文件头注已经说过一次，这里不抄第二份。
    grade: optionsFrom(kase.CASE_GRADE),
    case_grade: optionsFrom(kase.CASE_GRADE),
    case_field: optionsFrom(kase.CASE_FIELD),
    case_area: optionsFrom(kase.CASE_AREA),
  };
}

/**
 * 「关联资源」滚轮的取值（`db_case.resource_ids`）。
 *
 * 这是本表单里唯一一个**滚轮**：form-control-spec.md §1 的第 3 问 —— 取值来自服务端
 * 数据、条数不定。第 1 问（多选）单看会判成横排标签，但一园的资源库有几十上百条，
 * 铺成标签就是一面墙。两问在这里第一次撞上，取的是「滚轮负责选，标签负责显示已选」：
 * 滚轮一次加一条，已选的在下面排成可删的标签。判据的这条空隙记进交接。
 *
 * 走到游标尽头读一次。资源库是一园一份、条数有界的集合，读得完；若将来涨到上千条，
 * 这里要换成带筛选的分页选择器，而不是把上限调大。
 *
 * `key` 是字符串：滚轮组件按 key 比对，而 `resource_ids` 是整数数组，换算只在这一处发生。
 */
async function resourcePickerOptions() {
  const options = [];
  let cursor = null;
  do {
    const page = await api.getPage(RESOURCE_PATH, { cursor, limit: 100 });
    page.items.forEach((row) => {
      options.push({ key: String(row.resource_id), label: row.resource_name });
    });
    cursor = page.nextCursor;
  } while (cursor);
  return options;
}

/** 一张空表单。数组列给空数组而不是 null：页面按数组长度开合，null 会多一处判断。 */
function emptyDraft(target) {
  const draft = {};
  WRITE_FIELDS[target].forEach((field) => {
    if (field.control === 'chips_multi' || field.control === 'picker_multi') draft[field.key] = [];
    else if (field.control === 'file') draft[field.key] = null;
    else draft[field.key] = '';
  });
  return draft;
}

/**
 * 缺哪些必填项。**返回缺项，不返回真假**：页面要就地把它们标出来，
 * 「有东西没填」这四个字帮不了正在找它的教师（票据 15 验收项 2）。
 */
function missingFields(target, draft) {
  return WRITE_FIELDS[target]
    .filter((field) => {
      if (!field.required) return false;
      const value = (draft || {})[field.key];
      if (Array.isArray(value)) return value.length === 0;
      return value === null || value === undefined || String(value).trim() === '';
    })
    .map((field) => ({ key: field.key, label: field.label }));
}

/** 超长的文本字段。页面就地拦，服务端仍独立复验（§6.4）。 */
function tooLong(target, draft) {
  return WRITE_FIELDS[target]
    .filter((field) => LIMITS[field.key] !== undefined
      && typeof (draft || {})[field.key] === 'string'
      && draft[field.key].trim().length > LIMITS[field.key])
    .map((field) => ({ key: field.key, label: field.label, max: LIMITS[field.key] }));
}

/**
 * 按契约的 `ResourceWrite`／`CaseWrite` 重建请求体。
 *
 * 白名单而非黑名单：两个 schema 都是 `additionalProperties: false`，所以「只有这几个键」
 * 是契约形状本身，不是防御性代码。顺带的效果是 `created_by`／`school_id`／`class_id`
 * 与任何 `*_at` 在客户端就不存在于请求体里，而不是靠 `utils/derived` 事后剥
 * （DO-NOT-BUILD 8，§7.3.1）。两道都在，先后不重要，缺一才重要。
 *
 * 可空列送 `null` 而不是省略：PATCH 的语义是「缺席＝不改，显式 null＝清空」（§1.1），
 * 教师取消了封面就必须送 null，省略会让旧封面留在那里。
 */
function buildWriteBody(target, draft) {
  const body = {};
  WRITE_FIELDS[target].forEach((field) => {
    const value = (draft || {})[field.key];
    if (field.control === 'file') {
      body[field.key] = value || null;
    } else if (field.control === 'chips_multi' || field.control === 'picker_multi') {
      body[field.key] = (value && value.length) ? value.slice() : null;
    } else {
      const text = typeof value === 'string' ? value.trim() : value;
      body[field.key] = text === '' || text === undefined ? null : text;
    }
  });
  return body;
}

/**
 * 一次逻辑提交用到的两个幂等键。
 *
 * 建草稿与提交审核是两个端点，各要一个键；但它们同属**一次逻辑尝试**，所以两个都在
 * 教师按下提交的那一刻生成一次，之后每一次重发都复用这一对（§4.2）。每次重发换新键，
 * 重复点击就会变成两条待审核记录 —— 那正是票据 15 验收项 7 要防的。
 */
function newAttemptKeys() {
  return { create: api.uuid(), submit: api.uuid(), withdraw: api.uuid() };
}

/**
 * 读回自己的一条资源／案例，摊平成表单能直接绑的形状。
 *
 * 读取走的是阅读页那两个详情端点，所以「教师看得到自己的全部状态」这条可见范围只在
 * 服务端说了一次。
 *
 * `decision_reason` 是**契约缺口**：`db_review_action.decision_reason` 是它真正的家，
 * 而契约的 `Resource`／`Case` schema 都没有这一列，也没有任何端点把它交给作者。票据 15
 * 要求「驳回时看到原因」，所以这里按本地契约服务的形状读它，与 `related_cases`、
 * `/home/cases` 同类：**只在本地契约服务上成立，接真服务时必须重对**，已记进交接。
 */
async function loadForEdit(target, contentId) {
  const row = await api.get(`${WRITE_PATH[target]}/${contentId}`);
  const draft = emptyDraft(target);
  WRITE_FIELDS[target].forEach((field) => {
    const value = row[field.key];
    if (value === null || value === undefined) return;
    draft[field.key] = Array.isArray(value) ? value.slice() : value;
  });
  const status = row[STATUS_KEY[target]];
  return {
    contentId: row[ID_KEY[target]],
    status,
    statusLabel: CONTENT_STATUS[status] || '未知状态',
    statusPill: STATUS_PILL[status] || 'hl-pill--unknown',
    decisionReason: row.decision_reason || '',
    draft,
  };
}

/**
 * 把关路径断言，再发请求。**拒绝必须发生在网络出口之前**（ADR-0016 的阻断级不变量）。
 *
 * `claimsPending` 传 false 是有理由的，不是随手填的：它问的是「本次写入的**图片**这一类
 * 有没有被界面说成审核中」。资源与案例的「待审核」徽章说的是 F6 管理端队列里的**这一条
 * 内容**，不是它封面图的内容安全检查 —— 图片走先发后审，教师端没有那个中间态，界面上也
 * 确实一个字都没提。两条路径共用一个 state 对象，而这两个标志各属一类内容；这一点值得在
 * `utils/moderation` 里收一收形状，记进交接。
 *
 * `imageCount` 只数图片。Word 详案不是图片，ADR-0016 的图片那一行管不到它，它随这一条
 * 资源／案例一起走 F6 的管理端人工审核。
 */
function assertUploadGate(gates, draft, what) {
  moderation.assertGate(gates, {
    what,
    claimsPending: false,
    claimsPublished: false,
    imageCount: (draft && draft.cover_file_id) ? 1 : 0,
  });
}

/**
 * 新建草稿（NONE -> s1）。
 *
 * @param {object}   o
 * @param {string}   o.target  'resource' 或 'case'
 * @param {string[]} o.gates   把关路径，**必填、无默认值**。页面显式声明。
 * @param {object}   o.draft   教师填的草稿；只有白名单内的字段会被发出
 * @param {string}   o.idempotencyKey 一次逻辑提交一个，重发复用
 */
async function createDraft({ target, gates, draft, idempotencyKey }) {
  assertUploadGate(gates, draft, target === 'case' ? '课程案例' : '课程资源');
  return api.post(WRITE_PATH[target], {
    action: ACTIONS[target].create,
    idempotencyKey,
    body: buildWriteBody(target, draft),
  });
}

/** 改草稿（仅 s1）。F6：pending 之后内容冻结，要改必须先撤回。 */
async function updateDraft({ target, gates, contentId, draft }) {
  assertUploadGate(gates, draft, target === 'case' ? '课程案例' : '课程资源');
  return api.patch(`${WRITE_PATH[target]}/${contentId}`, {
    action: ACTIONS[target].update,
    body: buildWriteBody(target, draft),
  });
}

/**
 * 提交审核（s1 -> s2）。
 *
 * **本端点无请求体**（契约明写），因此它不携带任何用户内容，没有可声明的内容类别，
 * 也就不过内容安全闸门 —— 与 `task-submit.accept` 同一条规则。内容的把关声明发生在
 * 上面那两个真正携带内容的写入上。`submitted_at` 由服务端设值（B10／§1.2）。
 */
function submitForReview({ target, contentId, idempotencyKey }) {
  return api.post(`${WRITE_PATH[target]}/${contentId}/submission`, {
    action: ACTIONS[target].submit,
    idempotencyKey,
  });
}

/** 作者撤回成草稿（s2｜s3｜s4 -> s1）。同样无请求体，同样不过闸门。 */
function withdrawToDraft({ target, contentId, idempotencyKey }) {
  return api.post(`${WRITE_PATH[target]}/${contentId}/withdrawal`, {
    action: ACTIONS[target].withdraw,
    idempotencyKey,
  });
}

/** 超过平台单次上限。选完文件立刻问它，别等上传失败（票据 15 验收项 3）。 */
function tooLarge(bytes) {
  return Number(bytes) > MAX_UPLOAD_BYTES;
}

/**
 * 拒绝的那句话。**说出大小与上限**，而不是「文件太大」—— 教师要知道该压到多少。
 * 措辞留在服务里，与 `sayCannotOpen` 同理：一种措辞，一个地方。
 */
function tooLargeReason(picked) {
  const size = `${(Number(picked.size) / 1024 / 1024).toFixed(1)} MB`;
  return `这个文件 ${size}，超过微信单次上传的 10 MB 上限，请压缩后再选。`;
}

/**
 * 选一张封面图。
 *
 * 用 `wx.chooseImage` 而**不是** `wx.chooseMedia({ mediaType: ['image'] })`：后者要靠一个
 * 参数把视频关掉，参数写错就是一个视频入口，而 `wx.chooseImage` 根本回不了视频
 * （DO-NOT-BUILD 12：`wx.uploadFile` 单次 10 MB 硬上限使手机视频根本发不出去，三条出路
 * 未拍板）。代价是 `wx.chooseImage` 在基础库 2.21.0 起被标为不再维护 —— 用一个还在文档
 * 里的旧接口换「视频入口不可能存在」，这笔交换记在交接里，团队可以推翻。
 *
 * @returns {Promise<{path:string, size:number, name:string, contentType:string}|null>}
 *          教师取消时回 null —— 取消不是失败，不弹话。
 */
function pickCoverImage() {
  return new Promise((resolve, reject) => {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = (res.tempFiles || [])[0];
        if (!file) { resolve(null); return; }
        resolve({
          path: file.path,
          size: file.size,
          name: '封面图片',
          contentType: 'image/jpeg',
        });
      },
      fail: (err) => {
        // 取消选择在平台上也走 fail，errMsg 里带 cancel。它不是失败。
        if (err && String(err.errMsg || '').indexOf('cancel') !== -1) { resolve(null); return; }
        reject(new Error('选择图片失败，请重试'));
      },
    });
  });
}

/** 选一份 Word 详案。只能从微信会话里取，这是平台给的唯一取文件方式。 */
function pickWordFile() {
  return new Promise((resolve, reject) => {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['docx'],
      success: (res) => {
        const file = (res.tempFiles || [])[0];
        if (!file) { resolve(null); return; }
        resolve({
          path: file.path,
          size: file.size,
          name: file.name || 'Word 详案',
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
      },
      fail: (err) => {
        if (err && String(err.errMsg || '').indexOf('cancel') !== -1) { resolve(null); return; }
        reject(new Error('选择文件失败，请重试'));
      },
    });
  });
}

/**
 * 契约 §8 的媒体流：签凭证 -> 字节直传对象存储 -> 落库拿 file_id。
 *
 * §8.1 铁律：**字节不经过 API 实例**。所以这里发两个请求给 API，中间那一趟走的是凭证里
 * 那个 API 基址之外的地址，且用 `wx.uploadFile`（multipart 的 POST），因为凭证放行的是
 * COS 的 PostObject。
 *
 * 大小在**选文件的那一刻**已经拦过一次（`tooLarge`）；这里不再拦，服务端在签凭证时独立
 * 复验（§6.4：客户端预先禁用不是边界）。
 *
 * @param {string} usageKey `db_file_ref.usage_key`
 * @returns {Promise<number>} file_id
 */
async function uploadPickedFile(picked, usageKey) {
  const cred = await api.post('/media/upload-credentials', {
    body: {
      usage_key: usageKey,
      content_type: picked.contentType,
      byte_size: picked.size,
    },
  });

  await new Promise((resolve, reject) => {
    wx.uploadFile({
      url: cred.url,
      filePath: picked.path,
      // 文件字段放最后，其余按 field_order —— 顺序是 COS 表单上传的要求，不是习惯。
      name: 'file',
      formData: cred.form_fields,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error('上传失败，请检查网络后重试'));
      },
      fail: () => reject(new Error('上传失败，请检查网络后重试')),
    });
  });

  const file = await api.post('/media/files', { body: { upload_ticket: cred.upload_ticket } });
  return file.file_id;
}

module.exports = {
  RESOURCE_TAG,
  RESOURCE_TYPE,
  CONTENT_STATUS,
  tagFilters,
  gradeFilters,
  fieldFilters,
  areaFilters,
  listResources,
  resourceDetail,
  listCases,
  caseDetail,
  downloadWordFile,
  downloadCaseWordFile,
  entries,
  open,
  openCase,
  openResource,
  openUpload,
  // 票据 15 的写入面。
  UPLOAD_TARGETS,
  LIMITS,
  /**
   * 上传人的姓名与班级，只读回显。
   *
   * 原型 `upload-resource.html` 那一节自己的注释写着：「上传人信息**不再是表单**……
   * 改为只读回显」——原先那里是两个 `select`（GAPS.md G24 记的死控件），拿掉的是
   * 控件，不是这一节。教师要看得见自己这次以谁的身份、哪个班在传。
   *
   * §6.4：`scope` 只作显示用。显示班级名正是它许可的用法，把它写回请求体才不是 ——
   * 作者字段由服务端派生，客户端一个也不送（§7.3 / DO-NOT-BUILD 8）。
   *
   * 转出而不是让页面 require 第二个服务模块：分包规则只许一个（票据 12），
   * 与 co-education 转出 media、evaluation 转出 radarModel 是同一条。
   */
  uploaderIdentity: identity.homeIdentity,
  MAX_UPLOAD_BYTES,
  uploadOptions,
  resourcePickerOptions,
  emptyDraft,
  missingFields,
  tooLong,
  buildWriteBody,
  newAttemptKeys,
  loadForEdit,
  createDraft,
  updateDraft,
  submitForReview,
  withdrawToDraft,
  pickCoverImage,
  pickWordFile,
  uploadPickedFile,
  tooLarge,
  tooLargeReason,
};
