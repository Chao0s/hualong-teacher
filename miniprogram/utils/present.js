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
 *   kind 'auth'     the session is gone; the caller routes it to
 *                   identity.handleAuthFailure instead of rendering it
 */

const { ApiError } = require('./errors');
const session = require('./session');
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
 * The one answer to a dead session, anywhere: drop the local session and go
 * back to login. Returns true when it consumed the error, so a caller can
 * `if (endSessionOnAuthFailure(err)) return;` and treat the rest as ordinary
 * failures. Re-login needs a real user tap (§6.2 stage two), so nothing here
 * tries to recover silently.
 */
function endSessionOnAuthFailure(err) {
  if (!(err instanceof ApiError) || !err.isAuthFailure) return false;
  session.clear();
  guard.redirectToLogin();
  return true;
}

/**
 * The one landing for a failed read on a page (ticket 08). Every page declares
 * `errorText` / `errorRequestId` / `errorCanRetry`; this fills them, and `extra`
 * carries whatever loading flag the page must also clear.
 *
 * Pages call this instead of present() directly, so no page ever holds a copy
 * of the auth-failure branch.
 */
function reportFailure(page, err, extra = {}) {
  if (endSessionOnAuthFailure(err)) return;
  const failure = present(err);
  page.setData({
    ...extra,
    errorText: failure.message,
    errorRequestId: failure.requestId,
    errorCanRetry: failure.canRetry,
  });
}

module.exports = { present, endSessionOnAuthFailure, reportFailure };
