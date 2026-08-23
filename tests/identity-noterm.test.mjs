/**
 * Identity during the holiday (ticket 05, foreshadowing ticket 06): no active
 * term is a NORMAL state — sign-in succeeds, the home shape says noTerm, and
 * the term-gated write check answers no.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { start, setNoTerm } from '../mock/server.mjs'
import { loadClient, loadPage } from './helpers/seam.mjs'

let mock

before(async () => {
  mock = await start({ port: 0, noTerm: true })
  for (let i = 0; i < 20; i += 1) {
    try { await fetch(mock.baseUrl + '/__ready'); break }
    catch { await new Promise((r) => setTimeout(r, 50)) }
  }
})

after(async () => { await mock.close() })

test('the holiday is a state, not an error: sign-in succeeds and says noTerm', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  const result = await c.identity.signIn()
  assert.equal(result.status, 'ok', 'no error was thrown — the holiday is normal')
  assert.equal(result.home.noTerm, true)
  assert.equal(result.home.termName, '', 'nothing to display, not a crash')
  assert.equal(result.home.teacherName, '陈静', 'identity still fully resolved')
})

test('term-gated writes answer no while reads keep working', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  await c.identity.signIn()
  assert.equal(c.session.hasActiveTerm(), false)
  assert.equal(c.guard.canWriteThisTerm(), false, 'the pre-disable answers no')
  const page = await c.api.getPage('/notices')
  assert.ok(page.items.length > 0, 'reading is unaffected')
})

// ── Ticket 06: the term state is first-class ─────────────────────────────────

test('termState carries the writability AND the reason — pages never inspect the enum', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  await c.identity.signIn()
  const t = c.identity.termState()
  assert.equal(t.canWrite, false)
  assert.equal(t.termName, '假期中', 'always displayable, never an empty string')
  assert.match(t.notice, /假期/, 'the on-the-spot reason is ready-made')
  assert.match(t.notice, /可以查看/, 'and it says reading still works')
})

test('首页 during the holiday: read-only and explanatory, not an error', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  await c.identity.signIn()
  const page = loadPage(c, 'pages/home/index.js')
  page.hydrateFromSession()
  await page.load()

  assert.equal(page.data.errorText, '', 'no error banner — the holiday is normal')
  assert.equal(page.data.termName, '假期中')
  assert.ok(page.data.termNotice, 'the banner explains instead of a blank')
  assert.equal(page.data.canWrite, false)
  assert.ok(page.data.todos.length > 0, 'existing content still reads')
  assert.ok(page.data.notices.length > 0, 'existing content still reads')
})

test('a write entry during the holiday explains itself instead of failing silently', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  await c.identity.signIn()
  const page = loadPage(c, 'pages/home/index.js')
  page.hydrateFromSession()

  page.onQuickTap({ currentTarget: { dataset: { key: 'month-eval' } } })
  assert.equal(c.record.navigations.length, 0, 'no navigation happened')
  assert.match(c.record.toasts.pop().title, /假期/, 'the reason is on the spot')

  // A read entry is NOT term-gated: it falls through to the ordinary path.
  // Since ticket 09 that path reaches the 教研培训 tab, so the proof is a
  // navigation rather than a toast — reading still works during the holiday.
  page.onQuickTap({ currentTarget: { dataset: { key: 'training' } } })
  assert.deepEqual(
    c.record.navigations.pop(),
    { api: 'switchTab', url: '/pages/training/index' },
    'gated by neither the term nor a missing page',
  )
})

// LAST: flips the server's term back on for the rest of the process.
test('the term resumes and the SAME page can write again — no re-login', async () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  await c.identity.signIn()
  const tokenBefore = c.session.getToken()

  const page = loadPage(c, 'pages/home/index.js')
  page.setData({ ready: true })
  page.hydrateFromSession()
  assert.equal(page.data.canWrite, false)

  setNoTerm(false) // the new term starts while the app sits in the background
  await page.onShow()

  assert.equal(page.data.canWrite, true, 'the write entries came back')
  assert.equal(page.data.termName, '2026学年第一学期')
  assert.equal(page.data.termNotice, '')
  assert.equal(c.session.getToken(), tokenBefore, 'the same session — nobody logged in again')
})
