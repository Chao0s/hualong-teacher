/**
 * The seam's own proof (ticket 03): one real round trip through the stack —
 * fake wx -> utils -> HTTP -> the real contract mock — plus the isolation
 * properties every later test file will lean on.
 *
 * Scope: the seam itself. Contract regression (payloads, error branches,
 * cursors, idempotency) is ticket 04 and does not live here.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { start } from '../mock/server.mjs'
import { loadClient } from './helpers/seam.mjs'

let mock

before(async () => {
  // Port 0: the OS picks a free port, so parallel test processes never collide.
  mock = await start({ port: 0 })
  // Readiness probe: on Windows the first loopback connect after listen() can
  // transiently refuse. Probe until the socket accepts, so no test carries a
  // connect race. This retries the PROBE only — production request semantics
  // (no auto-retry without an idempotency key) stay untested-side untouched.
  for (let i = 0; i < 20; i += 1) {
    try { await fetch(mock.baseUrl + '/__ready'); break }
    catch { await new Promise((r) => setTimeout(r, 50)) }
  }
})

after(async () => {
  await mock.close()
})

test('through: sign in, context cached, first page of notices read', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })

  // 1. The session is issued.
  const result = await c.auth.signIn()
  assert.equal(result.status, 'ok')
  assert.equal(result.context.role, 'teacher')
  assert.equal(result.context.subject.teacher_name, '陈静')

  // 2. The session context is cached — in memory and in storage.
  assert.ok(c.session.getToken(), 'token cached in the session module')
  assert.equal(c.session.getRole(), 'teacher')
  const writtenKeys = c.record.storageWrites.map((w) => w.key)
  assert.ok(writtenKeys.includes('hualong_teacher_session_token'), 'token persisted')
  assert.ok(writtenKeys.includes('hualong_teacher_session_context'), 'context persisted')

  // 3. The first page of notices is read, in the contract's collection shape.
  const page = await c.api.getPage('/notices')
  assert.ok(page.items.length > 0, 'items arrived')
  assert.ok(page.items[0].notice_id, 'items have the contract shape')
  assert.notEqual(page.nextCursor, undefined, 'cursor field present (null means end)')
})

test('isolation: a fresh load carries no session from the previous test', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })

  assert.equal(c.session.getToken(), null, 'no token leaked across loads')
  await assert.rejects(
    () => c.api.get('/auth/session'),
    (err) => err.code === 'unauthenticated',
    'an authenticated call without a session raises, not silently succeeds'
  )
})

test('the fake runtime records navigation without executing it', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })

  c.guard.redirectToLogin()
  assert.equal(c.record.navigations.length, 1)
  assert.equal(c.record.navigations[0].api, 'reLaunch')
  assert.match(c.record.navigations[0].url, /login/)
})

test('base URL injection does not survive a fresh load', async () => {
  const first = loadClient({ baseUrl: mock.baseUrl })
  assert.equal(first.config.env.baseUrl, mock.baseUrl)

  const second = loadClient({}) // no override
  assert.notEqual(second.config.env.baseUrl, mock.baseUrl,
    'the fresh load starts from the source file value, not the injected one')
})

test('login failure surfaces as an ApiError, not a hang', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl, wxOptions: { loginFails: true } })

  await assert.rejects(
    () => c.auth.signIn(),
    (err) => err.name === 'ApiError' && err.code === 'upstream_unavailable'
  )
})
