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
 * Read-only. 报名、取消报名与研修反馈是票据 16 与 18 的事，本文件不写任何东西，
 * 也不读 `my_participation_status` 与 `feedback_count` —— 一个没有报名入口的页面上显示
 * 「已报名」，教师看得到却改不了，比不显示更糟。
 *
 * Everything returned is view-ready (spec 实现决定 7): a page binds it and
 * formats nothing.
 */

const api = require('../utils/request');
const time = require('../utils/time');
const guard = require('../utils/guard');
const { present } = require('../utils/present');

const TRAINING_PATH = '/trainings';
// 契约里没有这条路径（见头注）。名字刻意不写成 `/trainings/...`：那会看起来像契约的一部分。
const COURSE_INTRO_PATH = '/training/course-intro';

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

module.exports = {
  TRAINING_STATUS,
  TRAINING_PHASE,
  phaseFilters,
  listTrainings,
  trainingDetail,
  openMaterial,
  copyMeetingLink,
  courseIntro,
};
