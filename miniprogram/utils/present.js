/**
 * Failure presentation — the ONE mapping from an error to what a teacher sees
 * (ticket 07). Pages render the result; they never branch on an error code.
 *
 * Branching is by `code` via the ApiError registry, never by matching the
 * server's message text — messages may change without a version bump (§2.2).
 *
 *   kind 'retry'    transient; offer a retry entry
 *   kind 'refresh'  the world moved (revision_stale …); the registry hint
 *                   already says 刷新后重试, and retrying re-reads state
 *   kind 'fatal'    the request itself is wrong; retrying changes nothing,
 *                   so NO retry entry is offered
 *   kind 'auth'     the session is gone; reportFailure hands it to the guard
 *                   instead of rendering it, so no page shows this one
 */

const { ApiError } = require('./errors');
const guard = require('./guard');

function present(err) {
  if (err instanceof ApiError) {
    const kind = err.isAuthFailure ? 'auth'
      : err.retry === 'never' ? 'fatal'
        : err.retry === 'refresh' ? 'refresh'
          : 'retry';
    return {
      // userMessage prefers the server's 中文 and falls back to the registry
      // hint; a transport failure carries 网络请求失败 from the request layer,
      // so it never masquerades as a server error.
      message: err.userMessage,
      requestId: err.requestId || '',
      kind,
      canRetry: kind === 'retry' || kind === 'refresh',
    };
  }
  return { message: '操作未能完成，请稍后再试', requestId: '', kind: 'retry', canRetry: true };
}

/**
 * The one landing for a failed read on a page (ticket 08). Every page declares
 * `errorText` / `errorRequestId` / `errorCanRetry`; this fills them, and `extra`
 * carries whatever loading flag the page must also clear.
 *
 * Pages call this instead of present() directly, so no page ever holds a copy
 * of the auth-failure branch.
 *
 * `extra` is applied FIRST and on every path. A dead session normally tears the
 * page stack down, so the flag would not matter — but a template that says
 * "hand me your loading flag" must honour it on all branches, or the one time
 * the teardown does not happen the teacher sits on 加载中… forever.
 */
function reportFailure(page, err, extra = {}) {
  page.setData(extra);
  if (guard.endSessionOnAuthFailure(err)) return;
  const failure = present(err);
  page.setData({
    errorText: failure.message,
    errorRequestId: failure.requestId,
    errorCanRetry: failure.canRetry,
  });
}

module.exports = { present, reportFailure };
