/**
 * The authorization primitive — API-CONTRACT.md §7.1 / §7.2 / §2.3.
 *
 * One decision function, not a rule repeated per endpoint. HANDOFF.md §3 argues
 * for exactly this: the PC backend's derived-input ban was silently inert for
 * its whole life because a lookup key did not match, and a checker that reports
 * green while enforcing nothing is the worst failure mode there is. So the
 * decision lives here, alone, and every route calls it.
 *
 * The status split is the part people get wrong:
 *
 *   no token / unknown token / revoked token   -> 401   the caller has no identity
 *   identity resolves, role not allowed        -> 404   NOT 403
 *   identity resolves, id outside scope        -> 404   NOT 403
 *
 * 403 would confirm that the id exists, which is a leak — and for minors' data
 * it is red-line-4 (Platform SECURITY.md). 404 says nothing either way.
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
    return { status: 404, code: 'not_found', message: '资源不存在或不在可见范围内' };
  }
  if (!roles.includes(session.role)) {
    // §2.3 — the same 404 an absent id gets. Deliberately indistinguishable.
    return { status: 404, code: 'not_found', message: '资源不存在或不在可见范围内' };
  }
  return null;
}
