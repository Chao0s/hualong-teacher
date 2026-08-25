/**
 * Functional coverage: every teacher-reachable operation the contract declares
 * answers with the success code it declares.
 *
 * This is a breadth test, and it is honest about what breadth buys. It proves
 * the path exists, the role gate lets a teacher through, the status code is the
 * declared one, and the body has the declared shape. It proves nothing about
 * business rules, state machines or scope predicates — those need a real
 * service, and there is no service code in hualong-backend yet.
 *
 * Its real value is the failure it catches: a client calling a path the
 * contract does not define. That already happened four times before this test
 * existed (see the 契约缺口 section of HANDOFF.md).
 *
 * Skips itself when the contract is not mounted — it lives in a sibling repo on
 * another drive, and `npm test` must not fail because that drive is absent.
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

/**
 * A concrete path for a template. Every placeholder becomes a value that is
 * legal for its own name — an ordinal is 1, a code is a code — because the
 * generated routes match `([^/]+)` but the hand-written ones match `\d+`, and
 * a hand-written route is the one that would notice a wrong shape.
 */
function concretePath(template) {
  return template.replace(/\{([^}]+)\}/g, (_, name) => {
    if (name === 'ordinal') return '1'
    if (name === 'scale_version') return 'v1.0'
    if (name.endsWith('_code')) return 'c1'
    if (name === 'link_id') return 'lnk1'
    return '1'
  })
}

/**
 * The contract's required query parameters, appended.
 *
 * Without them the call is one the contract is entitled to refuse, and "回它自己
 * 声明的成功码" would be asserting against a request that was never legal. Three
 * teacher operations declare required query parameters today; only the
 * hand-written handlers enforce them, which is precisely why the test must send
 * them rather than rely on the generated routes being permissive.
 */
function withRequiredQuery(path, route) {
  const entries = Object.entries(route.requiredQuery || {})
  if (!entries.length) return path
  return `${path}?${entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`
}

function requestFor(route, token) {
  const init = { method: route.method, headers: { authorization: `Bearer ${token}` } }
  if (['POST', 'PUT', 'PATCH'].includes(route.method)) {
    init.headers['content-type'] = 'application/json'
    // The generated routes do not validate bodies; the hand-written ones do.
    // An empty object is the request that exercises the route without claiming
    // to satisfy a schema this test is not checking.
    init.body = '{}'
  }
  return init
}

/**
 * 手写处理器带真实前置条件的写入路径 —— 这条广度测试满足不了它们（票据 11）。
 *
 * 广度测试证明的是「路径存在，且角色门放教师进来」。对这几条，一个**业务**级 4xx
 * 恰好证明同一件事：请求越过了认证与授权，走进了业务规则。所以这里断言的是「不是
 * 401／403／404」—— 比 2xx 更贴近这条测试真正管的事。硬要它们回 2xx，只能靠把前置
 * 条件从 mock 里拿掉，那等于为了让测试变绿而把服务端变笨。
 *
 * 键是 `METHOD 具体路径`，值是它为什么必然被业务规则拒。
 */
const BUSINESS_REFUSAL_EXPECTED = {
  'POST /tasks/1/acceptance': '1 号任务在夹具里已完成（a3），a1 那一行不存在',
  'POST /tasks/1/completion': '同上：转移图上没有 a3 → a3 这条边',
  'POST /media/upload-credentials': '空请求体缺 usage_key／content_type／byte_size',
  'POST /media/files': '空请求体缺 upload_ticket',
  // 票据 15：资源与案例的写入面。1 号在夹具里都是 s3，状态机因此挡住改与提交。
  'POST /library/resources': '空请求体缺 resource_type／resource_name／resource_tag 等 NOT NULL 列',
  'PATCH /library/resources/1': '1 号资源是 s3，改草稿只允许 s1（F6：pending 之后内容冻结）',
  'POST /library/resources/1/submission': '同上：转移图上没有 s3 → s2 这条边',
  'POST /library/cases': '空请求体缺 case_name／case_grade／case_field／case_area 等 NOT NULL 列',
  'PATCH /library/cases/1': '1 号案例是 s3，改草稿只允许 s1',
  'POST /library/cases/1/submission': '同上',
  // 票据 16：1 号研修的参与状态是 s2 已取消，只有 s3 已完成才可提交反馈。
  'POST /trainings/1/feedback': '1 号研修的参与状态是 s2 已取消，只有 s3 已完成才可提交',
  // 票据 19：亲子任务的 NOT NULL 列在契约的 ParentTaskWrite 上是 required。
  'POST /home-school/parent-tasks': '空请求体缺 parent_task_type／parent_task_title／task_detail／start_at',
}

// 401／403／404 是门的回答，不是业务的回答。这三个码出现在上表里的路径上，说明门
// 出了问题，仍然要红。
const GATE_STATUSES = [401, 403, 404]

describe('每个教师端操作都回契约声明的成功码', () => {
  test('契约已挂载', () => {
    if (specError) {
      assert.fail(`契约不可读，本文件其余断言无意义：${specError}`)
    }
    assert.ok(routes.length > 0, '路由表为空')
  })

  test('教师端可达操作的数量与契约一致', async () => {
    const teacherRoutes = routes.filter((r) => !r.isPublic)
    // 90 teacher operations + 1 pre-session login = 91 routes generated.
    assert.equal(teacherRoutes.length + 1, routes.length)
    assert.equal(routes.length, 91,
      `契约的教师端操作数变了：现在 ${routes.length}。改的是契约还是这条断言？`)
  })

  test('每个操作在教师身份下回它自己声明的成功码', async (t) => {
    const token = await signIn('teacher')
    const failures = []
    let ok = 0
    let refused = 0

    for (const route of routes) {
      if (route.isPublic) continue
      const path = withRequiredQuery(concretePath(route.template), route)
      // Logout really revokes (mock/server.mjs → deleteAuthSession), so calling
      // it with the shared token would 401 every operation after it. Give it a
      // token of its own rather than skipping it — it is an operation too.
      const isLogout = route.method === 'DELETE' && route.template === '/auth/session'
      const res = await fetch(mock.baseUrl + path, requestFor(route, isLogout ? await signIn('teacher') : token))
      // The hand-written handlers answer some of these paths with their own
      // richer logic and their own codes; both are legal contract answers, so
      // the assertion is "a declared 2xx", not "exactly the generated one".
      if (res.status >= 200 && res.status < 300) {
        ok += 1
        continue
      }
      const reason = BUSINESS_REFUSAL_EXPECTED[`${route.method} ${path}`]
      if (reason && !GATE_STATUSES.includes(res.status)) {
        refused += 1
        t.diagnostic(`业务前置拒绝（门已通过）：${route.method} ${path} -> ${res.status} —— ${reason}`)
        continue
      }
      failures.push(`${route.method} ${path} -> ${res.status}（契约声明 ${route.status}）`)
    }

    t.diagnostic(`成功 ${ok} / ${routes.length - 1} 个教师端操作，另有 ${refused} 个被业务前置拒绝`)
    assert.deepEqual(failures, [], `以下操作未回 2xx：\n  ${failures.join('\n  ')}`)
  })

  test('登录端点在无会话时可达 —— 它是唯一的 security: [] 操作', async () => {
    const publicRoutes = routes.filter((r) => r.isPublic)
    assert.equal(publicRoutes.length, 1)
    assert.equal(publicRoutes[0].template, '/auth/session')
  })

  test('被 GAPS 阻断的操作已登记，实作前不得依赖', async (t) => {
    const blocked = routes.filter((r) => r.blockedOn.length > 0)
    for (const r of blocked) t.diagnostic(`阻断：${r.method} ${r.template} <- ${r.blockedOn.join('; ')}`)
    // A count, not a list: the register in db/GAPS.md is the authority on which
    // ones. This only fails when the number moves without anyone noticing.
    assert.equal(blocked.length, 5,
      `教师端被阻断的操作数变了：现在 ${blocked.length}。核对 db/GAPS.md 后改这条断言。`)
  })

  test('生成的样例值满足契约的 pattern —— mock 不得发出契约禁止的值', async () => {
    const { loadSpec } = await import('../tools/openapi-source.mjs')
    const spec = loadSpec()
    const offenders = []
    walkSchemas(spec, (schema, where) => {
      if (!schema.pattern) return
      const value = sampleStringFor(schema)
      if (value === null || !new RegExp(schema.pattern).test(value)) {
        offenders.push(`${where}: pattern ${schema.pattern} 生成不出合法值`)
      }
    })
    assert.deepEqual(offenders, [], offenders.join('\n'))
  })
})

// Mirrors mock/spec-routes.mjs → stringSample. Kept as a copy on purpose: if
// the two drift, this test fails, which is the point.
function sampleStringFor(schema) {
  const p = schema.pattern
  if (p.includes('T\\d{2}:\\d{2}:\\d{2}\\+08:00')) return '2026-09-01T09:00:00+08:00'
  if (p.includes('W\\d{2}')) return '2026-W36'
  if (p === '^\\d{4}-\\d{2}-\\d{2}$') return '2026-09-01'
  if (p === '^\\d{4}-\\d{2}$') return '2026-09'
  if (p.startsWith('^https://')) return 'https://example.invalid/generated'
  return null
}

function walkSchemas(node, visit, where = '$', depth = 0, seen = new Set()) {
  if (!node || typeof node !== 'object' || depth > 12) return
  if (seen.has(node)) return
  seen.add(node)
  if (node.type === 'string' || node.pattern) visit(node, where)
  for (const [key, child] of Object.entries(node)) {
    if (child && typeof child === 'object') walkSchemas(child, visit, `${where}.${key}`, depth + 1, seen)
  }
}
