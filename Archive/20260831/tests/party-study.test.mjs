/**
 * 党建管理 · 学习资料 (ticket 12) — the first page family that lives in a
 * subpackage, and the first collection the contract says must NOT be filtered.
 *
 * Two things here are not repeats of tickets 08 and 10. The subpackage boundary
 * is now a real structural claim that a wrong edit would break silently, so it
 * is asserted against app.json. And 契约 §4 规则 19 forbids searching or
 * filtering this collection, which means the cursor's filter set is empty — the
 * self-heal path is therefore exercised with a cursor issued under a DIFFERENT
 * filter set, because there is no second filter set on this endpoint to switch to.
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

const LIST = 'packages/party/pages/learn/list'
const DETAIL = 'packages/party/pages/learn/detail'

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
  await c.party.listStudies({})

  const url = c.record.requests.pop().url
  assert.match(url, /\/party\/studies\?/, '路径来自契约，不是页面拼的')
  assert.match(url, /limit=20/)
  // §4 规则 19：这个集合不搜索、不筛选。
  assert.ok(!url.includes('study_type='), '类型只显示，不做成筛选项')
  assert.ok(!url.includes('q='), '本集合不搜索')
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
  const { items } = await c.party.listStudies({})

  assert.ok(items.length > 0)
  for (const row of items) {
    assert.ok(row.type_label, '每行都有类型文案')
    assert.ok(!/^t\d$/.test(row.type_label), `界面上出现了枚举原值：${row.type_label}`)
    assert.match(row.published_label, /^\d{2}-\d{2} \d{2}:\d{2}$/, '时间由服务层格式化')
    assert.ok(row.excerpt, '列表摘要由服务端派生，客户端不截字')
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
    data: { code: 'internal_error', message: '服务出错', request_id: 'req-p1' },
  })
  await failed.loadFirst()
  assert.equal(failed.data.items.length, 0)
  assert.ok(failed.data.errorText, '读失败要说出来')
  assert.equal(failed.data.errorRequestId, 'req-p1')

  // 界面上分得开：空态与错误横幅不能同屏。这一条由标记守住 —— 两个状态的数据
  // 形状完全相同（items 为空），只有开合条件能区分它们。
  const wxml = read(`${LIST}.wxml`)
  assert.match(
    wxml,
    /items\.length === 0 && !errorText/,
    '空态必须同时按 !errorText 开合，否则读不到会被说成「今天没有资料」',
  )
})

test('an unknown type code still renders a row, neutrally', async () => {
  const c = await signedIn()
  const { items } = await c.party.listStudies({})
  // 第 7 条的 study_type 是本客户端不认识的码。
  const row = items.find((r) => r.study_id === 7)
  assert.ok(row, '这一行没有被丢掉')
  assert.ok(row.type_label, '仍有文案，不留空')
  assert.ok(!row.type_label.includes('z9'), '不得把原始码抬到界面上')
})

test('a null department does not break the row', async () => {
  const c = await signedIn()
  const { items } = await c.party.listStudies({})
  const row = items.find((r) => r.study_id === 4)
  assert.equal(row.department_label, '', '可空列变成空串，不是 null 或 undefined')
  assert.ok(row.study_title, '这一行照常显示')
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

  const firstId = page.data.items[0].study_id
  const before = page.data.items.length
  await page.loadMore()

  assert.ok(page.data.items.length > before, '列表增长了')
  assert.equal(page.data.items[0].study_id, firstId, '第一条没被加载动画顶掉')
  assert.equal(page.data.loadingFirst, false, '续加载不重进首读状态')
})

test('a cursor from another filter set is refused, and the page reloads exactly once', async () => {
  const c = await signedIn()

  // 本端点不筛选，所以拿一个**别的**集合在筛选条件下签发的游标来充当失效游标。
  // 指纹算在 { scope: 'current' } 上，与本端点的空筛选集对不上。
  const foreign = await c.task.listPage({ scope: 'current', limit: 2 })
  assert.ok(foreign.nextCursor, '夹具够长，有下一页')

  await assert.rejects(
    () => c.party.listStudies({ cursor: foreign.nextCursor }),
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
    data: { code: 'internal_error', message: '服务出错', request_id: 'req-p2' },
  })
  await page.loadFirst()

  assert.ok(page.data.errorText, '刷新失败说出来了')
  assert.equal(page.data.cursor, priorCursor, '刷新失败要还原游标')
  assert.equal(page.data.exhausted, priorExhausted, '不得把列表钉死在「没有更多了」')

  // 还原是为了这个：下一次上滑仍然发得出请求。
  const before = c.record.requests.length
  await page.loadMore()
  assert.ok(c.record.requests.length > before, '还原后列表还能继续加载')
})

test('an unregistered error code degrades by HTTP class, in Chinese, with a trace id', async () => {
  const c = await signedIn()
  const page = loadPage(c, `${LIST}.js`)

  answerOnce({
    statusCode: 400,
    data: { code: 'z9_unknown_new_code', message: '请求无法处理', request_id: 'req-p3' },
  })
  await page.loadFirst()

  assert.match(page.data.errorText, /[一-龥]/, '给老师看的是中文，不是错误码')
  assert.equal(page.data.errorCanRetry, false, '400 类降级为不可重试')
  assert.equal(page.data.errorRequestId, 'req-p3', '带一个可以报给园方的追踪号')
})

// ── The detail ───────────────────────────────────────────────────────────────

test('detail carries the whole body, the attachments and the external films', async () => {
  const c = await signedIn()
  const row = await c.party.studyDetail(1)

  assert.ok(row.study_content.includes('指导思想'), '正文是完整的，不是列表那段摘要')
  assert.ok(row.study_content.includes('学习要求'), '第二节也在')
  assert.ok(row.files.length > 0, '附件清单')
  assert.ok(row.files.some((f) => f.usage_label === '主文件'), '主文件是契约要求必有的一份')
  assert.equal(row.video_links.length, 2, '外部影片链接')
  for (const v of row.video_links) {
    assert.ok(v.title, '每条链接都有标题')
    assert.match(v.url, /^https:\/\//, '契约只接受 https')
  }
})

test('a null video_links list arrives as an empty array, not as null', async () => {
  const c = await signedIn()
  // 第 4 条的 video_links 是 null（契约允许该列为空）。
  const row = await c.party.studyDetail(4)
  assert.deepEqual(row.video_links, [], 'wx:for 拿到 null 会报错，服务层先补成数组')
})

test('the published time is shown as written — no timezone arithmetic anywhere', async () => {
  const c = await signedIn()
  const raw = await c.api.get('/party/studies/1')
  const row = await c.party.studyDetail(1)

  const written = /T(\d{2}):(\d{2})/.exec(raw.published_at)
  assert.match(raw.published_at, /\+08:00$/, '服务端给的是字面偏移量')
  assert.ok(
    row.published_label.endsWith(`${written[1]}:${written[2]}`),
    `${written[1]}:${written[2]} 不得被换算成 ${row.published_label}`,
  )
})

test('an external film is copied, never played inline', async () => {
  const c = await signedIn()
  const page = loadPage(c, `${DETAIL}.js`)
  await page.load(1)

  page.onCopyLink({ currentTarget: { dataset: { url: 'https://www.xuexi.cn/' } } })
  assert.equal(c.record.clipboard.pop(), 'https://www.xuexi.cn/')
  assert.match(c.record.toasts.pop().title, /复制/, '复制之后要说一声，不能静默')

  const wxml = read(`${DETAIL}.wxml`)
  assert.ok(!wxml.includes('<video'), 'F7：外部影片不由小程序内嵌播放')
  // 2026-08-27 照原型改字：原型写的是「请复制链接到浏览器中打开」。
  assert.match(wxml, /请复制链接到浏览器中打开/, '页面要写明这句，否则老师以为点了没反应')
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
  // 教师端对党建资料只读：发布是管理端的事。
  for (const file of [`${LIST}.js`, `${LIST}.wxml`, `${DETAIL}.js`, `${DETAIL}.wxml`,
                      'services/party.js']) {
    const src = read(file)
    for (const forbidden of ['api.post', 'api.patch', 'api.del', 'wx.uploadFile',
                             '幂等', 'Idempotency', '上传', '新建', '编辑', '删除']) {
      assert.ok(!src.includes(forbidden), `${file} 出现了写入痕迹：${forbidden}`)
    }
  }
})

test('neither screen carries 观察记录 or a path to the PC后台', () => {
  for (const file of [`${LIST}.js`, `${LIST}.wxml`, `${DETAIL}.js`, `${DETAIL}.wxml`,
                      'services/party.js']) {
    const src = read(file)
    assert.ok(!src.includes('观察记录'), `${file}: DO-NOT-BUILD 1`)
    assert.ok(!src.includes('pc-backend'), `${file}: DO-NOT-BUILD 2`)
    assert.ok(!src.includes('/admin/'), `${file}: DO-NOT-BUILD 2`)
  }
})

// ── The subpackage boundary ──────────────────────────────────────────────────

test('both screens live in the party subpackage, and no tab page followed them in', () => {
  const sub = (appJson.subPackages || []).find((s) => s.root === 'packages/party')
  assert.ok(sub, '党建分包必须在 app.json 里声明')
  // 活动与品牌建设自本票起也在这个分包里，各自的测试文件断言各自那一对，
  // 所以这里只认领学习资料这一对，不再对整张分包清单做全等。
  for (const route of ['pages/learn/list', 'pages/learn/detail']) {
    assert.ok(sub.pages.includes(route), `分包缺 ${route}`)
  }

  for (const route of [LIST, DETAIL]) {
    assert.ok(!appJson.pages.includes(route), `${route} 同时登记在主包，编译会拒绝`)
    for (const ext of ['.js', '.json', '.wxml']) {
      assert.ok(fs.existsSync(path.join(MP, route + ext)), `${route} 缺 ${ext}`)
    }
  }

  // tabBar 页面必须留在主包。党建入口页是 tab 页，不得搬进分包。
  for (const tab of appJson.tabBar.list) {
    assert.ok(!tab.pagePath.startsWith('packages/'), `${tab.pagePath} 落进了分包`)
  }
})

test('the subpackage is preloaded from its own navigation entry', () => {
  const rule = appJson.preloadRule['pages/party-building/index']
  assert.ok(rule, '预下载按导航项配置：进党建管理时就把它的分包拉下来')
  assert.deepEqual(rule.packages, ['party'])
  assert.equal(rule.network, 'all', 'wifi-only 会让蜂窝网络下的老师白等一次下载')
})

test('the party subpackage reads one service module and only one', () => {
  // 一个分包只对应一个服务模块。verify:build 也查这条；这里守住页面这一侧。
  for (const route of [LIST, DETAIL]) {
    const requires = [...read(`${route}.js`).matchAll(/require\('([^']+)'\)/g)].map((m) => m[1])
    const services = requires.filter((r) => r.includes('/services/'))
    assert.deepEqual(services, ['../../../../services/party'],
      `${route} 引用了党建以外的服务模块`)
  }
})

test('the party entry page now really opens the study list', async () => {
  const c = await signedIn()
  const entry = loadPage(c, 'pages/party-building/index.js')
  entry.onLoad()
  // 入口页重建后「全部 ›」是页面自己的标签，不再是组件事件：key 从 dataset 来。
  entry.onEntryTap({ currentTarget: { dataset: { key: 'learn' } } })

  assert.deepEqual(
    c.record.navigations.pop(),
    { api: 'navigateTo', url: '/packages/party/pages/learn/list' },
    '分包页面不是 tab 页，用 navigateTo',
  )
  assert.equal(c.record.toasts.length, 0, '已经落地的入口不再说「尚未上线」')
})

// ── 版面：逐格对着 screens/party-study-detail.html（2026-08-27） ────────────

test('meta 三格，页尾两枚动作 —— 原型没有逐条列附件的那一节', async () => {
  const c = await signedIn()
  const row = await c.party.studyDetail(1)

  // 原型 `.meta` 的第三格：主文件的「格式 · 体积」。
  assert.match(row.main_file_label, /PDF/, '格式')
  assert.match(row.main_file_label, /MB|KB/, '体积')

  const wxml = read(`${DETAIL}.wxml`)
  assert.match(wxml, /在线预览/)
  assert.match(wxml, /下载文件/)
  assert.equal(wxml.includes('hl-section-title">附件'), false, '原型没有这一节')
})

test('「在线预览」与「下载文件」走同一条取档路，只在最后一步分手', async () => {
  const c = await signedIn()
  const page = loadPage(c, `${DETAIL}.js`)
  page.onLoad({ study_id: '1' })      // studyId 从这里来，两枚按钮都要用它
  await page.load(1)

  await page.onOpenFile({ currentTarget: { dataset: { save: '' } } })
  const preview = c.record.opened.pop()
  assert.equal(preview.showMenu, false, '预览不给转发菜单')

  await page.onOpenFile({ currentTarget: { dataset: { save: '1' } } })
  const download = c.record.opened.pop()
  assert.equal(download.showMenu, true, '下载给转发菜单 —— 小程序没有文件系统下载')
})
