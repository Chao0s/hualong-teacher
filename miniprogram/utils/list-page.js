/**
 * The list conventions, shared (ticket 07). Extracted verbatim from the
 * notice list page — the first list set the pattern, this makes it the ONLY
 * implementation. Every cursor-paginated list page spreads these methods in.
 *
 * Data contract the page must declare:
 *   items []  cursor null  loadingFirst true  loadingMore false
 *   exhausted false  errorText ''  errorRequestId ''  errorCanRetry false
 *
 * Guarantees:
 *   - loading / empty / failed are three distinct states; an empty page is
 *     exhausted, never an error
 *   - appending never touches what is already read: loadingFirst stays false
 *     and items only grow
 *   - a null cursor is the only end signal; after it, no request leaves
 *   - a dead cursor (cursor_invalid / cursor_filter_mismatch, emitted by the
 *     server) self-heals by reloading from the top exactly once
 *   - failures render through present(): 中文, a traceable request id, and a
 *     retry entry only when retrying can change anything
 */

const api = require('./request');
const session = require('./session');
const guard = require('./guard');
const { ApiError } = require('./errors');
const { present } = require('./present');

function createListMethods({ path, decorate = (x) => x, pageSize } = {}) {
  return {
    async loadFirst() {
      this.setData({
        loadingFirst: true,
        errorText: '',
        errorRequestId: '',
        errorCanRetry: false,
        // §3.3: a cursor is bound to its filter set — reloading drops it.
        cursor: null,
        exhausted: false,
      });
      try {
        const { items, nextCursor } = await api.getPage(path, pageSize ? { limit: pageSize } : {});
        this.setData({
          items: items.map(decorate),
          cursor: nextCursor,
          exhausted: nextCursor === null,
          loadingFirst: false,
        });
      } catch (err) {
        this.reportListError(err, { loadingFirst: false });
      }
    },

    async loadMore() {
      if (this.data.loadingMore || this.data.exhausted || this.data.loadingFirst) return;
      if (!this.data.cursor) {
        this.setData({ exhausted: true });
        return;
      }
      this.setData({ loadingMore: true, errorText: '' });
      try {
        const { items, nextCursor } = await api.getPage(path, {
          cursor: this.data.cursor,
          ...(pageSize ? { limit: pageSize } : {}),
        });
        this.setData({
          items: this.data.items.concat(items.map(decorate)),
          cursor: nextCursor,
          exhausted: nextCursor === null,
          loadingMore: false,
        });
      } catch (err) {
        // A dead cursor is recoverable exactly once: reload from the top
        // rather than leaving the user on a list that cannot grow.
        if (err instanceof ApiError
          && (err.code === 'cursor_invalid' || err.code === 'cursor_filter_mismatch')) {
          this.setData({ loadingMore: false });
          return this.loadFirst();
        }
        this.reportListError(err, { loadingMore: false });
      }
    },

    reportListError(err, extra = {}) {
      if (err instanceof ApiError && err.isAuthFailure) {
        session.clear();
        guard.redirectToLogin();
        return;
      }
      const failure = present(err);
      this.setData({
        ...extra,
        errorText: failure.message,
        errorRequestId: failure.requestId,
        errorCanRetry: failure.canRetry,
      });
    },

    onRetryList() {
      this.loadFirst();
    },
  };
}

module.exports = { createListMethods };
