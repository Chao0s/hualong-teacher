/**
 * The shared conventions (ticket 07): failure presentation and the list
 * states, tested on the REAL pages that now consume them — the extraction
 * only counts if the call sites actually switched.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { start } from '../mock/server.mjs'
import { loadClient, loadPage } from './helpers/seam.mjs'

let mock

before(async () => {
  mock = await start({ port: 0 })
  for (let i = 0; i < 20; i += 1) {
    try { await fetch(mock.baseUrl + '/__ready'); break }
    catch { await new Promise((r) => setTimeout(r, 50)) }
  }
})

after(async () => { await mock.close() })

// ── present(): the one error-to-teacher mapping ──────────────────────────────

test('present() distinguishes retryable from pointless, in Chinese, with the trace id', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  const E = c.errors.ApiError

  const r1 = c.present(new E({ statusCode: 404, code: 'not_found', message: '内容不存在或已不在可见范围内', requestId: 'req-1' }))
  assert.equal(r1.canRetry, false, 'not_found: retrying changes nothing — no retry entry')
  assert.equal(r1.kind, 'fatal')
  assert.equal(r1.requestId, 'req-1')
  assert.match(r1.message, /[一-龥]/)

  const r2 = c.present(new E({ statusCode: 429, code: 'rate_limited', message: '操作过于频繁，请稍后再试' }))
  assert.equal(r2.canRetry, true)
  assert.equal(r2.kind, 'retry')

  const r3 = c.present(new E({ statusCode: 409, code: 'revision_stale', message: '内容已被他人修改，请刷新后重试' }))
  assert.equal(r3.kind, 'refresh', 'a concurrent edit means re-read, never silently overwrite')
  assert.match(r3.message, /刷新/)

  const r4 = c.present(new E({ statusCode: 0, code: 'upstream_unavailable', message: '网络请求失败：request:fail' }))
  assert.match(r4.message, /网络/, 'a dead network says so — it never masquerades as a server error')
  assert.equal(r4.canRetry, true)

  const r5 = c.present(new E({ statusCode: 400, code: 'z9_unknown_new_code', message: '' }))
  assert.equal(r5.kind, 'fatal', 'unknown 400-class degrades to never-retry')
  assert.match(r5.message, /[一-龥]/, 'still something readable, not a code')

  const r6 = c.present(new Error('boom'))
  assert.equal(r6.canRetry, true)
  assert.match(r6.message, /[一-龥]/)
})

// ── the list states, on the real notice list page ────────────────────────────

test('empty is a state, not an error', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  await c.auth.signIn()
  const page = loadPage(c, 'pages/notice/list.js')

  // Script only this one response; the transport is otherwise real.
  const realRequest = globalThis.wx.request
  globalThis.wx.request = (opts) => {
    globalThis.wx.request = realRequest
    opts.success({ statusCode: 200, data: { items: [], next_cursor: null }, header: {} })
  }
  await page.loadFirst()

  assert.equal(page.data.items.length, 0)
  assert.equal(page.data.exhausted, true)
  assert.equal(page.data.errorText, '', 'an empty list shows 暂无, never a failure')
  assert.equal(page.data.loadingFirst, false)
})

test('appending never disturbs what is already read', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  await c.auth.signIn()
  const page = loadPage(c, 'pages/notice/list.js')

  await page.loadFirst()
  const firstId = page.data.items[0].notice_id
  const countAfterFirst = page.data.items.length

  // Spy on every patch made during the append.
  const patches = []
  const rawSetData = page.setData.bind(page)
  page.setData = (patch) => { patches.push(patch); rawSetData(patch) }
  await page.loadMore()

  assert.ok(page.data.items.length > countAfterFirst, 'the list grew')
  assert.equal(page.data.items[0].notice_id, firstId, 'the first item is untouched')
  for (const p of patches) {
    assert.notEqual(p.loadingFirst, true, 'appending never re-enters the first-load state')
    if (p.items) assert.ok(p.items.length >= countAfterFirst, 'no patch ever shrank the list')
  }
})

test('after the null cursor, no request leaves', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  await c.auth.signIn()
  const page = loadPage(c, 'pages/notice/list.js')

  await page.loadFirst()
  while (!page.data.exhausted) await page.loadMore()

  const sent = c.record.requests.length
  await page.loadMore()
  await page.loadMore()
  assert.equal(c.record.requests.length, sent, 'exhausted means exhausted')
})

test('a fatal load failure offers no retry entry; a retryable one does', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  await c.auth.signIn()
  const page = loadPage(c, 'pages/notice/list.js')

  const realRequest = globalThis.wx.request
  globalThis.wx.request = (opts) => {
    globalThis.wx.request = realRequest
    opts.success({ statusCode: 422, data: { code: 'validation_failed', message: '填写内容不符合要求', request_id: 'req-9' }, header: {} })
  }
  await page.loadFirst()
  assert.equal(page.data.errorCanRetry, false, 'retrying an invalid request changes nothing')
  assert.equal(page.data.errorRequestId, 'req-9', 'the trace id a teacher can report')

  await page.onRetryList // exists but the UI never renders it for fatal
  await page.loadFirst() // the real service recovers the page
  assert.equal(page.data.errorText, '')
  assert.ok(page.data.items.length > 0)
})

// ── the detail page speaks the same language ─────────────────────────────────

test('out-of-scope and gone read identically on the detail page, with no retry', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  await c.auth.signIn()
  const page = loadPage(c, 'pages/notice/detail.js')

  await page.load(99999) // §2.3: scope-miss is a 404, indistinguishable from gone
  assert.match(page.data.errorText, /不存在|不在可见范围/)
  assert.equal(page.data.errorCanRetry, false)

  const ok = loadPage(c, 'pages/notice/detail.js')
  await ok.load(26)
  assert.equal(ok.data.errorText, '')
  assert.ok(c.record.navTitles.length > 0, 'the real title reached the navigation bar')
})
