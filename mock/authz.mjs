/**
 * The authorization primitive — API-CONTRACT.md §7.1 / §7.2 / §2.3.
 *
 * One decision function, not a rule repeated per endpoint. HANDOFF.md §3 argues
 * for exactly this: the PC backend's derived-input ban was silently inert for
 * its whole life because a lookup key did not match, and a checker that reports
 * green while enforcing nothing is the worst failure mode there is. So the
 * decision lives here, alone, and every route calls it.
 *
 * The status split is the part people get wrong, and it splits THREE ways, not
 * two (§2.3, and the RoleNotAllowed / NotFound response descriptions):
 *
 *   no token / unknown token / revoked token  -> 401  the caller has no identity
 *   role not on this route's allowlist        -> 403  route_not_allowed_for_role
 *   id exists but is outside the caller scope -> 404  not_found
 *
 * The distinction is which question is being answered. "May this role walk this
 * road" leaks no business fact — 合作园 learning that 化龙 has a review centre
 * costs nothing — so it answers honestly with 403. "May you see this row" would
 * confirm the id exists, and for minors' records that confirmation is itself the
 * leak (Platform SECURITY.md red line 4), so it hides behind a 404 that is
 * deliberately indistinguishable from an id that never existed.
 *
 * Getting this backwards is common enough that the contract calls it out: §12
 * records six places in one admin spec alone where scope-miss was written as
 * 403. This module is the one place that decides, so it is the one place to be
 * right.
 *
 * §7.2's other half: failing to resolve a role is FATAL. It is never an empty
 * rule set, because an empty rule set reads as "no restrictions".
 */

/**
 * `surface` is the Mini Program the caller opened, and it resolves to exactly
 * one role. There is no multi-role session and no active-role selection (A1,
 * DO-NOT-BUILD 5).
 *
 * G1 blocks `parent` and `admin-pc` in production: `db_phone_claim.ck_pc2_type`
 * admits only c1 (正式教师) and c5 (合作园帐户), and `db_parent` / `db_admin`
 * have no openid column. They are issued here anyway, because proving that a
 * teacher endpoint refuses a parent needs a parent identity to refuse.
 */
export const ROLE_BY_SURFACE = Object.freeze({
  teacher: 'teacher',
  parent: 'parent',
  'admin-pc': 'admin-pc',
  partner: 'partner-account',
});

/**
 * The route-level refusal. Frozen and shared, because every caller must send the
 * same words — a message that varied by endpoint would reintroduce the channel
 * the single code exists to close.
 */
const ROUTE_DENIED = Object.freeze({
  status: 403,
  code: 'route_not_allowed_for_role',
  message: '当前身份无法使用此功能',
});

/**
 * The scope-level refusal, for a caller whose role IS allowed on the route but
 * whose scope predicate excludes the row. Byte-identical to an absent id.
 *
 * Nothing in this mock evaluates a real scope predicate — that needs the
 * database. It is exported so the routes that DO know their scope (the
 * hand-written handlers) refuse in one shape rather than inventing their own.
 */
export const SCOPE_DENIED = Object.freeze({
  status: 404,
  code: 'not_found',
  message: '资源不存在或不在可见范围内',
});

export class RoleResolutionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RoleResolutionError';
  }
}

/**
 * Resolve the bearer token to a session.
 *
 * @returns {{session: object}|{deny: {status: number, code: string, message: string}}}
 */
export function resolveSession(req, sessions, revoked) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || !sessions.has(token)) {
    return { deny: { status: 401, code: 'unauthenticated', message: '未登录或登录凭证无效' } };
  }
  if (revoked.has(token)) {
    return { deny: { status: 401, code: 'session_revoked', message: '登录状态已失效，请重新登录' } };
  }
  return { session: sessions.get(token), token };
}

/**
 * May this session reach an operation whose contract lists `roles`?
 *
 * @param {object} session      resolved session, carrying `role`
 * @param {string[]} roles      the operation's x-hualong-roles
 * @returns {null|{status:number, code:string, message:string}} null = allowed
 * @throws RoleResolutionError when the session carries no role (§7.2)
 */
export function authorizeRole(session, roles) {
  if (!session || !session.role) {
    throw new RoleResolutionError(
      '会话解析不出角色。按契约 §7.2 这是致命错误，不得降级为空规则集。',
    );
  }
  // An operation with no declared roles is unreachable, not unrestricted. The
  // spec inventory reports zero such operations today; if one appears, it must
  // fail closed rather than open.
  if (!roles || roles.length === 0) {
    return ROUTE_DENIED;
  }
  if (!roles.includes(session.role)) {
    return ROUTE_DENIED;
  }
  return null;
}
