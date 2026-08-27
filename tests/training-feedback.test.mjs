/**
 * 研修反馈提交（票据 16）—— 教研培训模块唯一的写入点。
 *
 * 这一套盯住的是四件看不见的东西：
 *
 *   1. **入口只在研修详情里。** 多一个入口不会报错，只会悄悄提前上线，所以办园理念页
 *      与研修列表页各有一条反向断言。
 *   2. **提交时间是服务端的。** 客户端送来的值被静默忽略 —— 「静默」意味着没有任何报错
 *      会告诉你写错了，只有读 wire payload 才看得见。
 *   3. **关闭的入口是一行说明，不是一个会当面拒绝人的按钮。** 五种关闭情形各有各的话。
 *   4. **重复点击只有一条反馈。** `UNIQUE(training_id, teacher_id)` 让第二条变成 409，
 *      教师看到的会是一句莫名其妙的「你已经提交过」—— 幂等键就是为了不走到那里。
 *
 * 票据正文那句「研修已结束时反馈入口渲染为只读」与契约相反：契约的
 * `submitTrainingFeedback` scope 要求 `participation_status='s3' AND $now >
 * effective_end_at`，**已结束是前置条件，不是阻断条件**。这里按契约断言。
 */

import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { start, setNoTerm, trainingFeedbackWrites } from '../mock/server.mjs'
import { loadClient, loadPage } from './helpers/seam.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MP = path.resolve(HERE, '..', 'miniprogram')
const read = (rel) => fs.readFileSync(path.join(MP, rel), 'utf8')

const DETAIL = 'packages/training/pages/train/detail.js'

let mock

before(async () => { mock = await start({ port: 0 }) })
after(async () => { await mock.close() })

async function signedIn(options) {
  const c = loadClient({ baseUrl: mock.baseUrl, ...options })
  await c.auth.signIn()
  return c
}

/**
 * 打开研修详情。
 *
 * 夹具里可提交反馈的是**已结束的偶数号**（参与状态 s3）。**每个会真的提交的用例用自己
 * 那一号**：`UNIQUE(training_id, teacher_id)` 是一人一场一份，两个用例共用一号，第二个
 * 会撞 409 而不是测到它想测的东西。哪个用例用哪一号写在各自的注释里。
 */
async function openDetail(c, trainingId) {
  const page = loadPage(c, DETAIL)
  page.onLoad({ training_id: String(trainingId) })
  await page.load(trainingId)
  return page
}

/** 走完「写 → 预览 → 读到底」，停在可以确认的那一刻。 */
function readyToConfirm(page, text) {
  page.onFeedbackInput({ detail: { value: text } })
  page.onPreviewTap()
  page.onPreviewEnd()
  return page
}

const SAID = '这次研修的观察工具可以直接带回班级，希望下次多留一些分组研讨的时间。'

// ── 入口只在研修详情里 ──────────────────────────────────────────────────────

describe('反馈入口的位置', () => {
  test('办园理念与研修列表两页一个反馈入口也没有', () => {
    for (const base of ['packages/training/pages/course/detail', 'packages/training/pages/train/list']) {
      const wxml = read(`${base}.wxml`)
      // 2026-08-27：研修列表补了原型的「我的档案」两张入口卡，其中一张的说明写着
      // 「参与记录、提交材料与研修成果」—— 那是描述，不是入口。所以只扫能点的元素。
      const tappable = (wxml.match(/<[^>]*bind\w*tap="[^"]*"[^>]*>[^<]*/g) || []).join(' | ')
      for (const word of ['反馈', '评论', '提交']) {
        assert.ok(!tappable.includes(word), `${base}.wxml 出现了反馈入口「${word}」`)
      }
      assert.ok(!wxml.includes('<textarea'), `${base}.wxml 出现了输入框`)
    }
    for (const base of ['packages/training/pages/course/detail', 'packages/training/pages/train/list']) {
      const js = read(`${base}.js`)
      assert.ok(!js.includes('submitFeedback'), `${base}.js 调了反馈提交`)
    }
  })

  test('研修详情有且只有一个反馈输入框；附件一概不接（F9）', () => {
    const wxml = read('packages/training/pages/train/detail.wxml')
    assert.equal((wxml.match(/<textarea/g) || []).length, 1)
    for (const forbidden of ['chooseImage', 'chooseMessageFile', 'uploadFile', '<video', '上传']) {
      assert.ok(!wxml.includes(forbidden), `研修详情出现了附件入口：${forbidden}`)
    }
  })

  test('票据 14 留的那条注释已经改成现在的事实', () => {
    const src = read(DETAIL)
    assert.ok(!src.includes('本页没有报名、反馈或评论的提交入口'),
      '注释还在说本页没有反馈入口，而它现在有了')
    assert.match(src, /反馈是本页唯一的写入点/)
    // 报名仍属票据 18，本轮不做 —— 注释与代码都不得提前把它带上来。
    assert.ok(!src.includes('participation'), '报名不在本轮范围内')
  })
})

// ── 完整预览是把关本身 ──────────────────────────────────────────────────────

describe('预览与确认是两个独立动作', () => {
  test('未完整预览就发布 -> 被拒，且本地契约服务没有收到任何请求', async () => {
    const c = await signedIn()
    const page = await openDetail(c, 16)
    assert.equal(page.data.entry.open, true, '这一场可以提交')

    page.onFeedbackInput({ detail: { value: SAID } })
    page.onPreviewTap()          // 进了预览，但没有读到底

    const before = c.record.requests.length
    const doneBefore = trainingFeedbackWrites().length
    await page.onConfirmTap()

    assert.equal(c.record.requests.length, before, '被拒必须发生在网络出口之前')
    assert.equal(trainingFeedbackWrites().length, doneBefore, '服务端没有建任何反馈')
    assert.match(page.data.gateError, /完整预览/, '告诉教师缺的是哪一步')
    assert.equal(page.data.errorCanRetry, false, '这不是服务故障，没有可重试的东西')
  })

  test('预览了但没有明确确认 -> 被拒，且没有任何请求发出', async () => {
    const c = await signedIn()
    const before = c.record.requests.length

    // 「缺少明确确认」在页面上不可达 —— `onConfirmTap` 本身就是那次确认。两个条件是
    // 独立的，缺一即拒，所以这里绕过页面直接问服务层。
    await assert.rejects(
      () => c.training.submitFeedback({
        trainingId: 16,
        gates: [c.moderation.GATES.HUMAN_PREVIEW_CONFIRM],
        draft: { feedback_text: SAID },
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
        () => c.training.submitFeedback({
          trainingId: 16, gates, draft: { feedback_text: SAID },
          previewedInFull: true, confirmed: true, idempotencyKey: c.api.uuid(),
        }),
        (err) => err instanceof c.moderation.ModerationError && /未声明内容安全闸门/.test(err.message),
        `声明为 ${JSON.stringify(gates)} 时必须拒绝`,
      )
    }
    assert.equal(c.record.requests.length, before, '四种未声明的形态都没有走到网络')
  })

  test('本页声明的是教职工文字那条路径，不是资源与案例的审核队列', () => {
    const src = read(DETAIL)
    assert.match(src, /GATES\.HUMAN_PREVIEW_CONFIRM/)
    assert.ok(!src.includes('ADMIN_REVIEW_QUEUE'), '研修反馈不进 F6 的管理端队列')
    assert.ok(!src.includes('IMAGE_MEDIA_CHECK_ASYNC'), 'F9：附件一概不接，没有图片可声明')
  })

  test('预览内容与最终提交内容一致；改了草稿，上一次的完整预览就作废', async () => {
    const c = await signedIn()
    const page = await openDetail(c, 12)
    readyToConfirm(page, SAID)
    assert.equal(page.data.previewedInFull, true)

    page.onFeedbackInput({ detail: { value: '改了一个字。' } })
    assert.equal(page.data.previewedInFull, false, '内容变了，上一次预览不再是对它的把关')
    assert.equal(page.data.preview, null)

    readyToConfirm(page, SAID)
    const previewed = page.data.preview.body
    await page.onConfirmTap()

    const sent = c.record.requests.find((r) => r.url.includes('/trainings/12/feedback') && r.method === 'POST')
    assert.deepEqual(sent.data, previewed, '发出去的就是预览里那一份，逐字段相同')
  })
})

// ── 派生字段：不发作者，也不发时间 ──────────────────────────────────────────

describe('派生字段在网络出口之前就不存在', () => {
  test('请求体只有 feedback_text；作者字段与提交时间都不在里面', async () => {
    const c = await signedIn()
    const page = await openDetail(c, 8)
    readyToConfirm(page, SAID)
    await page.onConfirmTap()

    const sent = c.record.requests.find((r) => r.url.includes('/trainings/8/feedback') && r.method === 'POST')
    assert.deepEqual(Object.keys(sent.data), ['feedback_text'],
      'TrainingFeedbackWrite 只有 feedback_text —— 发出去的报文就该只有它')

    // 就算调用方塞进来，客户端也在出口之前剥掉，不依赖服务端的忽略顺序。
    const dirty = c.training.buildFeedbackBody({
      feedback_text: '甲',
      teacher_id: 999, school_id: 1, training_id: 8,
      submitted_at: '2020-01-01T00:00:00+08:00',
      published_at: '2020-01-01T00:00:00+08:00',
      created_at: '2020-01-01T00:00:00+08:00',
    })
    assert.deepEqual(dirty, { feedback_text: '甲' })
  })

  test('评论时间由服务端设置，客户端提交的值被静默忽略', async () => {
    const c = await signedIn()
    // 直接对着传输层送一个提交时间：`utils/derived` 在出口之前把它剥掉，服务端也
    // 独立忽略。两道都在，先后不重要，缺一才重要。
    const receipt = await c.api.post('/trainings/4/feedback', {
      body: { feedback_text: '带着一个假的提交时间来。', submitted_at: '2020-01-01T00:00:00+08:00' },
      idempotencyKey: c.api.uuid(),
    })

    const sent = c.record.requests.find((r) => r.url.includes('/trainings/4/feedback') && r.method === 'POST')
    assert.deepEqual(Object.keys(sent.data), ['feedback_text'], '客户端出口之前就剥掉了')
    assert.notEqual(receipt.submitted_at, '2020-01-01T00:00:00+08:00',
      '服务端写的是自己的时间，不是客户端送来的那个')
    assert.match(receipt.submitted_at, /\+08:00$/, '§1.2：偏移量是字面量')
  })

  test('提交回执刻意不含 feedback_status —— 作者不可查询状态（F9 的 Q58-ap1）', async () => {
    const c = await signedIn()
    const receipt = await c.api.post('/trainings/20/feedback', {
      body: { feedback_text: '这一场已撤回，本来就提交不了。' },
      idempotencyKey: c.api.uuid(),
    }).catch((err) => err)
    assert.equal(receipt.code, 'state_precondition_failed')

    // 14 号走得通，回执只有三个字段。
    const ok = await c.api.post('/trainings/14/feedback', {
      body: { feedback_text: SAID }, idempotencyKey: c.api.uuid(),
    })
    assert.deepEqual(Object.keys(ok).sort(), ['feedback_id', 'submitted_at', 'training_id'])
  })
})

// ── 幂等：重复点击只有一条 ──────────────────────────────────────────────────

describe('重复点击不产生两条反馈', () => {
  test('重放返回原始状态码与原始响应体，服务端只建了一条', async () => {
    const c = await signedIn()
    const key = c.api.uuid()
    const doneBefore = trainingFeedbackWrites().length

    // 18 号：本文件里只有这一条用例动它。
    const first = await c.api.post('/trainings/18/feedback', {
      body: { feedback_text: SAID }, idempotencyKey: key,
    })
    const replay = await c.api.post('/trainings/18/feedback', {
      body: { feedback_text: SAID }, idempotencyKey: key,
    })

    assert.deepEqual(replay, first, '§4.2：重放回的是原始响应体，不是重新算的')
    assert.equal(trainingFeedbackWrites().length - doneBefore, 1, '只建了一条')

    // 换一个键再来就不是重放了 —— UNIQUE(training_id, teacher_id) 顶住它。
    await assert.rejects(
      () => c.api.post('/trainings/18/feedback', {
        body: { feedback_text: '第二条' }, idempotencyKey: c.api.uuid(),
      }),
      (err) => err.code === 'state_precondition_failed' && err.statusCode === 409,
    )
    assert.equal(trainingFeedbackWrites().length - doneBefore, 1, '仍然只有一条')
  })

  test('提交成功后入口关上，第二次点击到不了网络', async () => {
    const c = await signedIn()
    // 22 号：本文件里只有这一条用例动它。
    const page = await openDetail(c, 22)
    readyToConfirm(page, SAID)

    const doneBefore = trainingFeedbackWrites().length
    await page.onConfirmTap()
    const key = page.data.attemptKey
    assert.ok(key)

    await page.onConfirmTap()
    const calls = c.record.requests.filter((r) => r.url.includes('/trainings/22/feedback') && r.method === 'POST')
    assert.equal(calls.length, 1, '入口关了，第二次点击什么也没发')
    assert.equal(calls[0].header['Idempotency-Key'], key)
    assert.equal(trainingFeedbackWrites().length - doneBefore, 1)
  })

  test('第一次提交失败后再点一次，复用同一个键，仍然只有一条反馈', async () => {
    const c = await signedIn()
    // 2 号：已结束、参与状态 s3，且本文件里只有这一条用例动它。（6 号也已结束，
    // 但它的派生阶段是个未来码，入口因此是关的 —— 那是另一条用例的事。）
    const page = await openDetail(c, 2)
    assert.equal(page.data.entry.open, true)
    readyToConfirm(page, SAID)

    // 让第一次提交失败一次。入口不因失败而关上 —— 教师本来就该能再点一次。
    const realRequest = globalThis.wx.request
    globalThis.wx.request = (opts) => {
      if (!opts.url.includes('/feedback')) { realRequest(opts); return }
      globalThis.wx.request = realRequest
      // 拦下的这一次也要记进 record：下面比的是两次提交带的键，少记一次就无从比起。
      c.record.requests.push({ method: opts.method, url: opts.url, header: opts.header, data: opts.data })
      opts.success({ statusCode: 500, data: { code: 'internal_error', message: '服务出错', request_id: 'req-f1' }, header: {} })
    }

    const doneBefore = trainingFeedbackWrites().length
    await page.onConfirmTap()
    assert.ok(page.data.errorText, '第一次失败了，并且说了出来')
    assert.equal(page.data.stage, 'preview', '还停在预览上，教师可以再点一次')
    const key = page.data.attemptKey
    assert.ok(key)

    await page.onConfirmTap()
    assert.equal(page.data.attemptKey, key, '重发复用同一个键，不是每次新建')
    assert.equal(page.data.stage, 'done', '第二次走通了')

    const calls = c.record.requests.filter((r) => r.url.includes('/trainings/2/feedback') && r.method === 'POST')
    assert.equal(calls.length, 2, '确实发了两次 —— 这一条测的是服务端只建了一条')
    assert.equal(calls[0].header['Idempotency-Key'], key)
    assert.equal(calls[1].header['Idempotency-Key'], key)
    assert.equal(trainingFeedbackWrites().length - doneBefore, 1, '只产生一条反馈')
  })
})

// ── 提交成功后详情页立即显示已提交 ──────────────────────────────────────────

describe('提交后的状态', () => {
  test('提交成功后详情页立即显示已提交，不需要手工刷新', async () => {
    const c = await signedIn()
    const page = await openDetail(c, 16)
    readyToConfirm(page, SAID)

    const readsBefore = c.record.requests.length
    await page.onConfirmTap()

    assert.equal(page.data.stage, 'done')
    assert.equal(page.data.entry.submitted, true)
    assert.equal(page.data.entry.open, false, '交过之后入口关上，内容锁定')
    assert.match(page.data.entry.reason, /已提交/)
    // 只发了提交那一个请求：契约没有查得到自己反馈的端点，重读一次详情什么也证明不了。
    assert.equal(c.record.requests.length - readsBefore, 1)
  })

  test('自己刚提交的那一条是待审核，按契约不进公开流', async () => {
    const c = await signedIn()
    // 10 号：本文件里只有这一条用例动它。
    const page = await openDetail(c, 10)
    const publicBefore = page.data.feedbacks.length

    readyToConfirm(page, SAID)
    await page.onConfirmTap()
    await page.loadFeedback()

    assert.equal(page.data.feedbacks.length, publicBefore,
      '自己那一条是 s2 待审核，公开流只收 s3')
    assert.ok(!page.data.feedbacks.some((f) => f.feedback_text === SAID))
  })

  test('公开流只收已公开的，且活动撤回后回空', async () => {
    const c = await signedIn()

    const open = await openDetail(c, 16)
    assert.equal(open.data.feedbacks.length, 3, '夹具给 16 号挂了三条已公开的')
    for (const row of open.data.feedbacks) {
      assert.ok(row.teacher_name, '真名公开（F9）')
      assert.match(row.time_label, /^\d{2}-\d{2} \d{2}:\d{2}$/, '时间由服务层格式化')
      assert.equal(row.feedback_status, undefined, '公开流对象不带状态字段')
    }
    // 夹具第 305 条是待审核的，它不该在里面。
    assert.ok(!open.data.feedbacks.some((f) => /还在待审核/.test(f.feedback_text)))

    // 20 号已撤回：即使回馈列还在，公开流也回空（F9）。
    const withdrawn = await openDetail(c, 20)
    assert.deepEqual(withdrawn.data.feedbacks, [])
  })
})

// ── 关闭的入口是一行说明，不是一个错误 ──────────────────────────────────────

describe('不能提交时说出原因，而不是弹错误', () => {
  test('研修还没结束时是只读说明 —— 已结束是前置条件，不是阻断条件', async () => {
    const c = await signedIn()
    // 24 号还在进行中，这位教师已报名（participation s1）。
    const page = await openDetail(c, 24)

    assert.equal(page.data.entry.open, false)
    assert.match(page.data.entry.reason, /还没有结束/)
    assert.equal(page.data.errorText, '', '这不是一个错误')

    const before = c.record.requests.length
    page.onPreviewTap()
    await page.onConfirmTap()
    assert.equal(c.record.requests.length, before, '点下去什么也不发')
    assert.equal(page.data.stage, 'edit', '预览也进不去')

    // §6.4：客户端预先禁用不是边界，服务端独立拒绝。
    await assert.rejects(
      () => c.api.post('/trainings/24/feedback', { body: { feedback_text: SAID } }),
      (err) => err.code === 'state_precondition_failed' && /还没有结束/.test(err.message),
    )
  })

  test('没参加过的研修上说的是「没参加」，不是「还没结束」', async () => {
    const c = await signedIn()
    // 21 号已结束，但这位教师取消过报名（participation s2）。
    const page = await openDetail(c, 21)
    assert.equal(page.data.entry.open, false)
    assert.match(page.data.entry.reason, /参加过/)
    assert.equal(page.data.errorText, '')
  })

  test('已撤回的研修上说的是「已撤回」', async () => {
    const c = await signedIn()
    const page = await openDetail(c, 20)
    assert.equal(page.data.entry.open, false)
    assert.match(page.data.entry.reason, /已撤回/)
    assert.equal(page.data.errorText, '')
    // 撤回说明与反馈说明是两句话，各说各的，不合并。
    assert.match(page.data.train.withdrawn_notice, /已撤回/)
  })

  test('五种关闭情形各有各的话，一句也不共用', () => {
    const c = loadClient({ baseUrl: mock.baseUrl })
    const entry = (train, canWrite, submitted) => c.training.feedbackEntry({ train, canWrite, submitted })
    const ended = { training_status: 's1', training_phase: 'history', my_participation_status: 's3' }

    const reasons = [
      entry(ended, true, true).reason,
      entry({ ...ended, training_status: 's5' }, true, false).reason,
      entry({ ...ended, training_phase: 'ongoing' }, true, false).reason,
      entry({ ...ended, my_participation_status: 's2' }, true, false).reason,
      entry(ended, false, false).reason,
    ]
    assert.equal(new Set(reasons).size, 5, '五种情形五句话')
    for (const reason of reasons) assert.match(reason, /[一-龥]/)
    assert.equal(entry(ended, true, false).open, true, '五个条件都满足时入口是开的')
  })

  test('顺序：先答「还没结束」再答「你没参加」', () => {
    const c = loadClient({ baseUrl: mock.baseUrl })
    // 一场还没结束的研修上，报了名的教师参与状态仍是 s1（到达有效结束时间才转 s3）。
    // 反过来问，他会被告知「你没参加」—— 那句话是错的，他明明报了名。
    const entry = c.training.feedbackEntry({
      train: { training_status: 's1', training_phase: 'upcoming', my_participation_status: 's1' },
      canWrite: true,
      submitted: false,
    })
    assert.match(entry.reason, /还没有结束/)
  })
})

// ── 假期：只读状态，不是错误 ────────────────────────────────────────────────
//
// LAST in this file: it flips the server's term off and back on again.

describe('没有进行中的学期时', () => {
  test('反馈入口是只读说明，浏览照常，一句话也不弹', async () => {
    setNoTerm(true)
    try {
      const c = await signedIn()
      const page = await openDetail(c, 16)

      assert.equal(page.data.entry.open, false)
      assert.match(page.data.entry.reason, /假期/)
      assert.equal(page.data.errorText, '', '假期是季节，不是故障')
      assert.ok(page.data.train.materials.length > 0, '研修材料照常读回来了')
      assert.deepEqual(c.record.toasts, [], '一句话也没弹')

      const before = c.record.requests.length
      await page.onConfirmTap()
      assert.equal(c.record.requests.length, before)

      // §6.4：客户端预先禁用不是边界，服务端独立拒绝。
      await assert.rejects(
        () => c.api.post('/trainings/16/feedback', { body: { feedback_text: SAID } }),
        (err) => err.code === 'no_active_term' && err.statusCode === 409,
      )
    } finally {
      setNoTerm(false)
    }
  })
})
