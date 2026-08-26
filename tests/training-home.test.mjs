/**
 * 教研培训入口页（TrainHome）—— 按原型 training-center.html 重建。
 *
 * 园方 2026-08-26 裁定：原型是版面权威。这一页原来只画两组共五条整宽链接，一个请求
 * 都不发；原型上是顶部推荐轮播、三张快捷入口卡、推荐资源与推荐案例两节。
 *
 * 这一组测试盯住重建之后最容易悄悄坏掉的五件事：
 *
 *   1. 三块内容同出一张**管理员维护的**推荐表，不是按教师算的（ADR-0011 /
 *      DO-NOT-BUILD 6：没有画像、没有排序信号）。
 *   2. 推荐位上只能出现**已通过**（s3）且**仍在推荐中**（is_visible）的内容。
 *      夹具里各埋了一条反例，少了它们，一个不过滤的实现也会通过。
 *   3. 顶部推荐可以混型别：一张卡是资源、下一张是案例，去向因此不同。
 *   4. 快捷入口**只有三张**，与原型逐字一致。量表与五维图不在其中。
 *   5. 空与失败是两种状态；空态还要说清楚怎么才会有内容。
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

const ENTRY = 'pages/training/index'

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

async function openEntry(c) {
  const page = loadPage(c, `${ENTRY}.js`)
  page.onLoad()
  await page.load()
  return page
}

// ── 一个请求，三块内容 ───────────────────────────────────────────────────────

test('无会话就不读：入口页回登录页，一个请求也不发', () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  const page = loadPage(c, `${ENTRY}.js`)
  page.onLoad()

  assert.equal(page.data.ready, false, '未通过会话门的页面不渲染')
  assert.equal(c.record.requests.length, 0, '也不发请求')
  assert.deepEqual(c.record.navigations.pop(), { api: 'reLaunch', url: '/pages/login/index' })
})

test('入口页一次读回顶部推荐、推荐资源与推荐案例', async () => {
  const c = await signedIn()
  c.record.requests.length = 0
  await c.training.trainingHome()

  const sent = c.record.requests
  assert.equal(sent.length, 1, '三块内容一个请求读回，不是三个')
  assert.equal(sent[0].method, 'GET')
  assert.match(sent[0].url, /\/training\/home$/, '聚合端点，路径后面什么都不跟')
  // §7.3 / DO-NOT-BUILD 8：派生的作者字段永不发送。
  for (const derived of ['teacher_id', 'created_by', 'school_id']) {
    assert.ok(!sent[0].url.includes(derived), `客户端送了派生字段 ${derived}`)
  }

  const page = await openEntry(c)
  assert.ok(page.data.featured.length > 0, '顶部推荐')
  assert.ok(page.data.resources.length > 0, '推荐资源')
  assert.ok(page.data.cases.length > 0, '推荐案例')
  assert.equal(page.data.loading, false)
  assert.equal(page.data.errorText, '')

  // View-ready：没有一个原始值到得了绑定。
  for (const slide of page.data.featured) {
    assert.ok(slide.kicker && slide.title, '轮播卡带着自己的眉题与标题')
    assert.ok(slide.target_id, '以及它的去向 id')
    assert.ok(['c1', 'c2'].includes(slide.content_type))
  }
  for (const row of [...page.data.resources, ...page.data.cases]) {
    assert.ok(row.thumb_label && row.name && row.badge, `${row.name} 少了缩略字、标题或徽章`)
  }
})

test('三块都按 spec 取三条封顶', async () => {
  const c = await signedIn()
  const view = await c.training.trainingHome()
  for (const [key, rows] of Object.entries(view)) {
    assert.ok(rows.length <= 3, `${key} 回了 ${rows.length} 条，spec 是 LIMIT 3`)
  }
})

// ── 推荐位上只能是已通过、且仍在推荐中的内容 ─────────────────────────────────

test('未通过审核的内容不进推荐位，即使推荐行还在', async () => {
  const c = await signedIn()
  const view = await c.training.trainingHome()

  // 夹具里 407 号推荐指着 resource_id=3，那条资源是草稿（s1）。
  const ids = [...view.featured.map((f) => f.target_id), ...view.resources.map((r) => r.resource_id)]
  assert.ok(!ids.includes(3), '草稿资源不得出现在推荐位上')
})

test('管理员取消推荐后那一条就消失，不靠客户端过滤', async () => {
  const c = await signedIn()
  const view = await c.training.trainingHome()

  // 夹具里 408 号推荐 is_visible=false，指着 case_id=117。
  const ids = [...view.featured.map((f) => f.target_id), ...view.cases.map((k) => k.case_id)]
  assert.ok(!ids.includes(117), '已取消的推荐不得出现')
})

// ── 轮播可以混型别，去向因此不同 ─────────────────────────────────────────────

test('轮播卡按自己的类型进不同的详情页', async () => {
  const c = await signedIn()
  const page = await openEntry(c)

  const resourceSlide = page.data.featured.find((f) => f.content_type === 'c1')
  const caseSlide = page.data.featured.find((f) => f.content_type === 'c2')
  assert.ok(resourceSlide && caseSlide, '夹具里两种类型都要有，否则这条断言什么也没证明')

  page.onFeaturedTap({ currentTarget: { dataset: { type: 'c1', id: resourceSlide.target_id } } })
  assert.deepEqual(c.record.navigations.pop(), {
    api: 'navigateTo',
    url: `/packages/library/pages/resource/detail?resource_id=${resourceSlide.target_id}`,
  })

  page.onFeaturedTap({ currentTarget: { dataset: { type: 'c2', id: caseSlide.target_id } } })
  assert.deepEqual(c.record.navigations.pop(), {
    api: 'navigateTo',
    url: `/packages/library/pages/case/detail?case_id=${caseSlide.target_id}`,
  })
})

test('两节的行卡与「全部」各进各的去处', async () => {
  const c = await signedIn()
  const page = await openEntry(c)

  page.onResourceTap({ currentTarget: { dataset: { id: 30 } } })
  assert.deepEqual(c.record.navigations.pop(),
    { api: 'navigateTo', url: '/packages/library/pages/resource/detail?resource_id=30' })

  page.onCaseTap({ currentTarget: { dataset: { id: 120 } } })
  assert.deepEqual(c.record.navigations.pop(),
    { api: 'navigateTo', url: '/packages/library/pages/case/detail?case_id=120' })

  page.onMoreTap({ currentTarget: { dataset: { key: 'resource' } } })
  assert.deepEqual(c.record.navigations.pop(),
    { api: 'navigateTo', url: '/packages/library/pages/resource/list' })

  page.onMoreTap({ currentTarget: { dataset: { key: 'case' } } })
  assert.deepEqual(c.record.navigations.pop(),
    { api: 'navigateTo', url: '/packages/library/pages/case/list' })
})

// ── 快捷入口就是原型的三张 ───────────────────────────────────────────────────

test('快捷入口只有三张，与原型逐字一致，且三张都通', async () => {
  const c = await signedIn()
  const page = await openEntry(c)

  assert.deepEqual(page.data.quickEntries.map((e) => e.label),
    ['课程建设', '课程资源', '教研培训'], '原型 training-center.html 的 `.entry-grid`')

  const expected = {
    course: '/packages/training/pages/course/detail',
    resource: '/packages/library/pages/home/index',
    train: '/packages/training/pages/train/list',
  }
  for (const [key, url] of Object.entries(expected)) {
    page.onQuickTap({ currentTarget: { dataset: { key } } })
    assert.deepEqual(c.record.navigations.pop(), { api: 'navigateTo', url }, key)
  }
  assert.equal(c.record.toasts.length, 0, '三张都已落地，没有一句「尚未上线」')
})

test('量表与五维图不在这一页上 —— 它们换了门', async () => {
  const c = await signedIn()
  const page = await openEntry(c)
  const labels = page.data.quickEntries.map((e) => e.label)
  assert.ok(!labels.includes('填写五大领域量表'), '量表从首页的质量评估卡进')
  assert.ok(!labels.includes('评价五维图'), '五维图从量表页内进')
})

// ── 空与失败是两种状态 ───────────────────────────────────────────────────────

test('读失败时两节都不说「暂无」', () => {
  const empties = read(`${ENTRY}.wxml`).split('\n').filter((line) => line.includes('hl-card hl-empty'))
  assert.ok(empties.length >= 2, '两节各有空态')
  for (const line of empties) {
    // loading / empty / failed 是三种状态。读失败时数组也是空的，一个不设防的
    // 「暂无」会把「读不到」说成「没有内容」。
    assert.match(line, /!errorText/, `空态必须与失败态互斥 — ${line.trim()}`)
  }
})

test('空态说清楚怎么才会有内容', () => {
  const src = read(`${ENTRY}.wxml`)
  assert.match(src, /暂无推荐资源/)
  assert.match(src, /暂无推荐案例/)
  assert.match(src, /审核通过并设置为推荐后/, 'spec 的 empty_description，照抄')
})

test('顶部推荐为空时整块不画，不是画一个空壳', () => {
  const src = read(`${ENTRY}.wxml`)
  assert.match(src, /wx:if="\{\{featured\.length > 0\}\}"/,
    'spec: IF featured_count=0, show_featured=0')
})

test('一次失败的读取报到同一个出口，重试能恢复', async () => {
  const c = await signedIn()
  const page = loadPage(c, `${ENTRY}.js`)
  page.onLoad()

  const realRequest = globalThis.wx.request
  globalThis.wx.request = (opts) => {
    globalThis.wx.request = realRequest
    opts.success({
      statusCode: 503,
      data: { code: 'upstream_unavailable', message: '服务暂时不可用', request_id: 'req-t1' },
      header: { 'Retry-After': '600' },
    })
  }
  await page.load()

  assert.equal(page.data.loading, false, '转圈总会停')
  assert.ok(page.data.errorText, '中文，来自登记表')
  assert.equal(page.data.errorRequestId, 'req-t1')
  assert.equal(page.data.errorCanRetry, true)

  await page.load()
  assert.equal(page.data.errorText, '', '重试清掉了它')
  assert.ok(page.data.featured.length > 0)
})

// ── 分层 ─────────────────────────────────────────────────────────────────────

test('页面不持有端点路径，也不自己格式化', () => {
  // 只看代码：头注里点名那条聚合端点是有用的交代，不是一份藏在页面里的路由表。
  const code = read(`${ENTRY}.js`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(!code.includes('/training/'), '端点在服务层')
  assert.ok(!code.includes('utils/request'), '页面不碰传输层')
  assert.ok(!code.includes('utils/time'), '页面不格式化时间')
})

test('入口页不再读 module-entry —— 它的版面由原型说了算', () => {
  const src = read(`${ENTRY}.js`)
  assert.ok(!src.includes('module-entry'), '两组整宽链接的形状已经退役')
})
