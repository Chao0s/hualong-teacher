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
 * The world this walk needs before it can ask anything useful.
 *
 * Walking every operation with a hardcoded `1` measured the wrong thing: id 1 is
 * not on this class's roster, and the growth-book ids are issued by the server,
 * so a third of the walk was asserting against 404s it had caused itself. This
 * creates the objects first and remembers what the server called them.
 *
 * The task and resource ids come from the fixtures rather than from creation,
 * because their interesting states — an unaccepted assignment, an accepted one,
 * a draft that predates this session — are states the client cannot reach on
 * demand.
 */
async function seedWorld(token) {
  const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const post = async (path, body) => {
    const res = await fetch(mock.baseUrl + path, {
      method: 'POST',
      headers: { ...h, 'idempotency-key': `seed-${path}` },
      body: JSON.stringify(body),
    })
    return res.ok ? res.json() : null
  }
  const get = async (path) => {
    const res = await fetch(mock.baseUrl + path, { headers: h })
    return res.ok ? res.json() : null
  }

  const tasks = (await get('/tasks?limit=100'))?.items || []
  const byAssign = (s) => tasks.find((t) => t.assign?.assign_status === s)?.task_id

  const resources = (await get('/library/resources?limit=100'))?.items || []
  const draftResource = resources.find((r) => r.resource_status === 's1')?.resource_id

  const roster = (await get('/child-assessments'))?.items || []

  // 这个请求体是手写的，不是生成的，因为契约生成不出一个能过的。`ResourceWrite`
  // 与 `CaseWrite` 都没有 `required` 列表，而且把 `resource_explain`／`case_intro`
  // 标成了 nullable —— DDL 上这两列是 NOT NULL（01_schema.sql:667、:718），契约的
  // **读**模式也标成非空。写模式是错的，记在 HANDOFF.md 的契约缺口里。
  const draftCase = await post('/library/cases', {
    case_name: '走查用草稿', case_grade: 'k2', case_field: 'f1', case_area: ['a1'],
    case_intro: '走查用的活动简介', case_trans: '走查用的转化建议',
  })
  const compilation = await post('/teacher/growth-book/compilation', {})
  const section = await post('/teacher/growth-book/sections', {
    name: '走查用栏目', anchor_after: 'cover', anchor_type: 'a1',
  })
  const book = await post('/teacher/growth-book/books', { child_id: roster[0]?.child_id })

  // 量表的编码与版本是契约层的常量，不是可猜的 id。猜错的代价很隐蔽：请求落到
  // 生成路由上，回一条 `item_id: "sample"` 的假数据，看起来成功，其实手写路由
  // 一次也没被碰到。走查此前正是这样把 `/scales/c1/v1.0` 当成了通过。
  const scaleCode = 'guide';
  const scaleVersion = '1.0'
  const scale = await get(`/scales/${scaleCode}/${scaleVersion}`)
  const firstItem = scale?.items?.[0]?.item_id

  // 三条读取端点在「还没开始」时回 404，那是状态不是故障（票据 18）。所以先写，
  // 再读 —— 走查要问的是端点通不通，不是这个班今天有没有人评过。
  const child = roster[0]?.child_id
  if (child && firstItem) {
    await fetch(`${mock.baseUrl}/children/${child}/child-assessment/items/${firstItem}`, {
      method: 'PUT', headers: h, body: JSON.stringify({ score: 3 }),
    })
  }
  if (child) {
    await fetch(`${mock.baseUrl}/children/${child}/term-evaluation`, {
      method: 'PUT', headers: h, body: JSON.stringify({ eval_text: '走查用学期评价' }),
    })
  }

  // `POST /media/files` 要一张真凭证换来的 upload_ticket，不是一个字符串样例。
  // 契约 §8 的媒体流是三步，这里走前一步把票取出来。
  const cred = await post('/media/upload-credentials', {
    usage_key: 'main_file', content_type: 'image/jpeg', byte_size: 1024,
  })

  return {
    child_id: roster[0]?.child_id,
    upload_ticket: cred?.upload_ticket,
    // 名册上第二个孩子，种子一个字也没写过他 —— 留给「只能提交一次」的那些写入。
    unseeded_child_id: roster[1]?.child_id,
    // `POST /moments` 的生成体里 class_id 是 1，那不是本班 —— 服务端因此 422。
    // 班级来自会话，不是客户端挑的，所以从会话上下文取。
    class_id: (await get('/auth/session'))?.scope?.class_id,
    scale_code: scaleCode,
    scale_version: scaleVersion,
    item_id: firstItem,
    tool_item_code: firstItem,
    // 接收要 a1，完成要 a2 —— 同一个参数名，两条路径要两个不同的 id。
    acceptable_task_id: byAssign('a1'),
    completable_task_id: byAssign('a2'),
    resource_id: draftResource,
    case_id: draftCase?.case_id,
    compilation_id: compilation?.compilation_id,
    // 乐观锁令牌。PATCH 编册要带它，带错就是 422；带服务端刚给的那个才是对的。
    revision: compilation?.revision,
    section_id: section?.section_id,
    growth_book_id: book?.growth_book_id,
  }
}

/**
 * Bodies the generator cannot produce, written by hand.
 *
 * Each of these exists because the CONTRACT under-specifies the write, which is
 * a recorded defect, not a gap in the generator:
 *
 *   ResourceWrite / CaseWrite  declare no `required` list at all and type
 *                              `resource_explain` / `case_intro` as nullable,
 *                              while the DDL has both NOT NULL
 *                              (`01_schema.sql:667`, `:718`).
 *   MomentWrite                the class and the child come from the session's
 *                              scope, not from a schema default; `1` is nobody.
 *   ParentTaskWrite            the two scheduled times are on §1.2's whitelist
 *                              and must carry the +08:00 LITERAL. A generator
 *                              that emitted one would be guessing at business
 *                              data, so it deliberately does not.
 *
 * Values that depend on the seeded world are left as placeholders and replaced
 * by `withSeededIds`.
 */
const HAND_WRITTEN_BODY = {
  'POST /library/resources': {
    resource_type: 'r1',
    resource_name: '走查用资源',
    resource_tag: 'g1',
    resource_explain: '走查用的资源解读',
  },
  'POST /library/cases': {
    case_name: '走查用案例',
    case_grade: 'k2',
    case_field: 'f1',
    case_area: ['a1'],
    case_intro: '走查用的活动简介',
    case_trans: '走查用的转化建议',
  },
  'POST /moments': {},
  'POST /home-school/parent-tasks': {
    parent_task_type: 'p1',
    parent_task_title: '走查用亲子任务',
    task_detail: '走查用的任务要求',
    // §1.2：白名单内的计划时间带字面偏移量提交。`Z` 或其他偏移量是 422，服务端
    // 不做换算 —— 所以这里写死的就是要发出去的那串字符。
    start_at: '2026-09-05T18:00:00+08:00',
    due_at: '2026-09-12T18:00:00+08:00',
  },
}

/**
 * Per-path overrides, for the params whose right value depends on the verb.
 *
 * The same id cannot be in two states at once. 接收 needs an unaccepted
 * assignment and 完成 needs an accepted one; the reads need a child who already
 * has a record and the write needs one who does not, because 学期评价 submits
 * once. So each of those gets its own subject rather than the walk pretending
 * one row can be everything.
 */
const PATH_ID = {
  'POST /tasks/{task_id}/acceptance': (w) => w.acceptable_task_id,
  'POST /tasks/{task_id}/completion': (w) => w.completable_task_id,
  'PUT /children/{child_id}/term-evaluation': (w) => w.unseeded_child_id,
}

/**
 * A concrete path for a template, using the seeded world where it has an answer.
 *
 * Placeholders with no seeded value keep the old literal `1`: the generated
 * routes match `([^/]+)` while the hand-written ones match `\d+`, and the
 * hand-written route is the one that would notice a wrong shape.
 */
function concretePath(template, world = {}, key = '') {
  const override = PATH_ID[key]
  return template.replace(/\{([^}]+)\}/g, (_, name) => {
    if (override) return String(override(world))
    if (world[name] !== undefined && world[name] !== null) return String(world[name])
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

/**
 * A request the contract would accept: its own declared body, plus the headers
 * it marks required.
 *
 * This used to send `{}` to every write and treat the resulting 422 as expected.
 * That measured nothing — a 422 for a missing column is indistinguishable from a
 * 422 for a broken endpoint. Sending the declared shape means a refusal after it
 * is about STATE, which is the only kind worth reading.
 */
function requestFor(route, token, seq, world) {
  const init = { method: route.method, headers: { authorization: `Bearer ${token}` } }
  for (const name of route.requiredHeaders || []) {
    // §4: the key is per logical attempt. One walk is one attempt per operation.
    if (name.toLowerCase() === 'idempotency-key') init.headers[name] = `walk-${seq}`
  }
  if (['POST', 'PUT', 'PATCH'].includes(route.method)) {
    init.headers['content-type'] = 'application/json'
    const key = `${route.method} ${route.template}`
    const body = HAND_WRITTEN_BODY[key] || route.requestBody || {}
    init.body = JSON.stringify(withSeededIds(body, world))
  }
  return init
}

/**
 * Replace generated placeholder ids in a body with ones that exist.
 *
 * `sample()` fills an integer with 1, so `POST /teacher/growth-book/books` was
 * asking for child 1 — who is not on this class's roster, so the server answered
 * 404 and the walk recorded a failure it had authored. Any key the seeded world
 * knows by name gets the real value.
 */
function withSeededIds(body, world) {
  if (!body || typeof body !== 'object') return body
  const out = Array.isArray(body) ? [...body] : { ...body }
  for (const [key, value] of Object.entries(out)) {
    if (world[key] !== undefined && world[key] !== null) out[key] = world[key]
    else if (key === 'child_ids' && world.child_id) out[key] = [world.child_id]
    else if (value && typeof value === 'object') out[key] = withSeededIds(value, world)
  }
  return out
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
  // 一次广度走查走不完一条多步流程。这几条各自缺的是流程里更早的一步，不是端点坏了。
  'POST /teacher/growth-book/compilation/{compilation_id}/lock':
    '刚建的编册还没有内容，锁定要求先有可锁的东西（多步流程，非本走查的范围）',
  'POST /teacher/growth-book/books/{growth_book_id}/publication':
    '发布要 content_fingerprint，它由预检派生 —— 先预检再发布是两步（§10）',
  'POST /moments':
    '在园时光的最小合法请求体不足以建草稿：还要班级、幼儿与至少一张图片（票据 17）',
  // 状态机上不存在那条边，或那一行不在可写状态。
  // 一个 id 不可能同时处在两种状态。seedWorld 给的是草稿，因为改与提交审核需要草稿；
  // 取下载链接需要已发布。两者必居其一，所以这一条注定被拒 —— 要两个都绿，得给案例
  // 两个 id，而那是把走查改写成两条流程，不是广度测试该做的事。
  'POST /library/cases/{case_id}/download-link': '种子案例是 s1 草稿，取下载链接要 s3 已发布',
  'POST /trainings/{training_id}/feedback': '这场研修的参与状态是 s2 已取消，只有 s3 已完成才可提交',
  // 契约的写模式没有 `required` 列表，而 DDL 上那几列 NOT NULL（见 seedWorld 的注释）。
  'POST /media/files': '最小合法体只有 upload_ticket，它必须是一张真凭证换来的',
  'POST /library/resources': '契约的 ResourceWrite 生成不出能过的体：缺 resource_explain（DDL NOT NULL）',
  'POST /library/cases': '同上：缺 case_intro（DDL NOT NULL）',
  'POST /home-school/parent-tasks': '缺 start_at／due_at 的字面偏移量，生成器不发白名单内的计划时间',
}

/**
 * 契约自己声明被阻断的操作 —— 它们**不可能**回 2xx，直到上游解冻。
 *
 * 与业务拒绝分开，因为性质不同：业务拒绝是「这次调用的前置没满足」，这里是「这个
 * 端点今天根本没有可用的实现依据」。混在一起会让前者的数字看起来更差，也会让后者
 * 在解冻后无人察觉。
 */
const CONTRACT_BLOCKED_EXPECTED = {
  'GET /growth-book/books/{growth_book_id}/manifest':
    '0/12 版式包已发布，服务端回 409 layout_pack_unreleased（ADR-0015 Follow-ups）',
  'GET /growth-book/books/{growth_book_id}/pages/{ordinal}': '同上',
}

/**
 * 「还没开始」的 404 —— 票据 18 单独钉过这一条：第一次进来服务端回 404，那是状态，
 * 不是故障。它与范围不符逐字相同，这正是红线 4 要的效果。
 *
 * **这张表现在一条也匹配不上**，因为 `seedWorld` 先写后读：走查要问的是端点通不通，
 * 不是这个班今天有没有人评过。留着是因为这个分类会再出现 —— 下一个加读取端点的人
 * 会先撞上它，那时把新端点加进来比重新想明白一遍便宜。
 */
const NOT_STARTED_EXPECTED = {
  'GET /children/{child_id}/term-evaluation': '这名幼儿本学期还没有学期评价',
  'PUT /children/{child_id}/term-evaluation': '同上：要先有记录才谈得上写',
  'GET /children/{child_id}/child-assessment': '这名幼儿本学期还没有综合评估记录',
  'PUT /children/{child_id}/child-assessment/items/{item_id}': '同上',
  'GET /children/{child_id}/child-assessment/report': '同上：没有记录就没有报告',
  'GET /children/{child_id}/growth-record': '同上',
}

/**
 * 服务端签发编号的对象，用 1 号去问必然落空 —— 而落空与越权逐字相同（红线 4）。
 * seedWorld 已经把这几个换成真编号，所以这张表现在是空的；留着是因为下一个加端点
 * 的人需要看见这个分类存在。
 */
const SCOPE_REFUSAL_EXPECTED = {
}

/**
 * 授权形状的拒绝，永远不算「业务拒绝」。
 *
 * 没有这道闸，一个授权漏洞就能藏进上面任何一张表：某条操作开始回 403 了，而它恰好
 * 在表里有一行，于是走查照样绿。表说的是「门通过了，业务规则挡住」——门没通过就
 * 不适用，必须落进 failures。
 */
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
    const world = await seedWorld(token)
    t.diagnostic(`夹具：child_id=${world.child_id} 任务 a1=${world.acceptable_task_id} a2=${world.completable_task_id} `
      + `资源=${world.resource_id} 案例=${world.case_id} 编册=${world.compilation_id} `
      + `栏目=${world.section_id} 成长册=${world.growth_book_id}`)
    const failures = []
    let ok = 0
    let refused = 0
    let notStartedCount = 0
    let blockedCount = 0
    let seq = 0

    for (const route of routes) {
      if (route.isPublic) continue
      seq += 1
      const key = `${route.method} ${route.template}`
      const path = withRequiredQuery(concretePath(route.template, world, key), route)
      // Logout really revokes (mock/server.mjs → deleteAuthSession), so calling
      // it with the shared token would 401 every operation after it. Give it a
      // token of its own rather than skipping it — it is an operation too.
      const isLogout = route.method === 'DELETE' && route.template === '/auth/session'
      const res = await fetch(mock.baseUrl + path, requestFor(route, isLogout ? await signIn('teacher') : token, seq, world))
      // The hand-written handlers answer some of these paths with their own
      // richer logic and their own codes; both are legal contract answers, so
      // the assertion is "a declared 2xx", not "exactly the generated one".
      if (res.status >= 200 && res.status < 300) {
        ok += 1
        continue
      }
      // 三张表都按**模板**查，不按具体路径 —— 具体路径里的编号来自 seedWorld，每次
      // 运行都不同，用它做键的表第二次运行就失效了。
      const blocked = CONTRACT_BLOCKED_EXPECTED[key]
      if (blocked && !GATE_STATUSES.includes(res.status)) {
        blockedCount += 1
        t.diagnostic(`契约声明阻断：${key} -> ${res.status} —— ${blocked}`)
        continue
      }
      const notStarted = NOT_STARTED_EXPECTED[key]
      if (notStarted && res.status === 404) {
        notStartedCount += 1
        t.diagnostic(`还没开始（404 是状态不是故障）：${key} —— ${notStarted}`)
        continue
      }
      const reason = BUSINESS_REFUSAL_EXPECTED[key]
      if (reason && !GATE_STATUSES.includes(res.status)) {
        refused += 1
        t.diagnostic(`业务前置拒绝（门已通过）：${key} -> ${res.status} —— ${reason}`)
        continue
      }
      const scopeReason = SCOPE_REFUSAL_EXPECTED[key]
      if (scopeReason && res.status === 404) {
        refused += 1
        t.diagnostic(`范围拒绝（契约要求 404）：${key} —— ${scopeReason}`)
        continue
      }
      failures.push(`${route.method} ${path} -> ${res.status}（契约声明 ${route.status}）`)
    }

    t.diagnostic(`成功 ${ok} / ${routes.length - 1} 个教师端操作`)
    t.diagnostic(`另：业务前置拒绝 ${refused}，还没开始 ${notStartedCount}，契约声明阻断 ${blockedCount}`)
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
