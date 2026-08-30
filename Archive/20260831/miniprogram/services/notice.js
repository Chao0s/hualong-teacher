/**
 * 通知服务 — the contract's notice reads, in one place (ticket 08).
 *
 * Boundary: the notice module, NOT a page. The endpoint path, the page size
 * and the published-time format are written here once. Since the 2026-08-26
 * redesign 首页 no longer reads notice rows — its quick-entry badge rides on
 * the db_home aggregate — so 通知列表页 is this module's only list caller.
 *
 * Everything returned is view-ready (spec 实现决定 7): a page binds it and
 * formats nothing.
 */

const api = require('../utils/request');
const time = require('../utils/time');

const PATH = '/notices';

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
  listPage,
  detail,
};
