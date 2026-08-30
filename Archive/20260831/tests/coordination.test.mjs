/**
 * 综合协调 · 行政／后勤／人事 (ticket 12) — three list pages, three detail pages,
 * one table underneath them all.
 *
 * What is new here, beyond the party module's shape:
 *   - `coord_category` is REQUIRED and its domain is fixed (c1—c7). Missing and
 *     unknown both answer 400, and the client must say so in Chinese.
 *   - the category is part of the filter set, so switching a tab must throw the
 *     cursor away. This is the first list in the client with a real filter.
 *   - attachments really open: a short-lived URL is signed per tap (§8.4), and
 *     every way that can fail has to reach the teacher as a sentence.
 *   - the three groups share one status column and one scope predicate, which is
 *     asserted rather than assumed.
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

const BASE = 'packages/coordination/pages'
// 三个页族，以及各自覆盖的类目。测试逐个走一遍，不挑一个代表。
const GROUPS = [
  { key: 'xz', zh: '行政资料', categories: ['c1', 'c2', 'c3'] },
  { key: 'hq', zh: '后勤资料', categories: ['c4', 'c5'] },
  { key: 'hr', zh: '人事资料', categories: ['c6', 'c7'] },
]

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

test('no session means no read: every list page goes back to login instead of fetching', () => {
  for (const g of GROUPS) {
    const c = loadClient({ baseUrl: mock.baseUrl })
    const page = loadPage(c, `${BASE}/${g.key}/list.js`)
    page.onLoad()

    assert.equal(page.data.ready, false, `${g.zh}：未通过会话门的页面不渲染`)
    assert.equal(c.record.requests.length, 0, `${g.zh}：也不发请求`)
    assert.deepEqual(c.record.navigations.pop(), { api: 'reLaunch', url: '/pages/login/index' })
  }
})

// ── 必填的分类参数 ───────────────────────────────────────────────────────────

test('the list sends coord_category and the pagination pair, and nothing else', async () => {
  const c = await signedIn()
  await c.coordination.listDocuments({ coord_category: 'c1' })

  const url = c.record.requests.pop().url
  assert.match(url, /\/coordination\/documents\?/, '路径来自契约，不是页面拼的')
  assert.match(url, /coord_category=c1/, '分类是必填参数，一次一个值')
  assert.match(url, /limit=20/)
  // 契约明写这是分类页切换，不是自由筛选：没有搜索，也没有第二个筛选维度。
  assert.ok(!url.includes('q='), '本集合不搜索')
  assert.ok(!url.includes('document_status='), '状态不是筛选项，可见范围由服务端定')
  // §3.1 / DO-NOT-BUILD 11：分页只有游标。
  for (const banned of ['page=', 'offset=', 'total=']) {
    assert.ok(!url.includes(banned), `分页只有游标，出现了 ${banned}`)
  }
  // §7.3 / DO-NOT-BUILD 8：派生的作者字段永不发送。
  for (const derived of ['teacher_id', 'created_by', 'school_id']) {
    assert.ok(!url.includes(derived), `客户端送了派生字段 ${derived}`)
  }
})

test('an unknown category is refused with 400, and the page says so in Chinese', async () => {
  const c = await signedIn()

  await assert.rejects(
    () => c.coordination.listDocuments({ coord_category: 'c9' }),
    (err) => err.statusCode === 400 && err.code === 'malformed_request',
    '契约：值域固定 c1—c7，未知值回 400',
  )

  // 页面这一侧：老师看到的是中文，不是错误码，而且不给一个没用的重试。
  const page = loadPage(c, `${BASE}/xz/list.js`)
  page.onLoad()
  page.setData({ filters: { coord_category: 'c9' } })
  await page.loadFirst()

  assert.match(page.data.errorText, /[一-龥]/, '给老师看的是中文')
  assert.ok(!page.data.errorText.includes('c9'), '不得把参数原值抬到界面上')
  assert.equal(page.data.errorCanRetry, false, '同一个请求重试还是 400')
})

test('a missing category is refused with 400 too — the generated route would have let it through', async () => {
  const c = await signedIn()
  // 直接打端点，绕过服务层，因为服务层永远会带上分类。生成路由不校验查询参数，
  // 所以这条只有手写处理器拦得住；它拦不住就是客户端被教错。
  await assert.rejects(
    () => c.api.get('/coordination/documents', { query: { limit: 5 } }),
    (err) => err.statusCode === 400 && err.code === 'malformed_request',
    '缺必填参数是 400',
  )
})

// ── 三类的状态列与可见范围 ───────────────────────────────────────────────────

test('all three groups read one status column and one scope — no group sees more than another', async () => {
  const c = await signedIn()
  const seen = new Set()

  for (const g of GROUPS) {
    for (const category of g.categories) {
      const data = await c.api.get('/coordination/documents', {
        query: { coord_category: category, limit: 100 },
      })
      assert.ok(data.items.length >= 20, `${category} 的夹具不够翻页，测试证明不了什么`)
      for (const row of data.items) {
        assert.equal(row.coord_category, category, '服务端按类目过滤，不是切了一刀')
      }
      // 详情才带状态列；卡片形状里没有它。逐条读第一笔，确认可见的只有 s3。
      const detail = await c.api.get(`/coordination/documents/${data.items[0].document_id}`)
      seen.add(detail.document_status)
    }
  }

  assert.deepEqual([...seen], ['s3'], '七个类目、三个页族的可见范围完全一致，只有 s3')
})

test('the service never reads the status column, because it can only ever say one thing', () => {
  const src = read('services/coordination.js')
  assert.ok(
    !/doc\.document_status/.test(src),
    '可见范围恒为 s3，状态文案会是一个恒定值，而恒定值不是信息',
  )
})

// ── 换类目 ───────────────────────────────────────────────────────────────────

test('switching category throws the old cursor away and reloads from the top', async () => {
  const c = await signedIn()
  const page = loadPage(c, `${BASE}/xz/list.js`)
  page.onLoad()
  await page.loadFirst()

  const firstCursor = page.data.cursor
  assert.ok(firstCursor, '首读后还有下一页')
  assert.equal(page.data.filters.coord_category, 'c1', '默认落在第一个类目上')

  await page.onCategoryTap({ currentTarget: { dataset: { key: 'c2' } } })

  assert.equal(page.data.filters.coord_category, 'c2')
  assert.notEqual(page.data.cursor, firstCursor, '§3.3：游标属于签发它的那一组筛选条件')
  const url = c.record.requests.pop().url
  assert.match(url, /coord_category=c2/)
  assert.ok(!url.includes('cursor='), '换类目后的首读不带旧游标')
})

test('a cursor issued under one category is refused under another, and the page self-heals once', async () => {
  const c = await signedIn()

  const first = await c.coordination.listDocuments({ coord_category: 'c1', limit: 5 })
  assert.ok(first.nextCursor, '夹具够长，有下一页')

  await assert.rejects(
    () => c.coordination.listDocuments({ coord_category: 'c2', cursor: first.nextCursor }),
    (err) => err.code === 'cursor_filter_mismatch',
    '§3.3：筛选集对不上是 400，不是悄悄给出错答案',
  )

  const page = loadPage(c, `${BASE}/xz/list.js`)
  page.onLoad()
  await page.loadFirst()
  page.setData({ filters: { coord_category: 'c2' }, cursor: first.nextCursor })

  const before = c.record.requests.length
  await page.loadMore()

  assert.equal(c.record.requests.length - before, 2, '一次失败的续页，加一次从头重载，就此为止')
  assert.equal(page.data.errorText, '', '自愈成功后不留错误横幅')
  assert.ok(page.data.items.length > 0, '重载后列表是满的')
})

test('a failed reload does not leave the previous category rows under the new tab', async () => {
  const c = await signedIn()
  const page = loadPage(c, `${BASE}/hq/list.js`)
  page.onLoad()
  await page.loadFirst()
  assert.ok(page.data.items.length > 0)

  answerOnce({
    statusCode: 500,
    data: { code: 'internal_error', message: '服务出错', request_id: 'req-c1' },
  })
  await page.onCategoryTap({ currentTarget: { dataset: { key: 'c5' } } })

  assert.ok(page.data.errorText, '切换失败要说出来')
  assert.equal(page.data.items.length, 0, '上一个类目的行留在新标签下就是在骗人')
})

test('tapping the category already open sends no request', async () => {
  const c = await signedIn()
  const page = loadPage(c, `${BASE}/hr/list.js`)
  page.onLoad()
  await page.loadFirst()

  const before = c.record.requests.length
  page.onCategoryTap({ currentTarget: { dataset: { key: 'c6' } } })
  assert.equal(c.record.requests.length, before, '同一个类目不重读')
})

// ── 列表三态，三个页族逐字一致 ───────────────────────────────────────────────

test('every row arrives ready to bind — the page formats nothing', async () => {
  const c = await signedIn()
  const { items } = await c.coordination.listDocuments({ coord_category: 'c1' })

  assert.ok(items.length > 0)
  for (const row of items) {
    assert.ok(row.document_title, '每行都有标题')
    assert.match(row.published_label, /^\d{2}-\d{2} \d{2}:\d{2}$/, '时间由服务层格式化')
    assert.ok(row.excerpt, '列表摘要由服务端派生，客户端不截字')
    assert.equal(typeof row.effective_label, 'string', '可空的日期列变成字符串，不是 null')
  }
  assert.ok(items.some((r) => r.effective_label), 'c1 可填生效日期，夹具里要有填了的')
  assert.ok(items.some((r) => !r.effective_label), '也要有没填的，两种都得能显示')
})

test('an effective date never appears on a category that may not carry one', async () => {
  const c = await signedIn()
  // 表约束 ck_cd_effective：只有 c1／c4／c5 可填，其余必须为 NULL。
  for (const category of ['c2', 'c3', 'c6', 'c7']) {
    const { items } = await c.coordination.listDocuments({ coord_category: category, limit: 100 })
    for (const row of items) {
      assert.equal(row.effective_label, '', `${category} 不该有生效日期`)
    }
  }
})

test('a null department does not break the row', async () => {
  const c = await signedIn()
  const doc = await c.coordination.documentDetail(100)
  assert.equal(doc.department_label, '', '可空列变成空串，不是 null 或 undefined')
  assert.ok(doc.document_title, '这一条照常显示')
})

test('the three groups say the same words for empty, loading and failed', () => {
  const wxmls = GROUPS.map((g) => read(`${BASE}/${g.key}/list.wxml`))
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
  // 三个页族的列表标记逐字相同 —— 空态、加载中、加载更多、没有更多了、错误横幅。
  // 教师看到的三套界面必须完全一致，而唯一能保证这件事的方式是它们本来就一样。
  assert.equal(strip(wxmls[0]), strip(wxmls[1]), '行政与后勤的列表界面不一致')
  assert.equal(strip(wxmls[1]), strip(wxmls[2]), '后勤与人事的列表界面不一致')
  for (const wxml of wxmls) {
    assert.match(wxml, /暂无资料/, '空列表要显示一句说明')
    assert.match(wxml, /加载中/, '首读有加载态')
    assert.match(wxml, /加载更多/, '续加载有自己的加载态')
    // 读到底时原型是把「加载更多」那一枚**收起来**（`loadMore.hidden = …`），
    // 不另说一句「没有更多了」。2026-08-27 照原型改回。
    assert.match(wxml, /wx:if="\{\{!exhausted && items\.length > 0\}\}"/, '读完就收起按钮')
    assert.equal(wxml.includes('没有更多了'), false, '原型没有这一句')
    // 空态必须同时按 !errorText 开合，否则读不到会被说成「今天没有资料」。
    assert.match(wxml, /items\.length === 0 && !errorText/)
  }
})

test('an empty list and a failed read are two different things on screen', async () => {
  const c = await signedIn()

  const empty = loadPage(c, `${BASE}/xz/list.js`)
  answerOnce({ statusCode: 200, data: { items: [], next_cursor: null } })
  await empty.loadFirst()
  assert.equal(empty.data.items.length, 0)
  assert.equal(empty.data.exhausted, true, '空页就是读到底了，不是失败')
  assert.equal(empty.data.errorText, '', '空列表不喊失败')

  const failed = loadPage(c, `${BASE}/xz/list.js`)
  answerOnce({
    statusCode: 500,
    data: { code: 'internal_error', message: '服务出错', request_id: 'req-c2' },
  })
  await failed.loadFirst()
  assert.equal(failed.data.items.length, 0)
  assert.ok(failed.data.errorText, '读失败要说出来')
  assert.equal(failed.data.errorRequestId, 'req-c2')
})

test('each of the three lists pages to the end and then stops asking', async () => {
  for (const g of GROUPS) {
    const c = await signedIn()
    const page = loadPage(c, `${BASE}/${g.key}/list.js`)
    page.onLoad()
    await page.loadFirst()

    let pages = 1
    while (!page.data.exhausted) { await page.loadMore(); pages += 1 }
    assert.ok(pages > 1, `${g.zh}：夹具要够翻页，否则这条测试什么也没证明`)
    assert.ok(page.data.items.length > 20, `${g.zh}：翻完只有 ${page.data.items.length} 条`)

    const sent = c.record.requests.length
    await page.loadMore()
    await page.loadMore()
    assert.equal(c.record.requests.length, sent, `${g.zh}：游标为空即结束`)
  }
})

test('appending never disturbs what is already read', async () => {
  const c = await signedIn()
  const page = loadPage(c, `${BASE}/hq/list.js`)
  page.onLoad()
  await page.loadFirst()

  const firstId = page.data.items[0].document_id
  const before = page.data.items.length
  await page.loadMore()

  assert.ok(page.data.items.length > before, '列表增长了')
  assert.equal(page.data.items[0].document_id, firstId, '第一条没被加载动画顶掉')
  assert.equal(page.data.loadingFirst, false, '续加载不重进首读状态')
})

test('an unregistered error code degrades by HTTP class, in Chinese, with a trace id', async () => {
  const c = await signedIn()
  const page = loadPage(c, `${BASE}/hr/list.js`)

  answerOnce({
    statusCode: 400,
    data: { code: 'z9_unknown_new_code', message: '请求无法处理', request_id: 'req-c3' },
  })
  await page.loadFirst()

  assert.match(page.data.errorText, /[一-龥]/, '给老师看的是中文，不是错误码')
  assert.equal(page.data.errorCanRetry, false, '400 类降级为不可重试')
  assert.equal(page.data.errorRequestId, 'req-c3', '带一个可以报给园方的追踪号')
})

// ── 详情 ─────────────────────────────────────────────────────────────────────

test('detail carries the whole body and the attachment list', async () => {
  const c = await signedIn()
  const doc = await c.coordination.documentDetail(1)

  assert.ok(doc.document_content.includes('适用范围'), '正文是完整的，不是列表那段摘要')
  assert.ok(doc.document_content.includes('执行要求'), '第二节也在')
  assert.ok(doc.category_label, '类目有中文文案')
  assert.ok(!/^c\d$/.test(doc.category_label), `界面上出现了枚举原值：${doc.category_label}`)
  assert.ok(doc.files.length > 0, '附件清单')
  assert.ok(doc.files.some((f) => f.usage_label === '主文件'), 'F8 要求恰有一份主文件')
})

test('the published time is shown as written — no timezone arithmetic anywhere', async () => {
  const c = await signedIn()
  const raw = await c.api.get('/coordination/documents/1')
  const doc = await c.coordination.documentDetail(1)

  const written = /T(\d{2}):(\d{2})/.exec(raw.published_at)
  assert.match(raw.published_at, /\+08:00$/, '服务端给的是字面偏移量')
  assert.ok(
    doc.published_label.endsWith(`${written[1]}:${written[2]}`),
    `${written[1]}:${written[2]} 不得被换算成 ${doc.published_label}`,
  )
})

/**
 * 2026-08-27：详情从三个独立页面改成**同页弹层**（原型 `.sheet`，API 契约 §4
 * 规则 20 也明写「不增独立详情页」）。下面这些用例的主题一条没变，落点从
 * `detail.js` 换成 `list.js` 的 `openSheet`／`onOpenFile`。
 */

/** 打开某一类下的文件弹层。 */
async function openDoc(c, group, documentId) {
  const page = loadPage(c, `${BASE}/${group}/list.js`)
  page.onLoad({})
  await page.openSheet(documentId)
  return page
}

test('out-of-scope and gone read identically, with no retry, in all three sheets', async () => {
  for (const g of GROUPS) {
    const c = await signedIn()
    const page = await openDoc(c, g.key, 999999)

    assert.match(page.data.sheetError, /不存在|不在可见范围/, `${g.zh}：措辞不区分两种情形`)
    assert.equal(page.data.doc, null, `${g.zh}：读不到就没有正文`)
    assert.equal(page.data.sheetOpen, true, `${g.zh}：弹层留着，理由写在里面`)
  }
})

test('弹层里的失败不冒充列表读不到', async () => {
  const c = await signedIn()
  const page = await openDoc(c, 'hq', 999999)

  assert.ok(page.data.sheetError, '弹层自己说')
  assert.equal(page.data.errorText, '', '整页的错误横幅不动 —— 列表本身读到了')
  assert.ok(page.data.items.length > 0, '列表照常在')
})

// ── 附件 ─────────────────────────────────────────────────────────────────────

test('opening a document signs a fresh short-lived URL, per tap, with its owner', async () => {
  const c = await signedIn()
  const page = await openDoc(c, 'xz', 1)

  const file = page.data.doc.files.find((f) => f.file_name.endsWith('.pdf'))
  await page.onOpenFile({ currentTarget: { dataset: { file } } })

  const url = c.record.requests.pop().url
  assert.match(url, new RegExp(`/media/files/${file.file_id}/url`), '§8.4：取档另走签名端点')
  // owner 首先是授权参数：同一个 file_id 可被多条记录引用。
  assert.match(url, /owner_object=db_coord_document/)
  assert.match(url, /owner_id=1/)
  assert.equal(c.record.opened.length, 1, '签完就打开')
  assert.equal(c.record.opened[0].fileType, 'pdf')

  // 第二次点击重新签一次：短时 URL 不缓存，服务端借每次调用重跑授权。
  await page.onOpenFile({ currentTarget: { dataset: { file } } })
  assert.match(c.record.requests.pop().url, /\/media\/files\//, '不复用上一次的地址')
})

test('an image attachment is previewed, not downloaded as a document', async () => {
  const c = await signedIn()
  // 第 4 条挂了一张配图（id % 4 === 0）。
  const page = await openDoc(c, 'xz', 4)

  const image = page.data.doc.files.find((f) => f.file_name.endsWith('.jpg'))
  assert.ok(image, '夹具里要有一张配图')
  await page.onOpenFile({ currentTarget: { dataset: { file: image } } })

  assert.equal(c.record.previews.length, 1, '图片走预览')
  assert.equal(c.record.opened.length, 0, '不当作文档下载')
})

test('an attachment WeChat cannot open says so in Chinese, and does not waste a signature', async () => {
  const c = await signedIn()
  const page = await openDoc(c, 'xz', 154)

  const zip = page.data.doc.files.find((f) => f.file_name.endsWith('.zip'))
  assert.ok(zip, '夹具里要有一份微信打不开的格式')

  const before = c.record.requests.length
  await page.onOpenFile({ currentTarget: { dataset: { file: zip } } })

  assert.equal(c.record.requests.length, before, '打不开的格式不必先白跑一次签名')
  const said = c.record.toasts.pop()
  assert.match(said.title, /[一-龥]/, '给的是中文说明')
  assert.match(said.title, /无法在手机上打开/, '说清楚为什么，而不是留白')
  assert.equal(c.record.opened.length, 0)
})

test('a download that fails still reaches the teacher as a sentence', async () => {
  const c = await signedIn()
  const page = await openDoc(c, 'hr', 2)
  const file = page.data.doc.files[0]

  c.control.downloadFails = true
  await page.onOpenFile({ currentTarget: { dataset: { file } } })
  assert.match(c.record.toasts.pop().title, /下载失败/, '下载失败要说出来')

  c.control.downloadFails = false
  c.control.openFails = true
  await page.onOpenFile({ currentTarget: { dataset: { file } } })
  assert.match(c.record.toasts.pop().title, /打开失败/, '打开失败要说出来')
})

test('a refused signature is presented in Chinese, not swallowed', async () => {
  const c = await signedIn()
  const page = await openDoc(c, 'hq', 3)
  const file = page.data.doc.files[0]

  answerOnce({
    statusCode: 404,
    data: { code: 'not_found', message: '资源不存在或不在可见范围内', request_id: 'req-c4' },
  })
  await page.onOpenFile({ currentTarget: { dataset: { file } } })

  assert.equal(c.record.opened.length, 0, '没签到地址就不该去打开什么')
  assert.match(c.record.toasts.pop().title, /[一-龥]/, '失败也是一句中文，不是一片空白')
})

// ── 只读，以及不通往任何不该去的地方 ─────────────────────────────────────────

test('no coordination screen carries an upload, create or edit control', () => {
  const files = ['services/coordination.js']
  for (const g of GROUPS) {
    files.push(`${BASE}/${g.key}/list.js`, `${BASE}/${g.key}/list.wxml`)
  }
  for (const file of files) {
    const src = read(file)
    for (const forbidden of ['api.post', 'api.patch', 'api.del', 'wx.uploadFile', 'wx.chooseMedia',
                             '幂等', 'Idempotency', '上传', '新建', '编辑', '删除']) {
      assert.ok(!src.includes(forbidden), `${file} 出现了写入痕迹：${forbidden}`)
    }
    assert.ok(!src.includes('观察记录'), `${file}: DO-NOT-BUILD 1`)
    assert.ok(!src.includes('pc-backend'), `${file}: DO-NOT-BUILD 2`)
    assert.ok(!src.includes('/admin/'), `${file}: DO-NOT-BUILD 2`)
    assert.ok(!src.includes('PC后台'), `${file}: DO-NOT-BUILD 2 —— 不给通往 PC 的路`)
  }
})

test('the prototype carousel is not built', () => {
  // F8 已删掉「重复展示同一批资料前三笔」的轮播。原型上若有，不照搬。
  for (const g of GROUPS) {
    const wxml = read(`${BASE}/${g.key}/list.wxml`)
    assert.ok(!wxml.includes('swiper'), `${g.zh}：F8 删掉了轮播`)
  }
})

// ── 分包边界 ─────────────────────────────────────────────────────────────────

test('三个清单页都在综合协调分包里，没有 tab 页跟进来', () => {
  const sub = (appJson.subPackages || []).find((s) => s.root === 'packages/coordination')
  assert.ok(sub, '综合协调分包必须在 app.json 里声明')

  // 2026-08-27：详情改成同页弹层，三个 detail 页退役 —— 分包里只剩三个清单页。
  assert.deepEqual(sub.pages.slice().sort(),
    ['pages/hq/list', 'pages/hr/list', 'pages/xz/list'],
    '分包里只有三个清单页，一个详情页也不剩')

  for (const g of GROUPS) {
    const route = `${BASE}/${g.key}/list`
    assert.ok(!appJson.pages.includes(route), `${route} 同时登记在主包，编译会拒绝`)
    for (const ext of ['.js', '.json', '.wxml']) {
      assert.ok(fs.existsSync(path.join(MP, route + ext)), `${route} 缺 ${ext}`)
    }
    for (const ext of ['.js', '.json', '.wxml', '.wxss']) {
      assert.ok(!fs.existsSync(path.join(MP, `${BASE}/${g.key}/detail${ext}`)),
        `${g.key}/detail${ext} 还在 —— 退役的页面要连文件一起走`)
    }
  }

  for (const tab of appJson.tabBar.list) {
    assert.ok(!tab.pagePath.startsWith('packages/'), `${tab.pagePath} 落进了分包`)
  }
})

test('the subpackage is preloaded from its own navigation entry', () => {
  const rule = appJson.preloadRule['pages/coordination/index']
  assert.ok(rule, '预下载按导航项配置：进综合协调时就把它的分包拉下来')
  assert.deepEqual(rule.packages, ['coordination'])
  assert.equal(rule.network, 'all', 'wifi-only 会让蜂窝网络下的老师白等一次下载')
})

test('the coordination subpackage reads one service module and only one', () => {
  for (const g of GROUPS) {
    const src = read(`${BASE}/${g.key}/list.js`)
    const requires = [...src.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1])
    const services = requires.filter((r) => r.includes('/services/'))
    assert.deepEqual(services, ['../../../../services/coordination'],
      `${g.key}/list 引用了综合协调以外的服务模块`)
  }
})

/**
 * 入口页自 2026-08-26 起按原型 comprehensive-coordination.html 建：三节共七张类目
 * 卡，一类一卡。此前是三条整宽链接（一组一条），所以「点一下到哪里」这件事的粒度
 * 从组变成了类目，卡片因此带着 `coord_category` 走。
 */
const ENTRY_CARDS = [
  ['c1', 'xz', '政策法规'], ['c2', 'xz', '通知文件'], ['c3', 'xz', '组织架构'],
  ['c4', 'hq', '安全管理'], ['c5', 'hq', '卫生保健'],
  ['c6', 'hr', '师德师风'], ['c7', 'hr', '跟岗交流'],
]

test('入口页是原型的三节七卡，每张卡带着自己的类目进对应列表页', async () => {
  const c = await signedIn()
  const entry = loadPage(c, 'pages/coordination/index.js')
  entry.onLoad()

  const sections = entry.data.sections
  assert.deepEqual(sections.map((s) => s.title), ['行政统筹', '后勤保障', '人事管理'])
  assert.deepEqual(sections.map((s) => s.entries.length), [3, 2, 2], '原型是 3／2／2')

  const flat = sections.flatMap((s) => s.entries)
  assert.deepEqual(flat.map((e) => e.key), ENTRY_CARDS.map(([key]) => key))
  for (const entryCard of flat) {
    assert.ok(entryCard.mark && entryCard.label && entryCard.desc && entryCard.tint,
      `${entryCard.key} 少了字标、标题、描述或色调`)
  }

  for (const [key, group, zh] of ENTRY_CARDS) {
    entry.onEntryTap({ currentTarget: { dataset: { key } } })
    assert.deepEqual(
      c.record.navigations.pop(),
      { api: 'navigateTo', url: `/${BASE}/${group}/list?coord_category=${key}` },
      `${zh}：分包页面不是 tab 页，用 navigateTo，并把类目带过去`,
    )
  }
  assert.equal(c.record.toasts.length, 0, '已经落地的入口不再说「尚未上线」')
})

test('带类目进来的列表页停在那一类上，取值不认识时回落到第一类', async () => {
  const c = await signedIn()

  // 后勤那一页有两类。从入口页点「卫生保健」进来，开场就该是卫生保健。
  const hq = loadPage(c, `${BASE}/hq/list.js`)
  await hq.onLoad({ coord_category: 'c5' })
  assert.equal(hq.data.filters.coord_category, 'c5', '不该还停在第一类上')

  // 无参进入（例如从其他页面直达）仍是第一类。
  const plain = loadPage(c, `${BASE}/hq/list.js`)
  await plain.onLoad()
  assert.equal(plain.data.filters.coord_category, 'c4')

  // 不属于本组的类目是我们自己的失误，不能让它变成服务端的 400。
  const stray = loadPage(c, `${BASE}/hq/list.js`)
  await stray.onLoad({ coord_category: 'c1' })
  assert.equal(stray.data.filters.coord_category, 'c4', '回落到第一类，不发一个必然 400 的请求')
})

test('a partner account is refused at the route, not at the row', async () => {
  // §4 规则 20：合作园不得进入综合协调。403 说的是「这个角色能不能走这条路」，
  // 它不泄露任何业务事实；404 才是「这一行归不归你」。
  // `auth.signIn()` 只会以本客户端自己的 surface 登录（一个客户端一个角色，
  // DO-NOT-BUILD 5），所以合作园的令牌直接向 mock 领，再装进这个客户端。
  const c = loadClient({ baseUrl: mock.baseUrl })
  const issued = await fetch(`${mock.baseUrl}/auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ surface: 'partner', js_code: 'mock-js-code' }),
  }).then((r) => r.json())
  c.session.setToken(issued.session_token)

  await assert.rejects(
    () => c.coordination.listDocuments({ coord_category: 'c1' }),
    (err) => err.statusCode === 403 && err.code === 'route_not_allowed_for_role',
    '合作园回 403 route_not_allowed_for_role',
  )
  await assert.rejects(
    () => c.coordination.documentDetail(1),
    (err) => err.statusCode === 403 && err.code === 'route_not_allowed_for_role',
    '详情同样是 403',
  )

  // 客户端这一侧也不给门：综合协调不在合作园的模块清单里。
  assert.ok(!c.guard.PARTNER_MODULES.includes('admin-coordination'))
})
