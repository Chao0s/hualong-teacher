/**
 * 党建管理服务 — the party module's reads (ticket 12).
 *
 * Boundary: the 党建管理 module, and it is also the subpackage boundary. The
 * pages in `packages/party` read this file and no other service module — one
 * subpackage, one service module, which is what ticket 12 asks the build check
 * to enforce. 活动 and 品牌建设 are the same collection shape and belong HERE
 * when their tickets land, not in a file beside this one.
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

// db_party_study.study_type. 契约 §4 规则 19／F7: this is SHOWN, never a filter —
// the endpoint does not accept it, so no page may offer 按类型筛选.
const STUDY_TYPE_LABEL = { t1: '政策文件', t2: '学习材料', t3: '制度文件' };

// §1.1 lets the server ship a type code before this build knows it. A neutral
// word keeps the row on screen; leaving it blank would read as a broken card.
const STUDY_TYPE_FALLBACK = '资料';

// db_file_ref.usage_key — 本模块只用这三个（F7）。
const USAGE_LABEL = { main_file: '主文件', inline_media: '配图', download: '附件' };

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
    files: (study.file_refs || []).map((f) => ({
      file_id: f.file_id,
      file_name: f.file_name,
      usage_label: USAGE_LABEL[f.usage_key] || '附件',
    })),
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
  copyVideoLink,
};
