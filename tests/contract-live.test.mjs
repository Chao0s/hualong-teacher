/**
 * Contract regression against the real mock (ticket 04, live half).
 *
 * Everything here is invisible in the UI and survives only as long as a test
 * pins it: the +08:00 literal, the derived tier, cursor discipline, idempotent
 * replay, and the roster shape. The mock emits every error; no test fabricates
 * a server response.
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

async function signedIn(options) {
  const c = loadClient({ baseUrl: mock.baseUrl, ...options })
  await c.auth.signIn()
  return c
}

// ── §1.2 scheduled times: the offset is a literal, not a conversion ─────────

test('a Z-offset scheduled time is a 422 and the client converted nothing', async () => {
  const c = await signedIn()
  await assert.rejects(
    () => c.api.post('/parent-tasks', { body: { task_title: '秋游材料', due_at: '2026-09-01T10:00:00Z' } }),
    (err) => err.code === 'timestamp_not_accepted' && err.statusCode === 422
  )
  // The client sent the string untouched — no silent timezone shift.
  const sent = c.record.requests.find((r) => r.url.endsWith('/parent-tasks'))
  assert.equal(sent.data.due_at, '2026-09-01T10:00:00Z')
})

test('a +08:00 literal built by time.js is accepted as written', async () => {
  const c = await signedIn()
  const due = c.time.fromPickerParts('2026-09-01', '18:00')
  assert.equal(due, '2026-09-01T18:00:00+08:00')
  const task = await c.api.post('/parent-tasks', { body: { task_title: '秋游材料', due_at: due } })
  assert.equal(task.due_at, due, 'stored as written — 18:00 stays 18:00')
})

test('the scheduled whitelist mirrors the contract LIST: 8 columns, not the prose 7', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  assert.equal(c.time.SCHEDULED_TIME_COLUMNS.length, 8)
  assert.ok(c.time.SCHEDULED_TIME_COLUMNS.includes('db_party_activity.activity_at'),
    'the 8th column the prose count missed')
})

test('an event timestamp submitted by the client is ignored, not an error', async () => {
  const c = await signedIn()
  // created_at is server-set. Submitting one neither errors nor takes effect.
  const task = await c.api.post('/parent-tasks', {
    body: { task_title: '园所开放日', created_at: '2020-01-01T00:00:00+08:00' },
  })
  assert.ok(task.parent_task_id, 'the write succeeded')
  assert.equal(task.created_at, undefined, 'the submitted value did not take effect')
})

// ── §7.3 derived tier ────────────────────────────────────────────────────────

test('author columns are stripped before send and the server sets its own', async () => {
  const c = await signedIn()
  const task = await c.api.post('/parent-tasks', {
    body: { task_title: '亲子共读打卡', teacher_id: 999, created_by: 999 },
  })
  const sent = c.record.requests.find((r) => r.url.endsWith('/parent-tasks'))
  assert.equal(sent.data.teacher_id, undefined, 'teacher_id never left the client')
  assert.equal(sent.data.created_by, undefined, 'created_by never left the client')
  assert.equal(task.teacher_id, 12, 'the server set the session teacher, not the body value')
})

// ── §3.1–§3.3 cursors ────────────────────────────────────────────────────────

test('cursor walk: pages of 10/10/6, null cursor is the only end signal', async () => {
  const c = await signedIn()
  const sizes = []
  let cursor = null
  do {
    const page = await c.api.getPage('/notices', { limit: 10, ...(cursor ? { cursor } : {}) })
    sizes.push(page.items.length)
    cursor = page.nextCursor
  } while (cursor)
  assert.deepEqual(sizes, [10, 10, 6])

  // §3.1: no offset, no page number, no total — anywhere in what was sent.
  for (const r of c.record.requests.filter((x) => x.url.includes('/notices'))) {
    assert.doesNotMatch(r.url, /offset=|page=|total=/)
  }
})

test('a garbage cursor is a 400 cursor_invalid from the real service', async () => {
  const c = await signedIn()
  await assert.rejects(
    () => c.api.getPage('/notices', { cursor: 'not-a-cursor' }),
    (err) => err.code === 'cursor_invalid' && err.statusCode === 400
  )
})

test('a cursor from a different filter set is a cursor_filter_mismatch', async () => {
  const c = await signedIn()
  // A structurally valid cursor whose filter fingerprint is not this query's.
  const foreign = Buffer.from(JSON.stringify({ k: 20, f: 'deadbeef0000' })).toString('base64url')
  await assert.rejects(
    () => c.api.getPage('/notices', { cursor: foreign }),
    (err) => err.code === 'cursor_filter_mismatch'
  )
})

test('page-level self-heal: a dead cursor reloads from the top exactly once', async () => {
  const c = await signedIn()
  const page = loadPage(c, 'pages/notice/list.js')
  await page.loadFirst()
  assert.ok(page.data.items.length > 0)

  const countBefore = c.record.requests.filter((r) => r.url.includes('/notices')).length
  page.setData({ cursor: 'not-a-cursor', exhausted: false })
  await page.loadMore()
  const countAfter = c.record.requests.filter((r) => r.url.includes('/notices')).length

  // The dead-cursor request plus ONE reload — not a loop.
  assert.equal(countAfter - countBefore, 2)
  assert.equal(page.data.errorText, '', 'self-heal is silent, not an error banner')
  assert.ok(page.data.items.length > 0, 'the list recovered')
})

// ── §4 idempotency ───────────────────────────────────────────────────────────

test('replaying the same key returns the original body without a second effect', async () => {
  const c = await signedIn()
  const key = c.api.uuid()
  const body = { task_title: '重阳节探访' }
  const first = await c.api.post('/parent-tasks', { body, idempotencyKey: key })
  const replay = await c.api.post('/parent-tasks', { body, idempotencyKey: key })
  assert.equal(replay.parent_task_id, first.parent_task_id, 'same row, not a duplicate')
})

test('the same key with a different body is a 422 idempotency_key_reused', async () => {
  const c = await signedIn()
  const key = c.api.uuid()
  await c.api.post('/parent-tasks', { body: { task_title: '甲' }, idempotencyKey: key })
  await assert.rejects(
    () => c.api.post('/parent-tasks', { body: { task_title: '乙' }, idempotencyKey: key }),
    (err) => err.code === 'idempotency_key_reused'
  )
})

// ── §3.5 roster shape ────────────────────────────────────────────────────────

test('a roster returns whole, child_id ascending, with no pagination params sent', async () => {
  const c = await signedIn()
  const rows = await c.api.getRoster('/parent-tasks/900/progress')
  assert.ok(rows.length >= 6, 'the whole class, one read')
  const ids = rows.map((r) => r.child_id)
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b), 'child_id ASC')
  const sent = c.record.requests.find((r) => r.url.includes('/progress'))
  assert.doesNotMatch(sent.url, /limit=|cursor=|offset=|page=/)
})
