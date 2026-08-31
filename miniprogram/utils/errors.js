/**
 * Error-code registry — a verbatim transcription of API-CONTRACT.md §2.4.
 *
 * Two rules from the contract that this file exists to enforce:
 *
 *   §2.2  "客户端按它分支，不得字符串匹配 message" — branch on `code`, never on
 *         the message text. Messages are free to change without a version bump;
 *         codes are not.
 *   §2.4  The registry is append-only. A new code is a legal v1 addition, so an
 *         unknown code must degrade gracefully rather than throw.
 */

// code -> { http, retry, hint }
//   retry: 'never'    the request itself is wrong; retrying changes nothing
//          'refresh'  the world moved; re-read state and let the user redo it
//          'later'    transient; honour Retry-After
//          'reauth'   the session is gone; restart the login flow
const REGISTRY = {
  malformed_request: { http: 400, retry: 'never', hint: '请求格式有误' },
  cursor_invalid: { http: 400, retry: 'refresh', hint: '翻页已失效，请重新加载' },
  cursor_filter_mismatch: { http: 400, retry: 'refresh', hint: '筛选条件已变，请重新加载' },

  unauthenticated: { http: 401, retry: 'reauth', hint: '请重新登录' },
  session_revoked: { http: 401, retry: 'reauth', hint: '登录状态已失效，请重新登录' },

  route_not_allowed_for_role: { http: 403, retry: 'never', hint: '当前身份无法使用此功能' },
  identity_not_on_roster: { http: 403, retry: 'never', hint: '该手机号不在园所名册内，请联系园方' },

  not_found: { http: 404, retry: 'never', hint: '内容不存在或已不在可见范围内' },

  state_precondition_failed: { http: 409, retry: 'refresh', hint: '当前状态已变，请刷新后重试' },
  revision_stale: { http: 409, retry: 'refresh', hint: '内容已被他人修改，请刷新后重试' },
  fingerprint_drift: { http: 409, retry: 'refresh', hint: '名单或内容在确认期间发生变动，请重新确认' },
  no_active_term: { http: 409, retry: 'never', hint: '当前没有进行中的学期' },
  no_active_review_policy: { http: 409, retry: 'never', hint: '尚无启用的审核规则，无法批准' },
  concurrent_winner_exists: { http: 409, retry: 'refresh', hint: '该操作已由他人完成' },
  identity_binding_conflict: { http: 409, retry: 'never', hint: '该手机号已绑定其他微信，请联系园方' },
  identity_binding_required: { http: 409, retry: 'never', hint: '需要验证手机号' },

  validation_failed: { http: 422, retry: 'never', hint: '填写内容不符合要求' },
  timestamp_not_accepted: { http: 422, retry: 'never', hint: '时间格式不被接受' },
  scope_violation: { http: 422, retry: 'never', hint: '所选对象超出你的范围' },
  transition_not_allowed: { http: 422, retry: 'never', hint: '该操作在当前状态下不可用' },
  idempotency_key_reused: { http: 422, retry: 'never', hint: '重复提交，请重新操作' },

  rate_limited: { http: 429, retry: 'later', hint: '操作过于频繁，请稍后再试' },

  internal_error: { http: 500, retry: 'later', hint: '服务出错，请稍后再试' },

  wechat_phone_quota_exhausted: { http: 503, retry: 'later', hint: '手机号验证暂时不可用，请稍后重试或联系园方' },
  upstream_unavailable: { http: 503, retry: 'later', hint: '依赖服务暂时不可用，请稍后再试' },
};

/**
 * An API failure carrying the contract's error shape.
 *
 * §2.2: `details` holds a field name and a rule name and never a value, so this
 * object is safe to log. Do not add the request body to it.
 */
class ApiError extends Error {
  constructor({ statusCode, code, message, requestId, details, retryAfter }) {
    super(message || code || 'api_error');
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code || 'internal_error';
    this.requestId = requestId || null;
    this.details = details || null;
    this.retryAfter = retryAfter || null;

    const known = REGISTRY[this.code];
    this.known = Boolean(known);
    // An unregistered code is a forward-compatible addition, not a crash. Treat
    // it by its HTTP class so the client keeps working against a newer server.
    this.retry = known ? known.retry : retryClassFromStatus(statusCode);
  }

  /** Text safe to show a teacher. Prefers the server message, which is 中文. */
  get userMessage() {
    if (this.message && this.message !== this.code) return this.message;
    const known = REGISTRY[this.code];
    return known ? known.hint : '操作未能完成，请稍后再试';
  }

  get isAuthFailure() {
    return this.retry === 'reauth';
  }

  /** Should the caller re-read server state before offering a retry? */
  get needsRefresh() {
    return this.retry === 'refresh';
  }
}

function retryClassFromStatus(status) {
  if (status === 401) return 'reauth';
  if (status === 409) return 'refresh';
  if (status === 429 || status >= 500) return 'later';
  return 'never';
}

module.exports = { ApiError, REGISTRY };
