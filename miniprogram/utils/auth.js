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
 * add one here (DO-NOT-BUILD 10).
 *
 * The old `getPhoneNumber` API is deprecated and must not be used (A2).
 *
 * ── Why there is a second way in here, and why it is not a side door ─────────
 *
 * `POST /auth/session` is `blocked` on the testdata server: that server does not
 * call WeChat at all, so no js_code exists to exchange. It publishes
 * `POST /dev/session` instead. Its own README §二.3 states the property that
 * makes this safe to depend on: it **bypasses no authorization** — the session
 * it signs has exactly the shape a real login produces, and every route, role
 * gate and scope predicate still applies to it. `--no-dev-tokens` turns it off.
 *
 * It is reachable only when `config.env.devSession` is true, which is a property
 * of the testdata environment and is false for prod. DO-NOT-BUILD 10 forbids a
 * second *identity* path in the shipped client; this is not one, because the
 * prod env cannot reach it and the endpoint does not exist on the prod server.
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

/**
 * POST /dev/session. Testdata server only.
 *
 * Returns `{ token, surface, role, subject }` — note the key is `token`, not
 * `session_token`, which is why this cannot simply reuse `adoptSession`'s input.
 */
async function postDevSession() {
  const issued = await api.request('POST', '/dev/session', {
    body: { surface: config.SURFACE, subject_id: config.devSubjectId },
    anonymous: true,
  });
  return { session_token: issued.token };
}

/**
 * Store whatever the session endpoint issued, then fetch the full context.
 *
 * `skipAuthRetry` 是承重的：这一发是**登录过程的一部分**，它拿到 401 说明这次
 * 登录本身失败了（例如以离职教师 teacher_id 13 的身份签票 —— `/dev/session`
 * 照发 token，下一发才回 session_revoked）。此时绝不能再去触发一次自动重登：
 * `utils/request.js` 的恢复分支会 `await auth.ensureSession()`，而那个 promise
 * 正是当前这次登录，于是它开始等自己 —— 页面永远停在加载中，不报错也不超时。
 */
async function adoptSession(issued) {
  session.setToken(issued.session_token);
  try {
    const context = await api.get('/auth/session', { skipAuthRetry: true });
    session.setContext(context);
    return context;
  } catch (err) {
    // 这一步失败就把票丢掉。留着它的后果不是「下次再试一次」，是
    // `session.isLoggedIn()` 从此说谎 —— 本地有 token，`ensureSession()` 因此
    // 直接短路返回，而每一发业务请求都还是 401。离职教师那条路正好会走到这里：
    // `/dev/session` 发了票，`GET /auth/session` 才回 session_revoked。
    session.clear();
    throw err;
  }
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
  if (config.env.devSession) {
    // No js_code, no phone stage: this server has no WeChat behind it.
    return { status: 'ok', context: await adoptSession(await postDevSession()) };
  }
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
 * Sign in only if there is no live session yet.
 *
 * Pages call this from onLoad rather than assuming a session exists, because
 * this build has no login page: the preview signs itself in on first need. The
 * in-flight promise is shared so five pages loading at once produce one session,
 * not five.
 */
let pending = null;
function ensureSession() {
  if (session.isLoggedIn()) return Promise.resolve(session.getContext());
  if (!pending) {
    pending = signIn()
      .then((res) => res.context)
      .finally(() => { pending = null; });
  }
  return pending;
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

module.exports = { signIn, bindPhone, ensureSession, refreshContext, signOut };
