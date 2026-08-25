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
    usage_label: USAGE_LABEL[ref.usage_key] || '附件',
  };
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
  };
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
    files: (activity.file_refs || []).map(toFileRow),
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
    files: (brand.file_refs || []).map(toFileRow),
  };
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

module.exports = {
  listStudies,
  studyDetail,
  listActivities,
  activityDetail,
  listBrands,
  brandDetail,
  copyVideoLink,
};
