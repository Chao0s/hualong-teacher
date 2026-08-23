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
    present: require(path.join(MP, 'utils', 'present.js')).present,
    identity: require(path.join(MP, 'services', 'identity.js')),
  }
}

/**
 * Load a Page() file through the seam and return a drivable instance.
 *
 * The stub captures the config object Page() receives and binds it to a
 * minimal `this`: `data` plus a merging `setData`, which is all the page code
 * under test uses. Rendering is out of scope by design — the seam tests
 * behaviour, never WXML.
 */
export function loadPage(client, pageRelPath) {
  let captured = null
  const full = path.join(MP, pageRelPath)
  // Loading the same page twice must yield two independent instances: drop
  // its cache entry so the module body (and its Page() call) re-executes.
  delete require.cache[require.resolve(full)]
  globalThis.Page = (config) => { captured = config }
  try {
    require(full)
  } finally {
    delete globalThis.Page
  }
  if (!captured) throw new Error(`${pageRelPath} never called Page()`)

  const instance = Object.create(captured)
  instance.data = JSON.parse(JSON.stringify(captured.data || {}))
  instance.setData = function setData(patch) { Object.assign(this.data, patch) }
  return instance
}
