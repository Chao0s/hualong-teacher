/**
 * RBAC: the authorization primitive, proved once per operation.
 *
 * The contract's rule is narrow and easy to break by accident, so it is pinned
 * here at full breadth rather than sampled:
 *
 *   §2.3  no identity            -> 401
 *   §2.3  identity, wrong role   -> 404, NOT 403 and NOT 401
 *   §7.2  no resolvable role     -> fatal, never an empty rule set
 *
 * Why 404 and not 403 is the whole point. 403 says "this exists but you may not
 * have it", which confirms the id. For a platform holding minors' records that
 * confirmation is itself the leak (Platform SECURITY.md red line 4). The 404 a
 * wrong-role caller gets must therefore be indistinguishable from the 404 an
 * absent id gets — byte for byte, and that is asserted below.
 *
 * The parent and admin-pc identities used here cannot exist in production: G1
 * blocks them at db_phone_claim.ck_pc2_type. They exist in the mock because
 * proving a teacher endpoint refuses a parent requires a parent to refuse.
 */

import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import { start } from '../mock/server.mjs'
import { loadRoutes } from '../mock/spec-routes.mjs'

let mock
let routes = []
let specError = null

before(async () => {
  const loaded = await loadRoutes()
  routes = loaded.routes
  specError = loaded.error
  mock = await start({ port: 0 })
})

after(async () => { await mock?.close() })

async function signIn(surface) {
  const res = await fetch(`${mock.baseUrl}/auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ surface, js_code: 'mock-js-code' }),
  })
  assert.equal(res.status, 200, `${surface} 登录失败`)
  return (await res.json()).session_token
}

function concretePath(template) {
  return template.replace(/\{([^}]+)\}/g, (_, name) => {
    if (name === 'ordinal') return '1'
    if (name === 'scale_version') return 'v1.0'
    if (name.endsWith('_code')) return 'c1'
    if (name === 'link_id') return 'lnk1'
    return '1'
  })
}

function call(route, token) {
  const init = { method: route.method, headers: {} }
  if (token) init.headers.authorization = `Bearer ${token}`
  if (['POST', 'PUT', 'PATCH'].includes(route.method)) {
    init.headers['content-type'] = 'application/json'
    init.body = '{}'
  }
  return fetch(mock.baseUrl + concretePath(route.template), init)
}

/** Every gated operation. The pre-session login is excluded by definition. */
function gated() {
  return routes.filter((r) => !r.isPublic)
}

/** Teacher-only: the operations a parent must be refused. */
function teacherOnly() {
  return gated().filter((r) => r.roles.includes('teacher') && !r.roles.includes('parent'))
}

describe('RBAC · 身份缺失一律 401', () => {
  test('无 Authorization 头 -> 401 unauthenticated', async (t) => {
    const failures = []
    for (const route of gated()) {
      const res = await call(route, null)
      if (res.status !== 401) {
        failures.push(`${route.method} ${route.template} -> ${res.status}`)
        continue
      }
      const body = await res.json()
      if (body.code !== 'unauthenticated') {
        failures.push(`${route.method} ${route.template} -> 401 但 code=${body.code}`)
      }
    }
    t.diagnostic(`${gated().length - failures.length} / ${gated().length} 个操作在无身份时回 401`)
    assert.deepEqual(failures, [], `未回 401 unauthenticated：\n  ${failures.join('\n  ')}`)
  })

  test('伪造的令牌 -> 401，与无令牌同码', async () => {
    const failures = []
    for (const route of gated()) {
      const res = await call(route, 'not-a-real-token')
      const body = await res.json()
      if (res.status !== 401 || body.code !== 'unauthenticated') {
        failures.push(`${route.method} ${route.template} -> ${res.status} ${body.code}`)
      }
    }
    assert.deepEqual(failures, [], failures.join('\n  '))
  })

  test('已吊销的令牌 -> 401 session_revoked，且吊销立即生效', async () => {
    const token = await signIn('teacher')
    const before = await fetch(`${mock.baseUrl}/auth/session`, {
      headers: { authorization: `Bearer ${token}` },
    })
    assert.equal(before.status, 200, '吊销前应当可用')

    const logout = await fetch(`${mock.baseUrl}/auth/session`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    })
    assert.equal(logout.status, 204)

    const after = await fetch(`${mock.baseUrl}/auth/session`, {
      headers: { authorization: `Bearer ${token}` },
    })
    assert.equal(after.status, 401)
    assert.equal((await after.json()).code, 'session_revoked')
  })
})

describe('RBAC · 角色不符一律 404，绝不 403', () => {
  test('家长身份访问教师专属操作 -> 404', async (t) => {
    const parent = await signIn('parent')
    const targets = teacherOnly()
    const failures = []
    for (const route of targets) {
      const res = await call(route, parent)
      if (res.status !== 404) {
        failures.push(`${route.method} ${route.template} -> ${res.status}`)
      }
    }
    t.diagnostic(`${targets.length - failures.length} / ${targets.length} 个教师专属操作拒绝了家长身份`)
    assert.deepEqual(failures, [], `未回 404：\n  ${failures.join('\n  ')}`)
  })

  test('合作园帐户身份访问教师专属操作 -> 404', async () => {
    const partner = await signIn('partner')
    const failures = []
    for (const route of teacherOnly()) {
      if (route.roles.includes('partner-account')) continue
      const res = await call(route, partner)
      if (res.status !== 404) failures.push(`${route.method} ${route.template} -> ${res.status}`)
    }
    assert.deepEqual(failures, [], failures.join('\n  '))
  })

  test('没有任何操作对角色不符回 403 —— 403 会确认 id 存在', async () => {
    const parent = await signIn('parent')
    const leaks = []
    for (const route of teacherOnly()) {
      const res = await call(route, parent)
      if (res.status === 403) leaks.push(`${route.method} ${route.template}`)
    }
    assert.deepEqual(leaks, [], `以下操作泄露了资源存在性：\n  ${leaks.join('\n  ')}`)
  })

  test('越权的 404 与不存在的 404 逐字相同 —— 差异本身就是信道', async () => {
    const parent = await signIn('parent')
    const teacher = await signIn('teacher')

    // A teacher-only operation refused for the wrong role.
    const wrongRole = await call({ method: 'GET', template: '/party/studies/{study_id}' }, parent)
    // The same shape of request from an allowed role, for an id that cannot exist.
    const absent = await fetch(`${mock.baseUrl}/notices/999999`, {
      headers: { authorization: `Bearer ${teacher}` },
    })

    assert.equal(wrongRole.status, 404)
    assert.equal(absent.status, 404)

    const a = await wrongRole.json()
    const b = await absent.json()
    assert.equal(a.code, b.code, 'code 不同就是可区分的信道')
    // request_id differs by design (§1.4) and carries no information about the
    // resource; everything else must match.
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort())
  })
})

/**
 * The seven paths the client calls that the contract never enumerated. They are
 * the ones that had no role gate at all until the primitive was centralised, so
 * they are pinned by hand — a generated test cannot cover a route the generator
 * has never heard of.
 */
const CONTRACT_ABSENT = [
  ['GET', '/notices'],
  ['GET', '/notices/1'],
  ['GET', '/home/todos'],
  ['GET', '/home/cases'],
  ['GET', '/tasks'],
  ['GET', '/tasks/1'],
  ['GET', '/parent-tasks/1/progress'],
]

describe('RBAC · 契约未枚举但客户端在调的路径也有门', () => {
  test('无身份 -> 401', async () => {
    const failures = []
    for (const [method, path] of CONTRACT_ABSENT) {
      const res = await fetch(mock.baseUrl + path, { method })
      if (res.status !== 401) failures.push(`${method} ${path} -> ${res.status}`)
    }
    assert.deepEqual(failures, [], failures.join('\n  '))
  })

  test('家长身份 -> 404', async () => {
    const parent = await signIn('parent')
    const failures = []
    for (const [method, path] of CONTRACT_ABSENT) {
      const res = await fetch(mock.baseUrl + path, {
        method, headers: { authorization: `Bearer ${parent}` },
      })
      if (res.status !== 404) failures.push(`${method} ${path} -> ${res.status}`)
    }
    assert.deepEqual(failures, [], failures.join('\n  '))
  })

  test('教师身份 -> 2xx', async () => {
    const teacher = await signIn('teacher')
    const failures = []
    for (const [method, path] of CONTRACT_ABSENT) {
      const res = await fetch(mock.baseUrl + path, {
        method, headers: { authorization: `Bearer ${teacher}` },
      })
      if (res.status < 200 || res.status >= 300) failures.push(`${method} ${path} -> ${res.status}`)
    }
    assert.deepEqual(failures, [], failures.join('\n  '))
  })
})

describe('RBAC · 角色解析失败是致命的（§7.2）', () => {
  test('契约中没有既无角色又非公开的操作', async () => {
    assert.equal(specError, null, `契约不可读：${specError}`)
    const orphans = routes.filter((r) => !r.isPublic && r.roles.length === 0)
    assert.deepEqual(orphans.map((r) => `${r.method} ${r.template}`), [],
      '这些操作的授权原语无从判定，必须失败关闭，不得放行')
  })

  test('授权原语对无角色的会话抛出，不返回空规则集', async () => {
    const { authorizeRole, RoleResolutionError } = await import('../mock/authz.mjs')
    assert.throws(() => authorizeRole({ claim_id: 1 }, ['teacher']), RoleResolutionError)
    assert.throws(() => authorizeRole(null, ['teacher']), RoleResolutionError)
    // A role that resolves but is not on the list is a denial, not a throw.
    assert.deepEqual(authorizeRole({ role: 'teacher' }, ['teacher']), null)
    assert.equal(authorizeRole({ role: 'parent' }, ['teacher']).status, 404)
    // An operation with an empty role list fails closed.
    assert.equal(authorizeRole({ role: 'teacher' }, []).status, 404)
  })
})
