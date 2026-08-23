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

module.exports = { present };
