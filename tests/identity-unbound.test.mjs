/**
 * Identity against an UNBOUND mock (ticket 05): the two-stage flow, the three
 * F17 hard stops, and the login page driven end to end through the Page stub.
 *
 * Order matters inside this file: a successful bind flips the mock to bound
 * for the rest of the process, so every hard-stop test runs before the first
 * successful bindPhone.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { start } from '../mock/server.mjs'
import { loadClient, loadPage } from './helpers/seam.mjs'

let mock

before(async () => {
  mock = await start({ port: 0, unbound: true })
  for (let i = 0; i < 20; i += 1) {
    try { await fetch(mock.baseUrl + '/__ready'); break }
    catch { await new Promise((r) => setTimeout(r, 50)) }
  }
})

after(async () => { await mock.close() })

test('stage 1 on an unbound openid asks for the phone, and only then', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  const result = await c.identity.signIn()
  assert.equal(result.status, 'needs_phone')
  assert.ok(result.jsCode, 'the single-use js_code is handed back for stage 2')
  assert.equal(c.session.getToken(), null, 'no session was issued')
})

test('the three hard stops classify as hard-stop with distinct teacher-readable text', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  const { jsCode } = await c.identity.signIn()

  const messages = []
  for (const sentinel of ['QUOTA', 'NOTONROSTER', 'CONFLICT']) {
    let failure
    try {
      await c.identity.bindPhone(jsCode, sentinel)
    } catch (err) {
      failure = c.identity.classifyFailure(err)
    }
    assert.equal(failure.kind, 'hard-stop', `${sentinel} is terminal — no in-app fix exists`)
    assert.match(failure.message, /[一-龥]/, 'the message is Chinese, not a code')
    messages.push(failure.message)
  }
  assert.equal(new Set(messages).size, 3, 'three different situations, three different sentences')
})

test('the login page renders the blocked state on a hard stop', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  const page = loadPage(c, 'pages/login/index.js')

  await page.startSignIn()
  assert.equal(page.data.phase, 'needs_phone')

  await page.onPhone({ detail: { code: 'QUOTA' } })
  assert.equal(page.data.phase, 'blocked')
  assert.equal(page.data.hardStop, true)
  assert.ok(page.data.errorText, 'the reason is on screen')
  assert.equal(c.record.navigations.length, 0, 'no navigation happened')
})

test('declining the authorization sheet is not an error state', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  const page = loadPage(c, 'pages/login/index.js')
  await page.startSignIn()

  await page.onPhone({ detail: {} }) // user tapped deny
  assert.equal(page.data.phase, 'needs_phone', 'the button stays available')
  assert.match(page.data.errorText, /授权/)
})

// LAST in this file: a successful bind flips the mock to bound.
test('stage 2 with a real phone code signs in and lands on 首页', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  const page = loadPage(c, 'pages/login/index.js')

  await page.startSignIn()
  await page.onPhone({ detail: { code: '13800000000' } })

  assert.deepEqual(c.record.navigations.pop(), { api: 'reLaunch', url: '/pages/home/index' })
  assert.ok(c.session.getToken(), 'the session is live')
  assert.equal(c.session.getRole(), 'teacher')
})
