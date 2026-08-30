/**
 * Retry, idempotency-key and error-degrade semantics (ticket 04, scripted half).
 *
 * These branches need failures on demand — a 429 that clears, a transport
 * error on the first attempt only — so the transport is scripted per test.
 * Only wx.request is replaced; every module under test is the real one.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadClient } from './helpers/seam.mjs'

/** Feed wx.request from a queue of scripted outcomes. */
function script(c, outcomes) {
  const queue = [...outcomes]
  globalThis.wx.request = ({ url, method = 'GET', header = {}, data, success, fail }) => {
    c.record.requests.push({ method, url, header, data })
    const next = queue.shift()
    if (!next) throw new Error('scripted transport exhausted')
    setImmediate(() => {
      if (next.transportFail) fail({ errMsg: `request:fail ${next.transportFail}` })
      else success({ statusCode: next.status, data: next.body, header: next.header || {} })
    })
  }
}

const BASE = { baseUrl: 'http://scripted.invalid/api/v1' }

test('429 with a short Retry-After is retried once and succeeds', async () => {
  const c = loadClient(BASE)
  c.session.setToken('t')
  script(c, [
    { status: 429, body: { code: 'rate_limited', message: '操作过于频繁' }, header: { 'retry-after': '1' } },
    { status: 200, body: { ok: true } },
  ])
  const t0 = Date.now()
  const out = await c.api.get('/anything')
  assert.equal(out.ok, true)
  assert.equal(c.record.requests.length, 2)
  assert.ok(Date.now() - t0 >= 900, 'the Retry-After wait was honoured')
})

test('a long Retry-After is surfaced, not slept through', async () => {
  const c = loadClient(BASE)
  c.session.setToken('t')
  script(c, [
    { status: 429, body: { code: 'rate_limited', message: '操作过于频繁' }, header: { 'retry-after': '60' } },
  ])
  await assert.rejects(() => c.api.get('/anything'), (e) => e.code === 'rate_limited')
  assert.equal(c.record.requests.length, 1, 'a 60s wait is the server saying stop')
})

test('transport failure on GET is retried; the same failure on a bare POST is not', async () => {
  const c = loadClient(BASE)
  c.session.setToken('t')
  script(c, [
    { transportFail: 'ECONNRESET' },
    { status: 200, body: { ok: true } },
  ])
  const out = await c.api.get('/anything')
  assert.equal(out.ok, true)
  assert.equal(c.record.requests.length, 2, 'GET is safe to retry blind')

  const c2 = loadClient(BASE)
  c2.session.setToken('t')
  script(c2, [{ transportFail: 'ECONNRESET' }])
  await assert.rejects(
    () => c2.api.post('/writes', { body: { a: 1 } }),
    (e) => e.code === 'upstream_unavailable'
  )
  assert.equal(c2.record.requests.length, 1,
    'a POST without an idempotency key could double-execute — surfaced instead')
})

test('a registered idempotent action gets a key automatically and REUSES it across retries', async () => {
  const c = loadClient(BASE)
  c.session.setToken('t')
  script(c, [
    { transportFail: 'ECONNRESET' },
    { status: 200, body: { ok: true } },
  ])
  await c.api.post('/books/1/finalize', { body: {}, action: 'book.finalize' })
  const keys = c.record.requests.map((r) => r.header['Idempotency-Key'])
  assert.equal(c.record.requests.length, 2)
  assert.ok(keys[0], 'the key was generated without the caller asking')
  assert.equal(keys[0], keys[1], 'the retry reused the SAME key — that is the whole point of §4.2')
})

test('a 500 is surfaced after one attempt — retrying our own bug changes nothing', async () => {
  const c = loadClient(BASE)
  c.session.setToken('t')
  script(c, [{ status: 500, body: { code: 'internal_error', message: '服务出错' } }])
  await assert.rejects(() => c.api.get('/anything'), (e) => e.code === 'internal_error')
  assert.equal(c.record.requests.length, 1)
})

test('an unregistered error code degrades by HTTP class instead of crashing', async () => {
  const c = loadClient(BASE)
  c.session.setToken('t')
  script(c, [
    { status: 409, body: { code: 'brand_new_conflict_kind', message: '新分支' } },
  ])
  let caught
  try { await c.api.get('/anything') } catch (e) { caught = e }
  assert.equal(caught.name, 'ApiError')
  assert.equal(caught.known, false, 'not in the registry')
  assert.equal(caught.retry, 'refresh', '409 class → re-read state, let the user redo')
  assert.ok(caught.userMessage, 'still has something safe to show a teacher')
})

test('an unknown code on a waitable status still auto-retries by class', async () => {
  const c = loadClient(BASE)
  c.session.setToken('t')
  script(c, [
    { status: 503, body: { code: 'z9_future_outage_kind', message: '稍后再试' }, header: { 'retry-after': '1' } },
    { status: 200, body: { ok: true } },
  ])
  const out = await c.api.get('/anything')
  assert.equal(out.ok, true)
  assert.equal(c.record.requests.length, 2)
})

test('X-Request-Id is attached to every attempt and differs between logical calls', async () => {
  const c = loadClient(BASE)
  c.session.setToken('t')
  script(c, [
    { status: 200, body: { ok: 1 } },
    { status: 200, body: { ok: 2 } },
  ])
  await c.api.get('/one')
  await c.api.get('/two')
  const ids = c.record.requests.map((r) => r.header['X-Request-Id'])
  assert.ok(ids[0] && ids[1])
  assert.notEqual(ids[0], ids[1])
})

test('stripDerived removes every server-owned key and reports what it dropped', async () => {
  const c = loadClient(BASE)
  const { body, stripped } = c.derived.stripDerived({
    task_title: '标题',
    teacher_id: 9, created_by: 9, uploaded_by: 9, school_id: 9, class_id: 9,
    requested_by_teacher_id: 9,
  })
  assert.deepEqual(Object.keys(body), ['task_title'])
  assert.equal(stripped.length, 6)
})

test('time.js refuses to be a timezone converter', async () => {
  const c = loadClient(BASE)
  assert.equal(c.time.OFFSET, '+08:00')
  assert.equal(c.time.isWireTimestamp('2026-09-01T18:00:00+08:00'), true)
  assert.equal(c.time.isWireTimestamp('2026-09-01T18:00:00Z'), false)
  assert.equal(c.time.isWireTimestamp('2026-09-01T18:00:00+09:00'), false)
  const parts = c.time.parseWireTimestamp('2026-09-01T18:00:00+08:00')
  assert.equal(parts.hour, 18, 'wall-clock parts as written, never a Date round-trip')
})
