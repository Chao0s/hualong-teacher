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

  assert.ok(view.todos.length > 0, '待办事项')
  assert.equal(view.todoCount, view.todos.length, '待处理数量 is computed for the page')
  assert.ok(view.notices.length > 0, '资源中心通知')
  assert.ok(view.cases.length > 0, '推荐课程案例')
  assert.equal(c.home.quickEntries(true).length, 4, '常用入口')

  // View-ready means: no raw wire value reaches a binding.
  for (const todo of view.todos) {
    assert.ok(todo.kind_label, 'every todo carries its label')
    assert.ok(todo.pill_class, 'and its pill class')
    if (todo.due_at) assert.match(todo.due_label, /^\d{2}-\d{2} \d{2}:\d{2}$/)
  }
  for (const n of view.notices) {
    assert.match(n.published_label, /^\d{2}-\d{2} \d{2}:\d{2}$/, 'formatted in the service')
  }
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
  assert.deepEqual(page.data.todos, view.todos, 'the page reformats nothing')
  assert.deepEqual(page.data.notices, view.notices)
  assert.deepEqual(page.data.cases, view.cases)
  assert.equal(page.data.todoCount, view.todoCount)
  assert.equal(page.data.loading, false)
  assert.equal(page.data.errorText, '')
})

test('an unknown enum degrades to neutral and still shows — todo AND case', async () => {
  const c = await signedIn()
  const view = await c.home.load()

  const unknownTodo = view.todos.find((t) => t.todo_kind === 'z9_future_kind')
  assert.ok(unknownTodo, 'the row is present, not dropped')
  assert.equal(unknownTodo.pill_class, 'hl-pill--unknown')
  assert.equal(unknownTodo.kind_label, '待办', 'neutral, never the raw code')

  const unknownCase = view.cases.find((k) => k.case_id === 64)
  assert.ok(unknownCase, 'the card is present, not dropped')
  assert.equal(unknownCase.thumb_label, '案', 'it loses its initial, not its card')
  assert.equal(unknownCase.tag_label, '中班', 'the half that is known still shows')
})

// ── One notice implementation, two views ─────────────────────────────────────

test('首页 notice summary and 通知列表页 are the same read', async () => {
  const c = await signedIn()
  const summary = await c.notice.summary()
  const page = loadPage(c, 'pages/notice/list.js')
  await page.loadFirst()

  assert.equal(summary.length, c.notice.SUMMARY_LIMIT, '首页 asks for the few it shows')
  assert.ok(page.data.items.length > summary.length, 'the list asks for the default page')
  // Same collection, same ordering, same decoration — row for row.
  for (let i = 0; i < summary.length; i += 1) {
    assert.deepEqual(page.data.items[i], summary[i], `row ${i} is identical`)
  }
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

  page.onQuickTap({ currentTarget: { dataset: { key: 'moment' } } })
  assert.equal(c.record.navigations.length, 0, 'no navigation happened')
  assert.match(c.record.toasts.pop().title, /尚未上线/, 'and it said why')
})

test('every tappable region on 首页 either navigates or gives a reason', async () => {
  const c = await signedIn()
  const page = loadPage(c, 'pages/home/index.js')

  page.onCaseTap()
  assert.match(c.record.toasts.pop().title, /案例库尚未上线/)

  page.onTodoTap()
  assert.match(c.record.toasts.pop().title, /看板尚未上线/)

  assert.equal(c.record.navigations.length, 0, 'nothing dead-ended into a jump')
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

test('an expired session on 首页 ends the session instead of rendering an error', async () => {
  const c = await signedIn()
  const page = loadPage(c, 'pages/home/index.js')

  c.session.setToken('a-token-the-server-never-issued')
  await page.load()

  assert.equal(page.data.errorText, '', 'no error banner for a dead session')
  assert.equal(c.session.getToken(), null, 'the local session was dropped')
  assert.deepEqual(c.record.navigations.pop(), { api: 'reLaunch', url: '/pages/login/index' })
})
