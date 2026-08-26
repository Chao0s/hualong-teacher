/**
 * 教研培训服务 — the teaching-research module's reads (ticket 14).
 *
 * Boundary: the 教研培训 module, and it is also the subpackage boundary. The pages
 * in `packages/training` read this file and no other service module — one
 * subpackage, one service module, the rule `npm run verify:build` enforces.
 * 入口页 `pages/training/index` 是 tabBar 页，留在主包，读的是 services/module-entry.js。
 *
 * 状态列与可见范围，**研修单独确认**的结论（票据 14 验收项。党建管理与综合协调的假设
 * 一条也没有沿用，两者的差别写在下面第三段）：
 *
 *   状态列  `db_training.training_status`，值域 **s0 草稿｜s1 已发布｜s5 已撤回**，
 *           三态而非五态，且 `s5` 终局、不可恢复也不可编辑（openapi 的 `TrainingStatus`
 *           描述与 F9）。
 *   列表    `/trainings` 的 `x-hualong-scope` 逐字写着：
 *             `school_id = $ctx_school AND training_status = 's1'`
 *           **这一条是抄录。**
 *   详情    `/trainings/{training_id}` 的 `x-hualong-scope` 逐字写着：
 *             `WHERE training_id=$1 AND school_id=$ctx_school AND training_status IN ('s1','s5')`
 *           **这一条也是抄录。**
 *
 * 两条范围**不同**，这是本模块最容易写错的地方：列表恒为 s1，详情多admit一个 s5。
 * 所以列表不读状态列（恒定值不是信息，与党建三类同理），而**详情必须读** —— 一场已撤回
 * 的研修仍打得开，但只是壳：`file_refs`／`meeting_link_title`／`meeting_url` 一律不返回
 * （F9「撤回后不提供材料、会议入口或公开回馈」）。详情页若不说这一句，教师看到的是一场
 * 没有任何材料的研修，而不知道为什么。
 *
 * **阶段不是状态列。** `training_phase`（upcoming／ongoing／history）是按园所时区**派生、
 * 不落列**的值（F9 已删 `training_type`），列表上那枚徽章说的是它，不是状态。党建三类的
 * 徽章说的是状态，两者同一个位置、不同一件事，混起来会让「已撤回」显示成「已结束」。
 *
 * `phase` 查询参数又是第三样东西：它只有 `latest` 与 `history` 两个值，是**两区切分**，
 * 不是自由筛选（契约原话）。`latest` 收 upcoming 与 ongoing 两个派生阶段。
 *
 * 合作园不得进入本模块（§4 规则 21）。`utils/guard.js` 的 `PARTNER_MODULES` 里没有
 * `teaching-research`，服务端另有 403 route_not_allowed_for_role 兜底。
 *
 * **办园理念与课程体系是一个契约缺口。** `openapi.yaml` 的 126 条路径里搜不到
 * course／curriculum／理念／课程体系任何一个词，`db/01_schema.sql` 里也没有对应的表 ——
 * 这比 `/notices`、`/home/cases` 那几条更空：那几条至少有表撑着，只是没登记操作。本文件
 * 按本地契约服务实现 `GET /training/course-intro`，与 `related_cases`、`/home/cases`
 * 同类：**只在本地契约服务上成立，接真服务时必须重对**，已记进交接。
 *
 * **研修反馈（票据 16）也在本文件**，与资源库那边同一条理由：`packages/training` 这个分包
 * 只对应一个服务模块，`npm run verify:build` 会拦下第二个。报名与取消报名仍不在本轮范围内，
 * 所以 `my_participation_status` 只被反馈入口的判定读，**列表卡片仍然不带它** —— 一个没有
 * 报名入口的列表上显示「已报名」，教师看得到却改不了，比不显示更糟。
 *
 * Everything returned is view-ready (spec 实现决定 7): a page binds it and
 * formats nothing.
 */

const api = require('../utils/request');
const time = require('../utils/time');
const guard = require('../utils/guard');
const moderation = require('../utils/moderation');
const { present } = require('../utils/present');

const TRAINING_PATH = '/trainings';
// 契约里没有这两条路径（见头注）。名字刻意不写成 `/trainings/...`：那会看起来像契约的一部分。
const COURSE_INTRO_PATH = '/training/course-intro';
const HOME_PATH = '/training/home';

// db_training.training_status —— 三态，s5 终局（F9）。s0 草稿只在管理端存在，教师端的
// 两条可见范围都不含它；留在表里是因为契约的值域就是三个，删掉会让未知码判定失真。
const TRAINING_STATUS = { s0: '草稿', s1: '已发布', s5: '已撤回' };

// 派生阶段。§1.1: 服务端可以先于本次构建增加编码，所以每一处查表都带兜底。
const TRAINING_PHASE = { upcoming: '即将开始', ongoing: '进行中', history: '已结束' };

// 阶段徽章的颜色。琥珀＝还没到、需要留意；绿＝正在进行；蓝＝存档信息。灰只留给未知码，
// 所以「读不懂的阶段」与「历史研修」在屏幕上分得出来。
const PHASE_PILL = {
  upcoming: 'hl-pill--pending',
  ongoing: 'hl-pill--ok',
  history: 'hl-pill--info',
};

// db_file_ref.owner_object —— 取档要按这张业务表重跑一次授权（§8.4）。
const FILE_OWNER = 'db_training';

// db_file_ref.usage_key — 契约的 ContentFileRef 只认这三个。
const USAGE_LABEL = { main_file: '主文件', inline_media: '配图', download: '附件' };

// wx.openDocument 认得的扩展名，以及 wx.previewImage 认得的那几种。清单是微信平台定的，
// 不是我们定的；不在这两张表里的材料在手机上打不开，要当场说清楚。
const DOCUMENT_EXT = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];

/**
 * 列表的两区切分，ready to bind。
 *
 * 形态定案：横排标签（form-control-spec.md §1 第 2 问 —— 单选，2 项＋全部，取值固定）。
 * 一个滚轮也没有，这是判据的结果，不是遗漏。
 *
 * `全部` 用空串表示，因为 utils/request.js 的 buildQuery 会丢掉空串 —— 「不切分」就是
 * 「不发这个参数」，而不是发一个服务端不认识的 `all`。
 */
function phaseFilters() {
  return [
    { key: '', label: '全部' },
    { key: 'latest', label: '最新' },
    { key: 'history', label: '历史' },
  ];
}

/** 地点与主讲都是可空列，缺席的那一半消失，剩下的照常显示。 */
function metaLabel(row) {
  return [row.location, row.speaker ? `主讲：${row.speaker}` : '']
    .filter(Boolean)
    .join(' · ');
}

/** The list-row shape. */
function decorateCard(row) {
  return {
    training_id: row.training_id,
    training_title: row.training_title,
    // §1.2：偏移量是字面量。formatShort 只读写好的部分，14:00 在任何设备上都是 14:00。
    time_label: time.formatShort(row.start_at),
    phase_label: TRAINING_PHASE[row.training_phase] || '未知阶段',
    phase_pill: PHASE_PILL[row.training_phase] || 'hl-pill--unknown',
    meta_label: metaLabel(row),
    // Derived server-side from the first 100 characters of training_content;
    // there is no summary column (F9). Nothing here re-derives it.
    excerpt: row.excerpt || '',
  };
}

/**
 * One page of 研修, newest first (§3.1 cursor pagination).
 *
 * 契约只给了 `phase` 一个参数，且它是两区切分而不是自由筛选：这个集合**不搜索、不筛选**
 * （§4 规则 21 原话）。不要在这里发明第二个参数去抹平原型的两个「更多」链接。
 */
async function listTrainings({ phase, cursor, limit } = {}) {
  const page = await api.getPage(TRAINING_PATH, { cursor, limit, phase });
  return { items: page.items.map(decorateCard), nextCursor: page.nextCursor };
}

/** 材料的一行。 */
function toFileRow(ref) {
  return {
    file_id: ref.file_id,
    file_name: ref.file_name,
    usage_label: USAGE_LABEL[ref.usage_key] || '附件',
  };
}

/**
 * One 研修, whole.
 *
 * §2.3: a training outside the caller's scope comes back as 404, identical to
 * one that never existed. This module passes that through untouched.
 *
 * s5 的壳由**服务端**做：它不返回材料与会议入口。这里不再自己清一遍 —— 清第二遍就意味着
 * 「壳里有什么」这条规则在两处各记一次，而客户端那一份永远慢一步。这里只做一件服务端做
 * 不了的事：把「为什么这一页什么材料也没有」说成一句中文。
 */
async function trainingDetail(trainingId) {
  const row = await api.get(`${TRAINING_PATH}/${trainingId}`);
  const withdrawn = row.training_status === 's5';
  const meeting = row.meeting_url
    ? { title: row.meeting_link_title || '线上会议', url: row.meeting_url }
    : null;
  return {
    training_id: row.training_id,
    training_title: row.training_title,
    // 开始与结束各占一行。拼成一行要判断是否同一天，那就是在时间上做算术，§1.2 不允许。
    start_label: time.formatLong(row.start_at),
    // end_at 可空（F9）。空串让页面按空串开合，不渲染一个空盒子。
    end_label: row.end_at ? time.formatLong(row.end_at) : '',
    location_label: row.location || '',
    speaker_label: row.speaker ? `主讲：${row.speaker}` : '',
    phase_label: TRAINING_PHASE[row.training_phase] || '未知阶段',
    phase_pill: PHASE_PILL[row.training_phase] || 'hl-pill--unknown',
    // s1 不挂徽章：列表的可见范围恒为 s1，它是常态，挂上去只是在重复「一切正常」。
    status_label: row.training_status === 's1' ? '' : (TRAINING_STATUS[row.training_status] || '未知状态'),
    status_pill: row.training_status === 's5' ? 'hl-pill--danger' : 'hl-pill--unknown',
    // 研修通知的正文。
    training_content: row.training_content || '',
    // 撤回后这一页是壳。不说这一句，教师只看到一场没有任何材料的研修。
    withdrawn_notice: withdrawn ? '这场研修已撤回，不再提供研修材料与会议入口。' : '',
    // 线上会议入口。契约：只供复制到浏览器或会议 App，**不内嵌外站**（F9）。
    meeting,
    // 研修材料全部可选，不强制 main_file（F9）：一份也没有的研修照常显示。
    materials: (row.file_refs || []).map(toFileRow),
    // 反馈入口的判定要的三样，原样带出去（票据 16）。判定本身在 feedbackEntry()。
    training_status: row.training_status,
    training_phase: row.training_phase,
    my_participation_status: row.my_participation_status || null,
    feedback_count: row.feedback_count || 0,
  };
}

function extensionOf(fileName) {
  const dot = String(fileName || '').lastIndexOf('.');
  return dot < 0 ? '' : String(fileName).slice(dot + 1).toLowerCase();
}

/**
 * 打不开就说一句中文，绝不留白。四条失败路径共用一个出口。
 *
 * 带得出追踪号的才带：格式不被支持是本机判定的，一个请求也没发过，编一个故障码只会让
 * 教师报上来一串对不上任何日志的数字。
 */
function sayCannotOpen(text, requestId) {
  wx.showToast({ title: requestId ? `${text}（故障码 ${requestId}）` : text, icon: 'none' });
}

/**
 * 打开一份研修材料。
 *
 * §8.4：读取形状里没有可直接访问的地址，每一次取档都要现签一个短时 URL，服务端借这次
 * 调用重跑一遍授权，`owner_object` 是第一个授权参数。所以这里不缓存 URL，也不把它交给
 * 页面。
 *
 * 这段与 services/coordination.js 的 openFile 逐行相同，只有 `owner_object` 不同。
 * 没有抽成公用件，是因为本票只改必须改的行；第三处出现时应当抽到 utils，已记进交接。
 */
async function openMaterial(trainingId, file) {
  const ext = extensionOf(file.file_name);
  const isImage = IMAGE_EXT.indexOf(ext) !== -1;
  if (!isImage && DOCUMENT_EXT.indexOf(ext) === -1) {
    // 微信打不开这种格式。先说清楚，不必白跑一次签名。
    sayCannotOpen('这种格式的研修材料无法在手机上打开，请到电脑上查看');
    return;
  }

  let signed;
  try {
    signed = await api.get(`/media/files/${file.file_id}/url`, {
      query: { owner_object: FILE_OWNER, owner_id: trainingId },
    });
  } catch (err) {
    // 会话失效是门的决定，不是一句提示。
    if (guard.endSessionOnAuthFailure(err)) return;
    const failure = present(err);
    sayCannotOpen(failure.message, failure.requestId);
    return;
  }

  if (isImage) {
    wx.previewImage({
      urls: [signed.url],
      fail: () => sayCannotOpen('图片打开失败，请稍后再试'),
    });
    return;
  }

  wx.downloadFile({
    url: signed.url,
    success: (res) => {
      if (res.statusCode !== 200) {
        sayCannotOpen('研修材料下载失败，请稍后再试');
        return;
      }
      wx.openDocument({
        filePath: res.tempFilePath,
        fileType: ext,
        fail: () => sayCannotOpen('研修材料打开失败，请到电脑上查看'),
      });
    },
    fail: () => sayCannotOpen('研修材料下载失败，请检查网络后再试'),
  });
}

/**
 * 复制线上会议链接。
 *
 * F9：`meeting_url` 只供复制到浏览器或会议 App，**不内嵌外站**。所以复制就是全部的交互，
 * 页面旁边也把这句话说出来。反馈留在服务里，与 `party.copyVideoLink` 同理：一种措辞，
 * 一个地方。
 */
function copyMeetingLink(url) {
  if (!url) return;
  wx.setClipboardData({
    data: url,
    success: () => wx.showToast({ title: '链接已复制，请到浏览器或会议 App 打开', icon: 'none' }),
  });
}

/**
 * 办园理念与课程体系的图文。
 *
 * 这条路径**不在契约里**，见本文件头注的契约缺口一段。返回的形状由本地契约服务定义，
 * 接真服务时必须重对。
 */
async function courseIntro() {
  const doc = await api.get(COURSE_INTRO_PATH);
  return {
    intro_title: doc.intro_title || '',
    intro_summary: doc.intro_summary || '',
    intro_lead: doc.intro_lead || '',
    sections: (doc.sections || []).map((section) => ({
      section_key: section.section_key,
      section_title: section.section_title,
      section_body: section.section_body || '',
      items: (section.items || []).map((item) => ({
        item_title: item.item_title,
        item_body: item.item_body || '',
      })),
    })),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 入口页的聚合读取（2026-08-26 按原型重建）
// ══════════════════════════════════════════════════════════════════════════
//
// 原型 training-center.html 的入口页有三块动态内容：顶部推荐轮播、推荐资源、推荐
// 案例。它们同出一张管理员维护的推荐表（`db_training_recommendation`，spec 04），
// **不是按这位教师算出来的** —— 没有画像、没有排序信号（ADR-0011／DO-NOT-BUILD 6）。
//
// 三块一次读回，与党建入口页同一条理由：三个请求各自失败会让页面半亮半灭。
//
// 枚举表借自资源库与案例库：`resource_tag` 与 `case_field`／`case_grade` 是那两个
// 模块的列，同一份映射服务两处，这里不抄第二份。

const library = require('./library');
const kase = require('./case');

/** 一条推荐 -> 一张轮播卡。资源与案例的列不重名，所以按 `content_type` 分支即可。 */
function decorateFeatured(row) {
  const isResource = row.content_type === 'c1';
  const kind = isResource ? '推荐资源' : '推荐案例';
  const facet = isResource
    ? (library.RESOURCE_TAG[row.resource_tag] || '')
    : (kase.CASE_FIELD[row.case_field] || '');
  return {
    content_type: row.content_type,
    // 去向要带的那个 id。两种卡片进的是两个详情页，所以 id 与类型一起走。
    target_id: isResource ? row.resource_id : row.case_id,
    // 原型的 `.banner-kicker`：「推荐资源 · 社会」。未知编码只丢掉后半截，不丢整张卡。
    kicker: facet ? `${kind} · ${facet}` : kind,
    title: isResource ? row.resource_name : row.case_name,
    excerpt: (isResource ? row.resource_explain : row.case_intro) || '',
  };
}

/**
 * 一条推荐 -> 一张推荐资源行卡（原型 `.resource-card`）。
 *
 * 与资源列表页那张卡**不是同一个形状**：这里多一枚领域徽章、少一枚状态徽章。推荐位
 * 上的内容按 spec 恒为已通过（s3），状态徽章会是一个恒定值，而恒定值不是信息。
 */
function decorateResourceCard(row) {
  const tag = library.RESOURCE_TAG[row.resource_tag] || '';
  const grade = (row.grade || []).map((g) => kase.CASE_GRADE[g]).filter(Boolean).join('｜');
  return {
    resource_id: row.resource_id,
    name: row.resource_name,
    thumb_label: tag || '资',
    badge: tag || '资源',
    meta: [library.RESOURCE_TYPE[row.resource_type] || '资料', grade].filter(Boolean).join(' · '),
    excerpt: row.resource_explain || '',
  };
}

/** 一条推荐 -> 一张推荐案例行卡。徽章是年级，与资源那张的领域徽章位置相同。 */
function decorateCaseCard(row) {
  const field = kase.CASE_FIELD[row.case_field] || '';
  const areas = (row.case_area || []).map((a) => kase.CASE_AREA[a]).filter(Boolean).join(' · ');
  return {
    case_id: row.case_id,
    name: row.case_name,
    thumb_label: field ? field.charAt(0) : '案',
    badge: kase.CASE_GRADE[row.case_grade] || '案例',
    meta: [field, areas].filter(Boolean).join(' · '),
    excerpt: row.case_intro || '',
  };
}

/**
 * 入口页的三张快捷入口卡 —— 原型 training-center.html 的 `.entry-grid`，三张，一行。
 *
 * **只有三张，与原型逐字一致。** 五大领域量表与评价五维图此前也挂在这一页；园方
 * 2026-08-26 裁定以原型为准，两者因此换了门：量表从首页「质量评估」卡进（那条已经
 * 接通），五维图改成量表页内的入口。结构契约的可达声明随之更新。
 *
 * `module` 按**目的地**的模块查，不是出发地：课程资源属资源库，合作园的模块清单里
 * 只有资源库与案例库，所以这一条对合作园开、另两条对合作园关。
 */
const QUICK_ENTRIES = [
  { key: 'course', mark: '建', label: '课程建设', desc: '课程体系沉淀', tint: 'accent', module: 'teaching-research', page: '/packages/training/pages/course/detail' },
  { key: 'resource', mark: '资', label: '课程资源', desc: '资源库、案例库', tint: 'blue', module: 'resource-library', page: '/packages/library/pages/home/index' },
  { key: 'train', mark: '训', label: '教研培训', desc: '研修与反馈', tint: 'green', module: 'teaching-research', page: '/packages/training/pages/train/list' },
];

/** 三张快捷入口卡，ready to bind。 */
function quickEntries() {
  return QUICK_ENTRIES.map((entry) => ({
    key: entry.key,
    mark: entry.mark,
    label: entry.label,
    desc: entry.desc,
    tint: entry.tint,
  }));
}

/** 点一张快捷入口卡。门按目的地的模块查，拒绝要出声。 */
function openQuickEntry(key) {
  const entry = QUICK_ENTRIES.find((q) => q.key === key);
  if (!entry) return false;
  return guard.navigateTo(entry.page, entry.module);
}

/**
 * 入口页的一次聚合读取 —— 一个请求，三块内容。
 *
 * 这条路径**不在契约里**，见本文件头注的契约缺口一段。
 *
 * 三块都可能为空（园所刚开张时推荐表是空的），所以每一块都按空数组兜底，页面用长度
 * 分空态：spec 的空态规则是「顶部推荐为空则整块不画，两个列表为空则各说一句」。
 */
async function trainingHome() {
  const home = await api.get(HOME_PATH);
  return {
    featured: (home.featured || []).map(decorateFeatured),
    resources: (home.resource_list || []).map(decorateResourceCard),
    cases: (home.case_list || []).map(decorateCaseCard),
  };
}

/** 轮播卡的去向：资源进资源详情，案例进案例详情。两个去向都由资源库模块说了算。 */
function openFeatured(contentType, targetId) {
  if (contentType === 'c1') {
    library.openResource(targetId);
    return;
  }
  library.openCase(targetId);
}

// ══════════════════════════════════════════════════════════════════════════
// 研修反馈（票据 16）
// ══════════════════════════════════════════════════════════════════════════
//
// 契约的 `submitTrainingFeedback` scope 逐字：
//   `WHERE training_id=$1 AND teacher_id=$ctx_teacher
//    AND participation_status='s3' AND $now > effective_end_at`
//
// 也就是**参加过、且研修已经结束**才能提交。票据正文那句「研修已结束时反馈入口渲染为只读」
// 与契约刚好相反 —— 已结束是提交的前置条件，不是阻断条件。按契约实现，这条冲突记进交接。
//
// F9（Q58-ap1）：**不保存服务端草稿**（已删 s1=draft），按提交直接建 s2 待审核；
// `UNIQUE(training_id, teacher_id)` 一人一场一份；提交后正文永久冻结，**作者不可撤回、
// 不可查询状态、不可查看驳回理由**。所以：
//   - 本模块没有撤回端点。教师端 `04 training-center-spec.md` 的 `feedback_withdraw`
//     已过期（契约 §14 冲突 1），不要照它建一个。
//   - 提交回执 `TrainingFeedbackOwn` 只有三个字段，**刻意不含 `feedback_status`**，
//     也没有对应的 GET。「已提交」这个状态因此只在提交成功的那一次会话里成立；
//     教师退出再进来，客户端无从知道自己交过 —— 这是契约缺口，记进交接。
//   - 附件一概不接（`db_file_ref` 不收），所以这条写入只携带教职工文字一类内容。

const FEEDBACK_TEXT_MAX = 1000;

// api/action-registry.tsv 的 action_key。
const ACTION_FEEDBACK_SUBMIT = 'training_feedback.submit';

/**
 * 反馈入口该是什么样子，以及为什么。
 *
 * **返回一个理由，不返回真假。** 五种关闭情形各有各的话要说，教师要知道自己为什么不能
 * 提交，而不只是不能。渲染成一行说明，不做成一个会当面拒绝他的按钮（票据 16 验收项 6）。
 *
 * 顺序是有意的：先答「还没结束」再答「你没参加」。`participation_status` 只在到达有效结束
 * 时间时才由 s1 自动转 s3，所以一场没结束的研修上，报了名的教师也还是 s1；反过来问，他会
 * 被告知「你没参加」——那句话是错的，他明明报了名。
 *
 * 「已结束」读的是服务端派生的 `training_phase`，不是自己拿时间去比 —— 客户端不做时间
 * 算术（§1.2 / DO-NOT-BUILD 9）。
 */
function feedbackEntry({ train, canWrite, submitted }) {
  if (submitted) {
    return { open: false, submitted: true, reason: '反馈已提交，内容已锁定，不能再修改。' };
  }
  if (!train) return { open: false, submitted: false, reason: '' };
  if (train.training_status === 's5') {
    return { open: false, submitted: false, reason: '这场研修已撤回，不再接收反馈。' };
  }
  if (train.training_phase !== 'history') {
    return { open: false, submitted: false, reason: '研修还没有结束，结束后可以在这里提交反馈。' };
  }
  if (train.my_participation_status !== 's3') {
    return { open: false, submitted: false, reason: '只有参加过这场研修的教师可以提交反馈。' };
  }
  if (!canWrite) {
    return { open: false, submitted: false, reason: '假期中暂不可提交，新学期开始后恢复。' };
  }
  return { open: true, submitted: false, reason: '' };
}

/** 反馈是否超长。页面用它就地拦，服务端仍会独立复验（§6.4）。 */
function feedbackTooLong(text) {
  return typeof text === 'string' && text.trim().length > FEEDBACK_TEXT_MAX;
}

/**
 * 按契约的 `TrainingFeedbackWrite` 重建请求体。
 *
 * 白名单而非黑名单：schema 是 `additionalProperties: false` 且只有 `feedback_text`，
 * 所以「只有这一个键」是契约形状本身，不是防御性代码。顺带的效果是
 * `teacher_id`／`school_id`／`training_id` 与 `submitted_at`／`published_at` 在客户端就
 * 不存在于请求体里，而不是靠 `utils/derived` 事后剥（DO-NOT-BUILD 8／9，§7.3.1／§1.2）。
 * 两道都在，先后不重要，缺一才重要。
 */
function buildFeedbackBody(draft) {
  const text = (draft && typeof draft.feedback_text === 'string') ? draft.feedback_text.trim() : '';
  return { feedback_text: text };
}

/**
 * 一次逻辑提交的幂等键。教师确认发布的那一刻生成一次，之后每次重发复用它（§4.2）。
 * 每次重发换新键，重复点击就会变成两条反馈 —— 而 `UNIQUE(training_id, teacher_id)`
 * 会把第二条挡成 409，教师看到的是一句莫名其妙的「你已经提交过」。
 */
function newAttemptKey() {
  return api.uuid();
}

/**
 * 提交研修反馈（NONE -> s2 待审核）。
 *
 * @param {object}   o
 * @param {number}   o.trainingId
 * @param {string[]} o.gates            把关路径，**必填、无默认值**。页面显式声明。
 * @param {object}   o.draft            教师填的草稿；只有白名单内的字段会被发出
 * @param {boolean}  o.previewedInFull  教师读完了最终内容（不是打开过预览）
 * @param {boolean}  o.confirmed        另一次独立的确认发布动作
 * @param {string}   o.idempotencyKey   一次逻辑提交一个，重发复用
 */
async function submitFeedback({ trainingId, gates, draft, previewedInFull, confirmed, idempotencyKey }) {
  // 闸门在这里，不在页面里，也不在服务端之后：拒绝必须发生在网络出口之前。
  moderation.assertGate(gates, {
    previewedInFull,
    confirmed,
    what: '研修反馈',
    // F9：附件一概不接，所以这次写入不携带图片。写成常量而不是省略，是为了让将来
    // 想加图片的那个人改这一行时看得见 assertGate 的另一半。
    imageCount: 0,
  });

  return api.post(`${TRAINING_PATH}/${trainingId}/feedback`, {
    action: ACTION_FEEDBACK_SUBMIT,
    idempotencyKey,
    body: buildFeedbackBody(draft),
  });
}

/**
 * 公开回馈流：只有 `feedback_status='s3'`，且活动仍 `training_status='s1'`。
 *
 * 「回馈就是评论」—— 契约不建第二套评论／回覆实体。真名公开，姓名由服务端从 `teacher_id`
 * 即时读，不另存快照（F9），所以这里照收照显。
 *
 * 教师自己刚提交的那一条是 s2 待审核，**按契约不在这个流里**，也没有任何端点查得到它。
 */
async function listFeedback(trainingId, { cursor, limit } = {}) {
  const page = await api.getPage(`${TRAINING_PATH}/${trainingId}/feedback`, { cursor, limit });
  return {
    items: page.items.map((row) => ({
      feedback_id: row.feedback_id,
      teacher_name: row.teacher_name,
      feedback_text: row.feedback_text,
      // §1.2：偏移量是字面量。formatShort 只读写好的部分，不做算术。
      time_label: row.published_at ? time.formatShort(row.published_at) : '',
    })),
    nextCursor: page.nextCursor,
  };
}

module.exports = {
  TRAINING_STATUS,
  TRAINING_PHASE,
  FEEDBACK_TEXT_MAX,
  phaseFilters,
  listTrainings,
  trainingDetail,
  openMaterial,
  copyMeetingLink,
  courseIntro,
  trainingHome,
  openFeatured,
  quickEntries,
  openQuickEntry,
  feedbackEntry,
  feedbackTooLong,
  buildFeedbackBody,
  newAttemptKey,
  submitFeedback,
  listFeedback,
};
