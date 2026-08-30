/**
 * The list conventions, shared (ticket 07). Extracted verbatim from the
 * notice list page — the first list set the pattern, this makes it the ONLY
 * implementation. Every cursor-paginated list page spreads these methods in.
 *
 * It knows about pagination, not about the wire (ticket 08): the caller injects
 * `fetchPage({ cursor, ...filters })` from a service module, which returns
 * view-ready `{ items, nextCursor }`. No page passes an endpoint path through
 * here, so a list page and the service that owns its collection cannot drift
 * apart.
 *
 * Data contract the page must declare:
 *   items []  cursor null  loadingFirst true  loadingMore false
 *   exhausted false  errorText ''  errorRequestId ''  errorCanRetry false
 *
 * Optional: `filters {}`. Whatever it holds is spread into every fetchPage call,
 * which is how a filtered list reaches its service. Changing a filter means
 * setData on `filters` and then loadFirst() — §3.3 requires the reload, because
 * a cursor belongs to the filter set it was issued under.
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

const { ApiError } = require('./errors');
const { reportFailure } = require('./present');

function createListMethods({ fetchPage } = {}) {
  // Fail at construction, not at first load. A forgotten fetchPage would
  // otherwise throw inside loadFirst's try, be caught, and reach the teacher as
  // 操作未能完成 with a retry button — a wiring slip wearing a server error's
  // clothes.
  if (typeof fetchPage !== 'function') {
    throw new TypeError('createListMethods 需要 fetchPage：服务层的取页函数');
  }
  return {
    async loadFirst() {
      // A refresh that fails must leave the list exactly as it was. Dropping
      // the cursor and never restoring it strands a loaded list: the rows stay,
      // but the next 上滑 finds no cursor, calls itself exhausted and never asks
      // the server again.
      const priorCursor = this.data.cursor;
      const priorExhausted = this.data.exhausted;
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
        const { items, nextCursor } = await fetchPage({ ...this.data.filters });
        this.setData({
          items,
          cursor: nextCursor,
          exhausted: nextCursor === null,
          loadingFirst: false,
        });
      } catch (err) {
        this.reportListError(err, {
          loadingFirst: false,
          cursor: priorCursor,
          exhausted: priorExhausted,
        });
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
        const { items, nextCursor } = await fetchPage({
          ...this.data.filters,
          cursor: this.data.cursor,
        });
        this.setData({
          items: this.data.items.concat(items),
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
      reportFailure(this, err, extra);
    },

    onRetryList() {
      this.loadFirst();
    },
  };
}

module.exports = { createListMethods };
