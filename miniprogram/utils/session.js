/**
 * Session state — API-CONTRACT.md §6.3 and §6.4.
 *
 * §6.3: the session token is a signed artefact, not a database row, and it must
 * be instantly revocable. So the client treats it as disposable: a
 * `401 session_revoked` clears everything and sends the user back to login. The
 * client never tries to keep a session alive that the server has retired.
 *
 * There is no role switching (§6.1). One surface, one role, decided at login and
 * fixed for the life of the session. This module therefore has no `setRole`.
 */

const TOKEN_KEY = 'hualong_teacher_session_token';
const CONTEXT_KEY = 'hualong_teacher_session_context';

// In-memory mirror so the hot path (every request) does not hit storage.
let token = null;
let context = null;
let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    token = wx.getStorageSync(TOKEN_KEY) || null;
    context = wx.getStorageSync(CONTEXT_KEY) || null;
  } catch (e) {
    token = null;
    context = null;
  }
}

function getToken() {
  load();
  return token;
}

function setToken(value) {
  load();
  token = value || null;
  try {
    if (token) wx.setStorageSync(TOKEN_KEY, token);
    else wx.removeStorageSync(TOKEN_KEY);
  } catch (e) {
    // Storage failure is not fatal: the in-memory token still serves this
    // launch, and the next launch simply logs in again.
  }
}

/**
 * The GET /auth/session payload, cached. Shape per §6.4:
 *   { surface, role, subject, scope, permissions, current_term, expires_at }
 */
function getContext() {
  load();
  return context;
}

function setContext(value) {
  load();
  context = value || null;
  try {
    if (context) wx.setStorageSync(CONTEXT_KEY, context);
    else wx.removeStorageSync(CONTEXT_KEY);
  } catch (e) {
    /* see setToken */
  }
}

function clear() {
  setToken(null);
  setContext(null);
}

function isLoggedIn() {
  return Boolean(getToken());
}

/** `teacher` or `partner-account` — §6.1's two mutually exclusive subjects. */
function getRole() {
  const ctx = getContext();
  return ctx ? ctx.role : null;
}

function getSubject() {
  const ctx = getContext();
  return ctx ? ctx.subject : null;
}

/**
 * The derived scope (§7.3). §6.4 is explicit: use it for display only — showing
 * the class name — and never write it back into a request body. Writing it back
 * is not merely discouraged, it is ignored, so a bug here fails silently.
 */
function getScope() {
  const ctx = getContext();
  return ctx ? ctx.scope : null;
}

/**
 * The current term, or null during a holiday.
 *
 * §6.4: the client may pre-disable writes when this is null, but the server
 * still independently returns `409 no_active_term`. Client UI is never the
 * boundary — this is a courtesy, not a check.
 */
function getCurrentTerm() {
  const ctx = getContext();
  return ctx ? ctx.current_term : null;
}

function hasActiveTerm() {
  return Boolean(getCurrentTerm());
}

/** F5: a partner account must accept the current terms before entering the shell. */
function needsTermsAcceptance() {
  const ctx = getContext();
  return Boolean(ctx && ctx.terms_acceptance_required);
}

module.exports = {
  getToken,
  setToken,
  getContext,
  setContext,
  clear,
  isLoggedIn,
  getRole,
  getSubject,
  getScope,
  getCurrentTerm,
  hasActiveTerm,
  needsTermsAcceptance,
};
