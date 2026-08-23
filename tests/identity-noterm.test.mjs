/**
 * Identity during the holiday (ticket 05, foreshadowing ticket 06): no active
 * term is a NORMAL state — sign-in succeeds, the home shape says noTerm, and
 * the term-gated write check answers no.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { start } from '../mock/server.mjs'
import { loadClient } from './helpers/seam.mjs'

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
