/**
 * 上传资源或案例（票据 15）—— 待办事项与案例库共用一条写入路径。
 *
 * 这一套盯住的是「两份表单逻辑」这个失败模式：它不会报错，只会让两个入口慢慢分家，
 * 半年后其中一个开始发出另一个不发的字段。所以第一条用例逐字比对两处发出的 wire
 * payload，而不是比对两处的代码长得像不像。
 *
 * 其余每一条都对着**行为**断言，不对着字符串：把关路径的拒绝发生在网络出口之前
 * （数请求条数），10 MB 的拒绝发生在选文件的那一刻（数请求条数），幂等重放不产生
 * 第二条待审核记录（数服务端自己的记录）。
 */

import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { start, setNoTerm, librarySubmissions } from '../mock/server.mjs'
import { loadClient, loadPage } from './helpers/seam.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MP = path.resolve(HERE, '..', 'miniprogram')
const read = (rel) => fs.readFileSync(path.join(MP, rel), 'utf8')

const FORM = 'packages/library/pages/upload/form.js'
const FORM_PAGE = '/packages/library/pages/upload/form'

let mock

before(async () => { mock = await start({ port: 0 }) })
after(async () => { await mock.close() })

async function signedIn(options) {
  const c = loadClient({ baseUrl: mock.baseUrl, ...options })
  await c.auth.signIn()
  return c
}

/** 打开上传表单。`query` 就是入口带进来的那一串。 */
async function openForm(c, query = {}) {
  const page = loadPage(c, FORM)
  page.onLoad(query)
  if (query.content_id) await page.load(query.target || 'resource', Number(query.content_id))
  else if (query.target === 'case') await page.loadResourceOptions()
  return page
}

/** 一份填满的案例草稿。两处入口填的是同一份，所以它只写一次。 */
const CASE_DRAFT = {
  case_name: '祠堂里的故事',
  case_grade: 'k3',
  case_field: 'f3',
  case_area: ['a3', 'a4'],
  case_intro: '幼儿围绕留耕堂建筑照片和参观见闻，讲述自己看到的门楼、天井与家族故事。',
  case_trans: '活动从照片观察进入故事表达，再延伸到亲子走访和班级地图制作。',
}

/** 按教师真实的动作填表：每个字段各走一次它自己的处理器。 */
function fillCase(page) {
  page.onTextInput({ currentTarget: { dataset: { field: 'case_name' } }, detail: { value: CASE_DRAFT.case_name } })
  page.onChipTap({ currentTarget: { dataset: { field: 'case_grade', key: CASE_DRAFT.case_grade } } })
  page.onChipTap({ currentTarget: { dataset: { field: 'case_field', key: CASE_DRAFT.case_field } } })
  CASE_DRAFT.case_area.forEach((key) => {
    page.onChipMultiTap({ currentTarget: { dataset: { field: 'case_area', key } } })
  })
  page.onTextInput({ currentTarget: { dataset: { field: 'case_intro' } }, detail: { value: CASE_DRAFT.case_intro } })
  page.onTextInput({ currentTarget: { dataset: { field: 'case_trans' } }, detail: { value: CASE_DRAFT.case_trans } })
  return page
}

/** 发往某个端点的请求，按顺序。 */
function sentTo(c, fragment) {
  return c.record.requests.filter((r) => r.url.includes(fragment))
}

// ── 验收项 1：两个入口，一张表单，一条写入路径 ──────────────────────────────

describe('两个入口进入同一张表单', () => {
  test('待办事项与案例库都跳到同一个页面路径', async () => {
    const c = await signedIn()

    const home = loadPage(c, 'pages/home/index.js')
    home.onTodoTap({ currentTarget: { dataset: { kind: 'upload' } } })
    const fromTodo = c.record.navigations.pop()

    const list = loadPage(c, 'packages/library/pages/case/list.js')
    list.onLoad({})
    list.onUploadTap()
    const fromLibrary = c.record.navigations.pop()

    assert.equal(fromTodo.url, FORM_PAGE, '待办事项进上传表单')
    assert.equal(fromLibrary.url.split('?')[0], FORM_PAGE, '案例库进同一个页面')
    assert.equal(fromLibrary.url, `${FORM_PAGE}?target=case`, '案例库带的只是「填哪一张表」')
  })

  test('两处提交发出的请求逐字相同 —— 不存在两份表单逻辑', async () => {
    // 入口一：待办事项。不带类型，教师在表单顶部选案例。
    const a = await signedIn()
    const pageA = await openForm(a, {})
    assert.equal(pageA.data.target, 'resource', '不带类型时落在资源上')
    pageA.onTargetTap({ currentTarget: { dataset: { key: 'case' } } })
    await pageA.loadResourceOptions()
    fillCase(pageA)
    await pageA.onSubmitTap()

    // 入口二：案例库。带 target=case 进来，其余一模一样。
    const b = await signedIn()
    const pageB = await openForm(b, { target: 'case' })
    assert.equal(pageB.data.target, 'case')
    fillCase(pageB)
    await pageB.onSubmitTap()

    const createA = sentTo(a, '/library/cases').find((r) => r.method === 'POST' && r.data)
    const createB = sentTo(b, '/library/cases').find((r) => r.method === 'POST' && r.data)
    assert.ok(createA && createB, '两处都建了草稿')
    assert.deepEqual(createA.data, createB.data, '两个入口发出的请求体逐字相同')
    assert.equal(createA.method, createB.method)
    assert.equal(
      createA.url.replace(mock.baseUrl, ''),
      createB.url.replace(mock.baseUrl, ''),
      '两个入口打的是同一条路径',
    )

    // 提交审核那一步也一样：同一个动作序列，同一条路径形状。
    for (const [c2, label] of [[a, '待办事项'], [b, '案例库']]) {
      const submit = sentTo(c2, '/submission')
      assert.equal(submit.length, 1, `${label} 提交了一次`)
      assert.match(submit[0].url, /\/library\/cases\/\d+\/submission$/)
    }
  })
})

// ── 验收项 2：缺必填项时根本不发请求 ────────────────────────────────────────

describe('必填项就地校验', () => {
  test('缺必填项时一个请求也没发，并逐项标出缺的是什么', async () => {
    const c = await signedIn()
    const page = await openForm(c, { target: 'case' })
    // 只填名称，其余五个必填项留空。
    page.onTextInput({ currentTarget: { dataset: { field: 'case_name' } }, detail: { value: '半张表' } })

    const before = c.record.requests.length
    await page.onSubmitTap()

    assert.equal(c.record.requests.length, before, '缺项时根本不发请求')
    const missing = page.data.missing.map((m) => m.key)
    assert.deepEqual(missing, ['case_grade', 'case_field', 'case_area', 'case_intro', 'case_trans'],
      '缺的每一项都点名，而不是一句「有东西没填」')
    assert.equal(page.data.errorText, '', '这不是一次服务故障')
  })

  test('填上之后那一项的红字就消失 —— 留在原地会让教师以为没填进去', async () => {
    const c = await signedIn()
    const page = await openForm(c, { target: 'case' })
    await page.onSubmitTap()
    assert.ok(page.data.missing.length > 0)

    page.onChipTap({ currentTarget: { dataset: { field: 'case_grade', key: 'k1' } } })
    assert.ok(!page.data.missing.some((m) => m.key === 'case_grade'), '填上就不再是缺项')
    assert.ok(page.data.missing.some((m) => m.key === 'case_intro'), '没填的那些还在')
  })

  test('超出字数上限时也不发请求，并说出上限是多少', async () => {
    const c = await signedIn()
    const page = await openForm(c, { target: 'case' })
    fillCase(page)
    page.onTextInput({
      currentTarget: { dataset: { field: 'case_intro' } },
      detail: { value: '字'.repeat(101) },
    })

    const before = c.record.requests.length
    await page.onSubmitTap()

    assert.equal(c.record.requests.length, before, '超长时也不发请求')
    assert.deepEqual(page.data.tooLong.map((t) => [t.key, t.max]), [['case_intro', 100]])

    // §6.4：客户端预先拦截不是边界，服务端独立拒绝同一件事。
    await assert.rejects(
      () => c.api.post('/library/cases', {
        body: { ...CASE_DRAFT, case_intro: '字'.repeat(101) },
      }),
      (err) => err.code === 'validation_failed' && err.statusCode === 422,
    )
  })
})

// ── 验收项 3：10 MB 在选文件的那一刻就拦 ────────────────────────────────────

describe('平台单次 10 MB 硬上限', () => {
  test('超过 10 MB 的图片在选完的那一刻被拒，一个请求也没发', async () => {
    const c = await signedIn()
    const page = await openForm(c, { target: 'resource' })
    c.control.picked = { path: 'wxfile://tmp/big.jpg', size: 10 * 1024 * 1024 + 1, name: '大图.jpg' }

    const before = c.record.requests.length
    await page.onPickCover()

    assert.equal(c.record.requests.length, before, '连签凭证都不必去问')
    assert.match(page.data.fileNotice, /10 MB/, '说出上限')
    assert.match(page.data.fileNotice, /10\.0 MB/, '也说出这个文件多大')
    assert.equal(page.data.draft.cover_file_id, null, '没有半个封面留在表单上')
  })

  test('刚好 10 MB 走得通，走的是契约 §8 的三步媒体流', async () => {
    const c = await signedIn()
    const page = await openForm(c, { target: 'resource' })
    c.control.picked = { path: 'wxfile://tmp/ok.jpg', size: 10 * 1024 * 1024, name: '封面.jpg' }

    await page.onPickCover()

    assert.ok(page.data.draft.cover_file_id, 'file_id 落到了表单上')
    const cred = c.record.requests.find((r) => r.url.includes('/media/upload-credentials'))
    const commit = c.record.requests.find((r) => r.url.includes('/media/files'))
    assert.ok(cred && commit, '签凭证与落库各一次')
    assert.equal(cred.data.byte_size, 10 * 1024 * 1024)

    // §8.1 铁律：字节不经过 API 实例。
    assert.equal(c.record.uploads.length, 1)
    assert.ok(!c.record.uploads[0].url.includes('/api/v1'), '字节送去了对象存储，不是 API')
  })

  test('教师取消选择不是失败 —— 不说话，也不发请求', async () => {
    const c = await signedIn()
    const page = await openForm(c, { target: 'resource' })
    c.control.pickCancels = true

    const before = c.record.requests.length
    await page.onPickCover()
    c.control.pickCancels = false

    assert.equal(c.record.requests.length, before)
    assert.equal(page.data.fileNotice, '', '取消不是一句要解释的话')
    assert.equal(page.data.errorText, '')
  })
})

// ── 验收项 5：把关路径显式声明，无默认值 ────────────────────────────────────

describe('把关路径的声明', () => {
  test('未声明把关路径 -> 被拒，且没有任何请求发出', async () => {
    const c = await signedIn()
    const before = c.record.requests.length

    for (const gates of [undefined, null, [], 'no_such_gate']) {
      await assert.rejects(
        () => c.library.createDraft({ target: 'case', gates, draft: CASE_DRAFT, idempotencyKey: c.api.uuid() }),
        (err) => err instanceof c.moderation.ModerationError && /未声明内容安全闸门/.test(err.message),
        `声明为 ${JSON.stringify(gates)} 时必须拒绝`,
      )
    }
    assert.equal(c.record.requests.length, before, '四种未声明的形态都没有走到网络')
  })

  test('带了封面却只声明管理端审核 -> 图片那一类未声明，请求发不出去', async () => {
    const c = await signedIn()
    const before = c.record.requests.length

    await assert.rejects(
      () => c.library.createDraft({
        target: 'case',
        gates: [c.moderation.GATES.ADMIN_REVIEW_QUEUE],
        draft: { ...CASE_DRAFT, cover_file_id: 8801 },
        idempotencyKey: c.api.uuid(),
      }),
      (err) => err instanceof c.moderation.ModerationError && /没有声明图片把关路径/.test(err.message),
    )
    assert.equal(c.record.requests.length, before, '没有请求发出')
  })

  test('本页声明的是 ADMIN_REVIEW_QUEUE，不是任务材料那条 HUMAN_PREVIEW_CONFIRM', () => {
    const src = read(FORM)
    assert.match(src, /GATES\.ADMIN_REVIEW_QUEUE/, '资源与案例走 F6 的管理端人工审核队列')
    assert.match(src, /GATES\.IMAGE_MEDIA_CHECK_ASYNC/, '表单能传图，图片那条也要声明')
    assert.ok(!src.includes('HUMAN_PREVIEW_CONFIRM'),
      '这一票不是「完整预览＋明确发布」那条路径 —— 抄错会让提交当场变成已发布')
  })

  test('触达家长端批次路径 -> 失败，且没有任何请求发出', async () => {
    const c = await signedIn()
    const before = c.record.requests.length
    await assert.rejects(
      () => c.library.createDraft({
        target: 'case', gates: [c.moderation.GATES.WECHAT_API_BATCH],
        draft: CASE_DRAFT, idempotencyKey: c.api.uuid(),
      }),
      (err) => err instanceof c.moderation.ModerationError && /家长端路径/.test(err.message),
    )
    assert.equal(c.record.requests.length, before)
  })
})

// ── 验收项 4：提交后是待审核，绝不是已发布 ──────────────────────────────────

describe('提交后呈现为待审核', () => {
  test('提交成功后界面说的是待审核，一个「已发布」也没有', async () => {
    const c = await signedIn()
    const page = await openForm(c, { target: 'case' })
    fillCase(page)

    const doneBefore = librarySubmissions().length
    await page.onSubmitTap()

    assert.equal(page.data.status, 's2')
    assert.equal(page.data.statusLabel, '待审核', '文案由 utils/moderation 统一给')
    assert.notEqual(page.data.statusLabel, '已发布')
    assert.equal(page.data.submitted, true)
    assert.equal(page.data.readonly, true, '提交后内容冻结（F6）')
    assert.equal(librarySubmissions().length - doneBefore, 1, '服务端确实做了一次 s1 -> s2')

    // 服务端那一条也是 s2，不是 s3：客户端说的与服务端记的是同一件事。
    const row = await c.api.get(`/library/cases/${page.data.contentId}`)
    assert.equal(row.case_status, 's2')
  })

  test('把管理端审核队列里的内容说成已发布，闸门当场拒绝', async () => {
    const c = loadClient({ baseUrl: mock.baseUrl })
    const { GATES, ModerationError, assertGate, pendingLabel } = c.moderation
    assert.throws(
      () => assertGate(GATES.ADMIN_REVIEW_QUEUE, { claimsPublished: true }),
      (err) => err instanceof ModerationError && /不得显示为已发布/.test(err.message),
    )
    assert.equal(pendingLabel(GATES.ADMIN_REVIEW_QUEUE), '待审核')
  })
})

// ── 验收项 4 后半：驳回时看到原因，改完重新提交 ────────────────────────────

describe('被驳回之后', () => {
  test('看得到驳回原因，撤回到草稿后能改，改完重新提交', async () => {
    const c = await signedIn()
    // 夹具第 7 条是这位教师自己写的、已被驳回的资源。
    const page = await openForm(c, { target: 'resource', content_id: '7' })

    assert.equal(page.data.status, 's4')
    assert.equal(page.data.statusLabel, '已驳回')
    assert.match(page.data.decisionReason, /资源解读/, '看得到原因，不是一句「未通过」')
    assert.equal(page.data.readonly, true, 'F6：不在草稿里就改不动')
    assert.match(page.data.readonlyReason, /撤回到草稿/, '说清楚下一步是什么')

    // 回到草稿。这不是下架 —— 目标是 s1，回到自己手里。
    await page.onWithdrawTap()
    assert.equal(page.data.status, 's1')
    assert.equal(page.data.readonly, false, '现在改得动了')
    assert.equal(page.data.decisionReason, '', '上一轮的理由跟着那一轮结束')

    // 改一处，重新提交。
    page.onTextInput({
      currentTarget: { dataset: { field: 'resource_explain' } },
      detail: { value: '补上幼儿可观察的活动线索：先看门楼，再数天井，最后讲一讲自己家的门。' },
    })
    const doneBefore = librarySubmissions().length
    await page.onSubmitTap()

    assert.equal(page.data.statusLabel, '待审核')
    assert.equal(librarySubmissions().length - doneBefore, 1)
    const row = await c.api.get('/library/resources/7')
    assert.equal(row.resource_status, 's2')
    assert.match(row.resource_explain, /门楼/, '改的那一处真的发出去了')
    assert.equal(row.decision_reason, null, '重新提交的这一条身上没有上一轮的理由')
  })

  test('待审核期间内容冻结 —— 服务端也拦，不只是界面灰着', async () => {
    const c = await signedIn()
    // 夹具第 5 条是待审核（s2）。
    await assert.rejects(
      () => c.library.updateDraft({
        target: 'resource',
        gates: [c.moderation.GATES.ADMIN_REVIEW_QUEUE, c.moderation.GATES.IMAGE_MEDIA_CHECK_ASYNC],
        contentId: 5,
        draft: { resource_name: '偷偷改一下' },
      }),
      (err) => err.code === 'state_precondition_failed' && err.statusCode === 409,
    )
  })
})

// ── 验收项 6：请求体不含作者字段；取值来自同一份来源 ────────────────────────

describe('请求体与取值来源', () => {
  test('请求体只有契约白名单里的键，一个派生作者字段也没有', async () => {
    const c = await signedIn()
    const page = await openForm(c, { target: 'case' })
    fillCase(page)
    await page.onSubmitTap()

    const sent = sentTo(c, '/library/cases').find((r) => r.method === 'POST' && r.data)
    assert.deepEqual(Object.keys(sent.data).sort(), [
      'case_area', 'case_field', 'case_grade', 'case_intro', 'case_name',
      'case_trans', 'cover_file_id', 'resource_ids', 'word_file_id',
    ], 'CaseWrite 的九个键，不多不少')
    for (const derived of ['created_by', 'teacher_id', 'school_id', 'class_id', 'case_status', 'submitted_at']) {
      assert.ok(!(derived in sent.data), `请求体里出现了服务端派生的 ${derived}`)
    }

    // 就算调用方塞进来，客户端也在出口之前剥掉，不依赖服务端的忽略顺序。
    const dirty = c.library.buildWriteBody('case', {
      ...CASE_DRAFT, created_by: 999, teacher_id: 999, submitted_at: '2020-01-01T00:00:00+08:00',
    })
    assert.ok(!('created_by' in dirty) && !('teacher_id' in dirty) && !('submitted_at' in dirty))
  })

  test('分类与标签取值与筛选用的是同一份来源，不是复制过来的第二份', async () => {
    const c = await signedIn()
    const options = c.library.uploadOptions()

    // 表单与筛选差的只有开头那一项「全部」：筛选可以不筛，表单不能不填。
    assert.deepEqual(options.resource_tag, c.library.tagFilters().slice(1))
    assert.deepEqual(options.case_grade, c.library.gradeFilters().slice(1))
    assert.deepEqual(options.case_field, c.library.fieldFilters().slice(1))
    assert.deepEqual(options.case_area, c.library.areaFilters().slice(1))
    // 资源的适用年级与案例的年级同一个值域，一份映射服务两张表。
    assert.deepEqual(options.grade, options.case_grade)
    // 这几张表在 services/case.js 里，本文件 require 它而不是抄它。
    assert.deepEqual(options.case_field.map((o) => o.label), Object.values(c.kase.CASE_FIELD))
    assert.deepEqual(options.case_area.map((o) => o.label), Object.values(c.kase.CASE_AREA))

    // 页面绑的就是这一份，不是它自己带的一张表。
    const page = await openForm(c, { target: 'case' })
    assert.deepEqual(page.data.options, options)
  })
})

// ── 验收项 7：幂等 ──────────────────────────────────────────────────────────

describe('同一次逻辑尝试复用同一个幂等键', () => {
  test('提交审核重放返回原始状态码与原始响应体，不产生两条待审核记录', async () => {
    const c = await signedIn()
    const created = await c.library.createDraft({
      target: 'case',
      gates: [c.moderation.GATES.ADMIN_REVIEW_QUEUE, c.moderation.GATES.IMAGE_MEDIA_CHECK_ASYNC],
      draft: CASE_DRAFT,
      idempotencyKey: c.api.uuid(),
    })

    const key = c.api.uuid()
    const doneBefore = librarySubmissions().length
    const first = await c.library.submitForReview({ target: 'case', contentId: created.case_id, idempotencyKey: key })
    const replay = await c.library.submitForReview({ target: 'case', contentId: created.case_id, idempotencyKey: key })

    assert.deepEqual(replay, first, '§4.2：重放回的是原始响应体，不是重新算的')
    assert.equal(librarySubmissions().length - doneBefore, 1, '服务端只做了一次')
  })

  test('第一次提交失败后再点一次，复用同一对键，仍然只有一条待审核记录', async () => {
    const c = await signedIn()
    const page = await openForm(c, { target: 'case' })
    fillCase(page)

    // 让**提交审核**那一步失败一次。建草稿照常成功，所以第二次点击走的是
    // 「已经有 contentId」那条路 —— 正是教师重试时的真实形状。
    const realRequest = globalThis.wx.request
    globalThis.wx.request = (opts) => {
      if (!opts.url.includes('/submission')) { realRequest(opts); return }
      globalThis.wx.request = realRequest
      // 拦下的这一次也要记进 record：下面比的是两次提交带的键，少记一次就无从比起。
      c.record.requests.push({ method: opts.method, url: opts.url, header: opts.header, data: opts.data })
      opts.success({ statusCode: 500, data: { code: 'internal_error', message: '服务出错', request_id: 'req-u1' }, header: {} })
    }

    const doneBefore = librarySubmissions().length
    await page.onSubmitTap()
    assert.ok(page.data.errorText, '第一次失败了，并且说了出来')
    assert.equal(page.data.submitted, false)
    const keys = page.data.attemptKeys
    assert.ok(keys && keys.create && keys.submit)

    await page.onSubmitTap()
    assert.deepEqual(page.data.attemptKeys, keys, '重发复用同一对键，不是每次新建')
    assert.equal(page.data.statusLabel, '待审核', '第二次走通了')

    const creates = sentTo(c, '/library/cases').filter((r) => r.method === 'POST' && r.data)
    assert.equal(creates.length, 1, '草稿只建了一条 —— 第二次走的是 PATCH')
    assert.equal(sentTo(c, '/library/cases').filter((r) => r.method === 'PATCH').length, 1)

    const submits = sentTo(c, '/submission')
    assert.equal(submits.length, 2, '确实发了两次 —— 这一条测的是服务端只做了一次')
    assert.equal(submits[0].header['Idempotency-Key'], keys.submit)
    assert.equal(submits[1].header['Idempotency-Key'], keys.submit)
    assert.equal(librarySubmissions().length - doneBefore, 1, '只产生一条待审核记录')
  })
})

// ── 验收项 8：选择位的形态 ──────────────────────────────────────────────────

describe('选择位按已定案的控件形态实现', () => {
  test('案例表单里唯一的滚轮是关联资源，取值来自服务端数据', async () => {
    const c = await signedIn()
    const page = await openForm(c, { target: 'case' })

    const wxml = read('packages/library/pages/upload/form.wxml')
    assert.equal((wxml.match(/<hl-picker-row/g) || []).length, 1, '整张表单只有一个滚轮')
    assert.match(wxml, /options="\{\{resourceOptions\}\}"/, '滚轮读的是服务端来的那一份')

    // 取值走到游标尽头读一次：夹具 32 条资源，一页读不完。
    assert.equal(page.data.resourceOptions.length, 32)
    assert.equal(sentTo(c, '/library/resources').filter((r) => r.method === 'GET').length >= 1, true)
  })

  test('滚轮只在确认时写入，已选的排成可删的标签', async () => {
    const c = await signedIn()
    const page = await openForm(c, { target: 'case' })

    page.onResourcePick({ detail: { key: '30', label: '沙湾留耕堂 · 何氏宗祠' } })
    page.onResourcePick({ detail: { key: '29', label: '安全过街' } })
    page.onResourcePick({ detail: { key: '30', label: '沙湾留耕堂 · 何氏宗祠' } })   // 重复不进第二次

    assert.deepEqual(page.data.draft.resource_ids, [30, 29], '整数进请求体，字符串只在滚轮里')
    assert.equal(page.data.resourcePicked.length, 2)
    assert.ok(page.data.resourcePicked[0].label, '标签上写的是名称，不是编号')

    page.onResourceRemove({ currentTarget: { dataset: { id: 30 } } })
    assert.deepEqual(page.data.draft.resource_ids, [29])
  })

  test('其余选择位全是横排标签，一个滚轮也没有', () => {
    const wxml = read('packages/library/pages/upload/form.wxml')
    // 六个枚举位：资源格式、资源分类、适用年级、案例年级、五大领域、活动形式。
    // 全部走 hl-chips —— 判据的结果，不是遗漏。
    for (const field of ['resource_type', 'resource_tag', 'grade', 'case_grade', 'case_field', 'case_area']) {
      assert.match(wxml, new RegExp(`data-field="${field}"`), `${field} 应当是一行标签`)
    }
    assert.equal((wxml.match(/class="hl-chips"/g) || []).length, 7,
      '六个枚举位加一行已选资源标签')

    // 上传目标不在其中：2026-08-27 改回原型的**两张卡**（字标＋名称＋一句说明）。
    // 此前它也是一行标签，援引的是 form-control-spec.md §2.1 —— 那条定案立在
    //「原型只是视觉参照」的时期，园方裁定以原型为准之后不再成立。
    assert.match(wxml, /class="up__targets"/, '上传目标是两张卡')
    assert.match(wxml, /up__target-desc/, '每张卡带一句说明，原型上就有')

    // 这条测试真正守的事：整张表里一个滚轮也没有（资源多选那处除外，另有测试）。
    assert.equal((wxml.match(/<picker/g) || []).length, 0, '没有 picker 滚轮')
  })
})

// ── 假期：只读状态，不是错误 ────────────────────────────────────────────────
//
// LAST in this file: it flips the server's term off and back on again.

describe('没有进行中的学期时', () => {
  test('上传表单是只读说明，不是一句错误', async () => {
    setNoTerm(true)
    try {
      const c = await signedIn()
      const page = await openForm(c, { target: 'case' })

      assert.equal(page.data.readonly, true, '写入区换成理由')
      assert.match(page.data.readonlyReason, /假期/)
      assert.equal(page.data.errorText, '', '假期是季节，不是故障')

      // 点下去也什么都不发 —— 客户端预先禁用。
      const before = c.record.requests.length
      await page.onSubmitTap()
      await page.onPickCover()
      assert.equal(c.record.requests.length, before)

      // §6.4：客户端预先禁用不是边界，服务端独立拒绝。
      await assert.rejects(
        () => c.api.post('/library/cases', { body: CASE_DRAFT }),
        (err) => err.code === 'no_active_term' && err.statusCode === 409,
      )
    } finally {
      setNoTerm(false)
    }
  })
})

// ── DO-NOT-BUILD ────────────────────────────────────────────────────────────

describe('不得建造清单', () => {
  test('上传表单没有视频入口，一个也没有（第 12 条）', () => {
    for (const file of [FORM, 'packages/library/pages/upload/form.wxml', 'services/library.js']) {
      const src = read(file)
      for (const forbidden of ['<video', 'chooseVideo', 'openVideoEditor', 'compressVideo', 'camera-']) {
        assert.ok(!src.includes(forbidden), `${file} 出现了视频入口：${forbidden}`)
      }
    }
    // `wx.chooseImage` 回不了视频；`wx.chooseMedia` 要靠一个参数把视频关掉，
    // 参数写错就是一个视频入口。这一页选的是前者。注释里讲得起 chooseMedia
    // （`pickCoverImage` 的头注正是在解释为什么不用它），所以先剥注释。
    const code = read('services/library.js')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.match(code, /wx\.chooseImage\(/)
    assert.ok(!/wx\.chooseMedia\(/.test(code), 'chooseMedia 的视频只隔着一个参数')
  })

  test('上传表单不通往 PC后台，也不出现观察记录（第 1、2 条）', () => {
    for (const file of [FORM, 'packages/library/pages/upload/form.wxml']) {
      const src = read(file)
      assert.ok(!src.includes('观察记录'), `${file} 出现了观察记录`)
      assert.ok(!src.includes('/admin/') && !src.includes('pc-backend'), `${file} 通往管理端`)
    }
  })

  test('客户端不调用内容安全接口，只声明把关路径（第 13 条）', () => {
    for (const file of [FORM, 'services/library.js']) {
      const src = read(file)
      assert.ok(!src.includes('msgSecCheck'), `${file} 调了 security.msgSecCheck`)
      assert.ok(!src.includes('mediaCheckAsync('), `${file} 调了 security.mediaCheckAsync`)
    }
  })
})
