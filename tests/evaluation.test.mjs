/**
 * 月度评价、学期评价与综合评估报告（票据 20）。
 *
 * 每一条回归用例都先在未修的代码上跑红过，确认它抓得住，再修绿。断言对着**行为**，
 * 不对着字符串：把关路径的拒绝发生在网络出口之前（数请求条数），跨月靠注入时刻（不是
 * 等一个月），版式取整对着算出来的像素（不是对着看起来对不对）。
 *
 * 三条是**负向断言**，它们不检查「有没有做对」，检查的是「有没有顺手做多」：
 * 报告页没有导出下载分享、学期评价页没有第二处五大领域录入、两张表单没有下拉列表残留。
 */

import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  start, setNoTerm, monthEvalPublications, termEvalWrites,
} from '../mock/server.mjs'
import { loadClient, loadPage } from './helpers/seam.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MP = path.join(path.resolve(HERE, '..'), 'miniprogram')
const read = (rel) => fs.readFileSync(path.join(MP, rel), 'utf8')

const MONTH = 'packages/evaluation/pages/month/index.js'
const MONTH_WXML = 'packages/evaluation/pages/month/index.wxml'
const TERM = 'packages/evaluation/pages/term/index.js'
const TERM_WXML = 'packages/evaluation/pages/term/index.wxml'
const REPORT = 'packages/evaluation/pages/report/index.js'
const REPORT_WXML = 'packages/evaluation/pages/report/index.wxml'
const SERVICE = 'services/evaluation.js'

let mock
let token = ''

before(async () => {
  mock = await start({ port: 0 })
  token = await signInToken()
})
after(async () => { await mock.close() })

async function signInToken() {
  const res = await fetch(`${mock.baseUrl}/auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ surface: 'teacher', js_code: 'mock-js-code' }),
  })
  return (await res.json()).session_token
}

async function signedIn() {
  const c = loadClient({ baseUrl: mock.baseUrl })
  await c.auth.signIn()
  return c
}

/** 剥掉注释再扫代码：注释里讲得起一个名字，代码里出现它才是问题。 */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/<!--[\s\S]*?-->/g, '')

/** 打开月度评价页，并把「现在」钉在一个确定的时刻上。 */
async function openMonth(c, { nowMs, childId } = {}) {
  const page = loadPage(c, MONTH)
  if (nowMs !== undefined) page.now = () => nowMs
  await page.onLoad(childId ? { child_id: childId } : {})
  return page
}

async function openTerm(c, childId) {
  const page = loadPage(c, TERM)
  await page.onLoad(childId ? { child_id: childId } : {})
  return page
}

const pickChild = (page, childId) => page.onChildChange({ detail: { childIds: [childId] } })

const writesTo = (c, fragment) => c.record.requests.filter(
  (r) => r.method !== 'GET' && r.url.includes(fragment),
)

// ── 验收项 1：月份来自当前日期，教师改不了，跨月后是新的月份 ────────────────

describe('月度评价的月份', () => {
  test('换算按园所的 +08:00 做，不读设备时区', async () => {
    const c = await signedIn()
    const { currentMonth } = c.evaluation
    // 8 月 31 日 23:59 园所时间（= UTC 15:59）还是 8 月；跨过 00:00 就是 9 月。
    assert.equal(currentMonth(Date.UTC(2026, 7, 31, 15, 59, 59)), '2026-08')
    assert.equal(currentMonth(Date.UTC(2026, 7, 31, 16, 0, 0)), '2026-09')
    // 跨年也一样：12 月 31 日 24:00 园所时间是下一年的 1 月。
    assert.equal(currentMonth(Date.UTC(2026, 11, 31, 16, 0, 0)), '2027-01')
    // 闰日不特判：2024 与 2000 都是闰年，2 月 29 日仍在 2 月。
    assert.equal(currentMonth(Date.UTC(2024, 1, 29, 4, 0, 0)), '2024-02')
    assert.equal(currentMonth(Date.UTC(2000, 1, 29, 4, 0, 0)), '2000-02')
  })

  test('页面显示的月份来自当前日期，跨月后再进来是新的月份', async () => {
    const august = Date.UTC(2026, 7, 26, 8, 0, 0)
    const september = Date.UTC(2026, 8, 2, 8, 0, 0)

    const a = await openMonth(await signedIn(), { nowMs: august })
    assert.equal(a.data.monthKey, '2026-08')
    assert.match(a.data.monthLabel, /2026 年 8 月/)

    // 同一份代码，只把「现在」往后拨一周：新的页面实例读到的是新的月份。
    const b = await openMonth(await signedIn(), { nowMs: september })
    assert.equal(b.data.monthKey, '2026-09', '跨月后是新的月份')
    assert.match(b.data.monthLabel, /2026 年 9 月/)
  })

  test('教师改不了月份 —— 页面上没有月份控件，请求体的月份也不来自表单', async () => {
    const wxml = stripComments(read(MONTH_WXML))
    assert.ok(!/<picker[^>]*mode="date"/.test(wxml), '没有日期选择器')
    assert.ok(!/hl-picker-row[\s\S]*?month/i.test(wxml), '没有月份滚轮')
    assert.match(wxml, /月份由系统按当前日期认定，不能更改/, '页面明说改不了')

    // 请求体那一半：`buildMonthBody` 忽略传进来的 eval_month，只认时刻。
    const c = await signedIn()
    const body = c.evaluation.buildMonthBody(
      { child_id: 101, eval_text: '正文', eval_month: '2020-01' },
      Date.UTC(2026, 7, 26, 8, 0, 0),
    )
    assert.equal(body.eval_month, '2026-08', '表单里塞一个月份也不生效')
  })
})

// ── 验收项 2：学期评价不重复录入五大领域 ───────────────────────────────────

describe('学期评价与五大领域', () => {
  test('五大领域只有读，没有第二处录入控件', () => {
    const wxml = read(TERM_WXML)
    // 有读：五个轴的名称与数值绑在页面上。
    assert.match(wxml, /radar\.axes/, '五大领域的结果呈现在页面上')
    assert.match(wxml, /这一页只呈现，不重复录入/)

    // 没有写：这一节里一个输入控件也没有。整页只有一个 textarea，就是学期综合评语。
    const src = stripComments(wxml)
    assert.equal((src.match(/<textarea/g) || []).length, 1, '整页只有一个输入框')
    assert.ok(!src.includes('五大领域评价</'), 'E6 删掉的那个 textarea 不得回流')
    // 打分入口更不能有：那是量表页的事。
    assert.ok(!/bind:pick="onScorePick"/.test(src), '学期评价页没有打分控件')
  })

  test('五大领域的数据取自已有的量表结果，服务层不重算', async () => {
    const c = await signedIn()
    // 服务层把票据 18 的算法**原样转出**，不是复制一份。
    assert.equal(c.evaluation.radarModel, c.assessment.radarModel)
    assert.equal(c.evaluation.scoreLabel, c.assessment.scoreLabel)
    const src = stripComments(read(SERVICE))
    assert.ok(!/Math\.round|toFixed/.test(src), '取整在 services/assessment 做过一次')
  })

  test('学期评价的请求体里没有五大领域 —— 契约的 TermEvaluationWrite 只有内容字段', async () => {
    const c = await signedIn()
    const body = c.evaluation.buildTermBody({ eval_text: ' 正文 ', file_id: [1] })
    assert.deepEqual(Object.keys(body).sort(), ['eval_text', 'file_id'])
    assert.equal(body.eval_text, '正文', 'trim 之后再送')
  })
})

// ── 验收项 3：所有选择项都是原生滚轮，没有下拉列表残留 ──────────────────────

describe('选择控件的形态', () => {
  test('两张表单的幼儿选择都是滚轮，界面上不存在下拉列表形态', () => {
    for (const [wxml, json] of [
      [MONTH_WXML, 'packages/evaluation/pages/month/index.json'],
      [TERM_WXML, 'packages/evaluation/pages/term/index.json'],
    ]) {
      const src = read(wxml)
      assert.match(src, /<hl-child-picker[\s\S]*?mode="single"/, `${wxml}: 幼儿选择是滚轮`)
      assert.ok(!src.includes('<select'), `${wxml}: 小程序不存在下拉列表这一形态`)
      assert.ok(!src.includes('hl-chips'), `${wxml}: 也没有把它改成横排标签`)
      const def = JSON.parse(read(json))
      assert.equal(def.usingComponents['hl-child-picker'], '/components/hl-child-picker/index')
    }
  })

  test('单选模式的滚轮由 hl-picker-row 承担 —— 一处实现', () => {
    const wxml = read('components/hl-child-picker/index.wxml')
    assert.match(wxml, /<hl-picker-row/, '单选直接复用滚轮行')
  })
})

// ── 验收项 4：一屏完整预览，预览内容与提交内容逐字一致 ──────────────────────

describe('预览与提交逐字一致', () => {
  test('月度评价：预览绑的就是发出去的请求体', async () => {
    const c = await signedIn()
    const page = await openMonth(c, { nowMs: Date.UTC(2026, 7, 26, 8, 0, 0) })
    pickChild(page, 105)
    page.onTextInput({ detail: { value: '八月能主动收拾自己的餐具。' } })
    page.onPreviewTap()

    assert.equal(page.data.stage, 'preview')
    const shown = page.data.preview.body

    page.onPreviewEnd()
    await page.onConfirmTap()
    assert.equal(page.data.errorText, '', page.data.errorText)

    const sent = writesTo(c, '/home-school/month-evals')
    assert.equal(sent.length, 2, '落内容一次，发布一次')
    assert.deepEqual(sent[0].data, shown, '预览里那一份与发出去那一份逐字相同')
    assert.equal(sent[1].data, undefined, '发布端点无请求体')
  })

  test('学期评价：预览绑的就是发出去的请求体', async () => {
    const c = await signedIn()
    const page = await openTerm(c)
    await pickChild(page, 106)
    page.onTextInput({ detail: { value: '这个学期规则意识和表达意愿持续提升。' } })
    page.onPreviewTap()
    const shown = page.data.preview.body

    page.onPreviewEnd()
    await page.onConfirmTap()
    assert.equal(page.data.errorText, '', page.data.errorText)

    const sent = writesTo(c, '/children/106/term-evaluation')
    assert.equal(sent.length, 1)
    assert.deepEqual(sent[0].data, shown)
  })

  test('打开预览不算完整预览；返回修改让它作废', async () => {
    const c = await signedIn()
    const page = await openMonth(c, { nowMs: Date.UTC(2026, 7, 26, 8, 0, 0) })
    pickChild(page, 107)
    page.onTextInput({ detail: { value: '正文' } })
    page.onPreviewTap()
    assert.equal(page.data.previewedInFull, false, '打开预览不算')

    page.onPreviewEnd()
    assert.equal(page.data.previewedInFull, true)

    page.onBackToEdit()
    assert.equal(page.data.previewedInFull, false, '返回修改让上一次的完整预览作废')
    assert.equal(page.data.stage, 'edit')
  })
})

// ── 验收项 4：把关路径显式声明，拒绝发生在网络出口之前 ─────────────────────

describe('把关路径的声明', () => {
  test('两页各声明一条：教职工文字走完整预览＋明确发布', () => {
    for (const file of [MONTH, TERM]) {
      // 注释里讲得起另外三条（声明处的头注正是在解释为什么只有一条），所以先剥注释。
      const src = stripComments(read(file))
      assert.match(src, /GATES\.HUMAN_PREVIEW_CONFIRM/, `${file}: 没有显式声明`)
      assert.ok(!src.includes('ADMIN_REVIEW_QUEUE'), `${file}: 评价不是管理端审核队列那条路`)
      assert.ok(!src.includes('WECHAT_API_BATCH'), `${file}: 那是家长端路径`)
      // 本页不提供相册引用入口，所以这一次写入不携带图片这一类内容。
      assert.ok(!src.includes('IMAGE_MEDIA_CHECK_ASYNC'), `${file}: 没有图片入口`)
    }
  })

  test('未声明把关路径 -> 被拒，且本地契约服务没有收到任何请求', async () => {
    const c = await signedIn()
    const draft = { child_id: 108, eval_text: '正文', file_id: [] }
    const before = c.record.requests.length

    for (const gates of [undefined, null, [], 'no_such_gate']) {
      await assert.rejects(
        () => c.evaluation.publishMonthEval({
          gates, draft, previewedInFull: true, confirmed: true, keys: c.evaluation.newMonthKeys(),
        }),
        (err) => err instanceof c.moderation.ModerationError && /未声明内容安全闸门/.test(err.message),
        `月度评价声明为 ${JSON.stringify(gates)} 时必须拒绝`,
      )
      await assert.rejects(
        () => c.evaluation.submitTermEvaluation({
          gates, childId: 108, draft: { eval_text: '正文' },
          previewedInFull: true, confirmed: true, idempotencyKey: c.api.uuid(),
        }),
        (err) => err instanceof c.moderation.ModerationError && /未声明内容安全闸门/.test(err.message),
        `学期评价声明为 ${JSON.stringify(gates)} 时必须拒绝`,
      )
    }
    assert.equal(c.record.requests.length, before, '八种未声明的形态都没有走到网络')
  })

  test('未完整预览就发布 -> 被拒，服务端没有执行任何一次发布', async () => {
    const c = await signedIn()
    const page = await openMonth(c, { nowMs: Date.UTC(2026, 7, 26, 8, 0, 0) })
    pickChild(page, 109)
    page.onTextInput({ detail: { value: '正文' } })
    page.onPreviewTap()          // 进了预览，但没有读到底

    const before = c.record.requests.length
    const doneBefore = monthEvalPublications().length
    await page.onConfirmTap()

    assert.equal(c.record.requests.length, before, '被拒必须发生在网络出口之前')
    assert.equal(monthEvalPublications().length, doneBefore, '服务端没有执行任何发布')
    assert.match(page.data.errorText, /完整预览/, '告诉教师缺的是哪一步')
    assert.equal(page.data.errorCanRetry, false, '这不是服务故障，没有可重试的东西')
    assert.equal(page.data.locked, false, '被拒之后内容要能改')
  })

  test('学期评价未完整预览就提交 -> 同样被拒，服务端一行也没写', async () => {
    const c = await signedIn()
    const page = await openTerm(c)
    await pickChild(page, 110)
    page.onTextInput({ detail: { value: '正文' } })
    page.onPreviewTap()

    const before = c.record.requests.length
    const wroteBefore = termEvalWrites().length
    await page.onConfirmTap()

    assert.equal(c.record.requests.length, before)
    assert.equal(termEvalWrites().length, wroteBefore)
    assert.match(page.data.errorText, /完整预览/)
  })

  test('客户端不调用内容安全接口，只声明把关路径（DO-NOT-BUILD 13）', () => {
    for (const file of [MONTH, TERM, REPORT, SERVICE]) {
      const src = read(file)
      assert.ok(!src.includes('msgSecCheck'), `${file} 调了 security.msgSecCheck`)
      assert.ok(!src.includes('mediaCheckAsync('), `${file} 调了 security.mediaCheckAsync`)
    }
  })
})

// ── 验收项 7：请求体不含作者字段；白名单外的时间列被忽略 ────────────────────

describe('请求体的形状', () => {
  test('月度评价只有契约声明的四个键，作者字段与事件时间戳都不在里面', async () => {
    const c = await signedIn()
    const page = await openMonth(c, { nowMs: Date.UTC(2026, 7, 26, 8, 0, 0) })
    pickChild(page, 111)
    page.onTextInput({ detail: { value: '正文' } })
    page.onPreviewTap()
    page.onPreviewEnd()
    await page.onConfirmTap()

    const sent = writesTo(c, '/home-school/month-evals')[0]
    assert.deepEqual(
      Object.keys(sent.data).sort(),
      ['child_id', 'eval_month', 'eval_text', 'file_id'],
      '契约的 MonthEvalDraft，additionalProperties: false',
    )
    for (const key of c.derived.DERIVED) {
      assert.ok(!(key in sent.data), `请求体带上了派生的作者字段 ${key}`)
    }
    for (const key of c.derived.EVENT_TIMESTAMPS) {
      assert.ok(!(key in sent.data), `请求体带上了服务端设值的事件时间戳 ${key}`)
    }
    for (const key of c.time.SCHEDULED_TIME_FIELDS) {
      assert.ok(!(key in sent.data), `请求体带上了白名单里的计划时刻 ${key}，本表没有这种列`)
    }
    assert.ok(!('month_eval_status' in sent.data), '状态由服务端定，G51 未决的正是它')
    assert.ok(!('saved_at' in sent.data), 'saved_at 是事件时间戳，服务端设值')
  })

  test('白名单外的时间列被客户端提交时**被忽略，不报错也不生效**', async () => {
    const c = await signedIn()
    // 客户端这一侧：`stripDerived` 在出网络之前剥掉它们。
    const { body, stripped } = c.derived.stripDerived({
      child_id: 112, eval_month: '2026-08', eval_text: '正文',
      saved_at: '2026-08-01T09:00:00+08:00',
      created_at: '2026-08-01T09:00:00+08:00',
      teacher_id: 99,
    })
    assert.deepEqual(Object.keys(body).sort(), ['child_id', 'eval_month', 'eval_text'])
    assert.deepEqual(stripped.sort(), ['created_at', 'saved_at', 'teacher_id'])

    // 服务端这一侧：同样先剥再验，所以送进去**不报错**，也不落值。
    const res = await fetch(`${mock.baseUrl}/home-school/month-evals`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        child_id: 112, eval_month: '2026-08', eval_text: '正文',
        saved_at: '2000-01-01T00:00:00+08:00', teacher_id: 99,
      }),
    })
    assert.equal(res.status, 200, '白名单外的时间列不报错')
    const row = await res.json()
    assert.notEqual(row.saved_at, '2000-01-01T00:00:00+08:00', '也不生效')
    assert.equal(row.teacher_id, 12, '作者由服务端派生，不是请求体里的那个')
  })

  test('提交带 Z 偏移量的计划时刻得到 422 —— 本表没有这种列，schema 直接挡掉', async () => {
    const res = await fetch(`${mock.baseUrl}/home-school/month-evals`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        child_id: 113, eval_month: '2026-08', eval_text: '正文',
        due_at: '2026-08-30T18:00:00Z',
      }),
    })
    assert.equal(res.status, 422)
    const err = await res.json()
    assert.equal(err.code, 'validation_failed')
    assert.equal(err.details.field, 'due_at')
    // 客户端的白名单与契约的列表逐项一致，且这两张表的列一个也不在里面。
    const c = await signedIn()
    assert.equal(c.time.SCHEDULED_TIME_COLUMNS.length, 8, '数列表，不数正文（DO-NOT-BUILD 9）')
    for (const column of c.time.SCHEDULED_TIME_COLUMNS) {
      assert.ok(!column.startsWith('db_month_eval.'), '月度评价没有客户端提交的计划时刻')
      assert.ok(!column.startsWith('db_term_eval.'), '学期评价也没有')
    }
  })
})

// ── 验收项 5：重复发布只产生一份，重放回原始状态码与原始响应体 ──────────────

describe('同一份评价重复提交', () => {
  test('月度评价：两个幂等键复用，服务端只执行一次发布', async () => {
    const c = await signedIn()
    const page = await openMonth(c, { nowMs: Date.UTC(2026, 7, 26, 8, 0, 0) })
    pickChild(page, 114)
    page.onTextInput({ detail: { value: '正文' } })
    page.onPreviewTap()
    page.onPreviewEnd()
    await page.onConfirmTap()

    const mine = () => monthEvalPublications().filter((r) => r.child_id === 114)
    assert.equal(mine().length, 1, '第一次真的执行了一次 e1 -> e3')
    const keys = page.data.attemptKeys
    assert.ok(keys.save && keys.publish, '两个键留在页面上，重发复用')

    const publishUrl = writesTo(c, '/publication')[0].url
    const replay = await fetch(publishUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': keys.publish,
      },
    })
    assert.equal(replay.status, 200, '原始状态码')
    assert.equal((await replay.json()).month_eval_status, 'e3', '原始响应体')
    assert.equal(mine().length, 1, '重放不产生第二份')
  })

  test('学期评价：重复提交复用同一个键，只写一行', async () => {
    const c = await signedIn()
    const page = await openTerm(c)
    await pickChild(page, 115)
    page.onTextInput({ detail: { value: '正文' } })
    page.onPreviewTap()
    page.onPreviewEnd()
    await page.onConfirmTap()

    const mine = () => termEvalWrites().filter((r) => r.child_id === 115)
    assert.equal(mine().length, 1)
    const key = page.data.attemptKey
    assert.ok(key)

    const replay = await fetch(`${mock.baseUrl}/children/115/term-evaluation`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify({ eval_text: '正文', file_id: [] }),
    })
    assert.equal(replay.status, 201, '原始状态码')
    assert.equal(mine().length, 1, '重放不产生第二行')
  })

  test('换一个键重发会撞上「已提交，内容已锁定」—— 所以键必须复用', async () => {
    const res = await fetch(`${mock.baseUrl}/children/115/term-evaluation`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': 'a-brand-new-key-for-the-same-attempt',
      },
      body: JSON.stringify({ eval_text: '正文', file_id: [] }),
    })
    assert.equal(res.status, 409)
    assert.equal((await res.json()).code, 'state_precondition_failed')
  })
})

// ── 验收项 6：综合评估报告是只读页，没有导出、下载、分享 ────────────────────

describe('综合评估报告', () => {
  test('页面上没有导出、下载、分享入口，文案里也不出现（DO-NOT-BUILD 3）', () => {
    // 原型 growth-comprehensive-assessment.html 有一个「导出报告」弹层，那是 F17 之前
    // 的版本。这一条扫的是**代码与界面文案**，注释里讲得起「不做导出」这件事。
    const forbidden = ['导出', '下载', '分享', '保存到相册',
      'shareFileMessage', 'saveImageToPhotosAlbum', 'onShareAppMessage',
      'canvasToTempFilePath', 'downloadFile', 'openDocument']
    for (const file of [REPORT, REPORT_WXML]) {
      const src = stripComments(read(file))
      for (const word of forbidden) {
        assert.ok(!src.includes(word), `${file} 出现了「${word}」`)
      }
    }
  })

  test('是只读页 —— 一个写入控件也没有', () => {
    const src = stripComments(read(REPORT_WXML))
    assert.ok(!src.includes('<textarea'), '没有输入框')
    assert.ok(!src.includes('<input'), '没有输入框')
    assert.ok(!/hl-btn/.test(src), '没有任何按钮')
    const js = stripComments(read(REPORT))
    for (const verb of ['api.post', 'api.put', 'api.patch', 'api.del']) {
      assert.ok(!js.includes(verb), `报告页发起了写入：${verb}`)
    }
  })

  test('读四份数据，一次写入也没有', async () => {
    const c = await signedIn()
    const before = c.record.requests.length     // 登录那一次 POST 不算这一页的
    const page = loadPage(c, REPORT)
    await page.onLoad({ child_id: 102 })

    assert.equal(page.data.errorText, '', page.data.errorText)
    const mine = c.record.requests.slice(before)
    assert.deepEqual(mine.filter((r) => r.method !== 'GET'), [], '只读页只读')
    assert.ok(mine.length >= 4, '名册、量表、月度评价与成长档案各读一次')
    assert.ok(page.data.record, '成长档案齐备度')
    assert.ok(Array.isArray(page.data.months), '月度评价')
    assert.ok(page.data.months.some((m) => m.done), '二元口径：e3 已完成')
  })

  test('没选幼儿时是一句说明，不是一次故障', async () => {
    const c = await signedIn()
    const page = loadPage(c, REPORT)
    await page.onLoad({})
    assert.equal(page.data.errorText, '')
    assert.equal(page.data.loading, false)
    assert.equal(page.data.childId, 0)
    assert.ok(page.data.children.length > 0, '名册已经读回来了，选一个就能看')
  })
})

// ── 版式原语：几何取整与像素取整的两个落点 ─────────────────────────────────

describe('版式原语（票据 21 复用同一份）', () => {
  test('几何取整：余数为 0，所以几何上不取整', async () => {
    const c = await signedIn()
    const L = c.layout
    assert.equal(L.PAGE_MM.width - L.MARGIN_MM.x * 2, L.CONTENT_MM.width)
    assert.equal(L.PAGE_MM.height - L.MARGIN_MM.y * 2, L.CONTENT_MM.height)
    assert.equal(L.CONTENT_MM.width % L.COLS, 0, '余数 0')
    assert.equal(L.CONTENT_MM.height % L.ROWS, 0, '余数 0')
    assert.equal(L.CONTENT_MM.width / L.COLS, L.CELL_MM)
    assert.equal(L.CONTENT_MM.height / L.ROWS, L.CELL_MM, '两轴同一个格边长')
    assert.equal(L.assertGeometry(), true)
  })

  test('像素取整：cell 只算一次，两轴共用，余数并入边距', async () => {
    const c = await signedIn()
    const L = c.layout
    // 版式规格 §2.3 的工作示例，150 DPI 的 A4 导出档。
    const grid = L.pixelGrid(886, 1417)
    assert.equal(grid.cell, 59, 'floor(886 / 15)')
    assert.equal(grid.rows, 24, 'floor(1417 / 59)')
    assert.equal(grid.usedHeight, 1416)
    assert.equal(grid.remainderY, 1, '余数并入下边距')
    assert.equal(grid.conforms, true)

    // 分别拿宽和高去除格数会得到两个不同的浮点值 —— 那正是这条规则要防的。
    assert.notEqual(886 / 15, 1417 / 24)
    assert.equal(grid.usedWidth / grid.cols, grid.usedHeight / grid.rows, '格子精确正方')
  })

  test('长宽比逐像素等于占格数之比 —— 家长端的裁剪框吃这个值', async () => {
    const c = await signedIn()
    const grid = c.layout.gridForPageWidth(390)
    const square = c.layout.widgetRect({ grid_x: 0, grid_y: 0, grid_w: 2, grid_h: 2 }, grid)
    const wide = c.layout.widgetRect({ grid_x: 0, grid_y: 0, grid_w: 6, grid_h: 4 }, grid)
    assert.equal(square.width, square.height, '2 × 2 是精确 1:1')
    assert.equal(wide.width * 2, wide.height * 3, '6 × 4 是精确 3:2')
  })

  test('渲染面不是 A4 比例时炸，不靠改网格迁就', async () => {
    const c = await signedIn()
    // 一张正方形的渲染面：宽算出的 cell 铺不满 24 行。
    const square = c.layout.pixelGrid(300, 300)
    assert.notEqual(square.rows, 24)
    assert.equal(square.conforms, false)
    assert.throws(() => c.layout.assertPageSurface(square), c.layout.LayoutError)
  })

  test('报告页把五个 widget 铺成一页，几何与像素都按规格', async () => {
    const c = await signedIn()
    const page = loadPage(c, REPORT)
    await page.onLoad({ child_id: 102 })

    const sheet = page.data.sheet
    assert.ok(sheet, '版面算出来了')
    assert.deepEqual(sheet.problems, [], '版式没有问题')
    assert.equal(sheet.drawable, true)
    assert.equal(sheet.widgets.length, 5)

    const rows = Math.max(...sheet.widgets.map((w) => w.grid_y + w.grid_h))
    assert.equal(rows, 24, '整页排满，不越界')
    for (const w of sheet.widgets) {
      assert.ok(w.grid_x >= 0 && w.grid_x + w.grid_w <= 15, `${w.key} 越出左右边距`)
      assert.ok(w.grid_y >= 0 && w.grid_y + w.grid_h <= 24, `${w.key} 越出上下边距`)
      assert.ok(w.grid_w >= 2 && w.grid_h >= 2, `${w.key} 小于 2 × 2`)
      assert.equal(w.rect.width, w.grid_w * sheet.cell, `${w.key} 的像素宽 = 格数 × 格边长`)
      assert.equal(w.rect.height, w.grid_h * sheet.cell)
    }
  })
})

// ── 验收项 8：没有进行中的学期时是只读说明，不是错误弹窗 ────────────────────
//
// LAST in this file: it flips the server's term off and back on again.

describe('没有进行中的学期时', () => {
  test('学期评价是只读说明，不是一句错误，也没有弹窗', async () => {
    setNoTerm(true)
    try {
      const c = await signedIn()
      const page = await openTerm(c)
      await pickChild(page, 116)

      assert.equal(page.data.readonly, true, '写入区换成理由')
      assert.match(page.data.readonlyReason, /假期/)
      assert.match(page.data.readonlyReason, /没有进行中的学期/, '说出原因')
      assert.equal(page.data.errorText, '', '假期是季节，不是故障')
      assert.equal(page.data.errorCanRetry, false)
      assert.equal(c.record.toasts.length, 0, '不是弹窗 —— 是页面上的一行说明')

      // 写入动作不可用：填字与提交都什么也不发。
      const before = c.record.requests.length
      page.onTextInput({ detail: { value: '正文' } })
      page.onPreviewTap()
      await page.onConfirmTap()
      assert.equal(c.record.requests.length, before)
    } finally {
      setNoTerm(false)
    }
  })

  test('月度评价同样是只读说明', async () => {
    setNoTerm(true)
    try {
      const c = await signedIn()
      const page = await openMonth(c, { nowMs: Date.UTC(2026, 7, 26, 8, 0, 0) })
      pickChild(page, 119)
      assert.equal(page.data.readonly, true)
      assert.match(page.data.readonlyReason, /假期/)
      assert.equal(page.data.errorText, '')
      assert.equal(c.record.toasts.length, 0)
    } finally {
      setNoTerm(false)
    }
  })

  test('客户端的预先禁用不是边界 —— 服务端仍独立回 409 no_active_term', async () => {
    setNoTerm(true)
    try {
      const cases = [
        [`${mock.baseUrl}/children/117/term-evaluation`, { eval_text: '正文' }],
        [`${mock.baseUrl}/home-school/month-evals`, { child_id: 117, eval_month: '2026-08', eval_text: '正文' }],
      ]
      for (const [url, body] of cases) {
        const res = await fetch(url, {
          method: 'PUT',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        assert.equal(res.status, 409, url)
        assert.equal((await res.json()).code, 'no_active_term')
      }
    } finally {
      setNoTerm(false)
    }
  })

  test('学期恢复后同一页的写入入口回来了，不必重新登录', async () => {
    const c = await signedIn()
    const page = await openTerm(c)
    await pickChild(page, 118)
    assert.equal(page.data.readonly, false)
    assert.equal(page.data.readonlyReason, '')
  })
})
