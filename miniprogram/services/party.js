/**
 * 党建管理 —— `/party/*` 共 7 条端点，全部只读。
 *
 * Boundary: 契约的 party 模块，不是某一页。页面 require 本模块、把返回值直接
 * setData，**不在页面里拼 URL、不在页面里译枚举、不在页面里格式化日期**。
 *
 * ── 这一族为什么全是只读 ─────────────────────────────────────────────────────
 *
 * 党建学习、活动与品牌都由管理员在 PC 后台发布（`created_by_admin_id`），教师端
 * 只读。所以本模块一个写入函数也没有，也不该有 —— DO-NOT-BUILD 2：教师端不存在
 * 任何通往 PC 后台的路径，管理职能不进小程序。
 *
 * 越权测试的 D/E 两组**不打**这一族的路径参数（`study_id`／`activity_id`／
 * `brand_id`）：党建内容是园所级共享，全园教师本来就都读得到，按「越权」去判会
 * 淹掉真正的发现。这不代表没有范围 —— 服务端仍按 `school_id` 收窄。
 *
 * ── 两处服务端与契约对不上，逐条记在这里 ─────────────────────────────────────
 *
 * 1. **`GET /party/home` 的回包形状不合契约。** 契约的 `PartyHome` 要求四个键：
 *    `carousel`／`latest_studies`／`latest_activities`／`latest_brands`，其中
 *    `carousel` 是派生的轮播（正好是党建管理部首屏要的那三条），`latest_activities`
 *    是完整的 `PartyActivity`。db/testdata 的服务端回的是 `studies`／`activities`／
 *    `brands` 三个键，且每个对象只有 id、标题与日期 —— `PartyStudyCard` 必填的
 *    `study_type` 与 `excerpt`、`PartyActivity` 必填的 `activity_content` 与
 *    `activity_status` 全都没有。
 *
 *    页面要显示文件类型、发布部门、活动地点与品牌标签，这些它一个也给不出来。
 *    所以 `home()` **不调 `/party/home`**，改由三条**合契约且工作正常**的列表端点
 *    并发拼出来。这是一次有意的取舍，不是没看见那条端点：
 *      - 代价：3 个请求而不是 1 个（都是只读、可并发、数据量极小）；
 *      - 收益：首屏显示的每一个字都有来源，不需要为了迁就一个不合契约的实作去
 *        删掉三个板块的信息。
 *    服务端补齐 `PartyHome` 之后，把 `home()` 换成一次 `api.get('/party/home')`
 *    即可，页面一行不用改 —— 这也是把它包成一个函数而不是写进页面的理由。
 *
 * 2. **附件的键名是 `files` 而不是契约的 `file_refs`。** 两个都读，以契约的
 *    `file_refs` 优先。这一条成本是零，所以就地兼容，不单开一张缺口单。
 */

const api = require('../utils/request');
const time = require('../utils/time');

const STUDY_PATH = '/party/studies';
const ACTIVITY_PATH = '/party/activities';
const BRAND_PATH = '/party/brands';

// db_party_study.study_type —— DDL 注释逐字：`t1=policy|t2=learning|t3=system`。
// 中文取原型上一直在用的三个说法，三者一一对得上，不是这里新起的名字。
const STUDY_TYPE = { t1: '政策文件', t2: '学习材料', t3: '制度文件' };

// 审核流共用值域（resource/case/study/activity/brand 同一族）。
// 教师端读到的基本只有 s3；其余四态列出来是为了未知码有中文可落，不是预期会出现。
const CONTENT_STATUS = { s1: '草稿', s2: '待审核', s3: '已发布', s4: '已驳回', s5: '已下架' };

// 党建管理部首屏每块取几条。原型三块各显示 3 条，轮播 3 条。
const HOME_LIMIT = 3;

/** 契约叫 file_refs，本地服务端叫 files。两个都收，契约的优先。 */
function fileRefs(row) {
  return (row && (row.file_refs || row.files)) || [];
}

/* ── 党建学习 ────────────────────────────────────────────────────────────── */

/**
 * 列表行。原型的 item 绑 title 与一个 meta 数组，meta 按顺序是
 * 「类型 · 日期 · 发布部门」。
 */
function studyCard(row) {
  return {
    id: row.study_id,
    title: row.study_title,
    type: STUDY_TYPE[row.study_type] || '学习文件',
    department: row.publisher_department || '',
    date: time.formatDay(row.published_at),
    meta: [
      STUDY_TYPE[row.study_type] || '学习文件',
      time.formatDay(row.published_at),
      row.publisher_department || '',
    ].filter(Boolean),
  };
}

async function listStudies({ cursor, limit } = {}) {
  const page = await api.getPage(STUDY_PATH, { cursor, limit });
  return { items: page.items.map(studyCard), nextCursor: page.nextCursor };
}

/**
 * 一份学习文件，整取。
 *
 * **原型的「文件预览」是两段写死的正文（p1/p2）。** `db_party_study` 只有一列
 * `study_content`，契约的 `PartyStudy` 亦然。所以这里回一个段落数组：正文按空行
 * 切段，有几段是几段 —— 不硬凑成两段，也不把一段劈成两半。
 *
 * `video_links` 可能是 null（三条学习材料里有一条就是），读作没有视频。
 */
async function getStudy(studyId) {
  const row = await api.get(`${STUDY_PATH}/${studyId}`);
  return {
    id: row.study_id,
    title: row.study_title,
    type: STUDY_TYPE[row.study_type] || '学习文件',
    department: row.publisher_department || '',
    date: time.formatDay(row.published_at),
    statusLabel: CONTENT_STATUS[row.study_status] || '未知状态',
    paragraphs: String(row.study_content || '')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean),
    // 契约的 video_links 是 [{url, title}]；原型的模板绑的是 name。
    videos: (row.video_links || []).map((v) => ({ url: v.url, name: v.title || v.url })),
    // 主文件。usage_key='main_file' 是这一族唯一用到的取值。
    files: fileRefs(row).map((f) => ({ fileId: f.file_id, usageKey: f.usage_key })),
  };
}

/* ── 党建活动 ────────────────────────────────────────────────────────────── */

/** 列表行。原型的 meta 按顺序是「日期 · 地点」。 */
function activityCard(row) {
  return {
    id: row.activity_id,
    title: row.activity_title,
    location: row.activity_location || '',
    date: time.formatDay(row.activity_at),
    meta: [time.formatDay(row.activity_at), row.activity_location || ''].filter(Boolean),
  };
}

async function listActivities({ cursor, limit } = {}) {
  const page = await api.getPage(ACTIVITY_PATH, { cursor, limit });
  return { items: page.items.map(activityCard), nextCursor: page.nextCursor };
}

/**
 * 一场活动，整取。
 *
 * `activity_at` 是**计划时间**（§1.2 白名单里的一列），所以这里显示到分钟，
 * 与「发布于哪天」不是一回事。
 */
async function getActivity(activityId) {
  const row = await api.get(`${ACTIVITY_PATH}/${activityId}`);
  return {
    id: row.activity_id,
    title: row.activity_title,
    location: row.activity_location || '',
    // 原型的副标题是「党建活动 · 多功能室」。
    sub: ['党建活动', row.activity_location].filter(Boolean).join(' · '),
    time: time.formatShort(row.activity_at),
    statusLabel: CONTENT_STATUS[row.activity_status] || '未知状态',
    body: row.activity_content || '',
    // 契约只回 {file_id, usage_key}，**没有文件名**。所以附件用途当名字显示，
    // 不编一个「xxx方案.docx」出来 —— 编出来的文件名点下去下不到那个文件。
    files: fileRefs(row).map((f) => ({ fileId: f.file_id, name: f.usage_key })),
  };
}

/* ── 品牌建设 ────────────────────────────────────────────────────────────── */

/**
 * 列表卡。
 *
 * 原型给 4 条写死的品牌各配了一个专名字（科／狮／园／读），照着假数据的名字捏的；
 * `db_party_brand` 没有图标列。改取标题首字：它对任何一条真实数据都有定义，也不
 * 需要动样式。
 */
function brandCard(row) {
  const tags = row.brand_tag || [];
  return {
    id: row.brand_id,
    title: row.brand_title,
    glyph: String(row.brand_title || '品').charAt(0),
    tags,
    date: time.formatDay(row.published_at),
    // 原型的 meta 是「科学探究 · 园本特色」两个标签拼起来的。
    meta: tags.slice(0, 2).join(' · '),
  };
}

async function listBrands({ cursor, limit } = {}) {
  const page = await api.getPage(BRAND_PATH, { cursor, limit });
  return { items: page.items.map(brandCard), nextCursor: page.nextCursor };
}

async function getBrand(brandId) {
  const row = await api.get(`${BRAND_PATH}/${brandId}`);
  const tags = row.brand_tag || [];
  return {
    id: row.brand_id,
    title: row.brand_title,
    sub: tags.slice(0, 2).join(' · '),
    chips: tags,
    body: row.brand_content || '',
    date: time.formatDay(row.published_at),
    statusLabel: CONTENT_STATUS[row.brand_status] || '未知状态',
    files: fileRefs(row).map((f) => ({ fileId: f.file_id, name: f.usage_key })),
  };
}

/* ── 党建管理部首屏 ──────────────────────────────────────────────────────── */

/**
 * 首屏要的四份数据：轮播 + 三块列表。
 *
 * 三条列表端点并发取，各取 3 条。**不调 `/party/home`** —— 理由见文件头注第 1 条，
 * 一句话是：那条端点在这台服务端上不合契约，回的对象缺了页面要显示的字段。
 *
 * 轮播用的就是最新三条学习文件：契约的 `PartyHome.carousel` 描述得很清楚 ——
 * 「本园 `study_status='s3'`，`published_at DESC, study_id DESC` 取 3」，是**派生
 * 结果，不是可管理的推荐清单**（F7 已拔除 `db_party_feature`，不得重建）。
 * 列表端点默认就按 `published_at DESC` 排，所以取前 3 条即为同一份东西。
 */
async function home() {
  const [studies, activities, brands] = await Promise.all([
    listStudies({ limit: HOME_LIMIT }),
    listActivities({ limit: HOME_LIMIT }),
    listBrands({ limit: HOME_LIMIT }),
  ]);
  return {
    carousel: studies.items,
    studies: studies.items,
    activities: activities.items,
    brands: brands.items,
  };
}

module.exports = {
  STUDY_TYPE,
  CONTENT_STATUS,
  listStudies,
  getStudy,
  listActivities,
  getActivity,
  listBrands,
  getBrand,
  home,
};
