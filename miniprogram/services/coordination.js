/**
 * 综合协调服务 — the coordination module's reads (ticket 12).
 *
 * Boundary: the 综合协调 module, and it is also the subpackage boundary. The
 * pages in `packages/coordination` read this file and no other service module —
 * one subpackage, one service module, the rule `npm run verify:build` enforces.
 * 行政资料, 后勤资料 and 人事资料 all live HERE.
 *
 * 状态列与可见范围，逐个确认的结论（票据 12 验收项）：三类**同一张表**。党建那边
 * 是三张表三条列表端点，这里只有 `db_coord_document` 与两条端点，三类的差别仅在
 * `coord_category` 的取值。所以：
 *   状态列    三类共用 `document_status`，值域只有 s1／s3／s5（F8）。
 *   可见范围  三类共用 `school_id = $ctx_school AND document_status = 's3'`
 *             （§4 规则 20），合作园不得进入。三者之间**没有**可见范围差异。
 * 教师因此永远只看得到 s3，状态文案会是一个恒定值，而恒定值不是信息。本模块因此
 * 一律不读状态列，与党建三类的处理相同。
 *
 * 七个类目对三个页面：端点的 `coord_category` 一次只收一个值，所以每页在页内再分
 * 一层类目标签，一个标签一个类目。这正是契约说的「分类页切换，不是自由筛选」。换
 * 标签＝换筛选集，`loadFirst` 会丢弃旧游标（§3.3）。
 *
 * Read-only. Publishing a coordination document is an administrator's job on
 * another surface entirely, so nothing here writes and no page this service
 * feeds carries an upload, create or edit control.
 *
 * Everything returned is view-ready (spec 实现决定 7): a page binds it and
 * formats nothing.
 */

const api = require('../utils/request');
const time = require('../utils/time');
const guard = require('../utils/guard');
const { present } = require('../utils/present');

const DOCUMENT_PATH = '/coordination/documents';

// db_coord_document.coord_category —— 七类固定，不提供自定义分类（F8）。
const CATEGORY_LABEL = {
  c1: '政策法规',
  c2: '通知文件',
  c3: '组织架构',
  c4: '安全管理',
  c5: '卫生保健',
  c6: '师德师风',
  c7: '跟岗交流',
};

// 三个页面各覆盖哪几类。这张表是本仓库唯一的一处声明：入口页的描述、页内标签与
// 首个标签的默认值都从这里来，改一处即可。
const GROUP_CATEGORIES = {
  xz: ['c1', 'c2', 'c3'],
  hq: ['c4', 'c5'],
  hr: ['c6', 'c7'],
};

// db_file_ref.owner_object —— 取档要按这张业务表重跑一次授权（§8.4）。
const FILE_OWNER = 'db_coord_document';

// db_file_ref.usage_key — 本模块只用这三个（F8）。
const USAGE_LABEL = { main_file: '主文件', inline_media: '配图', download: '附件' };

// wx.openDocument 认得的扩展名，以及 wx.previewImage 认得的那几种。清单是微信平台
// 定的，不是我们定的；不在这两张表里的附件在手机上打不开，要当场说清楚。
const DOCUMENT_EXT = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];

/** 页内类目标签，ready to bind。 */
function categoriesFor(groupKey) {
  const keys = GROUP_CATEGORIES[groupKey];
  if (!keys) throw new Error(`coordination: 未知分组 "${groupKey}"`);
  return keys.map((key) => ({ key, label: CATEGORY_LABEL[key] }));
}

/**
 * `2026-09-01` -> `2026年9月1日`。
 *
 * `effective_date` 是 LocalDate，没有时刻，time.js 的两个格式化都要时刻。这里照样
 * 只读写好的部分、不建 Date，理由与 §1.2 相同：建了 Date 就把设备时区放了进来。
 */
function formatDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!m) return '';
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

/** 附件的一行，三个详情页共用。 */
function toFileRow(ref) {
  return {
    file_id: ref.file_id,
    file_name: ref.file_name,
    usage_label: USAGE_LABEL[ref.usage_key] || '附件',
  };
}

/** The list-row shape. */
function decorateCard(doc) {
  return {
    document_id: doc.document_id,
    document_title: doc.document_title,
    // §1.2: the offset is a literal. formatShort reads the written parts and
    // never builds a Date, so a 09:30 stays 09:30 on any device.
    published_label: time.formatShort(doc.published_at),
    department_label: doc.publisher_department || '',
    // 只有 c1／c4／c5 可以有生效日期，其余类目必为 null（表约束 ck_cd_effective）。
    // 空串让页面按空串开合，不渲染一个空盒子——不必按类目分支。
    effective_label: formatDate(doc.effective_date),
    // Derived server-side from the first 100 characters of document_content;
    // there is no summary column (F8). Nothing here re-derives it.
    excerpt: doc.excerpt || '',
  };
}

/**
 * One page of 综合协调文件, newest first (§3.1 cursor pagination).
 *
 * `coord_category` 必填。服务层不预先校验它：值域由服务端判定，未知值回 400，页面
 * 照 §2.2 按 code 分支呈现。客户端先拦一道只会让两处规则各说各话。
 */
async function listDocuments({ coord_category: category, cursor, limit } = {}) {
  const page = await api.getPage(DOCUMENT_PATH, { cursor, limit, coord_category: category });
  return { items: page.items.map(decorateCard), nextCursor: page.nextCursor };
}

/**
 * One 综合协调文件, whole.
 *
 * §2.3: a document outside the caller's scope comes back as 404, identical to
 * one that never existed. This module passes that through untouched.
 */
async function documentDetail(documentId) {
  const doc = await api.get(`${DOCUMENT_PATH}/${documentId}`);
  return {
    document_id: doc.document_id,
    document_title: doc.document_title,
    category_label: CATEGORY_LABEL[doc.coord_category] || '资料',
    published_label: time.formatLong(doc.published_at),
    department_label: doc.publisher_department || '',
    effective_label: formatDate(doc.effective_date),
    document_content: doc.document_content || '',
    files: (doc.file_refs || []).map(toFileRow),
  };
}

function extensionOf(fileName) {
  const dot = String(fileName || '').lastIndexOf('.');
  return dot < 0 ? '' : String(fileName).slice(dot + 1).toLowerCase();
}

/** 打不开就说一句中文，绝不留白。三条失败路径共用一个出口。 */
function sayCannotOpen(text) {
  wx.showToast({ title: text, icon: 'none' });
}

/**
 * 打开一份附件。
 *
 * §8.4：读取形状里没有可直接访问的地址，每一次取档都要现签一个短时 URL，服务端借
 * 这次调用重跑一遍授权。所以这里不缓存 URL，也不把它交给页面。
 *
 * 反馈留在服务里，与 `guard.navigateTo` 和党建的 `copyVideoLink` 同理：一种措辞，
 * 一个地方，而不是三个详情页各抄一份（票据 08 样板评审第 1 条未采纳项的同一判断）。
 */
async function openFile(documentId, file) {
  const ext = extensionOf(file.file_name);
  const isImage = IMAGE_EXT.indexOf(ext) !== -1;
  if (!isImage && DOCUMENT_EXT.indexOf(ext) === -1) {
    // 微信打不开这种格式。先说清楚，不必白跑一次签名。
    sayCannotOpen('这种格式的附件无法在手机上打开，请到电脑上查看');
    return;
  }

  let signed;
  try {
    signed = await api.get(`/media/files/${file.file_id}/url`, {
      query: { owner_object: FILE_OWNER, owner_id: documentId },
    });
  } catch (err) {
    // 会话失效是门的决定，不是一句提示。
    if (guard.endSessionOnAuthFailure(err)) return;
    sayCannotOpen(present(err).message);
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
        sayCannotOpen('附件下载失败，请稍后再试');
        return;
      }
      wx.openDocument({
        filePath: res.tempFilePath,
        fileType: ext,
        fail: () => sayCannotOpen('附件打开失败，请到电脑上查看'),
      });
    },
    fail: () => sayCannotOpen('附件下载失败，请检查网络后再试'),
  });
}

module.exports = {
  CATEGORY_LABEL,
  GROUP_CATEGORIES,
  categoriesFor,
  listDocuments,
  documentDetail,
  openFile,
};
