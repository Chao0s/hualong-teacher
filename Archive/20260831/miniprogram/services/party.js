/**
 * 党建管理服务 — the party module's reads (ticket 12).
 *
 * Boundary: the 党建管理 module, and it is also the subpackage boundary. The
 * pages in `packages/party` read this file and no other service module — one
 * subpackage, one service module, which is what ticket 12 asks the build check
 * to enforce. 学习资料, 活动 and 品牌建设 all live HERE, not in three files
 * beside each other.
 *
 * Read-only. Publishing 党建 content is an administrator's job on another
 * surface entirely, so nothing here writes and no page this service feeds
 * carries an upload, create or edit control.
 *
 * Everything returned is view-ready (spec 实现决定 7): a page binds it and
 * formats nothing.
 */

const api = require('../utils/request');
const time = require('../utils/time');
const guard = require('../utils/guard');
const { present } = require('../utils/present');

const HOME_PATH = '/party/home';
const STUDY_PATH = '/party/studies';
const ACTIVITY_PATH = '/party/activities';
const BRAND_PATH = '/party/brands';

// 三个集合的状态列（`study_status`／`activity_status`／`brand_status`）共用一个值域，
// 而三条列表端点的可见范围都是 `s3`，详情端点也只在 `s3` 时返回（契约 x-hualong-scope）。
// 教师因此永远只看得到 s3，状态文案会是一个恒定值，而恒定值不是信息。所以这三个页族
// 一律不读状态列。这同时是对未知编码最强的容忍（§1.1）：读都不读，就无从把原值抬上界面。

// db_party_study.study_type. 契约 §4 规则 19／F7: this is SHOWN, never a filter —
// the endpoint does not accept it, so no page may offer 按类型筛选.
const STUDY_TYPE_LABEL = { t1: '政策文件', t2: '学习材料', t3: '制度文件' };

// §1.1 lets the server ship a type code before this build knows it. A neutral
// word keeps the row on screen; leaving it blank would read as a broken card.
const STUDY_TYPE_FALLBACK = '资料';

// db_file_ref.usage_key — 本模块只用这三个（F7）。
const USAGE_LABEL = { main_file: '主文件', inline_media: '配图', download: '附件' };

// db_file_ref.owner_object —— 取档要按这张业务表重跑一次授权（§8.4）。
const STUDY_FILE_OWNER = 'db_party_study';
const ACTIVITY_FILE_OWNER = 'db_party_activity';
const BRAND_FILE_OWNER = 'db_party_brand';

// wx.openDocument 认得的扩展名。清单是微信平台定的，不是我们定的；不在表里的
// 附件在手机上打不开，要当场说清楚。学习资料的主文件是文档，不是图片，所以这里
// 没有 综合协调 那份图片清单。
const DOCUMENT_EXT = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf'];

// 入口页卡片首格的那个词。它们是**固定词，不是列**：党建活动与品牌建设都没有类型
// 列（F7 连活动的主办部门与参与对象都拔了），原型这一格写死了这两个词。照抄原型，
// 但记在这里，免得下一个人去数据库里找它们。
const ACTIVITY_KIND_WORD = '活动介绍';
const BRAND_KIND_WORD = '主题图文';

// 轮播卡片副标题的后半句，原型 school-affairs.html 的 `.banner-sub` 原话。
const SLIDE_HINT = '点击查看最近发布的学习文件';

/**
 * 附件的一行，三个详情页共用。
 *
 * §8.4：读取形状里没有可直接访问的地址，取档要另走 `GET /media/files/{file_id}/url`。
 * 本票不建那条路径，所以这里只给名字与用途，页面照实列出来，不假装能打开。
 */
function toFileRow(ref) {
  return {
    file_id: ref.file_id,
    file_name: ref.file_name,
    usage_key: ref.usage_key,
    usage_label: USAGE_LABEL[ref.usage_key] || '附件',
    size_label: formatSize(ref.file_size),
  };
}

/** 字节数变成教师读得懂的一句。只作显示用。 */
function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 把 `inline_media` 附件签成可以直接绑到 `<image src>` 的地址。
 *
 * 原型的「活动现场图」「图文素材」画廊就是这些附件（园方 2026-08-27 裁定：图片区照画）。
 * **一张图一次签名** —— 契约 §8.4 不回可直接访问的地址，每次取档都重跑授权、短时签名、
 * `Cache-Control: no-store`，所以没有批量端点可用，也不能缓存。
 *
 * 签不出来的那一张**就不画**：一个裂图比少一张图更难看懂。整组都签不出来时这一节自己
 * 消失，不留一个空画廊。
 */
async function signInlineMedia(refs, ownerObject, ownerId) {
  const media = (refs || []).filter((r) => r.usage_key === 'inline_media');
  const signed = await Promise.all(media.map(async (ref) => {
    try {
      const res = await api.get(`/media/files/${ref.file_id}/url`, {
        query: { owner_object: ownerObject, owner_id: ownerId },
      });
      return { file_id: ref.file_id, file_name: ref.file_name, url: res.url };
    } catch (err) {
      return null;
    }
  }));
  return signed.filter(Boolean);
}

/** The list-row shape. */
function decorateStudyRow(study) {
  return {
    study_id: study.study_id,
    study_title: study.study_title,
    type_label: STUDY_TYPE_LABEL[study.study_type] || STUDY_TYPE_FALLBACK,
    // §1.2: the offset is a literal. formatShort reads the written parts and
    // never builds a Date, so a 09:30 stays 09:30 on any device.
    published_label: time.formatShort(study.published_at),
    department_label: study.publisher_department || '',
    // Derived server-side from the first 100 characters of study_content; there
    // is no summary column (F7). Nothing here re-derives it.
    excerpt: study.excerpt || '',
  };
}

/**
 * One page of 学习资料, newest first (§3.1 cursor pagination).
 *
 * Shaped for `createListMethods` — call it with no argument for the first page
 * and with the previous `nextCursor` for each append. The pagination pair is the
 * whole query: this collection is neither searched nor filtered.
 */
async function listStudies({ cursor, limit } = {}) {
  const page = await api.getPage(STUDY_PATH, { cursor, limit });
  return { items: page.items.map(decorateStudyRow), nextCursor: page.nextCursor };
}

/**
 * One 学习资料, whole.
 *
 * §2.3: a study outside the caller's scope comes back as 404, identical to one
 * that never existed. This module passes that through untouched.
 */
async function studyDetail(studyId) {
  const study = await api.get(`${STUDY_PATH}/${studyId}`);
  return {
    study_id: study.study_id,
    study_title: study.study_title,
    type_label: STUDY_TYPE_LABEL[study.study_type] || STUDY_TYPE_FALLBACK,
    published_label: time.formatLong(study.published_at),
    department_label: study.publisher_department || '',
    study_content: study.study_content || '',
    // The column is nullable, so an absent list arrives as null, not as [].
    video_links: (study.video_links || []).map((v) => ({ title: v.title, url: v.url })),
    files: (study.file_refs || []).map(toFileRow),
    // 原型 `.meta` 的第三格：主文件的格式与体积（「PDF · 2.4MB」）。
    main_file_label: mainFileLabel(study.file_refs),
  };
}

/** 主文件的「格式 · 体积」。没有主文件就是空串，那一格不画。 */
function mainFileLabel(refs) {
  const main = (refs || []).find((r) => r.usage_key === 'main_file');
  if (!main) return '';
  const ext = extensionOf(main.file_name).toUpperCase();
  const size = formatSize(main.file_size);
  return [ext, size].filter(Boolean).join(' · ');
}

/**
 * 活动的一行。
 *
 * 契约的活动列表回的是完整 `PartyActivity`，没有另立卡片形状，所以正文也在这一页里。
 * 列表不绑定正文：原型的活动列表给的是时间与地点，正文进详情页。
 */
function decorateActivityRow(activity) {
  return {
    activity_id: activity.activity_id,
    activity_title: activity.activity_title,
    // §1.2：偏移量是字面量。formatShort 只读写好的部分，15:00 在任何设备上都是 15:00。
    time_label: time.formatShort(activity.activity_at),
    // 可空列，缺席的地点变成空串，页面按空串开合，不渲染一个空盒子。
    location_label: activity.activity_location || '',
  };
}

/** One page of 党建活动, newest first (§3.1). This collection is neither searched nor filtered. */
async function listActivities({ cursor, limit } = {}) {
  const page = await api.getPage(ACTIVITY_PATH, { cursor, limit });
  return { items: page.items.map(decorateActivityRow), nextCursor: page.nextCursor };
}

/** One 党建活动, whole. §2.3: out of scope reads as 404, same as absent. */
async function activityDetail(activityId) {
  const activity = await api.get(`${ACTIVITY_PATH}/${activityId}`);
  return {
    activity_id: activity.activity_id,
    activity_title: activity.activity_title,
    time_label: time.formatLong(activity.activity_at),
    location_label: activity.activity_location || '',
    activity_content: activity.activity_content || '',
    // 原型「附件下载」那一节：只列可下载的档，图片归上面的图文区。
    files: (activity.file_refs || [])
      .filter((r) => r.usage_key !== 'inline_media')
      .map(toFileRow),
    // 原型 `.article-photos`：正文下面的现场图。
    photos: await signInlineMedia(activity.file_refs, ACTIVITY_FILE_OWNER, activityId),
  };
}

/** 品牌建设的一行。业务日期是 `published_at`，不是活动那一列。 */
function decorateBrandRow(brand) {
  return {
    brand_id: brand.brand_id,
    brand_title: brand.brand_title,
    published_label: time.formatShort(brand.published_at),
    // `brand_tag` 是可空数组。列表排成一行，所以在这里拼好，页面不再 join。
    tag_label: (brand.brand_tag || []).join(' · '),
  };
}

/** One page of 品牌建设资料, newest first (§3.1). */
async function listBrands({ cursor, limit } = {}) {
  const page = await api.getPage(BRAND_PATH, { cursor, limit });
  return { items: page.items.map(decorateBrandRow), nextCursor: page.nextCursor };
}

/** One 品牌建设资料, whole. */
async function brandDetail(brandId) {
  const brand = await api.get(`${BRAND_PATH}/${brandId}`);
  return {
    brand_id: brand.brand_id,
    brand_title: brand.brand_title,
    published_label: time.formatLong(brand.published_at),
    // 详情把标签排成一排，所以这里给数组；列表给拼好的那一行。
    tags: brand.brand_tag || [],
    brand_content: brand.brand_content || '',
    // 原型 `.gallery`：四格图文素材。品牌详情**没有附件区** —— 原型没画，本端不画
    // （园方 2026-08-27 裁定）。每条品牌带的那份「课程包.pdf」因此在这一页拿不到，
    // 缺口记在票据 27，等园方决定改原型还是改数据。
    photos: await signInlineMedia(brand.file_refs, BRAND_FILE_OWNER, brandId),
  };
}

// ── 入口页（PartyHome）───────────────────────────────────────────────────────

/** 轮播的一张。副标题在这里拼好，页面只绑一个字符串。 */
function decorateSlide(study) {
  const typeLabel = STUDY_TYPE_LABEL[study.study_type] || STUDY_TYPE_FALLBACK;
  return {
    study_id: study.study_id,
    study_title: study.study_title,
    sub_label: `${typeLabel} · ${time.formatDay(study.published_at)} · ${SLIDE_HINT}`,
  };
}

/**
 * 入口页的一张学习资料卡。
 *
 * 与列表行的差别只有两处，两处都来自原型：这里的日期不带钟点，而且不给摘要 ——
 * 入口页一张卡只有一行 meta，摘要放不下。
 */
function decorateStudyBrief(study) {
  return {
    study_id: study.study_id,
    study_title: study.study_title,
    type_label: STUDY_TYPE_LABEL[study.study_type] || STUDY_TYPE_FALLBACK,
    day_label: time.formatDay(study.published_at),
    department_label: study.publisher_department || '',
  };
}

/** 入口页的一张活动卡。业务日期是 `activity_at`，不是 `published_at`。 */
function decorateActivityBrief(activity) {
  return {
    activity_id: activity.activity_id,
    activity_title: activity.activity_title,
    kind_label: ACTIVITY_KIND_WORD,
    day_label: time.formatDay(activity.activity_at),
    // 可空列。空串让页面按空串开合，不渲染一个空盒子。
    location_label: activity.activity_location || '',
  };
}

/** 入口页的一张品牌建设卡。原型这一行是「主题图文 ＋ 两个标签」。 */
function decorateBrandBrief(brand) {
  return {
    brand_id: brand.brand_id,
    brand_title: brand.brand_title,
    kind_label: BRAND_KIND_WORD,
    // `brand_tag` 可空。原型一行只放得下两个标签，多的截掉，页面不再截。
    tags: (brand.brand_tag || []).slice(0, 2),
  };
}

/**
 * 入口页的一次聚合读取 —— 一个请求，四个分区。
 *
 * §4 规则 19：`carousel` 是**派生结果**，不是可管理的推荐清单。服务端查本园
 * `study_status='s3'`，按 `published_at DESC, study_id DESC` 取 3，不足就回实际
 * 笔数 —— 所以客户端既不排序也不补位，回几条就画几条。F7 拔掉的是
 * `db_party_feature` 那张挑选表，不是轮播本身。
 *
 * 四个数组都可能缺席或为空（园所刚开张时三类都是空的），所以每一个都按空数组兜底：
 * 页面用长度分空态，不用 undefined 分。
 */
async function partyHome() {
  const home = await api.get(HOME_PATH);
  return {
    carousel: (home.carousel || []).map(decorateSlide),
    studies: (home.latest_studies || []).map(decorateStudyBrief),
    activities: (home.latest_activities || []).map(decorateActivityBrief),
    brands: (home.latest_brands || []).map(decorateBrandBrief),
  };
}

function extensionOf(fileName) {
  const dot = String(fileName || '').lastIndexOf('.');
  return dot < 0 ? '' : String(fileName).slice(dot + 1).toLowerCase();
}

/** 打不开就说一句中文，绝不留白。几条失败路径共用一个出口。 */
function sayCannotOpen(text) {
  wx.showToast({ title: text, icon: 'none' });
}

/**
 * 打开一份学习资料的主文件。原型那张卡上的「预览」与「下载」都走这里。
 *
 * ── 两个按钮，一条契约能力 ──────────────────────────────────────────────────
 *
 * 登记表里 `/party/studies/{study_id}` **只有 view，没有 download-link**（那是资源
 * 库与案例库才有的）。党建学习唯一的取档能力是 `GET /media/files/{file_id}/url`，
 * 签发一条不超过 5 分钟的读取 URL。所以「预览」与「下载」调的是**同一个端点**，
 * 差别只在拿到文件之后：预览直接打开，下载多开右上角菜单，让教师转发或另存 ——
 * 微信小程序没有用户看得见的下载目录，那个菜单就是平台给的「存下来」。
 * 不要以为这里有两条路径可走。
 *
 * ── 为什么要先读一次详情 ────────────────────────────────────────────────────
 *
 * `PartyStudyCard`（入口页与列表拿到的形状）**没有 `file_refs`**，只有详情才有。
 * `file_id` 只能从详情里来，所以一次点击是两个请求：先详情拿 `file_id`，再签 URL。
 * 代价要说明白：详情读成功会写一笔 `db_content_access_event(viewed)`（§4 规则 19），
 * 于是入口页上按一次「预览」也会记一次浏览，即使教师没进详情页。
 *
 * §8.4：读取形状里没有可直接访问的地址，每一次取档都现签，服务端借这次调用重跑一遍
 * 授权。所以这里不缓存 URL，也不把它交给页面。
 *
 * @param {number} studyId
 * @param {boolean} save true 走「下载」，false 走「预览」。
 */
async function openStudyFile(studyId, save) {
  let study;
  try {
    // 详情端点，不是列表 —— 卡片形状里没有 file_refs。
    study = await api.get(`${STUDY_PATH}/${studyId}`);
  } catch (err) {
    if (guard.endSessionOnAuthFailure(err)) return;
    sayCannotOpen(present(err).message);
    return;
  }

  // 契约要求每份学习资料至少有一份 main_file（F7），但「要求」不是「保证」：
  // 少了它就说一句，不要让按钮变成一次无声的空转。
  const ref = (study.file_refs || []).find((r) => r.usage_key === 'main_file');
  if (!ref) {
    sayCannotOpen('这份学习资料还没有可打开的文件');
    return;
  }

  const ext = extensionOf(ref.file_name);
  if (DOCUMENT_EXT.indexOf(ext) === -1) {
    // 微信打不开这种格式。先说清楚，不必白跑一次签名。
    sayCannotOpen('这种格式的文件无法在手机上打开，请到电脑上查看');
    return;
  }

  let signed;
  try {
    signed = await api.get(`/media/files/${ref.file_id}/url`, {
      query: { owner_object: STUDY_FILE_OWNER, owner_id: studyId },
    });
  } catch (err) {
    // 会话失效是门的决定，不是一句提示。
    if (guard.endSessionOnAuthFailure(err)) return;
    sayCannotOpen(present(err).message);
    return;
  }

  wx.downloadFile({
    url: signed.url,
    success: (res) => {
      if (res.statusCode !== 200) {
        sayCannotOpen('文件下载失败，请稍后再试');
        return;
      }
      wx.openDocument({
        filePath: res.tempFilePath,
        fileType: ext,
        // 「下载」与「预览」在这里分手，也只在这里分手。
        showMenu: Boolean(save),
        success: () => {
          if (save) wx.showToast({ title: '可用右上角菜单转发或另存', icon: 'none' });
        },
        fail: () => sayCannotOpen('文件打开失败，请到电脑上查看'),
      });
    },
    fail: () => sayCannotOpen('文件下载失败，请检查网络后再试'),
  });
}

/**
 * 打开一份党建活动的附件（原型「附件下载」行末那一枚）。
 *
 * 与 `openStudyFile` 的差别只有两处：这里的档由调用方指名（活动可以挂不止一份），
 * 而且不必先读一次详情 —— 页面手上已经有 `file_refs` 了。§8.4 照旧：每次现签，
 * 不缓存地址。
 */
async function openActivityFile(activityId, file) {
  const ext = extensionOf(file.file_name);
  if (DOCUMENT_EXT.indexOf(ext) === -1) {
    sayCannotOpen('这种格式的文件无法在手机上打开，请到电脑上查看');
    return;
  }

  let signed;
  try {
    signed = await api.get(`/media/files/${file.file_id}/url`, {
      query: { owner_object: ACTIVITY_FILE_OWNER, owner_id: activityId },
    });
  } catch (err) {
    if (guard.endSessionOnAuthFailure(err)) return;
    sayCannotOpen(present(err).message);
    return;
  }

  wx.downloadFile({
    url: signed.url,
    success: (res) => {
      if (res.statusCode !== 200) {
        sayCannotOpen('文件下载失败，请稍后再试');
        return;
      }
      wx.openDocument({
        filePath: res.tempFilePath,
        fileType: ext,
        showMenu: true,
        fail: () => sayCannotOpen('文件打开失败，请到电脑上查看'),
      });
    },
    fail: () => sayCannotOpen('文件下载失败，请检查网络后再试'),
  });
}

/**
 * Copy an external video link.
 *
 * F7: these films live on other sites. They are not uploaded here and the Mini
 * Program does not play them inline, so copying is the whole interaction and the
 * page says so out loud next to the list.
 *
 * The feedback lives in the service for the same reason `reportFailure` and
 * `guard.navigateTo` do: one wording, one place, rather than a copy in each of
 * the pages that will offer this (ticket 08 template, unadopted item 1).
 */
function copyVideoLink(url) {
  if (!url) return;
  wx.setClipboardData({
    data: url,
    success: () => wx.showToast({ title: '链接已复制，请到浏览器打开', icon: 'none' }),
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 去向
// ══════════════════════════════════════════════════════════════════════════
//
// 入口页三个分区标题右侧的「全部 ›」。这三条原本住在 services/module-entry.js 里，
// 那是四个入口页共用同一种版面时的安排；四页各按自己的原型重建之后（2026-08-27），
// 那个文件的最后一个调用方就是这三条，于是搬回本模块，与其他三个服务模块自己持有
// 去向的做法一致（services/library.js 的 `DESTINATIONS`、services/co-education.js
// 的 `PAGES`）。

const MODULE_ID = 'party-building';
const SECTION_PAGES = {
  learn: '/packages/party/pages/learn/list',
  activity: '/packages/party/pages/activity/list',
  brand: '/packages/party/pages/brand/list',
};

/** 走一条去向，或者什么也不做（key 不认识只可能是调用方写错）。 */
function openSection(key) {
  const page = SECTION_PAGES[key];
  if (!page) return false;
  return guard.navigateTo(page, MODULE_ID);
}

module.exports = {
  partyHome,
  openSection,
  openStudyFile,
  openActivityFile,
  listStudies,
  studyDetail,
  listActivities,
  activityDetail,
  listBrands,
  brandDetail,
  copyVideoLink,
};
