/**
 * Role gate — API-CONTRACT.md §7.1, §7.5, §7.6 and APP-STRUCTURE.md.
 *
 * §7.2 is the load-bearing rule: "解析不到角色 = 致命错误，绝不是空规则集".
 * Failing to resolve a role must be fatal. An empty rule set would read as
 * "no restrictions" and open every route.
 *
 * The client gate is a courtesy, not a boundary. §6.4 says it outright: client
 * UI is never the boundary. The server re-checks every route and every scoped
 * id. This module exists so a teacher does not see a door that will slam, not
 * to keep anyone out.
 */

const session = require('./session');
const { ApiError } = require('./errors');

// APP-STRUCTURE.md: the teacher client carries the staff modules; the PC backend
// is admin-only and unreachable from any Mini Program.
const TEACHER_MODULES = Object.freeze([
  'home',
  'party-building',
  'admin-coordination',
  'teaching-research',
  'resource-library',
  'case-library',
  'co-education',
]);

// §7.5 — a partner account gets a restricted shell, and the allowlist is the
// boundary. Anything not listed returns 403 route_not_allowed_for_role. Kept
// deliberately small: 合作园 sees the libraries, nothing internal.
const PARTNER_MODULES = Object.freeze([
  'resource-library',
  'case-library',
]);

// Never reachable from this client, whatever the role.
const FORBIDDEN_MODULES = Object.freeze([
  'pc-backend',    // APP-STRUCTURE invariant 3
  'parent-client', // the parent surface is a different AppID entirely
]);

// The five bottom-bar destinations (ticket 09). They must be opened with
// wx.switchTab; wx.navigateTo refuses a tabBar page, and it refuses it QUIETLY —
// the tap simply does nothing. Keeping the list here means no caller has to
// remember which pages are tabs. Five is the platform ceiling, so this list
// cannot grow (DO-NOT-BUILD 14).
const TAB_PAGES = Object.freeze([
  '/pages/home/index',
  '/pages/party-building/index',
  '/pages/coordination/index',
  '/pages/training/index',
  '/pages/co-education/index',
]);

class RoleResolutionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RoleResolutionError';
  }
}

/**
 * The current role, or a throw. Never a default.
 *
 * @throws RoleResolutionError when there is no session context — per §7.2 this
 *         is fatal, not "unrestricted".
 */
function requireRole() {
  const role = session.getRole();
  if (!role) {
    throw new RoleResolutionError(
      '无法解析当前角色。按契约 §7.2，解析不到角色是致命错误，不得降级为无限制。'
    );
  }
  return role;
}

function modulesForRole(role) {
  if (role === 'teacher') return TEACHER_MODULES;
  if (role === 'partner-account') return PARTNER_MODULES;
  // An unknown role is not a teacher. Deny rather than assume.
  return [];
}

/** May the current subject reach this module? */
function canReachModule(moduleId) {
  if (FORBIDDEN_MODULES.indexOf(moduleId) !== -1) return false;
  const role = requireRole();
  return modulesForRole(role).indexOf(moduleId) !== -1;
}

/**
 * Navigate, or explain why not.
 *
 * Returns true on success. On refusal it shows the reason and returns false,
 * rather than failing silently — a dead tap is worse than a clear no.
 */
function navigateTo(url, moduleId) {
  try {
    if (moduleId && !canReachModule(moduleId)) {
      wx.showToast({ title: '当前身份无法使用此功能', icon: 'none' });
      return false;
    }
  } catch (err) {
    if (err instanceof RoleResolutionError) {
      redirectToLogin();
      return false;
    }
    throw err;
  }
  if (TAB_PAGES.indexOf(url) !== -1) wx.switchTab({ url });
  else wx.navigateTo({ url });
  return true;
}

/**
 * Page-level entry check. Call from onLoad of every page except login.
 *
 * Returns true when the page may render. When it returns false the page must not
 * fetch or render anything — it is already navigating away.
 */
function requireSession() {
  if (!session.isLoggedIn()) {
    redirectToLogin();
    return false;
  }
  // F5: a partner account that has not accepted the current terms cannot enter
  // the shell at all.
  if (session.needsTermsAcceptance()) {
    wx.showToast({ title: '请先接受使用条款', icon: 'none' });
    return false;
  }
  return true;
}

function redirectToLogin() {
  wx.reLaunch({ url: '/pages/login/index' });
}

/**
 * The one answer to a dead session, anywhere: drop the local session and go
 * back to login. Returns true when it consumed the error, so a caller can
 * `if (endSessionOnAuthFailure(err)) return;` and treat the rest as ordinary
 * failures.
 *
 * It lives here rather than beside the error presenter because ending a session
 * is a gate decision, not a way of showing something. §6.2's second stage needs
 * a real user tap, so nothing here tries to recover silently.
 */
function endSessionOnAuthFailure(err) {
  if (!(err instanceof ApiError) || !err.isAuthFailure) return false;
  session.clear();
  redirectToLogin();
  return true;
}

/**
 * Guard a write that needs an active term.
 *
 * §5.4 / §6.4: the client may pre-disable, but the server independently returns
 * 409 no_active_term. This is the pre-disable, and it is not a substitute.
 */
function canWriteThisTerm() {
  return session.hasActiveTerm();
}

module.exports = {
  TEACHER_MODULES,
  PARTNER_MODULES,
  FORBIDDEN_MODULES,
  TAB_PAGES,
  RoleResolutionError,
  requireRole,
  canReachModule,
  navigateTo,
  requireSession,
  redirectToLogin,
  endSessionOnAuthFailure,
  canWriteThisTerm,
};
