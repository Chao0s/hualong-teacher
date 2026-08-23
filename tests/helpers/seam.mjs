/**
 * The test seam: fresh client modules + a fake wx, wired to a given base URL.
 *
 * Freshness is the load-bearing part. The utils modules keep module-level
 * state (the session token mirror, the request sequence counter), so a test
 * that reuses a loaded module inherits the previous test's session and passes
 * for the wrong reason. loadClient() clears the require cache for everything
 * under miniprogram/ and installs a new fake wx before requiring, so every
 * call returns a client that has never seen the world.
 *
 * The base URL is injected by mutating the shared config object after the
 * fresh load — no source file changes, and the next fresh load starts from
 * the file's own value again.
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFakeWx } from './fake-wx.mjs'

const require = createRequire(import.meta.url)
const MP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'miniprogram')

export function loadClient({ baseUrl, wxOptions } = {}) {
  // Drop every cached module under miniprogram/, so module state resets.
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(MP)) delete require.cache[key]
  }

  const fake = createFakeWx(wxOptions)
  globalThis.wx = fake.wx

  const config = require(path.join(MP, 'config.js'))
  if (baseUrl) config.env.baseUrl = baseUrl

  return {
    ...fake, // wx, storage, record
    config,
    api: require(path.join(MP, 'utils', 'request.js')),
    session: require(path.join(MP, 'utils', 'session.js')),
    auth: require(path.join(MP, 'utils', 'auth.js')),
    guard: require(path.join(MP, 'utils', 'guard.js')),
    time: require(path.join(MP, 'utils', 'time.js')),
    derived: require(path.join(MP, 'utils', 'derived.js')),
    errors: require(path.join(MP, 'utils', 'errors.js')),
  }
}
