/**
 * 首页与通知阅读 (ticket 08) — the layering template, tested where it can fail.
 *
 * The subject is not "does the page render": it is that the three template
 * pages hold no logic. So these tests assert the shape the SERVICE returns, and
 * that the page's data is exactly that shape — a page that re-formatted
 * anything would show up as a difference between the two.
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

// ── The four regions arrive view-ready ───────────────────────────────────────

test('首页 aggregates the four regions, each ready to bind', async () => {
  const c = await signedIn()
  const view = await c.home.load()

  // 待办事项 is three stat cards now (2026-08-26 redesign), matching the
  // prototype's 近期任务 grid and the spec's ui=home.todo.* bindings.
  assert.deepEqual(view.stats.map((s) => s.key), ['upload', 'task', 'assessment'], '待办事项')
  const [upload, task, assessment] = view.stats
  assert.equal(upload.badge, '待审核', 'the latest upload record status, mapped, never the raw code')
  // 01 home-spec.md line 90: 显示「待处理 N」, and the fixture holds 10 a1/a2 assigns.
  assert.equal(task.badge, '待处理 10')
  // Numerator/denominator per ui=home.todo.assessment.badge.*; a fresh mock has
  // no completed child assessment, and the fixture class holds 28 children.
  assert.equal(assessment.badge, '0/28')
  for (const s of view.stats) {
    assert.ok(s.mark && s.title, 'every card carries its mark and title')
  }

  // 资源中心通知 is a quick-entry card now; its unread count still arrives.
  assert.equal(view.unreadNotice, 3, 'db_notification.read_at — the fixture holds 3 unread')

  assert.ok(view.cases.length > 0, '推荐课程案例')
  const entries = c.home.quickEntries(true)
  assert.equal(entries.length, 4, '常用入口')
  assert.ok(entries.some((e) => e.key === 'notice'), '通知 gained the entry it never had')
  assert.ok(!entries.some((e) => e.key === 'training'), '教研培训 duplicated the tab and gave way')

  for (const kase of view.cases) {
    assert.ok(kase.thumb_label, 'a card always has a thumb')
    assert.ok(kase.case_name)
  }
})

test('the page binds what the service returned, unchanged', async () => {
  const c = await signedIn()
  const page = loadPage(c, 'pages/home/index.js')
  await page.load()

  const view = await c.home.load()
  assert.deepEqual(page.data.stats, view.stats, 'the page reformats nothing')
  assert.deepEqual(page.data.cases, view.cases)
  assert.equal(page.data.unreadNotice, view.unreadNotice)
  assert.equal(page.data.loading, false)
  assert.equal(page.data.errorText, '')
})

test('an unknown enum degrades to neutral and still shows', async () => {
  const c = await signedIn()
  const view = await c.home.load()

  const unknownCase = view.cases.find((k) => k.case_id === 64)
  assert.ok(unknownCase, 'the card is present, not dropped')
  assert.equal(unknownCase.thumb_label, '案', 'it loses its initial, not its card')
  assert.equal(unknownCase.tag_label, '中班', 'the half that is known still shows')
})

// ── One notice collection, two surfaces ──────────────────────────────────────

test('通知入口的未读数与通知列表说同一件事', async () => {
  const c = await signedIn()
  const view = await c.home.load()
  const page = loadPage(c, 'pages/notice/list.js')
  await page.loadFirst()

  // The three unread rows are the newest, so the list's first page holds them
  // all — the badge and the rows must count the same collection.
  const unreadOnPage = page.data.items.filter((n) => !n.read_at).length
  assert.equal(view.unreadNotice, unreadOnPage, '角标与列表不许各说各话')
})

test('no page names a notice endpoint or formats a time', () => {
  for (const file of ['pages/home/index.js', 'pages/notice/list.js', 'pages/notice/detail.js']) {
    const src = read(file)
    assert.ok(!src.includes('/notices'), `${file} holds no endpoint path`)
    assert.ok(!src.includes('utils/request'), `${file} does not reach the transport`)
    assert.ok(!src.includes('utils/time'), `${file} formats no time`)
    assert.ok(!/present\(/.test(src), `${file} does not map errors itself`)
  }
})

// ── The entries refuse honestly ──────────────────────────────────────────────

test('a quick entry with no screen yet is stopped before the jump', async () => {
  const c = await signedIn()
  const page = loadPage(c, 'pages/home/index.js')
  page.hydrateFromSession()

  assert.equal(page.data.canWrite, true, 'the term is active in this fixture')
  for (const entry of page.data.quickEntries) {
    assert.equal(entry.disabled, false, 'nothing is term-blocked during the term')
  }

  // 通知 gained its quick entry in the 2026-08-26 redesign; it reaches the same
  // NoticeList screen the old section header did.
  page.onQuickTap({ currentTarget: { dataset: { key: 'notice' } } })
  assert.deepEqual(c.record.navigations.pop(), { api: 'navigateTo', url: '/pages/notice/list' })

  // 课程资源 landed in ticket 13, so this half now asserts the jump. 资源库 is the
  // sixth module and the bar holds five, so it reaches its subpackage by page
  // entry rather than by tab — that is the shape being pinned here.
  page.onQuickTap({ currentTarget: { dataset: { key: 'resource' } } })
  assert.equal(c.record.navigations.length, 1, '课程资源 已落地，应当真的跳转')
  assert.equal(c.record.navigations[0].url, '/packages/library/pages/home/index')

  // 案例库 landed in ticket 13, so this half no longer has a refusal to assert —
  // it asserts the jump instead, and the id it carries. 推荐课程案例 cards were
  // deliberately built WITHOUT an id in ticket 08 because there was nowhere to
  // send it; that is the half this pins down now.
  c.record.navigations.length = 0
  c.home.openCase(71)
  assert.equal(c.record.navigations.length, 1, '案例库已落地，应当真的跳转')
  assert.equal(c.record.navigations[0].url, '/packages/library/pages/case/detail?case_id=71')
})

test('every tappable region on 首页 either navigates or gives a reason', async () => {
  const c = await signedIn()
  const page = loadPage(c, 'pages/home/index.js')

  // 案例库 gained its screens in ticket 13. A recommended card carries the id it
  // was tapped on; 全部案例 is a different destination, so it is a different
  // handler — one that opens the list.
  page.onCaseTap({ currentTarget: { dataset: { id: 71 } } })
  assert.deepEqual(c.record.navigations.pop(),
    { api: 'navigateTo', url: '/packages/library/pages/case/detail?case_id=71' })

  page.onCaseMore()
  assert.deepEqual(c.record.navigations.pop(),
    { api: 'navigateTo', url: '/packages/library/pages/case/list' })

  // 待办事项 gained its destination in ticket 10, so the honest answer is now
  // the navigation itself. 票据 15 added a second destination: 待上传 is the
  // upload form's first entry, everything else is still the task board. The
  // card therefore carries its kind, the way the case card carries its id.
  page.onTodoTap({ currentTarget: { dataset: { kind: 'task' } } })
  assert.deepEqual(c.record.navigations.pop(), { api: 'navigateTo', url: '/pages/task/board' })

  page.onTodoTap({ currentTarget: { dataset: { kind: 'upload' } } })
  assert.deepEqual(c.record.navigations.pop(),
    { api: 'navigateTo', url: '/packages/library/pages/upload/form' },
    '待上传进上传表单，且不带目标类型 —— 待办行上没有一列说得出是资源还是案例')

  // The third stat card (2026-08-26 redesign): 质量评估 reaches the scale form,
  // the built counterpart of the prototype's assessment-tool.html.
  page.onTodoTap({ currentTarget: { dataset: { kind: 'assessment' } } })
  assert.deepEqual(c.record.navigations.pop(),
    { api: 'navigateTo', url: '/packages/assessment/pages/scale/index' })
})

// ── Structure: what must not be here ─────────────────────────────────────────

test('the three template screens hold no 观察记录 and no PC后台 path', () => {
  const files = [
    'pages/home/index.js', 'pages/home/index.wxml',
    'pages/notice/list.js', 'pages/notice/list.wxml',
    'pages/notice/detail.js', 'pages/notice/detail.wxml',
  ]
  for (const file of files) {
    const src = read(file)
    assert.ok(!src.includes('观察记录'), `${file}: DO-NOT-BUILD 1`)
    assert.ok(!src.includes('pc-backend') && !src.includes('/admin/'), `${file}: DO-NOT-BUILD 2`)
  }
})

// ── The failure landing is shared ────────────────────────────────────────────

test('a failed 首页 load reports through the one presenter, and retry recovers', async () => {
  const c = await signedIn()
  const page = loadPage(c, 'pages/home/index.js')

  const realRequest = globalThis.wx.request
  globalThis.wx.request = (opts) => {
    globalThis.wx.request = realRequest
    opts.success({
      statusCode: 503,
      data: { code: 'upstream_unavailable', message: '服务暂时不可用', request_id: 'req-h1' },
      header: { 'Retry-After': '600' },
    })
  }
  await page.load()

  assert.equal(page.data.loading, false, 'the spinner always stops')
  assert.ok(page.data.errorText, '中文, from the registry')
  assert.equal(page.data.errorRequestId, 'req-h1', 'the trace id a teacher can report')
  assert.equal(page.data.errorCanRetry, true, 'a transient failure offers the retry entry')

  await page.load()
  assert.equal(page.data.errorText, '', 'the retry cleared it')
  assert.ok(page.data.cases.length > 0)
})

/**
 * The four below come from the ticket-08 review. Each one is a bug the suite
 * did NOT catch when it was 59 tests green, which is the only reason they are
 * worth their lines.
 */

test('no region claims 暂无 while an error is on screen', () => {
  for (const file of ['pages/home/index.wxml', 'pages/notice/list.wxml']) {
    const empties = read(file).split('\n').filter((line) => line.includes('hl-empty'))
    assert.ok(empties.length > 0, `${file} has empty states to check`)
    for (const line of empties) {
      // loading / empty / failed are three states. A read that failed leaves the
      // arrays empty too, so an ungated 暂无 turns "we could not read" into
      // "there is nothing to do" — the one lie this screen must not tell.
      assert.match(line, /!errorText/, `${file}: 空态必须与失败态互斥 — ${line.trim()}`)
    }
  }
})

test('a failed refresh leaves the list able to grow again', async () => {
  const c = await signedIn()
  const page = loadPage(c, 'pages/notice/list.js')
  await page.loadFirst()
  const cursorBefore = page.data.cursor
  assert.ok(cursorBefore, 'the fixture is longer than one page')

  const realRequest = globalThis.wx.request
  globalThis.wx.request = (opts) => {
    globalThis.wx.request = realRequest
    opts.success({ statusCode: 500, data: { code: 'internal_error', message: '服务出错' }, header: {} })
  }
  await page.loadFirst()

  assert.ok(page.data.errorText, 'the refresh failed')
  assert.equal(page.data.cursor, cursorBefore, 'the cursor survived — it was not silently dropped')
  assert.equal(page.data.exhausted, false, 'a failed refresh is not the end of the list')

  const sent = c.record.requests.length
  await page.loadMore()
  assert.ok(c.record.requests.length > sent, 'the next 上滑 still reaches the server')
})

test('a list wired without fetchPage fails at construction, not as a fake server error', async () => {
  const c = await signedIn()
  assert.throws(
    () => c.listPage.createListMethods({}),
    /fetchPage/,
    'a wiring slip must not reach a teacher dressed as 操作未能完成',
  )
})

test('reportFailure clears the loading flag even when the session is dead', async () => {
  const c = await signedIn()
  const page = { data: {}, setData(patch) { Object.assign(this.data, patch) } }
  const err = new c.errors.ApiError({ statusCode: 401, code: 'session_revoked', message: '登录状态已失效' })

  c.reportFailure(page, err, { loading: false })

  assert.equal(page.data.loading, false, 'the flag the caller handed over was honoured')
  assert.equal(page.data.errorText, undefined, 'and nothing was rendered — the session ended instead')
  assert.equal(c.session.getToken(), null)
})

test('an expired session on 首页 ends the session instead of rendering an error', async () => {
  const c = await signedIn()
  const page = loadPage(c, 'pages/home/index.js')

  c.session.setToken('a-token-the-server-never-issued')
  await page.load()

  assert.equal(page.data.errorText, '', 'no error banner for a dead session')
  assert.equal(c.session.getToken(), null, 'the local session was dropped')
  assert.deepEqual(c.record.navigations.pop(), { api: 'reLaunch', url: '/pages/login/index' })
})
