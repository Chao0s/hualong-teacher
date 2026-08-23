/**
 * A fake `wx` runtime for the test seam.
 *
 * It replaces the platform entry points only — never any code under test. The
 * surface is exactly the APIs the client calls; anything else is deliberately
 * absent, so a new platform call fails loudly in tests instead of silently
 * returning undefined.
 *
 *   wx.request           -> Node fetch against the real URL the client built
 *   storage (get/set/remove Sync) -> an in-memory Map, recorded for assertions
 *   wx.login             -> a controllable stub (js_code value, or a failure)
 *   wx.navigateTo / wx.switchTab / wx.reLaunch / wx.showToast -> recorded, not executed
 */

export function createFakeWx({ loginCode = 'JS_CODE_OK', loginFails = false } = {}) {
  const storage = new Map()
  const record = {
    storageWrites: [],   // { key, value }
    storageRemoves: [],  // key
    navigations: [],     // { api: 'navigateTo'|'reLaunch', url }
    toasts: [],          // the options object passed in
    navTitles: [],       // titles passed to setNavigationBarTitle
    requests: [],        // { method, url, header, data } — the wire payload as built
  }

  const wx = {
    request({ url, method = 'GET', header = {}, data, success, fail }) {
      record.requests.push({ method, url, header, data })
      const init = { method, headers: header }
      if (data !== undefined && method !== 'GET' && method !== 'HEAD') {
        init.body = typeof data === 'string' ? data : JSON.stringify(data)
      }
      fetch(url, init).then(async (res) => {
        // wx.request parses JSON bodies itself; the mock speaks only JSON.
        const text = await res.text()
        let parsed = text
        try { parsed = text ? JSON.parse(text) : null } catch { /* leave as text */ }
        const headers = {}
        res.headers.forEach((v, k) => { headers[k] = v })
        success({ statusCode: res.status, data: parsed, header: headers })
      }).catch((err) => {
        fail({ errMsg: `request:fail ${err.message}` })
      })
    },

    login({ success, fail }) {
      if (loginFails) fail({ errMsg: 'login:fail simulated' })
      else success({ code: loginCode })
    },

    getStorageSync(key) {
      return storage.has(key) ? storage.get(key) : ''
    },
    setStorageSync(key, value) {
      storage.set(key, value)
      record.storageWrites.push({ key, value })
    },
    removeStorageSync(key) {
      storage.delete(key)
      record.storageRemoves.push(key)
    },

    navigateTo({ url }) { record.navigations.push({ api: 'navigateTo', url }) },
    // A tabBar page needs switchTab. Recorded separately so a test can prove the
    // client picked the right API — navigateTo on a tab page fails silently on
    // the real platform, which no assertion would otherwise catch.
    switchTab({ url }) { record.navigations.push({ api: 'switchTab', url }) },
    reLaunch({ url }) { record.navigations.push({ api: 'reLaunch', url }) },
    showToast(opts) { record.toasts.push(opts) },
    setNavigationBarTitle({ title }) { record.navTitles.push(title) },
    stopPullDownRefresh() { /* nothing to stop in a test */ },
  }

  return { wx, storage, record }
}
