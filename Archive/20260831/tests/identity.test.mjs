/**
 * Identity service against a BOUND mock (ticket 05): the silent stage-1 path,
 * the view-ready home shape, auth-failure handling, the fatal role rule, and
 * the negative guarantees — no side doors, no error codes in the page.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { start } from '../mock/server.mjs'
import { loadClient } from './helpers/seam.mjs'

let mock

before(async () => {
  mock = await start({ port: 0 })
  for (let i = 0; i < 20; i += 1) {
    try { await fetch(mock.baseUrl + '/__ready'); break }
    catch { await new Promise((r) => setTimeout(r, 50)) }
  }
})

after(async () => { await mock.close() })

test('stage 1 on a bound openid: ok, with a home shape a page can bind directly', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  const result = await c.identity.signIn()
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.home, {
    teacherName: '陈静',
    className: '中二班',
    termName: '2026学年第一学期',
    noTerm: false,
  })
})

test('the service exposes no side door — the export list is closed', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  assert.deepEqual(Object.keys(c.identity).sort(), [
    'bindPhone', 'classifyFailure', 'handleAuthFailure', 'homeIdentity',
    'isLoggedIn', 'refreshContext', 'signIn', 'signOut', 'termState',
  ].sort())
  // By name: nothing SMS-, invite-, password- or role-switch-shaped.
  for (const k of Object.keys(c.identity)) {
    assert.doesNotMatch(k, /sms|invite|password|manual|setRole/i)
  }
})

test('an auth failure is consumed once: session cleared, back to login', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  await c.identity.signIn()
  assert.ok(c.session.getToken())

  const revoked = new c.errors.ApiError({
    statusCode: 401, code: 'session_revoked', message: '登录状态已失效',
  })
  assert.equal(c.identity.handleAuthFailure(revoked), true)
  assert.equal(c.session.getToken(), null, 'local session dropped')
  assert.deepEqual(c.record.navigations.pop(), { api: 'reLaunch', url: '/pages/login/index' })

  const ordinary = new c.errors.ApiError({ statusCode: 422, code: 'validation_failed', message: 'x' })
  assert.equal(c.identity.handleAuthFailure(ordinary), false, 'ordinary failures pass through')
})

test('an unresolvable role is fatal, never an empty rule set', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  c.session.setToken('t')
  c.session.setContext({ surface: 'teacher' }) // no role field
  assert.throws(() => c.guard.requireRole(), (e) => e.name === 'RoleResolutionError')
})

test('the login page holds no network call and no error-code knowledge', async () => {
  const src = fs.readFileSync(path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', 'miniprogram', 'pages', 'login', 'index.js'), 'utf8')
  assert.ok(src.includes("require('../../services/identity')"), 'the page talks to the service')
  assert.ok(!src.includes('wx.request'), 'no network call in the page')
  assert.ok(!src.includes('utils/errors'), 'no ApiError import in the page')
  assert.ok(!src.includes('wechat_phone_quota_exhausted'), 'no error-code literal in the page')
  assert.ok(!src.includes('identity_not_on_roster'), 'no error-code literal in the page')
})
