/**
 * Identity & organisation service — the first service-layer module (ticket 05).
 *
 * Boundary: the API contract's identity module (§6), NOT a page. Pages call
 * this and setData what comes back; every value returned here is view-ready,
 * so no page ever formats, maps an enum, or branches on an error code.
 *
 * What is deliberately absent, and must stay absent: any second way in.
 * No SMS fallback, no invite code, no manual binding, no password. F17 §二
 * decided the phone verification is the only identity gate; an API surface
 * here would be an unverified side door beside it. The test suite enumerates
 * this module's exports to keep it true.
 *
 * There is also no role switching (§6.1) — one client, one role, fixed at
 * login for the session's life.
 */

const auth = require('../utils/auth');
const session = require('../utils/session');
const guard = require('../utils/guard');
const { ApiError } = require('../utils/errors');

/** The three F17 hard stops: nothing the user does in-app can fix these. */
const HARD_STOPS = [
  'wechat_phone_quota_exhausted',
  'identity_not_on_roster',
  'identity_binding_conflict',
];

/**
 * The term state, first-class (ticket 06). Every write page reads THIS —
 * no page ever inspects the term enum itself.
 *
 * The holiday is a normal state, not an error: `canWrite` gates the write
 * entries, `notice` is the on-the-spot reason a page shows, and `termName`
 * is always displayable — during the holiday it says so instead of being
 * an empty string.
 */
function termState() {
  const term = session.getCurrentTerm();
  if (term) {
    return { canWrite: true, termName: term.term_name, notice: '' };
  }
  return {
    canWrite: false,
    termName: '假期中',
    notice: '现在是假期，没有进行中的学期。已有内容可以查看；发布与填写会在新学期开始后自动恢复。',
  };
}

/** Shape the cached session context for direct binding on 首页. */
function homeIdentity() {
  const subject = session.getSubject() || {};
  const scope = session.getScope() || {};
  const term = session.getCurrentTerm();
  return {
    teacherName: subject.teacher_name || '',
    className: scope.class_name || '',
    termName: term ? term.term_name : '',
    noTerm: !term,
  };
}

/**
 * Classify a login failure for the page. The page renders `kind`; it never
 * sees an error code.
 *
 *   hard-stop   terminal; render the blocked state, offer no bypass
 *   stale-code  js_code expired while the user read the sheet; restart stage 1
 *   retryable   transient; keep the current phase, offer retry
 */
function classifyFailure(err) {
  const isApi = err instanceof ApiError;
  const code = isApi ? err.code : '';
  let kind = 'retryable';
  if (HARD_STOPS.indexOf(code) !== -1) kind = 'hard-stop';
  else if (code === 'validation_failed') kind = 'stale-code';
  return {
    kind,
    message: isApi ? err.userMessage : '登录失败，请稍后重试',
    requestId: isApi ? (err.requestId || '') : '',
  };
}

/**
 * Stage 1. Resolves to:
 *   { status: 'ok', home }                signed in; `home` binds directly
 *   { status: 'needs_phone', jsCode }     reveal the phone button
 * Failures reject; the page routes them through classifyFailure.
 */
async function signIn() {
  const result = await auth.signIn();
  if (result.status === 'ok') return { status: 'ok', home: homeIdentity() };
  return result;
}

/** Stage 2, from the getRealtimePhoneNumber button's e.detail.code. */
async function bindPhone(jsCode, phoneCode) {
  await auth.bindPhone(jsCode, phoneCode);
  return { status: 'ok', home: homeIdentity() };
}

/**
 * The one answer to an auth failure anywhere in the app: drop the local
 * session and go back to login. Returns true when it consumed the error, so
 * a caller can `if (handleAuthFailure(err)) return;` and treat the rest as
 * ordinary failures.
 */
function handleAuthFailure(err) {
  if (!(err instanceof ApiError) || !err.isAuthFailure) return false;
  session.clear();
  guard.redirectToLogin();
  return true;
}

/** Re-read the context on app resume; terms and suspension can move under us. */
async function refreshContext() {
  await auth.refreshContext();
  return homeIdentity();
}

function isLoggedIn() {
  return session.isLoggedIn();
}

function signOut() {
  auth.signOut();
}

module.exports = {
  signIn,
  bindPhone,
  classifyFailure,
  handleAuthFailure,
  refreshContext,
  homeIdentity,
  termState,
  isLoggedIn,
  signOut,
};
