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
 *   wx.downloadFile / wx.openDocument / wx.previewImage -> recorded; each branch
 *                          is switchable through `control`, because "the file
 *                          would not open" is a case the client must answer in
 *                          words and there is no other way to reach it
 *   wx.chooseImage / wx.chooseMessageFile -> return whatever `control.picked`
 *                          says, including a file over the 10 MB ceiling and the
 *                          user cancelling; both are cases the client must
 *                          answer and neither is reachable any other way
 *   wx.uploadFile        -> a real multipart-ish POST to the URL the credential
 *                          named, so "the bytes did not go through the API
 *                          instance" (§8.1) is assertable
 */

export function createFakeWx({ loginCode = 'JS_CODE_OK', loginFails = false } = {}) {
  const storage = new Map()
  const record = {
    storageWrites: [],   // { key, value }
    storageRemoves: [],  // key
    navigations: [],     // { api: 'navigateTo'|'reLaunch', url }
    toasts: [],          // the options object passed in
    navTitles: [],       // titles passed to setNavigationBarTitle
    clipboard: [],       // strings passed to setClipboardData
    requests: [],        // { method, url, header, data } — the wire payload as built
    downloads: [],       // urls passed to downloadFile
    opened: [],          // { filePath, fileType } passed to openDocument
    previews: [],        // urls passed to previewImage
    picks: [],           // { api, options } passed to chooseImage/chooseMessageFile
    uploads: [],         // { url, filePath, formData } passed to uploadFile
  }

  // Mutable mid-test, so one client can succeed and then fail without a reload.
  const control = {
    downloadFails: false,
    downloadStatus: 200,
    openFails: false,
    previewFails: false,
    // What the next chooseImage / chooseMessageFile returns. `null` means the
    // teacher cancelled — the platform reports that through `fail` with a
    // cancel errMsg, which is exactly why it needs its own switch.
    picked: { path: 'wxfile://tmp/cover.jpg', size: 1024 * 1024, name: '封面.jpg' },
    pickCancels: false,
    pickFails: false,
    uploadFails: false,
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
    setClipboardData({ data, success }) {
      record.clipboard.push(data)
      if (success) success({ errMsg: 'setClipboardData:ok' })
    },
    stopPullDownRefresh() { /* nothing to stop in a test */ },

    downloadFile({ url, success, fail }) {
      record.downloads.push(url)
      if (control.downloadFails) fail({ errMsg: 'downloadFile:fail simulated' })
      else success({ statusCode: control.downloadStatus, tempFilePath: 'wxfile://tmp/doc' })
    },
    openDocument({ filePath, fileType, success, fail }) {
      record.opened.push({ filePath, fileType })
      if (control.openFails) fail({ errMsg: 'openDocument:fail simulated' })
      else if (success) success({ errMsg: 'openDocument:ok' })
    },
    previewImage({ urls, success, fail }) {
      record.previews.push(...urls)
      if (control.previewFails) fail({ errMsg: 'previewImage:fail simulated' })
      else if (success) success({ errMsg: 'previewImage:ok' })
    },

    chooseImage(options) { choose('chooseImage', options) },
    chooseMessageFile(options) { choose('chooseMessageFile', options) },

    /**
     * §8.1: the bytes go to the object storage, not to the API instance. The
     * fake posts the form fields for real, so `POST /media/files` afterwards
     * finds the object present — a stub that only recorded the call would let a
     * client that never uploaded anything still get a file_id.
     */
    uploadFile({ url, filePath, formData, success, fail }) {
      record.uploads.push({ url, filePath, formData })
      if (control.uploadFails) { fail({ errMsg: 'uploadFile:fail simulated' }); return }
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(formData || {}).toString(),
      }).then((res) => {
        success({ statusCode: res.status, data: '' })
      }).catch((err) => {
        fail({ errMsg: `uploadFile:fail ${err.message}` })
      })
    },
  }

  /** chooseImage and chooseMessageFile differ only in the tempFiles shape. */
  function choose(api, { success, fail }) {
    record.picks.push({ api })
    if (control.pickCancels) { fail({ errMsg: `${api}:fail cancel` }); return }
    if (control.pickFails) { fail({ errMsg: `${api}:fail simulated` }); return }
    if (!control.picked) { success({ tempFiles: [] }); return }
    success({ tempFiles: [{ ...control.picked }] })
  }

  return { wx, storage, record, control }
}
