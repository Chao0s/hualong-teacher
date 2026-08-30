/**
 * Login — API-CONTRACT.md §6.2, the two-stage flow.
 *
 *   stage 1   wx.login -> js_code -> POST /auth/session { surface, js_code }
 *             openid already bound  -> 200, session issued
 *             not bound             -> 409 identity_binding_required
 *
 *   stage 2   only after that 409. A real user tap on
 *             <button open-type="getRealtimePhoneNumber"> yields phone_code
 *             (valid 5 minutes, single use), then the same POST carries it.
 *
 * Why two stages rather than verifying the phone every time: §6.2 —
 * `getRealtimePhoneNumber` is quota-capped and billed past the cap, and WeChat's
 * own guidance is to hide the button once authorization succeeds. Verifying on
 * every login would turn a one-off cost into a recurring one.
 *
 * The quota-exhausted path is a hard stop by design (F17): the server returns
 * `503 wechat_phone_quota_exhausted` and there is deliberately NO SMS fallback,
 * no invite code, no manual openid binding and no password back door. Any of
 * those would be an unverified side door next to the only identity gate. Do not
 * add one here.
 *
 * The old `getPhoneNumber` API is deprecated and must not be used (A2).
 */

const config = require('../config');
const api = require('./request');
const session = require('./session');
const { ApiError } = require('./errors');

/** Promise wrapper for wx.login. */
function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (res && res.code) resolve(res.code);
        else reject(new ApiError({
          statusCode: 0,
          code: 'upstream_unavailable',
          message: '微信登录未返回凭证，请重试',
        }));
      },
      fail: (err) => reject(new ApiError({
        statusCode: 0,
        code: 'upstream_unavailable',
        message: (err && err.errMsg) ? `微信登录失败：${err.errMsg}` : '微信登录失败',
      })),
    });
  });
}

/**
 * POST /auth/session. The only anonymous endpoint (§1.4).
 *
 * `phone_code` is omitted on stage 1 and present on stage 2.
 */
async function postSession(jsCode, phoneCode) {
  const body = { surface: config.SURFACE, js_code: jsCode };
  if (phoneCode) body.phone_code = phoneCode;
  return api.request('POST', '/auth/session', { body, anonymous: true });
}

/** Store whatever POST /auth/session issued, then fetch the full context. */
async function adoptSession(issued) {
  session.setToken(issued.session_token);
  const context = await api.get('/auth/session');
  session.setContext(context);
  return context;
}

/**
 * Stage 1. Returns one of:
 *   { status: 'ok', context }              signed in
 *   { status: 'needs_phone', jsCode }      caller must show the phone button
 *
 * Anything else throws.
 *
 * The `jsCode` is handed back because stage 2 needs it again, and js_code is
 * single-use — calling wx.login twice would invalidate the first one. If stage 2
 * reports the code expired, call `signIn` again for a fresh one.
 */
async function signIn() {
  const jsCode = await wxLogin();
  try {
    const issued = await postSession(jsCode);
    const context = await adoptSession(issued);
    return { status: 'ok', context };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'identity_binding_required') {
      return { status: 'needs_phone', jsCode };
    }
    throw err;
  }
}

/**
 * Stage 2. `phoneCode` is the `e.detail.code` from a
 * `getRealtimePhoneNumber` button — never a number the user typed (A2).
 *
 * Errors worth handling at the call site:
 *   403 identity_not_on_roster     phone is not on the roster; no self-signup
 *   409 identity_binding_conflict  same phone already bound to another WeChat
 *   503 wechat_phone_quota_exhausted  hard stop; tell the user to retry later
 */
async function bindPhone(jsCode, phoneCode) {
  if (!phoneCode) {
    throw new ApiError({
      statusCode: 0,
      code: 'validation_failed',
      message: '未获得手机号验证凭证',
    });
  }
  const issued = await postSession(jsCode, phoneCode);
  const context = await adoptSession(issued);
  return { status: 'ok', context };
}

/**
 * Re-read the session context without re-authenticating.
 *
 * Used on app resume: `current_term` can roll over and the subject can be
 * suspended while the app sits in the background.
 */
async function refreshContext() {
  const context = await api.get('/auth/session');
  session.setContext(context);
  return context;
}

/** Drop local state. The server-side revocation list is what actually ends a session (§6.3). */
function signOut() {
  session.clear();
}

module.exports = { signIn, bindPhone, refreshContext, signOut };
