/**
 * 通知服务 — the contract's notice reads, in one place (ticket 08).
 *
 * Boundary: the notice module, NOT a page. 首页's notice region and 通知列表页
 * are two views of the same collection, so they are two calls into this file
 * and never two copies of the same read. The endpoint path, the page size and
 * the published-time format are written here once; a page that wanted a
 * different summary length would change `SUMMARY_LIMIT`, not open its own read.
 *
 * Everything returned is view-ready (spec 实现决定 7): a page binds it and
 * formats nothing.
 */

const api = require('../utils/request');
const time = require('../utils/time');

const PATH = '/notices';

// 首页 shows the newest few and links to the full list. One number, one place.
const SUMMARY_LIMIT = 5;

/** The list-row shape. A summary row and a list row are deliberately identical. */
function decorate(notice) {
  return {
    ...notice,
    published_label: time.formatShort(notice.published_at),
  };
}

/**
 * One page of 通知, newest first (§3.1 cursor pagination).
 *
 * Shaped for `createListMethods` — call it with no argument for the first page
 * and with the previous `nextCursor` for each append.
 */
async function listPage({ cursor, limit } = {}) {
  const page = await api.getPage(PATH, { cursor, limit });
  return { items: page.items.map(decorate), nextCursor: page.nextCursor };
}

/** 首页's notice region: the newest few rows, same shape as the list. */
async function summary() {
  const { items } = await listPage({ limit: SUMMARY_LIMIT });
  return items;
}

/**
 * One notice, whole.
 *
 * §2.3: a notice outside the caller's scope comes back as 404, identical to a
 * notice that never existed. This module passes that through untouched — the
 * distinction must not be reconstructed anywhere upstream.
 */
async function detail(noticeId) {
  const notice = await api.get(`${PATH}/${noticeId}`);
  return {
    ...notice,
    published_label: time.formatLong(notice.published_at),
  };
}

module.exports = {
  SUMMARY_LIMIT,
  listPage,
  summary,
  detail,
};
