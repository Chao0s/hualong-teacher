/**
 * 党建管理入口页（PartyHome）—— `GET /party/home` 的第一次调用。
 *
 * 这条聚合端点在契约里躺了很久没人调：入口页原来只画三条整宽链接，一个请求都不发。
 * 这一组测试盯住重建之后最容易悄悄坏掉的四件事：
 *
 *   1. 轮播是**派生结果**。取 3 条，不足回实际笔数，客户端既不排序也不补位。
 *      F7 拔掉的是 `db_party_feature` 那张挑选表，不是轮播本身（契约 §4 规则 19）。
 *   2. 三个分区各画各的，空与失败是两种状态。
 *   3. 「预览」与「下载」调的是**同一个端点**。党建学习没有 download-link，
 *      唯一的取档能力是 `GET /media/files/{file_id}/url`。一个测试盯着这一点，
 *      下一个人就不会以为有两条路径。
 *   4. 页面不持有端点路径。
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

const ENTRY = 'pages/party-building/index'

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

// ── 会话门 ───────────────────────────────────────────────────────────────────

test('no session means no read: the entry page goes back to login instead of fetching', () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  const page = loadPage(c, `${ENTRY}.js`)
  page.onLoad()

  assert.equal(page.data.ready, false, '未通过会话门的页面不渲染')
  assert.equal(c.record.requests.length, 0, '也不发请求')
  assert.deepEqual(c.record.navigations.pop(), { api: 'reLaunch', url: '/pages/login/index' })
})

// ── 一个请求，四个分区 ───────────────────────────────────────────────────────

test('the whole page is one aggregate read, and it sends nothing but the path', async () => {
  const c = await signedIn()
  await c.party.partyHome()

  const sent = c.record.requests.pop()
  assert.equal(sent.method, 'GET')
  assert.match(sent.url, /\/party\/home$/, '聚合端点，路径后面什么都不跟')
  // §4 规则 19：这一页不搜索、不筛选、不翻页。
  for (const banned of ['limit=', 'cursor=', 'page=', 'offset=']) {
    assert.ok(!sent.url.includes(banned), `入口页不分页，出现了 ${banned}`)
  }
  // §7.3 / DO-NOT-BUILD 8：派生的作者字段永不发送。
  for (const derived of ['teacher_id', 'created_by', 'school_id']) {
    assert.ok(!sent.url.includes(derived), `客户端送了派生字段 ${derived}`)
  }
})

test('one read fills all four regions — the page does not fetch three more times', async () => {
  const c = await signedIn()
  const before = c.record.requests.length
  const view = await c.party.partyHome()

  assert.equal(c.record.requests.length - before, 1, '四个分区来自同一个请求')
  assert.ok(view.carousel.length > 0)
  assert.ok(view.studies.length > 0)
  assert.ok(view.activities.length > 0)
  assert.ok(view.brands.length > 0)
})

// ── 轮播 ─────────────────────────────────────────────────────────────────────

test('the carousel is three, newest first, and the client neither sorts nor pads', async () => {
  const c = await signedIn()
  const view = await c.party.partyHome()

  assert.equal(view.carousel.length, 3, '§4 规则 19：取 3 条')
  // 夹具按 `published_at DESC, study_id DESC` 排好，服务端切片，客户端原样接。
  assert.deepEqual(view.carousel.map((s) => s.study_id), [23, 22, 21], '顺序由服务端定')
})

test('fewer than three published studies means fewer than three slides, not a padded three', async () => {
  const c = await signedIn()
  answerOnce({
    statusCode: 200,
    data: {
      carousel: [
        { study_id: 9, study_title: '仅有的一条', study_type: 't1', published_at: '2026-06-18T09:10:00+08:00', excerpt: '…' },
      ],
      latest_studies: [],
      latest_activities: [],
      latest_brands: [],
    },
  })
  const view = await c.party.partyHome()

  assert.equal(view.carousel.length, 1, '不足就是不足，客户端不补位')
  assert.equal(view.studies.length, 0)
})

test('a slide carries one ready-made subtitle — the page composes nothing', async () => {
  const c = await signedIn()
  const view = await c.party.partyHome()

  for (const slide of view.carousel) {
    assert.ok(slide.study_title, '标题')
    // 原型 `.banner-sub` 的三段：类型 · 日期 · 一句提示。
    assert.match(slide.sub_label, /^[^·]+ · \d{2}-\d{2} · 点击查看最近发布的学习文件$/)
    assert.ok(!/t\d/.test(slide.sub_label), `界面上出现了枚举原值：${slide.sub_label}`)
  }
})

// ── 三个分区 ─────────────────────────────────────────────────────────────────

test('every row of every region arrives ready to bind — no page-side formatting', async () => {
  const c = await signedIn()
  const view = await c.party.partyHome()

  for (const row of view.studies) {
    assert.ok(row.type_label && !/^t\d$/.test(row.type_label), '类型是字不是码')
    // 入口页一行放不下钟点，所以日期只到日。
    assert.match(row.day_label, /^\d{2}-\d{2}$/)
  }
  for (const row of view.activities) {
    assert.equal(row.kind_label, '活动介绍', '固定词，活动表没有类型列（F7）')
    assert.match(row.day_label, /^\d{2}-\d{2}$/)
  }
  for (const row of view.brands) {
    assert.equal(row.kind_label, '主题图文')
    assert.ok(Array.isArray(row.tags), '`brand_tag` 可空，服务层兜成数组')
    assert.ok(row.tags.length <= 2, '原型一行只放得下两个标签')
  }
})

test('a null brand_tag becomes an empty array, never a crash and never the word null', async () => {
  const c = await signedIn()
  answerOnce({
    statusCode: 200,
    data: {
      carousel: [],
      latest_studies: [],
      latest_activities: [],
      latest_brands: [
        { brand_id: 6, brand_title: '没有标签的一条', brand_content: '…', brand_tag: null, published_at: '2026-05-06T08:45:00+08:00', brand_status: 's3' },
      ],
    },
  })
  const view = await c.party.partyHome()

  assert.deepEqual(view.brands[0].tags, [])
})

test('the page renders three regions from the one read', async () => {
  const c = await signedIn()
  const page = loadPage(c, `${ENTRY}.js`)
  page.onLoad()
  await page.load()

  assert.equal(page.data.ready, true)
  assert.equal(page.data.loading, false)
  assert.equal(page.data.carousel.length, 3)
  assert.ok(page.data.studies.length > 0, '党建学习')
  assert.ok(page.data.activities.length > 0, '党建活动')
  assert.ok(page.data.brands.length > 0, '品牌建设')
  assert.equal(page.data.slide, 0, '指示点从第一张开始')
})

test('an empty module and a failed read are two different things on screen', async () => {
  const c = await signedIn()

  // 空：三句说明，没有错误横幅，也没有轮播（spec: study_count=0 -> show_banner=0）。
  const empty = loadPage(c, `${ENTRY}.js`)
  answerOnce({
    statusCode: 200,
    data: { carousel: [], latest_studies: [], latest_activities: [], latest_brands: [] },
  })
  await empty.load()
  assert.equal(empty.data.carousel.length, 0)
  assert.equal(empty.data.studies.length, 0)
  assert.equal(empty.data.errorText, '', '空模块不喊失败')

  // 失败：错误横幅，且三个区都**不得**同时说「暂无」——WXML 用 `!errorText` 分。
  const failed = loadPage(c, `${ENTRY}.js`)
  answerOnce({
    statusCode: 500,
    data: { code: 'internal_error', message: '服务出错', request_id: 'req-ph1' },
  })
  await failed.load()
  assert.equal(failed.data.studies.length, 0)
  assert.ok(failed.data.errorText, '读失败要说出来')
  assert.equal(failed.data.errorRequestId, 'req-ph1')
  assert.equal(failed.data.errorCanRetry, true)

  const wxml = read(`${ENTRY}.wxml`)
  for (const region of ['studies', 'activities', 'brands']) {
    assert.ok(
      wxml.includes(`${region}.length === 0 && !errorText`),
      `${region} 的空态没有排除失败态`,
    )
  }
})

// ── 「全部 ›」 ───────────────────────────────────────────────────────────────

test('each region heading opens its own list page', async () => {
  const targets = {
    learn: '/packages/party/pages/learn/list',
    activity: '/packages/party/pages/activity/list',
    brand: '/packages/party/pages/brand/list',
  }
  for (const [key, url] of Object.entries(targets)) {
    const c = await signedIn()
    const page = loadPage(c, `${ENTRY}.js`)
    page.onLoad()
    page.onEntryTap({ currentTarget: { dataset: { key } } })

    assert.deepEqual(
      c.record.navigations.pop(),
      { api: 'navigateTo', url },
      '分包页面不是 tab 页，用 navigateTo',
    )
    assert.equal(c.record.toasts.length, 0, '三个入口都已落地，不说「尚未上线」')
  }
})

test('the three headings carry the module-entry keys, not hand-written routes', () => {
  const wxml = read(`${ENTRY}.wxml`)
  for (const key of ['learn', 'activity', 'brand']) {
    assert.ok(wxml.includes(`data-key="${key}"`), `「全部 ›」缺 ${key}`)
  }
  // 去向只有 module-entry 一处声明；页面里不得再抄一份列表页路由。
  for (const route of ['learn/list', 'activity/list', 'brand/list']) {
    assert.ok(!wxml.includes(route), `页面模板里写死了列表页路由 ${route}`)
  }
})

test('a card opens its own detail page', async () => {
  const c = await signedIn()
  const page = loadPage(c, `${ENTRY}.js`)
  page.onLoad()
  await page.load()

  page.onStudyTap({ currentTarget: { dataset: { id: 23 } } })
  assert.deepEqual(c.record.navigations.pop(),
    { api: 'navigateTo', url: '/packages/party/pages/learn/detail?study_id=23' })

  page.onActivityTap({ currentTarget: { dataset: { id: 21 } } })
  assert.deepEqual(c.record.navigations.pop(),
    { api: 'navigateTo', url: '/packages/party/pages/activity/detail?activity_id=21' })

  page.onBrandTap({ currentTarget: { dataset: { id: 22 } } })
  assert.deepEqual(c.record.navigations.pop(),
    { api: 'navigateTo', url: '/packages/party/pages/brand/detail?brand_id=22' })
})

// ── 预览与下载：两个按钮，一条契约能力 ───────────────────────────────────────

/** The wire calls a tap made, in order, without the login traffic. */
function trace(c, from) {
  return c.record.requests.slice(from).map((r) => r.url.replace(c.config.env.baseUrl, ''))
}

test('preview and download call the SAME endpoint — 党建学习 has no download-link', async () => {
  const c = await signedIn()
  const page = loadPage(c, `${ENTRY}.js`)
  page.onLoad()
  await page.load()

  const beforePreview = c.record.requests.length
  await page.onPreviewTap({ currentTarget: { dataset: { id: 23 } } })
  const preview = trace(c, beforePreview)

  const beforeDownload = c.record.requests.length
  await page.onDownloadTap({ currentTarget: { dataset: { id: 23 } } })
  const download = trace(c, beforeDownload)

  assert.deepEqual(preview, download, '两个按钮走的是同一串请求，一个字都不差')
  // 那一串是：详情拿 file_id，再签一条短时读取 URL。没有第三条路。
  assert.equal(preview.length, 2)
  assert.match(preview[0], /^\/party\/studies\/23$/, '卡片形状没有 file_refs，只能先读详情')
  assert.match(preview[1], /^\/media\/files\/7023\/url\?/, '§8.4：取档另走签名端点')
  assert.match(preview[1], /owner_object=db_party_study/, 'owner 首先是授权参数')
  assert.match(preview[1], /owner_id=23/)
  // 登记表里党建学习没有 download-link，那是资源库与案例库才有的。
  assert.ok(!download.some((u) => u.includes('download-link')), '不存在的端点不得被调用')
})

test('the two buttons differ only after the bytes arrive: 下载 opens the save menu', async () => {
  const c = await signedIn()
  const page = loadPage(c, `${ENTRY}.js`)
  page.onLoad()
  await page.load()

  await page.onPreviewTap({ currentTarget: { dataset: { id: 23 } } })
  assert.equal(c.record.opened.length, 1, '签完就打开')
  assert.equal(c.record.opened[0].fileType, 'pdf')
  assert.equal(c.record.opened[0].showMenu, false, '预览不开菜单')

  await page.onDownloadTap({ currentTarget: { dataset: { id: 23 } } })
  assert.equal(c.record.opened[1].showMenu, true, '小程序没有下载目录，右上角菜单就是「存下来」')
  assert.ok(c.record.toasts.pop().title.includes('右上角'), '要告诉教师文件去了哪里')
})

test('each tap signs a fresh URL — a short-lived address is never reused', async () => {
  const c = await signedIn()
  const page = loadPage(c, `${ENTRY}.js`)
  page.onLoad()
  await page.load()

  await page.onPreviewTap({ currentTarget: { dataset: { id: 23 } } })
  const first = c.record.requests.length
  await page.onPreviewTap({ currentTarget: { dataset: { id: 23 } } })

  assert.equal(c.record.requests.length - first, 2, '第二次点击重新读详情、重新签名')
})

test('a study whose file the phone cannot open is refused in words, before any signing', async () => {
  const c = await signedIn()
  answerOnce({
    statusCode: 200,
    data: {
      study_id: 3, study_title: '一份压缩包', study_type: 't1',
      study_content: '…', published_at: '2026-06-03T09:10:00+08:00', study_status: 's3',
      file_refs: [{ file_id: 7003, usage_key: 'main_file', file_name: '材料汇编.zip', file_size: 10 }],
    },
  })
  await c.party.openStudyFile(3, false)

  assert.ok(
    !c.record.requests.some((r) => r.url.includes('/media/files/')),
    '格式先拦下，签名那一步没有白跑',
  )
  assert.equal(c.record.opened.length, 0)
  assert.ok(c.record.toasts.pop().title.includes('电脑'), '打不开就说清楚')
})

// ── 分层 ─────────────────────────────────────────────────────────────────────

/** 去掉注释：注释里写着「这一页读 /party/home」是文档，不是持有。 */
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('the page holds no endpoint path and no transport of its own', () => {
  const src = codeOnly(read(`${ENTRY}.js`))
  for (const endpoint of ['/party/home', '/party/studies', '/party/activities', '/party/brands', '/media/files']) {
    assert.ok(!src.includes(endpoint), `页面持有端点路径 ${endpoint}`)
  }
  const requires = [...src.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1])
  assert.ok(!requires.includes('../../utils/request'), '页面不直接使用传输层')
  assert.deepEqual(
    requires.filter((r) => r.includes('/services/')).sort(),
    ['../../services/party'],
    // 2026-08-27 之前还有一个 `services/module-entry`，那是四个入口页共用同一种版面
    // 时的入口表。四页各按原型重建之后它退役了，三条「全部 ›」的去向搬进了党建服务
    // 自己（`openSection`），所以这一页现在只读一个服务模块。
    '入口页只读党建服务，不读第二个服务模块',
  )
})

test('the page formats no time of its own and builds no Date', () => {
  const src = read(`${ENTRY}.js`)
  assert.ok(!src.includes('new Date'), '§1.2：客户端一个 Date 也不建')
  assert.ok(!src.includes('Date.now'), '页面不读时钟')
  // 时间文案在服务层算好，页面只绑 `*_label`。
  assert.ok(!/toLocale|padStart/.test(src), '页面里出现了时间格式化')
})
