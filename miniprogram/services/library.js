/**
 * 资源库与案例库 —— `/library/resources` 与 `/library/cases` 两族共 14 条端点。
 *
 * Boundary: 契约的 library 模块，不是某一页。页面 require 本模块、把返回值直接
 * setData，**不在页面里拼 URL、不在页面里译枚举、不在页面里格式化日期**。
 * 返回的每一个值都是可直接渲染的（view-ready）。
 *
 * ── 枚举是唯一的一份 ─────────────────────────────────────────────────────────
 *
 * 下面五张枚举表逐字对应 `db/01_schema.sql` 的列注释与 `DATABASE_SPEC.md` §2.5。
 * 页面不得再抄一份 —— 原型把「衣食住行艺」写死在 12 张卡片上，那正是这次要清掉的。
 * §1.1：服务端可以先于本次构建增加编码，所以每一处查表都带兜底，未知码丢掉的是
 * 那一个字段，不是整行。
 *
 * ── 三处原型与契约对不上，逐条记在这里 ───────────────────────────────────────
 *
 * 1. **列表端点没有搜索参数。** `GET /library/resources` 只收 `resource_tag`、
 *    `grade`、`resource_status`、`class_id`，没有 `q`。原型的搜索框因此在客户端
 *    对已取回的那一页做匹配。数据集是 12 条资源 / 10 条案例，一页取尽；真接后端
 *    且资源上千时，这个搜索框需要契约先加一个参数，客户端补不出来。
 *
 * 2. **`case_area` 的筛选参数是单值，列表行也不回这一列。** 而原型的活动类型是
 *    多选。所以多选被翻译成**并发多发**：选中几项就发几条合法的单值查询，再按
 *    `case_id` 去重合并（`listCases` 的 `areas`）。最多 5 发，且是 5 个固定值。
 *
 * 3. **资源详情没有「关联案例」的数据源。** 方向要看清楚：`db_case.resource_ids`
 *    记着案例引用了哪些资源，`db_resource` 上没有反向列，契约的 `Resource` schema
 *    也没有。所以「这个资源被哪些案例用了」这一节在本服务端上无解 —— 本模块因此
 *    **不发明**它，`getResource().links` 恒为空数组，页面据此不渲染那一节。
 *    反过来 `getCase()` 是正向的，`resource_ids` 展开得出来（下面 `expandResources`）。
 */

const api = require('../utils/request');
const time = require('../utils/time');

const RESOURCE_PATH = '/library/resources';
const CASE_PATH = '/library/cases';

// db_resource.resource_tag —— 衣食住行艺，五类固定。这是资源库的主轴。
const RESOURCE_TAG = { g1: '衣', g2: '食', g3: '住', g4: '行', g5: '艺' };

// db_resource.resource_type —— 资源本体是哪种文件。DDL 注释逐字：
// `r1=docx|r2=xlsx|r3=jpg|r4=html|r5=pdf|r6=wiki`。中文取教师读得懂的说法。
const RESOURCE_TYPE = { r1: '文档', r2: '表格', r3: '图片', r4: '网页', r5: 'PDF', r6: '百科' };

// db_class.grade / db_case.case_grade / db_resource.grade[] —— 同一个编码系。
const GRADE = { k1: '小班', k2: '中班', k3: '大班' };

// db_case.case_field —— 《指南》五大领域。
const CASE_FIELD = { f1: '健康', f2: '语言', f3: '社会', f4: '科学', f5: '艺术' };

// db_case.case_area —— 活动组织形式。原型的按钮文字把「集体教学」缩成「集体」，
// 那是显示，不是取值；缩写留在页面的 typeOptions 里，本表存全称。
const CASE_AREA = {
  a1: '集体教学',
  a2: '区域',
  a3: '主题探究',
  a4: '家园社共育',
  a5: '数字化',
};

// db_resource.resource_status / db_case.case_status —— 同一个值域，两张表各持一列。
const CONTENT_STATUS = { s1: '草稿', s2: '待审核', s3: '已发布', s4: '已驳回', s5: '已下架' };

/**
 * 图标与色调，由分类派生。
 *
 * 原型给 12 条写死的资源配了 12 个专名图标（silk／milk／hall…），那是照着假数据的
 * 名字一条一条捏的：`香云纱纹样` 配 silk，`双皮奶` 配 milk。库里真实的 12 条资源叫
 * `走亲戚的路线`、`旧屋的门与窗`、`菜市场里的数学`，与那 12 个专名一个也对不上，
 * 而 `db_resource` 上并没有图标列。
 *
 * 所以图标改由 `resource_tag` 派生：五类各取一个已经存在于 wxss 里的图标。这样它
 * 有确定的含义（「住」类就是 hall），不需要动一行样式，也不会因为库里新增一条资源
 * 就没有图标可用。
 */
const TAG_ICON = { g1: 'silk', g2: 'milk', g3: 'hall', g4: 'boat', g5: 'lion' };
const TAG_TONE = { g1: 'green', g2: 'amber', g3: 'accent', g4: 'blue', g5: 'green' };
const FIELD_TONE = { f1: 'amber', f2: 'blue', f3: 'accent', f4: 'blue', f5: 'green' };

/* ── 筛选取值：页面的 chip 从这里拿，不自己写死 ──────────────────────────── */

/**
 * `全部` 用空串表示，因为 utils/request.js 的 buildQuery 会丢掉空串 —— 「不筛」
 * 就是「不发这个参数」，而不是发一个服务端不认识的 `all`。
 */
function optionsOf(table) {
  return Object.keys(table).map((key) => ({ key, label: table[key] }));
}

function tagFilters() {
  return [{ key: '', label: '全部' }].concat(optionsOf(RESOURCE_TAG));
}

function gradeFilters() {
  return [{ key: '', label: '全部' }].concat(optionsOf(GRADE));
}

function fieldFilters() {
  return [{ key: '', label: '全部' }].concat(optionsOf(CASE_FIELD));
}

function areaFilters() {
  return [{ key: '', label: '全部' }].concat(optionsOf(CASE_AREA));
}

/** `['k1','k3']` -> `小班 · 大班`。可空的数组列，null 与空数组都读作没有。 */
function gradeLabel(grades) {
  return (grades || []).map((k) => GRADE[k]).filter(Boolean).join(' · ');
}

/* ── 资源 ────────────────────────────────────────────────────────────────── */

/** 列表卡片。原型的 entry 绑的是 name／tag／icon／tone 四个键。 */
function resourceCard(row) {
  const tag = RESOURCE_TAG[row.resource_tag] || '';
  return {
    id: row.resource_id,
    name: row.resource_name,
    tag: row.resource_tag,
    tagLabel: tag,
    icon: TAG_ICON[row.resource_tag] || 'hall',
    tone: TAG_TONE[row.resource_tag] || 'accent',
    // s3 是常态，不挂徽章 —— 挂上去只是在重复「一切正常」。其余四态只可能是教师
    // 自己写的，要显眼。
    statusLabel: row.resource_status === 's3' ? '' : (CONTENT_STATUS[row.resource_status] || '未知状态'),
    gradeLabel: gradeLabel(row.grade),
    updatedAt: time.formatDay(row.updated_at),
  };
}

/**
 * 一页资源，新的在前（§3.1 游标分页）。
 *
 * `tag` 收的是中文标签（页面的 chip 就是中文），在这里译回 `g?` 再发出去 ——
 * 服务端筛选，不是取回来在客户端过。DO-NOT-BUILD 11：只有游标，没有页号。
 */
async function listResources({ tag, grade, cursor, limit } = {}) {
  const page = await api.getPage(RESOURCE_PATH, {
    cursor,
    limit,
    resource_tag: codeOf(RESOURCE_TAG, tag),
    grade: codeOf(GRADE, grade),
  });
  return { items: page.items.map(resourceCard), nextCursor: page.nextCursor };
}

/** 中文标签译回编码。传空串或未知值就返回空串，等于不发这个参数。 */
function codeOf(table, label) {
  if (!label || label === 'all' || label === '全部') return '';
  const hit = Object.keys(table).find((k) => table[k] === label);
  return hit || '';
}

/**
 * 一条资源，整取。
 *
 * §2.3：不在可见范围内与不存在同为 404，本模块原样透传，不翻译成「无权限」——
 * 那会把「有这条但你看不到」泄漏出去。
 *
 * 三段正文对应 DDL 的三列，原型的三个小标题逐字保留。
 */
async function getResource(resourceId) {
  const row = await api.get(`${RESOURCE_PATH}/${resourceId}`);
  const tag = RESOURCE_TAG[row.resource_tag] || '';
  return {
    id: row.resource_id,
    title: row.resource_name,
    tags: [tag, gradeLabel(row.grade), RESOURCE_TYPE[row.resource_type]].filter(Boolean),
    statusLabel: CONTENT_STATUS[row.resource_status] || '未知状态',
    sections: [
      { title: '资源解读', text: row.resource_explain || '' },
      { title: '资源获取', text: row.resource_access || '' },
      { title: '资源转化', text: row.resource_trans || '' },
    ],
    // Word 详案。没有附件的资源照常显示，只是少一个下载入口。
    wordFileId: row.word_file_id || null,
    // 取档的前置是 s3（服务端对教师那一支的可见性判定写死 = 's3'）。自己刚交上去的
    // s2 点下去会拿到 404 —— 那是范围判定，不是坏了，但教师读不出这个区别。
    // 所以不到 s3 就不给按钮，两页共用这一个判断。
    canDownload: Boolean(row.word_file_id) && row.resource_status === 's3',
    // 见文件头注第 3 条：本服务端没有反向索引，这一节无数据源，恒空。
    links: [],
  };
}

/* ── 案例 ────────────────────────────────────────────────────────────────── */

/** 列表卡片。原型的 case 卡绑 name／grade／field／thumb／tone／pills。 */
function caseCard(row) {
  const field = CASE_FIELD[row.case_field] || '';
  const grade = GRADE[row.case_grade] || '';
  return {
    id: row.case_id,
    name: row.case_name,
    grade,
    field,
    // 原型的缩略图是两行手写文字（`祠堂\n探访`）。库里没有这一列，改用领域首字
    // 加名称首字，两个字仍然占满原来那个方块。
    thumb: `${field.charAt(0) || '案'}\n${(row.case_name || '').charAt(0)}`,
    tone: FIELD_TONE[row.case_field] || 'accent',
    // 列表行不回 case_area（见头注第 2 条），所以 pills 只有年级与领域两项。
    pills: [grade, field].filter(Boolean),
    statusLabel: row.case_status === 's3' ? '' : (CONTENT_STATUS[row.case_status] || '未知状态'),
    intro: row.case_intro || '',
    updatedAt: time.formatDay(row.updated_at),
  };
}

/**
 * 一页案例，新的在前。
 *
 * `areas` 收一个中文数组（原型的活动类型是多选）。契约的 `case_area` 是**单值**
 * 参数，所以这里发的是**几条各自合法的单值查询**，再按 `case_id` 去重合并 ——
 * 不是在客户端过滤，也不是发一个契约没有的数组参数。上限是 5，因为取值就 5 个。
 *
 * 合并后按 `updated_at` 重新排序：几条查询各自有序，拼起来就不是了。
 */
async function listCases({ grade, field, areas, cursor, limit } = {}) {
  const areaCodes = (areas || [])
    .map((a) => codeOf(CASE_AREA, a))
    .filter(Boolean);

  const query = {
    cursor,
    limit,
    case_grade: codeOf(GRADE, grade),
    case_field: codeOf(CASE_FIELD, field),
  };

  if (areaCodes.length === 0) {
    const page = await api.getPage(CASE_PATH, query);
    return { items: page.items.map(caseCard), nextCursor: page.nextCursor };
  }

  const pages = await Promise.all(
    areaCodes.map((code) => api.getPage(CASE_PATH, { ...query, case_area: code }))
  );

  const seen = new Set();
  const merged = [];
  pages.forEach((page) => {
    page.items.forEach((row) => {
      if (seen.has(row.case_id)) return;
      seen.add(row.case_id);
      merged.push(row);
    });
  });
  merged.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));

  return {
    items: merged.map(caseCard),
    // 合并了几条独立的游标流，它们的游标彼此不通用，拼不出一个能续下去的游标。
    // 谎报一个会在翻第二页时静默漏行，所以这里明说到此为止。
    nextCursor: null,
  };
}

/**
 * 一条案例，整取。
 *
 * **自评、他评与活动反思没有对应的列。** `db_case` 只有 `case_intro`（活动简介）
 * 与 `case_trans`（活动转化），契约的 `Case` schema 亦然。原型 case-detail 把
 * 「七、自评」「八、他评」「九、活动反思」连同整份教案写成 60 个写死的块 —— 那些
 * 是 **Word 详案的正文**，存在 `word_file_id` 指向的文件里，不是页面上的字段。
 * 本模块因此不发明这些字段，正文由下载入口通向（`downloadLink`）。
 */
async function getCase(caseId) {
  const row = await api.get(`${CASE_PATH}/${caseId}`);
  const field = CASE_FIELD[row.case_field] || '';
  const grade = GRADE[row.case_grade] || '';
  const areas = (row.case_area || []).map((a) => CASE_AREA[a]).filter(Boolean);
  return {
    id: row.case_id,
    title: row.case_name,
    grade,
    field,
    areas,
    tags: [grade, field].concat(areas),
    statusLabel: CONTENT_STATUS[row.case_status] || '未知状态',
    intro: row.case_intro || '',
    trans: row.case_trans || '',
    sections: [
      { title: '活动简介', text: row.case_intro || '' },
      { title: '活动转化', text: row.case_trans || '' },
    ],
    wordFileId: row.word_file_id || null,
    // 同 getResource：取档前置是 s3，不到就不给按钮。
    canDownload: Boolean(row.word_file_id) && row.case_status === 's3',
    relatedResources: await expandResources(row.resource_ids),
  };
}

/**
 * `resource_ids` 只有整数，没有名称，契约的 `Case` schema 也只回 ID。
 *
 * 这是**有界的** N+1：一条案例引用的资源是个位数（数据集里是 1），而且这是拿到
 * 名称的唯一途径 —— 案例列表没有 `resource_id` 这个筛选参数，反过来查不到。
 * 其中任一条不在可见范围时回 404，这里吞掉那一条，不让它拖垮整页。
 */
async function expandResources(ids) {
  if (!ids || !ids.length) return [];
  const rows = await Promise.all((ids).map((id) =>
    api.get(`${RESOURCE_PATH}/${id}`).catch(() => null)
  ));
  return rows.filter(Boolean).map((row) => ({
    id: row.resource_id,
    name: row.resource_name,
    meta: [RESOURCE_TAG[row.resource_tag], gradeLabel(row.grade)].filter(Boolean).join(' · '),
  }));
}

/* ── 写入 ────────────────────────────────────────────────────────────────── */

// api/action-registry.tsv 的 action_key。
const ACTIONS = {
  resourceCreate: 'resource.create',
  resourceUpdateDraft: 'resource.update_draft',
  resourceSubmit: 'resource.submit',
  resourceDownloadLink: 'resource.download_link',
  caseCreate: 'case.create',
  caseUpdateDraft: 'case.update_draft',
  caseSubmit: 'case.submit',
  caseDownloadLink: 'case.download_link',
};

/**
 * 封面与 Word 详案的 file_id，只在真的有的时候才进请求体。
 *
 * 两列都是 `db_resource`／`db_case` 上的**直接外键列**（`fk_res_cover`／
 * `fk_res_word`／`fk_case_cover`／`fk_case_word`），两列都可空，**没有 `db_file_ref`
 * 行**。发一个 `null` 与不发这一格在服务端是同一件事，所以不发 —— 请求体越小，
 * 422 时指的那一格越准。
 *
 * 服务端会复验这个 id 是不是**本人上传的**成品：别人的 id 回 422 `validation_failed`。
 */
function fileIdInto(body, key, fileId) {
  if (fileId) body[key] = fileId;
  return body;
}

/**
 * 新建一条资源草稿。
 *
 * **不发 `school_id`、`class_id`、`created_by`** —— 那三个是 derived 层
 * （§7.3，DO-NOT-BUILD 8），服务端从登录上下文自己填。utils/derived.js 会在
 * 发出前剥掉它们，这里连传都不传。
 *
 * `coverFileId`／`wordFileId` 是 `services/media.js` 的 `uploadFile()` 落库之后
 * 回的那个 id，页面原样传进来。
 */
function createResource({ name, tag, grade, type, explain, access, trans, coverFileId, wordFileId }) {
  const body = {
    resource_name: name,
    resource_tag: codeOf(RESOURCE_TAG, tag),
    resource_type: codeOf(RESOURCE_TYPE, type) || 'r1',
    grade: (grade || []).map((g) => codeOf(GRADE, g)).filter(Boolean),
    resource_explain: explain,
    resource_access: access,
    resource_trans: trans,
  };
  fileIdInto(body, 'cover_file_id', coverFileId);
  fileIdInto(body, 'word_file_id', wordFileId);
  return api.post(RESOURCE_PATH, { action: ACTIONS.resourceCreate, body });
}

/** 新建一条案例草稿。同样不发 derived 三件套。 */
function createCase({ name, grade, field, areas, intro, trans, resourceIds, coverFileId, wordFileId }) {
  const body = {
    case_name: name,
    case_grade: codeOf(GRADE, grade),
    case_field: codeOf(CASE_FIELD, field),
    case_area: (areas || []).map((a) => codeOf(CASE_AREA, a)).filter(Boolean),
    case_intro: intro,
    case_trans: trans,
    resource_ids: resourceIds || [],
  };
  fileIdInto(body, 'cover_file_id', coverFileId);
  fileIdInto(body, 'word_file_id', wordFileId);
  return api.post(CASE_PATH, { action: ACTIONS.caseCreate, body });
}

/*
 * 资源与案例是**两条契约操作**，不是一条带参数的操作。
 *
 * 这四个函数以前是两个，路径前缀由 `target === 'case' ? CASE_PATH : RESOURCE_PATH`
 * 拼出来。运行时没问题，静态查不了：`npm run scan:wiring` 的 L3 拿到的是
 * `${path}/${contentId}/submission`，`path` 是个未知变量，只能按后缀去猜，
 * 一条调用同时匹配到两条契约操作，报「待审」。
 *
 * 「静态查不了」不是可有可无的洁癖。契约的路径改名、动作键改名、角色收紧，
 * 都是靠这一层比对发现的。一条查不了的调用就是一个盲点，而盲点不会报警。
 *
 * `action` 必须写成 `action: ACTIONS.xxx` 的显式形式，不能用 `{ action }` 简写 ——
 * 扫描器抓的是冒号形式（`scan-wiring.mjs` 的 `/\baction\s*:\s*…/`）。写简写等于
 * 没带 action，L3 会报「契约有 x-hualong-action，调用没带」。
 */

/* ── 「我的上传」──────────────────────────────────────────────────────────
 *
 * 契约的 `mine=true` 只列调用者本人创建的内容，**不分状态**。为什么要这个参数、
 * 为什么靠状态推断做不到，写在契约 §15 v0.23 与 `components.parameters.MineOnly`
 * 的 description 里，一句话是：`s3` 那一档推不出来 —— 我发布成功的那些与全园的
 * `s3` 混在一起。
 *
 * 五档全部列出来，因为「我交的东西到哪一步了」正是这个入口存在的理由。只列可改的
 * 两档，教师就看不到自己交上去的东西怎么了。五档都有数据源（`resource_status` 是
 * `NOT NULL` 的真列），不违反「没有数据源就不要渲染」。
 */

// 每一档要在屏幕上说的那句话。**F27 的代价要说出来** —— 不说，教师会以为
// 「为什么我改不了」是个 bug，然后来问。
const STATUS_NOTE = {
  s1: '草稿，可继续编辑或提交审核',
  s2: '审核中，内容已冻结',
  s3: '已发布，需请管理者下架后重新上传',
  s4: '已驳回，可直接修改后重新提交',
  s5: '已由管理者下架',
};

// 只有这两档能点进去改（F27：s1→s1 与 s4→s4，s4 直接重交不经 s1）。
const EDITABLE = { s1: true, s4: true };

/** 「我的上传」的一行。比列表卡多两样：那句话，与能不能点进改。 */
function myUploadRow(row, kind) {
  const status = kind === 'case' ? row.case_status : row.resource_status;
  return {
    kind,
    id: kind === 'case' ? row.case_id : row.resource_id,
    name: kind === 'case' ? row.case_name : row.resource_name,
    status,
    statusLabel: CONTENT_STATUS[status] || '未知状态',
    note: STATUS_NOTE[status] || '',
    editable: Boolean(EDITABLE[status]),
    updatedAt: time.formatDay(row.updated_at),
  };
}

/**
 * 我上传过的资源与案例，合成一份，新的在前。
 *
 * 两条列表端点各发一次（它们是两族内容，不是一族带类型参数），再按 `updated_at`
 * 重排。**`nextCursor` 明说 null** —— 合并了两条独立的游标流，它们的游标彼此
 * 不通用，谎报一个会在翻第二页时静默漏行。数据集是 12 + 10 条，一页取尽。
 */
async function listMyUploads({ limit = 100 } = {}) {
  const [res, cases] = await Promise.all([
    api.getPage(RESOURCE_PATH, { limit, mine: true }),
    api.getPage(CASE_PATH, { limit, mine: true }),
  ]);
  const items = res.items.map((r) => myUploadRow(r, 'resource'))
    .concat(cases.items.map((r) => myUploadRow(r, 'case')));
  items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { items, nextCursor: null };
}

/**
 * 改一条资源（`s1` 草稿或 `s4` 被驳回）。
 *
 * PATCH 语义：**字段缺席 = 不改，显式 `null` = 清空**（契约 §1.1）。所以这里
 * 只把调用者真的给了的键放进 body —— `undefined` 的键一个都不发，否则「没传」
 * 会被当成「清空」。
 *
 * `s2`／`s3`／`s5` 会回 409。`s3` 要改，由管理者先下架再重新上传一份（F27）。
 */
function updateResource(resourceId, patch) {
  return api.patch(`${RESOURCE_PATH}/${resourceId}`, {
    action: ACTIONS.resourceUpdateDraft,
    body: pick(patch, {
      name: 'resource_name',
      explain: 'resource_explain',
      access: 'resource_access',
      trans: 'resource_trans',
    }),
  });
}

/** 改一条案例。同资源。 */
function updateCase(caseId, patch) {
  return api.patch(`${CASE_PATH}/${caseId}`, {
    action: ACTIONS.caseUpdateDraft,
    body: pick(patch, {
      name: 'case_name',
      intro: 'case_intro',
      trans: 'case_trans',
    }),
  });
}

/** 只取调用者真的给了的键。undefined 不发 —— 发了会被读成「清空」。 */
function pick(patch, map) {
  const body = {};
  Object.keys(map).forEach((k) => {
    if (patch && patch[k] !== undefined) body[map[k]] = patch[k];
  });
  return body;
}

/** 资源草稿 s1 -> 待审核 s2。s4 被驳回的也走这条（F27）。 */
function submitResource(resourceId) {
  return api.post(`${RESOURCE_PATH}/${resourceId}/submission`, { action: ACTIONS.resourceSubmit });
}

/** 案例草稿 s1 -> 待审核 s2。同资源。 */
function submitCase(caseId) {
  return api.post(`${CASE_PATH}/${caseId}/submission`, { action: ACTIONS.caseSubmit });
}

// 本地契约服务端明确标注为假的取档域名。它自己的 README §二.2 写着：会**真的做完
// 授权**，然后回一个假 URL —— 它不接对象存储。
const PLACEHOLDER_HOST = 'example-cos.invalid';

/**
 * 取一次性的取档短链（Word 详案）。
 *
 * 返回 `{ url, placeholder, expiresAt }`。`placeholder` 为真时，这一次**授权是
 * 真的过了**，只是链接指向一个不存在的对象存储 —— 页面据此说一句中文，不要把它
 * 报成失败：报成失败会把「权限不足」和「预览环境不接 COS」混为一谈，而这两件事
 * 的处理方式完全相反。
 */
function shapeLink(res) {
  const url = (res && res.url) || '';
  return {
    url,
    placeholder: url.includes(PLACEHOLDER_HOST),
    expiresAt: (res && res.expires_at) || null,
  };
}

/** 资源的 Word 详案短链。前置是 `s3` —— 自己的 s1／s2／s4 点下载会拿到 404。 */
async function resourceDownloadLink(resourceId) {
  return shapeLink(await api.post(`${RESOURCE_PATH}/${resourceId}/download-link`, {
    action: ACTIONS.resourceDownloadLink,
  }));
}

/** 案例的 Word 详案短链。同资源。 */
async function caseDownloadLink(caseId) {
  return shapeLink(await api.post(`${CASE_PATH}/${caseId}/download-link`, {
    action: ACTIONS.caseDownloadLink,
  }));
}

module.exports = {
  RESOURCE_TAG,
  RESOURCE_TYPE,
  GRADE,
  CASE_FIELD,
  CASE_AREA,
  CONTENT_STATUS,
  tagFilters,
  gradeFilters,
  fieldFilters,
  areaFilters,
  listResources,
  getResource,
  listCases,
  getCase,
  createResource,
  createCase,
  listMyUploads,
  updateResource,
  updateCase,
  submitResource,
  submitCase,
  resourceDownloadLink,
  caseDownloadLink,
};
