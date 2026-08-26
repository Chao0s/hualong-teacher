/**
 * 党建管理 · 活动 (ticket 12) — the second page family in the party subpackage.
 *
 * One thing here is not a repeat of 学习资料. This collection's business date is
 * `activity_at`, a member of §1.2's client-submittable scheduled-time whitelist,
 * and the whole reason the ticket names it is that a teacher must read the hour
 * the kindergarten wrote — not the hour their phone's timezone would make of it.
 * That is asserted twice below: against the literal the server sent, and again
 * with the process timezone moved under the client's feet.
 *
 * The other difference is the status column. `activity_status` is required in
 * the response and shares its value domain with the other two collections, but
 * the endpoint's scope is `= 's3'`, so a teacher can only ever see one value.
 * The service therefore does not read it at all, which is why the unknown-code
 * fixture below proves degradation by shape rather than by wording.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { start } from '../mock/server.mjs'
import { loadClient, loadPage } from './helpers/seam.mjs'

const MP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'miniprogram')
const read = (rel) => fs.readFileSync(path.join(MP, rel), 'utf8')
const appJson = JSON.parse(read('app.json'))

const LIST = 'packages/party/pages/activity/list'
const DETAIL = 'packages/party/pages/activity/detail'

let mock

before(async () => {
  mock = await start({ port: 0 })
  for (let i = 0; i < 20; i += 1) {
    try { await fetch(mock.baseUrl + '/__ready'); break }
    catch { await new Promise((r) => setTimeout(r, 50)) }
  }
})

after(async () => { await mock.close() })

async function signedIn() {
  const c = loadClient({ baseUrl: mock.baseUrl })
  await c.auth.signIn()
  return c
}

/** Script exactly one wx.request answer; the transport is real either side of it. */
function answerOnce(res) {
  const real = globalThis.wx.request
  globalThis.wx.request = (opts) => {
    globalThis.wx.request = real
    opts.success({ header: {}, ...res })
  }
}

// ── The session gate ─────────────────────────────────────────────────────────

test('no session means no read: the page goes back to login instead of fetching', () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  const page = loadPage(c, `${LIST}.js`)
  page.onLoad()

  assert.equal(page.data.ready, false, '未通过会话门的页面不渲染')
  assert.equal(c.record.requests.length, 0, '也不发请求')
  assert.deepEqual(c.record.navigations.pop(), { api: 'reLaunch', url: '/pages/login/index' })
})

// ── The list ─────────────────────────────────────────────────────────────────

test('the list sends the pagination pair and nothing else', async () => {
  const c = await signedIn()
  await c.party.listActivities({})

  const url = c.record.requests.pop().url
  assert.match(url, /\/party\/activities\?/, '路径来自契约，不是页面拼的')
  assert.match(url, /limit=20/)
  // §4 规则 19：这个集合不搜索、不筛选。
  assert.ok(!url.includes('q='), '本集合不搜索')
  assert.ok(!url.includes('activity_status='), '状态不做成筛选项')
  // §3.1 / DO-NOT-BUILD 11：分页只有游标。
  for (const banned of ['page=', 'offset=', 'total=']) {
    assert.ok(!url.includes(banned), `分页只有游标，出现了 ${banned}`)
  }
  // §7.3 / DO-NOT-BUILD 8：派生的作者字段永不发送。
  for (const derived of ['teacher_id', 'created_by', 'school_id']) {
    assert.ok(!url.includes(derived), `客户端送了派生字段 ${derived}`)
  }
})

test('every row arrives ready to bind — the page formats nothing', async () => {
  const c = await signedIn()
  const { items } = await c.party.listActivities({})

  assert.ok(items.length > 0)
  for (const row of items) {
    assert.ok(row.activity_title, '每行都有标题')
    assert.match(row.time_label, /^\d{2}-\d{2} \d{2}:\d{2}$/, '时间由服务层格式化')
    assert.equal(typeof row.location_label, 'string', '地点永远是字符串，页面不判 null')
  }
})

test('the list shows each activity time as written — the ticket asks for the hour, literally', async () => {
  const c = await signedIn()
  const { items } = await c.party.listActivities({})

  // 夹具第 3 条是 2026-06-03T15:00:00+08:00。换算过就不会是 15:00。
  const raw = await c.api.get('/party/activities/3')
  assert.equal(raw.activity_at, '2026-06-03T15:00:00+08:00', '夹具带的是字面偏移量')

  const row = items.find((r) => r.activity_id === 3)
  assert.equal(row.time_label, '06-03 15:00', '列表上出现的就是服务端写的那个钟点')
})

test('the same hour survives a hostile device timezone — no arithmetic anywhere', async () => {
  const c = await signedIn()
  const original = process.env.TZ
  const labels = []
  try {
    // 两个与园所时区相差极大的时区。任何一处 new Date 都会让下面两次结果分家。
    for (const tz of ['UTC', 'America/Los_Angeles']) {
      process.env.TZ = tz
      const { items } = await c.party.listActivities({})
      labels.push(items.find((r) => r.activity_id === 3).time_label)
    }
  } finally {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  }

  assert.equal(labels[0], '06-03 15:00', `UTC 下变成了 ${labels[0]}`)
  assert.equal(labels[1], '06-03 15:00', `美西时区下变成了 ${labels[1]}`)

  // 守住做法本身：读时间的那一层不得建 Date。注释里讲得起 Date（utils/time.js 的头注
  // 正是在解释为什么不建），所以先把注释去掉再查代码。
  const codeOnly = (rel) => read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  for (const file of ['services/party.js', 'utils/time.js', `${LIST}.js`, `${DETAIL}.js`]) {
    assert.ok(!codeOnly(file).includes('new Date('), `${file} 建了 Date —— 设备时区会从这里漏进来`)
  }
})

test('an empty list and a failed read are two different things on screen', async () => {
  const c = await signedIn()

  // 空：一句说明，没有错误横幅。
  const empty = loadPage(c, `${LIST}.js`)
  answerOnce({ statusCode: 200, data: { items: [], next_cursor: null } })
  await empty.loadFirst()
  assert.equal(empty.data.items.length, 0)
  assert.equal(empty.data.exhausted, true, '空页就是读到底了，不是失败')
  assert.equal(empty.data.errorText, '', '空列表不喊失败')

  // 失败：错误横幅，且**不得**同时说「暂无」。
  const failed = loadPage(c, `${LIST}.js`)
  answerOnce({
    statusCode: 500,
    data: { code: 'internal_error', message: '服务出错', request_id: 'req-a1' },
  })
  await failed.loadFirst()
  assert.equal(failed.data.items.length, 0)
  assert.ok(failed.data.errorText, '读失败要说出来')
  assert.equal(failed.data.errorRequestId, 'req-a1')

  // 界面上分得开：两个状态的数据形状完全相同，只有开合条件能区分它们。
  const wxml = read(`${LIST}.wxml`)
  assert.match(
    wxml,
    /items\.length === 0 && !errorText/,
    '空态必须同时按 !errorText 开合，否则读不到会被说成「今天没有活动」',
  )
  assert.match(wxml, /暂无党建活动/, '空态要有一句给老师看的话')
})

test('an unknown status code still renders a row, and never reaches the screen', async () => {
  const c = await signedIn()
  // 夹具第 9 条带一个本客户端不认识的状态码。
  const raw = await c.api.get('/party/activities/9')
  assert.equal(raw.activity_status, 'z9_future_status',
    '夹具真的带了未知码，否则这条测试什么也没证明')

  const { items } = await c.party.listActivities({})
  const unknown = items.find((r) => r.activity_id === 9)
  const ordinary = items.find((r) => r.activity_id === 8)
  assert.ok(unknown, '这一行没有被丢掉')
  assert.deepEqual(Object.keys(unknown), Object.keys(ordinary), '两行形状一致，未知码不改变结构')

  const shown = JSON.stringify(unknown)
  assert.ok(!shown.includes('z9'), '不得把原始码抬到界面上')
  assert.ok(!shown.includes('status'), '可见范围恒为 s3，状态列不读也不显示')
})

test('a null location does not break the row', async () => {
  const c = await signedIn()
  const { items } = await c.party.listActivities({})
  const row = items.find((r) => r.activity_id === 5)
  assert.equal(row.location_label, '', '可空列变成空串，不是 null 或 undefined')
  assert.ok(row.activity_title, '这一行照常显示')
  assert.ok(row.time_label, '时间照常显示')
})

test('the list pages to the end and then stops asking', async () => {
  const c = await signedIn()
  const page = loadPage(c, `${LIST}.js`)
  page.onLoad()
  await page.loadFirst()

  let pages = 1
  while (!page.data.exhausted) { await page.loadMore(); pages += 1 }
  assert.ok(pages > 1, '夹具要够翻页，否则这条测试什么也没证明')
  assert.ok(page.data.items.length > 20, `翻完只有 ${page.data.items.length} 条`)

  const sent = c.record.requests.length
  await page.loadMore()
  await page.loadMore()
  assert.equal(c.record.requests.length, sent, '游标为空即结束')
})

test('appending never disturbs what is already read', async () => {
  const c = await signedIn()
  const page = loadPage(c, `${LIST}.js`)
  page.onLoad()
  await page.loadFirst()

  const firstId = page.data.items[0].activity_id
  const before = page.data.items.length
  await page.loadMore()

  assert.ok(page.data.items.length > before, '列表增长了')
  assert.equal(page.data.items[0].activity_id, firstId, '第一条没被加载动画顶掉')
  assert.equal(page.data.loadingFirst, false, '续加载不重进首读状态')
})

test('a cursor from another filter set is refused, and the page reloads exactly once', async () => {
  const c = await signedIn()

  // 本端点不筛选，所以拿一个**别的**集合在筛选条件下签发的游标来充当失效游标。
  const foreign = await c.task.listPage({ scope: 'current', limit: 2 })
  assert.ok(foreign.nextCursor, '夹具够长，有下一页')

  await assert.rejects(
    () => c.party.listActivities({ cursor: foreign.nextCursor }),
    (err) => err.code === 'cursor_filter_mismatch',
    '§3.3：筛选集对不上是 400，不是悄悄给出错答案',
  )

  const page = loadPage(c, `${LIST}.js`)
  page.onLoad()
  await page.loadFirst()
  page.setData({ cursor: foreign.nextCursor })

  const before = c.record.requests.length
  await page.loadMore()

  assert.equal(c.record.requests.length - before, 2, '一次失败的续页，加一次从头重载，就此为止')
  assert.equal(page.data.errorText, '', '自愈成功后不留错误横幅')
  assert.ok(page.data.items.length > 0, '重载后列表是满的')
})

test('a failed pull-to-refresh restores the cursor instead of pinning the list at the end', async () => {
  const c = await signedIn()
  const page = loadPage(c, `${LIST}.js`)
  page.onLoad()
  await page.loadFirst()

  const priorCursor = page.data.cursor
  const priorExhausted = page.data.exhausted
  assert.ok(priorCursor, '首读后还有下一页')

  answerOnce({
    statusCode: 500,
    data: { code: 'internal_error', message: '服务出错', request_id: 'req-a2' },
  })
  await page.loadFirst()

  assert.ok(page.data.errorText, '刷新失败说出来了')
  assert.equal(page.data.cursor, priorCursor, '刷新失败要还原游标')
  assert.equal(page.data.exhausted, priorExhausted, '不得把列表钉死在「没有更多了」')

  const before = c.record.requests.length
  await page.loadMore()
  assert.ok(c.record.requests.length > before, '还原后列表还能继续加载')
})

test('an unregistered error code degrades by HTTP class, in Chinese, with a trace id', async () => {
  const c = await signedIn()
  const page = loadPage(c, `${LIST}.js`)

  answerOnce({
    statusCode: 400,
    data: { code: 'z9_unknown_new_code', message: '请求无法处理', request_id: 'req-a3' },
  })
  await page.loadFirst()

  assert.match(page.data.errorText, /[一-龥]/, '给老师看的是中文，不是错误码')
  assert.equal(page.data.errorCanRetry, false, '400 类降级为不可重试')
  assert.equal(page.data.errorRequestId, 'req-a3', '带一个可以报给园方的追踪号')
})

// ── The detail ───────────────────────────────────────────────────────────────

test('detail carries the whole body, the time, the place and the attachments', async () => {
  const c = await signedIn()
  const row = await c.party.activityDetail(1)

  assert.ok(row.activity_content.includes('活动安排'), '正文是完整的')
  assert.ok(row.activity_content.includes('参与要求'), '第二节也在')
  assert.ok(row.location_label, '有地点的活动要把地点带上')
  assert.ok(row.files.length > 0, '附件清单')
  for (const file of row.files) {
    assert.ok(file.file_name, '每个附件都有名字')
    assert.ok(file.usage_label, '每个附件都有用途文案')
    assert.ok(!/^(main_file|inline_media|download)$/.test(file.usage_label),
      `界面上出现了枚举原值：${file.usage_label}`)
  }
})

test('the activity time is shown as written on the detail page too', async () => {
  const c = await signedIn()
  const raw = await c.api.get('/party/activities/1')
  const row = await c.party.activityDetail(1)

  const written = /T(\d{2}):(\d{2})/.exec(raw.activity_at)
  assert.match(raw.activity_at, /\+08:00$/, '服务端给的是字面偏移量')
  assert.ok(
    row.time_label.endsWith(`${written[1]}:${written[2]}`),
    `${written[1]}:${written[2]} 不得被换算成 ${row.time_label}`,
  )
})

test('an activity with no attachments renders without an empty section', async () => {
  const c = await signedIn()
  // 夹具第 12 条一份附件也没有（F7：活动的 file_refs 可全空）。
  const row = await c.party.activityDetail(12)
  assert.deepEqual(row.files, [], '没有附件时是空数组，不是 null')

  const wxml = read(`${DETAIL}.wxml`)
  assert.match(wxml, /activity\.files\.length > 0/, '整块按有无开合，不留一个空的「附件」标题')
})

test('out-of-scope and gone read identically, with no retry', async () => {
  const c = await signedIn()
  const page = loadPage(c, `${DETAIL}.js`)

  await page.load(99999)
  assert.match(page.data.errorText, /不存在|不在可见范围/)
  assert.equal(page.data.errorCanRetry, false, '重试改变不了任何事')
  assert.equal(page.data.errorRequestId !== undefined, true, '带一个可以报给园方的追踪号')
})

test('a missing id is refused before any request leaves', async () => {
  const c = await signedIn()
  const page = loadPage(c, `${DETAIL}.js`)
  const before = c.record.requests.length

  page.onLoad({})
  assert.equal(c.record.requests.length, before, '缺编号不发请求')
  assert.ok(page.data.errorText, '说清楚缺什么')
  assert.equal(page.data.errorCanRetry, false, '重试同一个 URL 不会有别的结果')
})

// ── Read-only, and nothing that leads anywhere it should not ─────────────────

test('neither screen carries an upload, create or edit control', () => {
  // 教师端对党建活动只读：发布是管理端的事。
  for (const file of [`${LIST}.js`, `${LIST}.wxml`, `${DETAIL}.js`, `${DETAIL}.wxml`]) {
    const src = read(file)
    for (const forbidden of ['api.post', 'api.patch', 'api.del', 'wx.uploadFile',
                             '幂等', 'Idempotency', '上传', '新建', '编辑', '删除']) {
      assert.ok(!src.includes(forbidden), `${file} 出现了写入痕迹：${forbidden}`)
    }
  }
})

test('neither screen carries 观察记录 or a path to the PC后台', () => {
  for (const file of [`${LIST}.js`, `${LIST}.wxml`, `${DETAIL}.js`, `${DETAIL}.wxml`]) {
    const src = read(file)
    assert.ok(!src.includes('观察记录'), `${file}: DO-NOT-BUILD 1`)
    assert.ok(!src.includes('pc-backend'), `${file}: DO-NOT-BUILD 2`)
    assert.ok(!src.includes('/admin/'), `${file}: DO-NOT-BUILD 2`)
  }
})

// ── The subpackage boundary ──────────────────────────────────────────────────

test('both screens live in the party subpackage and not in the main package', () => {
  const sub = (appJson.subPackages || []).find((s) => s.root === 'packages/party')
  assert.ok(sub, '党建分包必须在 app.json 里声明')
  for (const route of ['pages/activity/list', 'pages/activity/detail']) {
    assert.ok(sub.pages.includes(route), `分包缺 ${route}`)
  }
  for (const route of [LIST, DETAIL]) {
    assert.ok(!appJson.pages.includes(route), `${route} 同时登记在主包，编译会拒绝`)
    for (const ext of ['.js', '.json', '.wxml']) {
      assert.ok(fs.existsSync(path.join(MP, route + ext)), `${route} 缺 ${ext}`)
    }
  }
})

test('the activity screens read one service module and only one', () => {
  for (const route of [LIST, DETAIL]) {
    const requires = [...read(`${route}.js`).matchAll(/require\('([^']+)'\)/g)].map((m) => m[1])
    const services = requires.filter((r) => r.includes('/services/'))
    assert.deepEqual(services, ['../../../../services/party'],
      `${route} 引用了党建以外的服务模块`)
  }
})

test('the party entry page now really opens the activity list', async () => {
  const c = await signedIn()
  const entry = loadPage(c, 'pages/party-building/index.js')
  entry.onLoad()
  entry.onEntryTap({ currentTarget: { dataset: { key: 'activity' } } })

  assert.deepEqual(
    c.record.navigations.pop(),
    { api: 'navigateTo', url: '/packages/party/pages/activity/list' },
    '分包页面不是 tab 页，用 navigateTo',
  )
  assert.equal(c.record.toasts.length, 0, '已经落地的入口不再说「尚未上线」')
})
