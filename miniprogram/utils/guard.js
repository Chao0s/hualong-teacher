/**
 * Role gate — API-CONTRACT.md §7.1, §7.5, §7.6 and APP-STRUCTURE.md.
 *
 * §7.2 is the load-bearing rule: "解析不到角色 = 致命错误，绝不是空规则集".
 * Failing to resolve a role must be fatal. An empty rule set would read as
 * "no restrictions" and open every route (DO-NOT-BUILD 7).
 *
 * The client gate is a courtesy, not a boundary. §6.4 says it outright: client
 * UI is never the boundary. The server re-checks every route and every scoped
 * id. This module exists so a teacher does not see a door that will slam, not
 * to keep anyone out.
 *
 * ── Two deliberate differences from the archived copy ────────────────────────
 *
 * 1. **No TAB_PAGES, no wx.switchTab.** The archived client declared five
 *    tabBar pages. This build has no `tabBar` key in app.json at all — the
 *    bottom bar is the `hl-tabbar` component and it navigates with
 *    `wx.reLaunch`, because the native tabBar accepts only PNG icons and this
 *    prototype's icons are SVG. Calling `wx.switchTab` on a non-tab page fails
 *    SILENTLY: the tap does nothing and nothing is logged. Keeping the old list
 *    would have made five destinations dead.
 *
 * 2. **redirectToLogin 现在有了。** `pages/login/index` 已建、并且是启动页（`app.json`
 *    的第一项）。会话失效时 `endSessionOnAuthFailure` 会清票并 reLaunch 过去 ——
 *    见那个函数的注释。此前没有登录页，跳转被拿掉，代价是每个页面 401 后留一张白页。
 */

const session = require('./session');
const auth = require('./auth');
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
  'pc-backend',    // APP-STRUCTURE invariant 3 / DO-NOT-BUILD 2
  'parent-client', // the parent surface is a different AppID entirely
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
 * Drop a dead session, then send the teacher to the login page.
 *
 * Returns true ONLY when it actually sent the user somewhere — that is the
 * contract callers rely on when they write
 * `if (endSessionOnAuthFailure(err)) return;`. Returning true means "handled,
 * stop rendering"; returning false means "still your error, show it".
 *
 * ── 这里为什么重新开始跳转（2026-09-12）───────────────────────────────────────
 *
 * 登录页 `pages/login/index` 建起来了、并且成了启动页，所以当初拿掉的那一句跳转
 * 可以放回来。归档版的形状是对的：清掉会话 → `wx.reLaunch` 到登录页 → 返回 true，
 * 因为页面正在离开，不渲染任何东西是应该的。
 *
 * **上一版恒返回 false 的那段时间的代价**，写在这里免得再犯：那时没有登录页，
 * 跳转被拿掉了而 `return true` 留着，于是每个页面的 catch 变成「清掉会话，然后
 * 一言不发地空着」—— 开发者工具里就是一张白页，没有报错、没有重试入口。
 *
 * 真正的自动恢复在 `utils/request.js` 里：devSession 环境下 401 会就地重新签票
 * 并重放一次。所以一个 401 **能走到这里**，就说明那次恢复已经失败了 —— 那不是
 * 可以静默吞掉的情况，是必须让教师看见的情况。
 *
 * **不会自己跳自己**：登录页自己不调这个函数（它把失败画在页面上、给重试按钮），
 * 所以登录失败时不会 reLaunch 到登录页形成循环。
 */
function endSessionOnAuthFailure(err) {
  if (!(err instanceof ApiError) || !err.isAuthFailure) return false;
  session.clear();
  // reLaunch 到登录页。本工程没有原生 tabBar（底部五项是 components/hl-tabbar），
  // 所以 reLaunch 是这里通行的跳法 —— hl-tabbar 自己切页用的也是它。
  wx.reLaunch({ url: '/pages/login/index' });
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

/**
 * What every page's onLoad does before it reads anything: make sure a session
 * exists. Resolves to the session context.
 */
function requireSession() {
  return auth.ensureSession();
}

module.exports = {
  TEACHER_MODULES,
  PARTNER_MODULES,
  FORBIDDEN_MODULES,
  RoleResolutionError,
  requireRole,
  canReachModule,
  requireSession,
  endSessionOnAuthFailure,
  canWriteThisTerm,
};
