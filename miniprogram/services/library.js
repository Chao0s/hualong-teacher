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
 * Read-only. 上传与提交审核是票据 15／16 的事，本文件不写任何东西。
 *
 * Everything returned is view-ready (spec 实现决定 7): a page binds it and
 * formats nothing.
 */

const api = require('../utils/request');
const guard = require('../utils/guard');
const { present } = require('../utils/present');
// `case` is a reserved word; the module is named for what it holds, the binding
// for what JavaScript allows（services/home.js 已是这个写法）。
const kase = require('./case');

const RESOURCE_PATH = '/library/resources';
const CASE_PATH = '/library/cases';

// db_resource.resource_tag —— 衣食住行艺，五类固定。这就是原型里的「衣食住行艺分类」，
// 也是资源库的主轴。形态定案：横排标签，不进滚轮（form-control-spec.md §2.1）。
const RESOURCE_TAG = { g1: '衣', g2: '食', g3: '住', g4: '行', g5: '艺' };

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
  case: { label: '课程案例库', page: '/packages/library/pages/case/list' },
  caseDetail: { label: '课程案例', page: '/packages/library/pages/case/detail' },
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

module.exports = {
  RESOURCE_TAG,
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
};
