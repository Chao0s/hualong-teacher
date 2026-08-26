/**
 * 党建管理 · 品牌建设 (ticket 12) — the third and last page family of the party
 * subpackage.
 *
 * What is new here is `brand_tag`: a nullable ARRAY column, where the study and
 * activity collections only had nullable scalars. A page that binds a null array
 * to `wx:for` throws, so the service turns it into `[]` on the detail side and
 * into a joined line on the list side. Both are asserted, because a null tag is
 * a legal record and a crash on it would be invisible until a real one arrived.
 *
 * The status column is handled as it is for the other two: `brand_status` is
 * required in the response, but the endpoint's scope is `= 's3'`, so a teacher
 * can only ever see one value and the service does not read the column.
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

const LIST = 'packages/party/pages/brand/list'
const DETAIL = 'packages/party/pages/brand/detail'

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
  await c.party.listBrands({})

  const url = c.record.requests.pop().url
  assert.match(url, /\/party\/brands\?/, '路径来自契约，不是页面拼的')
  assert.match(url, /limit=20/)
  assert.ok(!url.includes('q='), '本集合不搜索')
  assert.ok(!url.includes('brand_tag='), '标签只显示，不做成筛选项')
  assert.ok(!url.includes('brand_status='), '状态不做成筛选项')
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
  const { items } = await c.party.listBrands({})

  assert.ok(items.length > 0)
  for (const row of items) {
    assert.ok(row.brand_title, '每行都有标题')
    assert.match(row.published_label, /^\d{2}-\d{2} \d{2}:\d{2}$/, '时间由服务层格式化')
    assert.equal(typeof row.tag_label, 'string', '标签行永远是字符串，页面不 join')
  }
})

test('the published time is shown as written — no timezone arithmetic anywhere', async () => {
  const c = await signedIn()
  const raw = await c.api.get('/party/brands/4')
  assert.match(raw.published_at, /\+08:00$/, '服务端给的是字面偏移量')

  const written = /T(\d{2}):(\d{2})/.exec(raw.published_at)
  const { items } = await c.party.listBrands({})
  const row = items.find((r) => r.brand_id === 4)
  assert.ok(
    row.published_label.endsWith(`${written[1]}:${written[2]}`),
    `${written[1]}:${written[2]} 不得被换算成 ${row.published_label}`,
  )
})

test('an empty list and a failed read are two different things on screen', async () => {
  const c = await signedIn()

  const empty = loadPage(c, `${LIST}.js`)
  answerOnce({ statusCode: 200, data: { items: [], next_cursor: null } })
  await empty.loadFirst()
  assert.equal(empty.data.items.length, 0)
  assert.equal(empty.data.exhausted, true, '空页就是读到底了，不是失败')
  assert.equal(empty.data.errorText, '', '空列表不喊失败')

  const failed = loadPage(c, `${LIST}.js`)
  answerOnce({
    statusCode: 500,
    data: { code: 'internal_error', message: '服务出错', request_id: 'req-b1' },
  })
  await failed.loadFirst()
  assert.equal(failed.data.items.length, 0)
  assert.ok(failed.data.errorText, '读失败要说出来')
  assert.equal(failed.data.errorRequestId, 'req-b1')

  const wxml = read(`${LIST}.wxml`)
  assert.match(
    wxml,
    /items\.length === 0 && !errorText/,
    '空态必须同时按 !errorText 开合，否则读不到会被说成「今天没有资料」',
  )
  assert.match(wxml, /暂无品牌建设资料/, '空态要有一句给老师看的话')
})

test('an unknown status code still renders a row, and never reaches the screen', async () => {
  const c = await signedIn()
  const raw = await c.api.get('/party/brands/13')
  assert.equal(raw.brand_status, 'z9_future_status',
    '夹具真的带了未知码，否则这条测试什么也没证明')

  const { items } = await c.party.listBrands({})
  const unknown = items.find((r) => r.brand_id === 13)
  const ordinary = items.find((r) => r.brand_id === 12)
  assert.ok(unknown, '这一行没有被丢掉')
  assert.deepEqual(Object.keys(unknown), Object.keys(ordinary), '两行形状一致，未知码不改变结构')

  const shown = JSON.stringify(unknown)
  assert.ok(!shown.includes('z9'), '不得把原始码抬到界面上')
  assert.ok(!shown.includes('status'), '可见范围恒为 s3，状态列不读也不显示')
})

test('a null tag list does not break the row', async () => {
  const c = await signedIn()
  // 夹具第 6 条的 brand_tag 是 null（契约允许该列为空）。
  const { items } = await c.party.listBrands({})
  const row = items.find((r) => r.brand_id === 6)
  assert.equal(row.tag_label, '', '可空数组变成空串，不是 null 或 "null"')
  assert.ok(row.brand_title, '这一行照常显示')
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

  const firstId = page.data.items[0].brand_id
  const before = page.data.items.length
  await page.loadMore()

  assert.ok(page.data.items.length > before, '列表增长了')
  assert.equal(page.data.items[0].brand_id, firstId, '第一条没被加载动画顶掉')
  assert.equal(page.data.loadingFirst, false, '续加载不重进首读状态')
})

test('a cursor from another filter set is refused, and the page reloads exactly once', async () => {
  const c = await signedIn()

  const foreign = await c.task.listPage({ scope: 'current', limit: 2 })
  assert.ok(foreign.nextCursor, '夹具够长，有下一页')

  await assert.rejects(
    () => c.party.listBrands({ cursor: foreign.nextCursor }),
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
    data: { code: 'internal_error', message: '服务出错', request_id: 'req-b2' },
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
    data: { code: 'z9_unknown_new_code', message: '请求无法处理', request_id: 'req-b3' },
  })
  await page.loadFirst()

  assert.match(page.data.errorText, /[一-龥]/, '给老师看的是中文，不是错误码')
  assert.equal(page.data.errorCanRetry, false, '400 类降级为不可重试')
  assert.equal(page.data.errorRequestId, 'req-b3', '带一个可以报给园方的追踪号')
})

// ── The detail ───────────────────────────────────────────────────────────────

test('detail carries the whole body, the tags and the attachments', async () => {
  const c = await signedIn()
  const row = await c.party.brandDetail(1)

  assert.ok(row.brand_content.includes('主题由来'), '正文是完整的')
  assert.ok(row.brand_content.includes('课程转化'), '第二节也在')
  assert.ok(Array.isArray(row.tags) && row.tags.length > 0, '标签是数组，页面排成一排')
  assert.ok(row.files.length > 0, '附件清单')
  for (const file of row.files) {
    assert.ok(file.file_name, '每个附件都有名字')
    assert.ok(!/^(main_file|inline_media|download)$/.test(file.usage_label),
      `界面上出现了枚举原值：${file.usage_label}`)
  }
})

test('a null brand_tag arrives as an empty array, not as null', async () => {
  const c = await signedIn()
  const row = await c.party.brandDetail(6)
  assert.deepEqual(row.tags, [], 'wx:for 拿到 null 会报错，服务层先补成数组')
  assert.ok(row.brand_content, '正文照常显示')

  const wxml = read(`${DETAIL}.wxml`)
  assert.match(wxml, /brand\.tags\.length > 0/, '没有标签就整排不渲染，不留一条空白带')
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
  for (const route of ['pages/brand/list', 'pages/brand/detail']) {
    assert.ok(sub.pages.includes(route), `分包缺 ${route}`)
  }
  for (const route of [LIST, DETAIL]) {
    assert.ok(!appJson.pages.includes(route), `${route} 同时登记在主包，编译会拒绝`)
    for (const ext of ['.js', '.json', '.wxml']) {
      assert.ok(fs.existsSync(path.join(MP, route + ext)), `${route} 缺 ${ext}`)
    }
  }
})

test('the brand screens read one service module and only one', () => {
  for (const route of [LIST, DETAIL]) {
    const requires = [...read(`${route}.js`).matchAll(/require\('([^']+)'\)/g)].map((m) => m[1])
    const services = requires.filter((r) => r.includes('/services/'))
    assert.deepEqual(services, ['../../../../services/party'],
      `${route} 引用了党建以外的服务模块`)
  }
})

test('the party subpackage now holds all three page families and nothing else', () => {
  const sub = (appJson.subPackages || []).find((s) => s.root === 'packages/party')
  assert.deepEqual(sub.pages.slice().sort(), [
    'pages/activity/detail',
    'pages/activity/list',
    'pages/brand/detail',
    'pages/brand/list',
    'pages/learn/detail',
    'pages/learn/list',
  ], '党建管理是三个页族六个页面；多出来的页面属于别的模块，该另开分包')
})

test('the party entry page now really opens the brand list', async () => {
  const c = await signedIn()
  const entry = loadPage(c, 'pages/party-building/index.js')
  entry.onLoad()
  entry.onEntryTap({ currentTarget: { dataset: { key: 'brand' } } })

  assert.deepEqual(
    c.record.navigations.pop(),
    { api: 'navigateTo', url: '/packages/party/pages/brand/list' },
    '分包页面不是 tab 页，用 navigateTo',
  )
  assert.equal(c.record.toasts.length, 0, '已经落地的入口不再说「尚未上线」')
})
