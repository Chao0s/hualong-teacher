/**
 * 任务材料提交（票据 11）—— 本客户端第一个 UGC 写入页。
 *
 * 这一套锁住的东西以后会被复制九次，所以每一条都对着**行为**断言，不对着字符串：
 * 把关路径的拒绝发生在网络出口之前（数请求条数），幂等重放不产生第二条提交
 * （数服务端自己的记录），派生作者字段不在真正发出的报文里（读 wire payload）。
 *
 * 每一条回归用例都先在未修的代码上跑红过，确认它抓得住，再修绿。
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { start, setNoTerm, taskCompletions } from '../mock/server.mjs'
import { loadClient, loadPage } from './helpers/seam.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MP = path.resolve(HERE, '..', 'miniprogram')
const read = (rel) => fs.readFileSync(path.join(MP, rel), 'utf8')

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

/**
 * 打开提交页并读完首屏。
 *
 * 夹具里 11—15 号是 a2 进行中、6—10 号是 a1 待接收。**每个会真的提交的用例用自己
 * 那一号任务**：a2 -> a3 是单向的，两个用例共用一号，第二个会撞 409 而不是测到它
 * 想测的东西。哪个用例用哪一号写在各自的注释里。
 */
async function openSubmit(c, taskId) {
  const page = loadPage(c, 'pages/task/submit.js')
  page.onLoad({ task_id: String(taskId) })
  await page.load(taskId)
  return page
}

/** 走完「写 → 预览 → 读到底」，停在可以确认的那一刻。 */
function readyToConfirm(page, text) {
  page.onFeedbackInput({ detail: { value: text } })
  page.onPreviewTap()
  page.onPreviewEnd()
  return page
}

// ── 把关：拒绝发生在网络出口之前 ─────────────────────────────────────────────

test('未完整预览就发布 -> 被拒，且本地契约服务没有收到任何请求', async () => {
  const c = await signedIn()
  const page = await openSubmit(c, 15)

  page.onFeedbackInput({ detail: { value: '本班收集了 12 张实践照片。' } })
  page.onPreviewTap()   // 进了预览，但没有读到底

  const before = c.record.requests.length
  const doneBefore = taskCompletions().length
  await page.onConfirmTap()

  assert.equal(c.record.requests.length, before, '被拒必须发生在网络出口之前')
  assert.equal(taskCompletions().length, doneBefore, '服务端没有执行任何提交')
  assert.match(page.data.errorText, /完整预览/, '告诉教师缺的是哪一步')
  assert.equal(page.data.errorCanRetry, false, '这不是服务故障，没有可重试的东西')
  assert.equal(page.data.locked, false, '被拒之后内容要能改')
})

test('预览了但没有明确确认 -> 被拒，且没有任何请求发出', async () => {
  const c = await signedIn()
  const page = await openSubmit(c, 15)
  readyToConfirm(page, '照片与说明各一份。')

  // 完整预览已满足；这里绕过页面直接问服务层，因为「缺少明确确认」在页面上不可达
  // ——`onConfirmTap` 本身就是那次确认。两个条件是独立的，缺一即拒。
  const before = c.record.requests.length
  await assert.rejects(
    () => c.taskSubmit.complete({
      taskId: 15,
      gates: [c.moderation.GATES.HUMAN_PREVIEW_CONFIRM],
      draft: { feedback: '照片与说明各一份。' },
      previewedInFull: true,
      confirmed: false,
      idempotencyKey: c.api.uuid(),
    }),
    (err) => err instanceof c.moderation.ModerationError && /明确的发布确认/.test(err.message),
  )
  assert.equal(c.record.requests.length, before, '没有请求发出')
})

test('未声明把关路径 -> 被拒，且没有任何请求发出', async () => {
  const c = await signedIn()
  const before = c.record.requests.length

  for (const gates of [undefined, null, [], 'no_such_gate']) {
    await assert.rejects(
      () => c.taskSubmit.complete({
        taskId: 15, gates, draft: { feedback: '甲' },
        previewedInFull: true, confirmed: true, idempotencyKey: c.api.uuid(),
      }),
      (err) => err instanceof c.moderation.ModerationError && /未声明内容安全闸门/.test(err.message),
      `声明为 ${JSON.stringify(gates)} 时必须拒绝`,
    )
  }
  assert.equal(c.record.requests.length, before, '四种未声明的形态都没有走到网络')
})

test('触达家长端批次路径 -> 失败，且没有任何请求发出', async () => {
  const c = await signedIn()
  const before = c.record.requests.length

  await assert.rejects(
    () => c.taskSubmit.complete({
      taskId: 15,
      gates: [c.moderation.GATES.WECHAT_API_BATCH],
      draft: { feedback: '甲' },
      previewedInFull: true, confirmed: true, idempotencyKey: c.api.uuid(),
    }),
    (err) => err instanceof c.moderation.ModerationError && /家长端路径/.test(err.message),
  )
  assert.equal(c.record.requests.length, before, '没有请求发出')
})

// ── assertGate 的形状：一个写入点可以同时声明两条路径 ────────────────────────

test('一次写入携带两类内容，就声明两条路径；只声明一条即为未声明', () => {
  const c = loadClient({ baseUrl: mock.baseUrl })
  const { GATES, ModerationError, assertGate, pendingLabel } = c.moderation
  const ok = { previewedInFull: true, confirmed: true, what: '任务材料' }

  // 教师写的图文＝两类内容：文字走人工把关，图片走先发后审。
  assert.equal(
    assertGate([GATES.HUMAN_PREVIEW_CONFIRM, GATES.IMAGE_MEDIA_CHECK_ASYNC],
      { ...ok, imageCount: 3 }),
    true,
  )

  // 带图片却只声明文字那条 —— 图片这一类没有声明，等同未声明。
  assert.throws(
    () => assertGate([GATES.HUMAN_PREVIEW_CONFIRM], { ...ok, imageCount: 3 }),
    (err) => err instanceof ModerationError && /没有声明图片把关路径/.test(err.message),
  )

  // 不带图片时，单声明文字那条是完整的。
  assert.equal(assertGate(GATES.HUMAN_PREVIEW_CONFIRM, { ...ok, imageCount: 0 }), true)

  // 先发后审没有「审核中」：界面把图片说成待审就是错的（D1／D2）。
  assert.throws(
    () => assertGate(GATES.IMAGE_MEDIA_CHECK_ASYNC, { claimsPending: true }),
    (err) => err instanceof ModerationError && /审核中/.test(err.message),
  )
  assert.equal(pendingLabel(GATES.IMAGE_MEDIA_CHECK_ASYNC), '', '先发后审没有等待文案')
  assert.equal(pendingLabel(GATES.ADMIN_REVIEW_QUEUE), '待审核')
})

test('把关模块的头注以 ADR-0016 为准，不再把冲突写成未决', () => {
  const src = read('utils/moderation.js')
  assert.ok(src.includes('ADR-0016'), '以取代性 ADR 为准')
  assert.ok(src.includes('IMAGE_MEDIA_CHECK_ASYNC'), 'ADR-0016 新增的图片那条路径在册')
  assert.ok(!/GRILLING/.test(src), '它不再是 GRILLING.md 里的开放问题')
  assert.ok(!/未决|unresolved conflict/i.test(src), '冲突已经收口，不得再描述成未决')
})

// ── 预览就是提交的内容；确认后锁定 ──────────────────────────────────────────

test('预览内容与最终提交内容一致，确认发布后内容锁定', async () => {
  const c = await signedIn()
  const page = await openSubmit(c, 12)
  const text = '本班提交 12 张照片与 1 份教师转化说明。'
  readyToConfirm(page, text)

  const previewed = page.data.preview.body
  await page.onConfirmTap()

  const sent = c.record.requests.find((r) => r.url.includes('/tasks/12/completion'))
  assert.deepEqual(sent.data, previewed, '发出去的就是预览里那一份，逐字段相同')
  assert.equal(page.data.stage, 'done')
  assert.equal(page.data.locked, true, '确认之后内容锁定')

  page.onFeedbackInput({ detail: { value: '锁定之后又改了' } })
  assert.equal(page.data.feedback, text, '锁定之后改不动')
})

test('改了草稿，上一次的完整预览就作废', async () => {
  const c = await signedIn()
  const page = await openSubmit(c, 11)
  readyToConfirm(page, '第一版')
  assert.equal(page.data.previewedInFull, true)

  page.onFeedbackInput({ detail: { value: '第二版' } })
  assert.equal(page.data.previewedInFull, false, '内容变了，上一次预览不再是对它的把关')
  assert.equal(page.data.preview, null)
})

// ── §7.3.1 派生作者字段 ─────────────────────────────────────────────────────

// 15 号：上面的把关用例都被拒在网络出口之前，没有动过它。
test('请求体不含任何由服务端派生的作者字段', async () => {
  const c = await signedIn()
  const page = await openSubmit(c, 15)
  readyToConfirm(page, '甲')
  await page.onConfirmTap()

  const sent = c.record.requests.find((r) => r.url.includes('/tasks/15/completion'))
  assert.deepEqual(Object.keys(sent.data), ['feedback'],
    'TaskCompletionWrite 只有 feedback —— 发出去的报文就该只有它')

  // 就算调用方塞进来，客户端也在出口之前剥掉，不依赖服务端的忽略顺序。
  const dirty = c.taskSubmit.buildCompletionBody({
    feedback: '乙', teacher_id: 999, created_by: 999, assign_id: 500, completed_at: '2020-01-01T00:00:00+08:00',
  })
  assert.deepEqual(dirty, { feedback: '乙' })
})

// ── §4 幂等 ─────────────────────────────────────────────────────────────────

test('重复点击只产生一条提交；重放返回原始状态码与原始响应体', async () => {
  const c = await signedIn()
  const page = await openSubmit(c, 14)
  readyToConfirm(page, '两次点击')

  const doneBefore = taskCompletions().length
  await page.onConfirmTap()
  const key = page.data.attemptKey
  await page.onConfirmTap()          // 第二次点击，同一个幂等键

  const calls = c.record.requests.filter((r) => r.url.includes('/tasks/14/completion'))
  assert.equal(calls.length, 2, '确实发了两次 —— 这一条测的是服务端只做了一次')
  assert.equal(calls[0].header['Idempotency-Key'], key)
  assert.equal(calls[1].header['Idempotency-Key'], key, '重发复用同一个键，不是每次新建')
  assert.equal(taskCompletions().length - doneBefore, 1, '只产生一条提交')

  // §4.2：重放回原始状态码与原始响应体。
  const replay = await c.api.post('/tasks/14/completion', {
    body: page.data.preview.body, idempotencyKey: key,
  })
  assert.equal(replay.assign_status, 'a3')
  assert.equal(replay.completed_at, '2026-08-26T16:40:00+08:00', '原始响应体，不是重新算的')
  assert.equal(taskCompletions().length - doneBefore, 1, '第三次仍然只有一条')
})

// 6 号是 a1，先接受再用它 —— 11—15 号都已经有主了。
test('同键不同体是 422，不是悄悄替换成第一次的结果', async () => {
  const c = await signedIn()
  await c.taskSubmit.accept(6, { idempotencyKey: c.api.uuid() })

  const key = c.api.uuid()
  await c.api.post('/tasks/6/completion', { body: { feedback: '甲' }, idempotencyKey: key })
  await assert.rejects(
    () => c.api.post('/tasks/6/completion', { body: { feedback: '乙' }, idempotencyKey: key }),
    (err) => err.code === 'idempotency_key_reused' && err.statusCode === 422,
  )
})

test('不带幂等键的写请求在传输层失败时不自动重试', async () => {
  const c = await signedIn()

  let attempts = 0
  const realRequest = globalThis.wx.request
  globalThis.wx.request = (opts) => { attempts += 1; opts.fail({ errMsg: 'request:fail simulated' }) }

  await assert.rejects(
    () => c.api.post('/media/upload-credentials', {
      body: { usage_key: 'task_material', content_type: 'image/jpeg', byte_size: 1024 },
    }),
    (err) => err.code === 'upstream_unavailable',
    '失败上报给教师，由他决定下一步',
  )
  assert.equal(attempts, 1, '不知道请求有没有落地时，无键的 POST 只发一次')

  // 对照：带键的同一个请求可以自动重试，因为重放是安全的。
  attempts = 0
  await assert.rejects(
    () => c.api.post('/media/files', { body: { upload_ticket: 'x' }, idempotencyKey: c.api.uuid() }),
    (err) => err.code === 'upstream_unavailable',
  )
  assert.equal(attempts, 1 + c.config.maxAutoRetries, '有键才敢重试')

  globalThis.wx.request = realRequest
})

// ── 提交成功后看板与详情立即更新 ────────────────────────────────────────────

test('提交成功后看板与详情的状态立即更新，无需手工刷新', async () => {
  const c = await signedIn()

  const detail = loadPage(c, 'pages/task/detail.js')
  detail.onLoad({ task_id: '13' })
  await detail.load(13)
  detail.onShow()                       // 平台顺序：onLoad 先于 onShow
  assert.equal(detail.data.task.assign_status_label, '进行中')

  const board = loadPage(c, 'pages/task/board.js')
  board.onLoad()
  await board.loadAll()
  board.onShow()

  const submit = await openSubmit(c, 13)
  readyToConfirm(submit, '提交完就该看得见')
  await submit.onConfirmTap()
  assert.equal(submit.data.stage, 'done')

  // 返回详情：onShow 重读，教师不必下拉。
  await detail.onShow()
  assert.equal(detail.data.task.assign_status_label, '已完成')
  assert.ok(detail.data.task.completed_label, '完成时间也一并出现')

  // 看板是两节堆叠（当前任务／历史任务）。提交完成后 13 号就不属于当前了，
  // 它要从上一节消失并出现在下一节 —— 这才是「立即更新」，不是原地换个文案。
  await board.onShow()
  const at = (key) => board.data.sections.find((s) => s.key === key).items
  assert.equal(at('current').find((r) => r.task_id === 13), undefined,
    '已完成的任务不再留在当前任务这一节里')

  const row = at('history').find((r) => r.task_id === 13)
  assert.equal(row.status_label, '已完成', '它出现在历史任务那一节里，同样不必手工刷新')
})

test('首次 onShow 不重复发一次请求', async () => {
  const c = await signedIn()
  const detail = loadPage(c, 'pages/task/detail.js')
  detail.onLoad({ task_id: '11' })
  await detail.load(11)

  const before = c.record.requests.length
  detail.onShow()
  assert.equal(c.record.requests.length, before, 'onLoad 已经读过了')
})

// ── 状态机：幂等键替代不了它 ────────────────────────────────────────────────

test('未接受就直接完成是 409；接受之后才走得通', async () => {
  const c = await signedIn()

  // 9 号是 a1 待接收。转移图上没有 a1 -> a3 这条边。
  await assert.rejects(
    () => c.api.post('/tasks/9/completion', { body: { feedback: '甲' }, idempotencyKey: c.api.uuid() }),
    (err) => err.code === 'state_precondition_failed' && err.statusCode === 409,
  )

  const assign = await c.taskSubmit.accept(9, { idempotencyKey: c.api.uuid() })
  assert.equal(assign.assign_status, 'a2')
  assert.ok(assign.accepted_at, '服务端写的 accepted_at')

  // 接受任务不携带任何内容，所以它没有请求体，也不过内容安全闸门。
  const sent = c.record.requests.find((r) => r.url.includes('/tasks/9/acceptance'))
  assert.equal(sent.data, undefined, '本端点无请求体')

  // 重复接受是 409：a1 那一行已经不在了。
  await assert.rejects(
    () => c.taskSubmit.accept(9, { idempotencyKey: c.api.uuid() }),
    (err) => err.code === 'state_precondition_failed',
  )
})

test('超过 500 字的反馈被服务端 422 挡下，页面也就地拦', async () => {
  const c = await signedIn()
  assert.equal(c.taskSubmit.feedbackTooLong('x'.repeat(501)), true)
  assert.equal(c.taskSubmit.feedbackTooLong('x'.repeat(500)), false)

  await assert.rejects(
    () => c.api.post('/tasks/11/completion', {
      body: { feedback: 'x'.repeat(501) }, idempotencyKey: c.api.uuid(),
    }),
    (err) => err.code === 'validation_failed' && err.statusCode === 422,
  )
})

// ── §5.4 假期：只读状态，不是错误 ───────────────────────────────────────────

test('没有进行中的学期时提交路径不可用，返回的是只读状态而非错误', async () => {
  setNoTerm(true)
  try {
    const c = await signedIn()
    const page = await openSubmit(c, 11)

    assert.equal(page.data.readonly, true, '写入区换成理由')
    assert.match(page.data.readonlyReason, /假期/)
    assert.equal(page.data.errorText, '', '假期是季节，不是故障')
    assert.equal(page.data.errorCanRetry, false)

    // 点下去也什么都不发 —— 客户端预先禁用。
    const before = c.record.requests.length
    await page.onConfirmTap()
    await page.onAcceptTap()
    page.onPreviewTap()
    assert.equal(c.record.requests.length, before)
    assert.equal(page.data.stage, 'edit', '预览也进不去')

    // §6.4：客户端预先禁用不是边界，服务端独立拒绝。
    await assert.rejects(
      () => c.api.post('/tasks/11/completion', { body: { feedback: '甲' }, idempotencyKey: c.api.uuid() }),
      (err) => err.code === 'no_active_term' && err.statusCode === 409,
    )
  } finally {
    setNoTerm(false)
  }
})

// ── §8 媒体流：字节不经过 API 实例 ──────────────────────────────────────────

test('凭证由 API 签发，字节直传对象存储，file_id 只在落库后产生', async () => {
  const c = await signedIn()

  const cred = await c.api.post('/media/upload-credentials', {
    body: { usage_key: 'task_material', content_type: 'image/jpeg', byte_size: 3145728 },
  })
  assert.ok(cred.upload_ticket)
  assert.ok(!cred.url.includes('/api/v1'), '§8.1：字节不经过 API 实例')
  assert.ok(cred.object_key.startsWith('incoming/'), '落在没有读取路径的前缀下')
  assert.equal(cred.max_bytes, 10 * 1024 * 1024)
  assert.deepEqual(cred.field_order.slice(0, 2), ['key', 'policy'],
    '表单字段有固定顺序，文件字段放最后')

  // 未上传就落库：拿不到成品，就没有 file_id。
  await assert.rejects(
    () => c.api.post('/media/files', { body: { upload_ticket: cred.upload_ticket } }),
    (err) => err.code === 'validation_failed',
  )

  // 直传（真实客户端走 wx.uploadFile 的 POST multipart）。
  const form = new URLSearchParams(cred.form_fields).toString()
  const put = await fetch(cred.url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  assert.equal(put.status, 200)

  const file = await c.api.post('/media/files', { body: { upload_ticket: cred.upload_ticket } })
  assert.ok(file.file_id, 'file_id 只在处理后的成品上产生')
  assert.ok(file.file_size < 3145728, 'file_size 记的是处理后大小（W17）')

  // 原件随即删除，ticket 一次性。
  await assert.rejects(
    () => c.api.post('/media/files', { body: { upload_ticket: cred.upload_ticket } }),
    (err) => err.code === 'validation_failed',
  )
})

test('超过 10 MB 的单档在签发凭证时就被拒', async () => {
  const c = await signedIn()
  await assert.rejects(
    () => c.api.post('/media/upload-credentials', {
      body: { usage_key: 'task_material', content_type: 'image/jpeg', byte_size: 10 * 1024 * 1024 + 1 },
    }),
    (err) => err.code === 'validation_failed' && err.statusCode === 422,
  )
})

// ── DO-NOT-BUILD 12：不建视频入口 ───────────────────────────────────────────

test('提交页没有视频入口，一个也没有', () => {
  for (const file of ['pages/task/submit.wxml', 'pages/task/submit.js',
                      'services/task-submit.js']) {
    const src = read(file)
    for (const forbidden of ['<video', 'chooseVideo', 'chooseMedia', 'mediaType',
                             'camera', 'wx.chooseImage']) {
      assert.ok(!src.includes(forbidden), `${file} 出现了视频／媒体选择入口：${forbidden}`)
    }
  }
})

test('提交页不通往 PC后台，也不出现观察记录', () => {
  for (const file of ['pages/task/submit.wxml', 'pages/task/submit.js']) {
    const src = read(file)
    assert.ok(!src.includes('观察记录'), `${file} 出现了观察记录（DO-NOT-BUILD 1）`)
    assert.ok(!src.includes('/admin/'), `${file} 通往管理端（DO-NOT-BUILD 2）`)
  }
})
