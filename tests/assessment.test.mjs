/**
 * 五大领域量表与五维雷达图（票据 18）。
 *
 * 每一条回归用例都先在未修的代码上跑红过，确认它抓得住，再修绿。断言对着**行为**，
 * 不对着字符串：把关路径的拒绝发生在网络出口之前（数请求条数），幂等重放不产生第二份
 * （数服务端自己的记录），清屏发生在绘制之前（看调用次序，不看像素）。
 *
 * 题库那一条是**负向断言**：它不检查「有没有做对」，检查的是题目有没有被顺手抄进页面。
 */

import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  start, setNoTerm, childAssessmentCompletions, scaleItems, classRoster,
} from '../mock/server.mjs'
import { loadClient, loadPage } from './helpers/seam.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const MP = path.join(REPO, 'miniprogram')
const read = (rel) => fs.readFileSync(path.join(MP, rel), 'utf8')

const FIVE_CHART = 'packages/assessment/pages/five-chart/index.js'
const SCALE = 'packages/assessment/pages/scale/index.js'
const RADAR = 'packages/assessment/pages/radar/index.js'
const SERVICE = 'services/assessment.js'

// 五个领域各给一个分，好让五个轴互不相等 —— 全都相等的雷达图，画错了也看不出来。
const DOMAIN_SCORE = { H: 5, L: 4, S: 3, K: 2, A: 1 }

let mock
let ITEMS = []
let token = ''

before(async () => {
  mock = await start({ port: 0 })
  ITEMS = scaleItems()
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

async function signedIn(options) {
  const c = loadClient({ baseUrl: mock.baseUrl, ...options })
  await c.auth.signIn()
  return c
}

/**
 * 直接对着本地契约服务铺草稿。
 *
 * 走服务端而不是手搭一份状态：本票的核心是「进度存得住」，而存在哪里是服务端的事。
 * 用它铺完 123 题，页面进来看到的就是真实的 123/124。
 */
async function seed(childId, items) {
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(
      `${mock.baseUrl}/children/${childId}/child-assessment/items/${item.item_id}`,
      {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ score: DOMAIN_SCORE[item.item_id[0]] }),
      },
    )
    assert.equal(res.status, 200, `铺 ${item.item_id} 失败`)
  }
}

/** 打开量表页并读完首屏。 */
async function openScale(c, query = {}) {
  const page = loadPage(c, SCALE)
  await page.onLoad(query)
  return page
}

/** 拨一次滚轮，形状与 hl-picker-row 的 `pick` 事件一致。 */
function pick(page, itemId, score) {
  return page.onScorePick({
    currentTarget: { dataset: { itemId } },
    detail: { key: String(score), label: `${score} 分` },
  })
}

/** 剥掉注释再扫代码：注释里讲得起一个名字，代码里出现它才是问题。 */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/<!--[\s\S]*?-->/g, '')

const putsTo = (c, childId) => c.record.requests.filter(
  (r) => r.method === 'PUT' && r.url.includes(`/children/${childId}/child-assessment/items/`),
)

// ── 验收项 1：进度存得住，中断后回来接着填 ─────────────────────────────────

describe('量表填写进度', () => {
  test('填了一半离开再回来，已填的还在，且状态是草稿不是已提交', async () => {
    const childId = 101
    const c = await signedIn()
    const page = await openScale(c, { child_id: childId })
    assert.equal(page.data.progress.completed_count, 0, '第一次进来是空的')

    await pick(page, ITEMS[0].item_id, 3)
    await pick(page, ITEMS[1].item_id, 5)
    await pick(page, ITEMS[2].item_id, 1)
    assert.equal(page.data.progress.completed_count, 3)

    // 离开再回来：一个全新的客户端与一个全新的页面实例，本地什么也没带过去。
    const back = await signedIn()
    const again = await openScale(back, { child_id: childId })

    assert.equal(again.data.progress.completed_count, 3, '已填的三题还在')
    assert.deepEqual(again.data.progress.scores, {
      [ITEMS[0].item_id]: 3, [ITEMS[1].item_id]: 5, [ITEMS[2].item_id]: 1,
    }, '分数逐题相同')
    assert.equal(again.data.progress.child_assessment_status, 'c2')
    assert.equal(again.data.progress.status_label, '草稿', '未提交的内容是草稿')
    assert.equal(again.data.progress.done, false, '不被当成已提交')
    assert.equal(again.data.stage, 'fill', '回来就能接着填')
  })

  test('未评的题没有值 —— 不是 0 分，也不是原型那样预设的 4 分', async () => {
    const c = await signedIn()
    const page = await openScale(c, { child_id: 103 })
    await pick(page, ITEMS[0].item_id, 2)

    const scored = page.data.items.find((i) => i.item_id === ITEMS[0].item_id)
    const blank = page.data.items.find((i) => i.item_id !== ITEMS[0].item_id)
    assert.equal(scored.value, '2')
    assert.equal(blank.value, '', '缺席就是缺席')
    assert.equal(page.data.progress.scores[blank.item_id], undefined, '缺的题没有那一列')
  })

  test('第一次进来时服务端回 404 —— 那是「还没开始」，不是一次故障', async () => {
    const c = await signedIn()
    const page = await openScale(c, { child_id: 104 })
    assert.equal(page.data.errorText, '', '没有主记录不是错误')
    assert.equal(page.data.progress.completed_count, 0)
    assert.equal(page.data.progress.required_count, ITEMS.length)
    assert.equal(page.data.readonly, false, '照样可以填')
  })
})

// ── 验收项 2：选择项是从底部弹起的原生滚轮 ─────────────────────────────────

describe('选择控件的形态', () => {
  test('打分用 hl-picker-row，不是横排标签、更不是下拉列表', () => {
    const wxml = read('packages/assessment/pages/scale/index.wxml')
    assert.match(wxml, /<hl-picker-row[\s\S]*?bind:pick="onScorePick"/, '打分是滚轮行')
    assert.match(wxml, /<hl-child-picker[\s\S]*?mode="single"/, '幼儿选择是滚轮（名册型单选）')
    assert.ok(!wxml.includes('<select'), '小程序不存在下拉列表这一形态')

    const json = JSON.parse(read('packages/assessment/pages/scale/index.json'))
    assert.equal(json.usingComponents['hl-picker-row'], '/components/hl-picker-row/index')
    assert.equal(json.usingComponents['hl-child-picker'], '/components/hl-child-picker/index')
  })

  test('滚轮的五个选项带这一题自己的锚点 —— 取值随题目变，所以判滚轮不判标签', async () => {
    const c = await signedIn()
    const scale = await c.assessment.scaleDefinition()
    const first = scale.domains[0].items[0]
    const other = scale.domains[1].items[0]

    assert.equal(first.options.length, 5)
    assert.deepEqual(first.options.map((o) => o.key), ['1', '2', '3', '4', '5'])
    assert.match(first.options[0].label, /^1 分 · /)
    assert.notDeepEqual(
      first.options.map((o) => o.label), other.options.map((o) => o.label),
      '两题的选项文字不同 —— 取值不固定，form-control-spec 第 2 问因此答否',
    )
  })

  test('三条锚点搬进了题卡正文 —— 滚轮只显示选中的那一行，所以版面重排过', () => {
    const wxml = read('packages/assessment/pages/scale/index.wxml')
    assert.match(wxml, /as-anchor__level/, '锚点在题卡里逐条显示')
    assert.match(wxml, /as-item__question/, '完整问句与短名是两段文字，都在卡上')
  })
})

// ── 验收项 3：把关路径显式声明，不存在默认值 ───────────────────────────────

describe('把关路径的声明', () => {
  test('本页声明一条：教职工文字走完整预览＋明确发布', () => {
    // 注释里讲得起另外三条（声明处的头注正是在解释为什么只有一条），所以先剥注释。
    const src = stripComments(read(SCALE))
    assert.match(src, /GATES\.HUMAN_PREVIEW_CONFIRM/)
    assert.ok(!src.includes('ADMIN_REVIEW_QUEUE'), '量表不是资源与案例那条管理端审核路径')
    assert.ok(!src.includes('WECHAT_API_BATCH'), '那是家长端路径')
    // 本次写入不携带图片：契约的 ChildAssessmentItemWrite 里没有 file_id。
    assert.ok(!src.includes('IMAGE_MEDIA_CHECK_ASYNC'))
  })

  test('未声明把关路径 -> 被拒，且本地契约服务没有收到任何请求', async () => {
    const c = await signedIn()
    const progress = { child_id: 105, required_count: 124, completed_count: 123, scores: {} }
    const before = c.record.requests.length

    for (const gates of [undefined, null, [], 'no_such_gate']) {
      await assert.rejects(
        () => c.assessment.completeAssessment({
          progress, itemId: ITEMS[0].item_id, score: 3, gates,
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
      () => c.assessment.completeAssessment({
        progress: { child_id: 105, required_count: 124, completed_count: 123, scores: {} },
        itemId: ITEMS[0].item_id,
        score: 3,
        gates: [c.moderation.GATES.WECHAT_API_BATCH],
        previewedInFull: true,
        confirmed: true,
        idempotencyKey: c.api.uuid(),
      }),
      (err) => err instanceof c.moderation.ModerationError && /家长端路径/.test(err.message),
    )
    assert.equal(c.record.requests.length, before)
  })

  test('客户端不调用内容安全接口，只声明把关路径（DO-NOT-BUILD 13）', () => {
    for (const file of [SCALE, RADAR, FIVE_CHART, SERVICE]) {
      const src = read(file)
      assert.ok(!src.includes('msgSecCheck'), `${file} 调了 security.msgSecCheck`)
      assert.ok(!src.includes('mediaCheckAsync('), `${file} 调了 security.mediaCheckAsync`)
    }
  })
})

// ── 验收项 3／4：提交前完整预览，确认后锁定；提交是最后一题那一次写入 ────────

describe('提交要走完整预览与明确确认', () => {
  /** 铺满 123 题，把页面停在「只差最后一题」那一刻。 */
  async function readyForFinal(childId) {
    await seed(childId, ITEMS.slice(0, ITEMS.length - 1))
    const c = await signedIn()
    const page = await openScale(c, { child_id: childId })
    assert.equal(page.data.progress.completed_count, ITEMS.length - 1)
    assert.equal(page.data.remaining, 1)
    return { c, page, finalId: ITEMS[ITEMS.length - 1].item_id }
  }

  test('拨最后一题不发请求 —— 落下它就是提交，先进完整预览', async () => {
    const { c, page, finalId } = await readyForFinal(106)
    const before = c.record.requests.length

    await pick(page, finalId, 4)

    assert.equal(c.record.requests.length, before, '最后一题不当草稿写')
    assert.equal(page.data.stage, 'preview')
    assert.equal(page.data.preview.count, ITEMS.length, '预览里是全部 124 题')
    assert.equal(page.data.preview.rows[ITEMS.length - 1].score, 4, '最后一笔在预览里')
    assert.equal(page.data.previewedInFull, false, '打开预览不算完整预览')
  })

  test('未完整预览就提交 -> 被拒，且本地契约服务没有收到任何请求', async () => {
    const { c, page, finalId } = await readyForFinal(107)
    await pick(page, finalId, 4)     // 进了预览，但没有读到底

    const before = c.record.requests.length
    const doneBefore = childAssessmentCompletions().length
    await page.onConfirmTap()

    assert.equal(c.record.requests.length, before, '被拒必须发生在网络出口之前')
    assert.equal(childAssessmentCompletions().length, doneBefore, '服务端没有执行任何提交')
    assert.match(page.data.errorText, /完整预览/, '告诉教师缺的是哪一步')
    assert.equal(page.data.errorCanRetry, false, '这不是服务故障，没有可重试的东西')
    assert.equal(page.data.locked, false, '被拒之后内容要能改')
  })

  test('读到底再确认 -> 提交成功，内容锁定，状态是已完成', async () => {
    const { c, page, finalId } = await readyForFinal(108)
    await pick(page, finalId, 4)
    page.onPreviewEnd()
    await page.onConfirmTap()

    assert.equal(page.data.errorText, '')
    assert.equal(page.data.stage, 'done')
    assert.equal(page.data.locked, true, '确认之后内容锁定')
    assert.equal(page.data.progress.child_assessment_status, 'c1')
    assert.equal(page.data.progress.completed_count, ITEMS.length)
    assert.match(page.data.readonlyReason, /已锁定/)

    // 锁定之后改不动。
    const before = c.record.requests.length
    await pick(page, ITEMS[0].item_id, 1)
    assert.equal(c.record.requests.length, before)
  })

  test('返回修改让上一次的完整预览作废', async () => {
    const { page, finalId } = await readyForFinal(109)
    await pick(page, finalId, 4)
    page.onPreviewEnd()
    assert.equal(page.data.previewedInFull, true)

    page.onBackToFill()
    assert.equal(page.data.previewedInFull, false)
    assert.equal(page.data.pendingFinal, null, '最后一笔退回未落下的状态')
    assert.equal(page.data.stage, 'fill')
  })

  test('草稿这条路走不到「已提交」—— 服务层拒绝把最后一题当草稿写', async () => {
    const childId = 110
    await seed(childId, ITEMS.slice(0, ITEMS.length - 1))
    const c = await signedIn()
    const child = { child_id: childId, child_name: '测试' }
    const progress = await c.assessment.childAssessment(child, ITEMS.length)
    const finalId = ITEMS[ITEMS.length - 1].item_id
    assert.equal(c.assessment.isFinalItem(progress, finalId), true)

    const before = c.record.requests.length
    await assert.rejects(
      () => c.assessment.scoreItemDraft({ progress, itemId: finalId, score: 3 }),
      (err) => /最后一题/.test(err.message) && /完整预览/.test(err.message),
    )
    assert.equal(c.record.requests.length, before, '拒绝发生在网络出口之前')
    assert.equal(childAssessmentCompletions().filter((r) => r.child_id === childId).length, 0)
  })
})

// ── 验收项 4：请求体不含作者字段，也不含白名单外的时间戳 ────────────────────

describe('请求体的形状', () => {
  test('逐题写入只有 score 一个键，作者字段与事件时间戳都不在里面', async () => {
    const childId = 111
    const c = await signedIn()
    const page = await openScale(c, { child_id: childId })
    await pick(page, ITEMS[0].item_id, 3)
    await pick(page, ITEMS[1].item_id, 5)

    const sent = putsTo(c, childId)
    assert.equal(sent.length, 2)
    for (const req of sent) {
      assert.deepEqual(Object.keys(req.data), ['score'], '契约的 additionalProperties: false')
      for (const key of c.derived.DERIVED) {
        assert.ok(!(key in req.data), `请求体带上了派生的作者字段 ${key}`)
      }
      for (const key of c.derived.EVENT_TIMESTAMPS) {
        assert.ok(!(key in req.data), `请求体带上了服务端设值的事件时间戳 ${key}`)
      }
      // 白名单里的计划时刻本模块一列也用不到：量表没有任何客户端提交的时间。
      for (const key of c.time.SCHEDULED_TIME_FIELDS) {
        assert.ok(!(key in req.data), `请求体带上了白名单里的计划时刻 ${key}，量表没有这种列`)
      }
      assert.ok(!('completed_count' in req.data), 'completed_count 由服务端派生')
      assert.ok(!('child_assessment_status' in req.data), '状态由题项列数派生')
    }
  })

  test('提交那一次也只有 score —— 走的是同一个端点，不是第二条路径', async () => {
    const childId = 112
    await seed(childId, ITEMS.slice(0, ITEMS.length - 1))
    const c = await signedIn()
    const page = await openScale(c, { child_id: childId })
    const finalId = ITEMS[ITEMS.length - 1].item_id

    await pick(page, finalId, 2)
    page.onPreviewEnd()
    await page.onConfirmTap()

    const sent = putsTo(c, childId)
    assert.equal(sent.length, 1, '提交只发一次 PUT')
    assert.equal(sent[0].method, 'PUT')
    assert.ok(sent[0].url.endsWith(`/items/${finalId}`), '登记表两行，端点只有一个')
    assert.deepEqual(sent[0].data, { score: 2 })
    assert.ok(sent[0].header['Idempotency-Key'], '提交带幂等键')
  })

  test('草稿那一次不带幂等键 —— 键属于一次逻辑提交，不属于每一次拨动', async () => {
    const childId = 113
    const c = await signedIn()
    const page = await openScale(c, { child_id: childId })
    await pick(page, ITEMS[0].item_id, 3)
    assert.equal(putsTo(c, childId)[0].header['Idempotency-Key'], undefined)
  })
})

// ── 验收项 5：重复提交按幂等键回原始状态码与原始响应体 ──────────────────────

describe('同一份量表重复提交', () => {
  test('重复点击复用同一个键，回原始状态码与原始响应体，服务端只执行一次', async () => {
    const childId = 114
    await seed(childId, ITEMS.slice(0, ITEMS.length - 1))
    const c = await signedIn()
    const page = await openScale(c, { child_id: childId })
    const finalId = ITEMS[ITEMS.length - 1].item_id

    await pick(page, finalId, 5)
    page.onPreviewEnd()
    await page.onConfirmTap()

    const doneAfterFirst = childAssessmentCompletions().filter((r) => r.child_id === childId)
    assert.equal(doneAfterFirst.length, 1, '第一次真的执行了一次 c2 -> c1')
    const key = page.data.attemptKey
    assert.ok(key, '键留在页面上，重发复用')

    // 直接重放同一个键：页面已经锁定，所以这里对着服务端问同一个问题。
    const replay = await fetch(
      `${mock.baseUrl}/children/${childId}/child-assessment/items/${finalId}`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        body: JSON.stringify({ score: 5 }),
      },
    )
    assert.equal(replay.status, 200, '原始状态码')
    const body = await replay.json()
    assert.equal(body.child_assessment_status, 'c1')
    assert.equal(body.completed_count, ITEMS.length, '原始响应体')
    assert.equal(
      childAssessmentCompletions().filter((r) => r.child_id === childId).length, 1,
      '重放不产生第二份已提交的量表',
    )
  })

  test('第一次失败后重发复用同一个键 —— 键属于一次逻辑提交，不属于一次网络重试', async () => {
    const childId = 119
    await seed(childId, ITEMS.slice(0, ITEMS.length - 1))
    const c = await signedIn()
    const page = await openScale(c, { child_id: childId })
    const finalId = ITEMS[ITEMS.length - 1].item_id

    await pick(page, finalId, 3)
    page.onPreviewEnd()

    // 让第一次提交在网络上失败一次。500 不自动重试，所以拒绝会回到页面上。
    const realRequest = globalThis.wx.request
    globalThis.wx.request = (opts) => {
      globalThis.wx.request = realRequest
      c.record.requests.push({ method: opts.method, url: opts.url, header: opts.header, data: opts.data })
      opts.success({ statusCode: 500, data: { code: 'internal_error', message: '服务出错', request_id: 'req-x' }, header: {} })
    }
    await page.onConfirmTap()
    assert.match(page.data.errorText, /[一-龥]/, '失败说了一句中文')
    assert.equal(page.data.locked, false, '失败之后内容要能改')

    await page.onConfirmTap()

    const sent = putsTo(c, childId)
    assert.equal(sent.length, 2, '发了两次')
    assert.equal(
      sent[0].header['Idempotency-Key'], sent[1].header['Idempotency-Key'],
      '重发复用同一个键 —— 换新键会让重复点击变成两次写入',
    )
    assert.equal(
      childAssessmentCompletions().filter((r) => r.child_id === childId).length, 1,
      '服务端只执行了一次 c2 -> c1',
    )
    assert.equal(page.data.stage, 'done')
  })

  test('换一个键重发会撞上「已提交，内容已锁定」—— 所以键必须复用', async () => {
    const childId = 115
    await seed(childId, ITEMS)
    const res = await fetch(
      `${mock.baseUrl}/children/${childId}/child-assessment/items/${ITEMS[0].item_id}`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': 'a-brand-new-key-for-the-same-attempt',
        },
        body: JSON.stringify({ score: 3 }),
      },
    )
    assert.equal(res.status, 409)
    assert.equal((await res.json()).code, 'state_precondition_failed')
  })
})

// ── 验收项 6／7：画布绘制、五个轴、取整规则、图与表同源 ────────────────────

/** 一个已提交完整量表的幼儿，五个领域各一个分（DOMAIN_SCORE）。 */
async function completed(childId) {
  await seed(childId, ITEMS)
  return childId
}

async function openRadar(c, query) {
  const page = loadPage(c, RADAR)
  await page.onLoad(query)
  return page
}

/** 画布上写过的每一段文字。 */
const drawnText = (c) => c.record.canvasOps.filter((o) => o.op === 'fillText').map((o) => o.args[0])

describe('五维雷达图由画布绘制', () => {
  test('五个轴与五个领域一一对应，数值与服务层返回的逐字相同', async () => {
    const childId = await completed(116)
    const c = await signedIn()
    const page = await openRadar(c, { child_id: childId })

    const axes = page.data.radar.axes
    assert.deepEqual(axes.map((a) => a.code), ['H', 'L', 'S', 'K', 'A'])
    assert.deepEqual(axes.map((a) => a.name), ['健康', '语言', '社会', '科学', '艺术'])
    assert.deepEqual(axes.map((a) => a.value), [5, 4, 3, 2, 1], '五个领域各自的均分')
    assert.deepEqual(axes.map((a) => a.value_label), ['5.0', '4.0', '3.0', '2.0', '1.0'])

    // 画布上写的字与表里绑的字，是服务层给的同一个字符串。页面没有第二次计算。
    const text = drawnText(c)
    for (const axis of axes) {
      assert.ok(text.includes(`${axis.name} ${axis.value_label}`),
        `画布上没有 ${axis.name} 的数值`)
    }
    const src = stripComments(read(RADAR))
    assert.ok(!/toFixed|Math\.round/.test(src), '页面不做取整 —— 取整在服务层做过一次')
  })

  test('得分变化时重绘，且清屏发生在任何一笔绘制之前', async () => {
    const childId = await completed(117)
    const c = await signedIn()
    const page = await openRadar(c, { child_id: childId })

    const firstClear = c.record.canvasOps.findIndex((o) => o.op === 'clearRect')
    const firstDraw = c.record.canvasOps.findIndex(
      (o) => ['moveTo', 'lineTo', 'fill', 'stroke', 'fillText', 'arc'].includes(o.op),
    )
    assert.ok(firstClear >= 0, '画之前清了画布')
    assert.ok(firstClear < firstDraw, `清屏必须先于绘制（清 ${firstClear}，画 ${firstDraw}）`)

    // 重绘：画布不清就会叠图，所以第二遍也要有它自己的一次清屏。
    const opsBefore = c.record.canvasOps.length
    await page.onPullDownRefresh()
    const second = c.record.canvasOps.slice(opsBefore)
    const clearAt = second.findIndex((o) => o.op === 'clearRect')
    const drawAt = second.findIndex(
      (o) => ['moveTo', 'lineTo', 'fill', 'stroke', 'fillText', 'arc'].includes(o.op),
    )
    assert.ok(clearAt >= 0, '重绘也清了画布')
    assert.ok(clearAt < drawAt, '重绘时清屏仍在绘制之前，不残留上一次的图形')
  })

  test('后备缓冲 = CSS 尺寸 × 像素比，2 倍屏与 3 倍屏都不模糊', async () => {
    const childId = await completed(118)
    for (const dpr of [2, 3]) {
      const c = await signedIn()
      c.control.pixelRatio = dpr
      c.control.nodeSize = { width: 320, height: 280 }
      await openRadar(c, { child_id: childId })

      const node = c.record.canvasNodes[c.record.canvasNodes.length - 1]
      assert.equal(node.width, 320 * dpr, `${dpr} 倍屏的后备缓冲宽度`)
      assert.equal(node.height, 280 * dpr, `${dpr} 倍屏的后备缓冲高度`)
      // 放大之后必须用同一个倍率缩回去，否则整张图会画到画布外面。
      const scale = c.record.canvasOps.find((o) => o.op === 'scale')
      assert.deepEqual(scale.args, [dpr, dpr])
    }
  })

  test('画布用新版 Canvas 2D 接口，不是已废弃的旧接口', () => {
    const wxml = read('packages/assessment/pages/radar/index.wxml')
    assert.match(wxml, /<canvas[^>]*type="2d"/, 'type="2d" 才有同层渲染')
    assert.ok(!wxml.includes('canvas-id'), 'canvas-id 是旧接口，不再维护')
    const src = stripComments(read(RADAR))
    assert.match(src, /createSelectorQuery\(\)/)
    assert.match(src, /fields\(\{ node: true, size: true \}\)/)
    assert.ok(!src.includes('createCanvasContext'), 'wx.createCanvasContext 是旧接口')
    assert.ok(!/ctx\.draw\(/.test(src), '旧接口的 ctx.draw() 在 2d 上不存在')
  })

  test('图与表同屏对照，表里给出具体数值', () => {
    const wxml = read('packages/assessment/pages/radar/index.wxml')
    assert.match(wxml, /<canvas/, '图')
    assert.match(wxml, /as-table__row[\s\S]*?item\.value_label/, '表，且给的是数值')
    assert.match(wxml, /radar\.total_label/, '全部题项的均分也在表里')
  })
})

// ── 验收项 8：没有得分时是说明性的空状态 ───────────────────────────────────

describe('没有得分时', () => {
  test('是空状态，不是一个塌成一点的五边形 —— 根本不走绘制路径', async () => {
    const c = await signedIn()
    // 不经 onLoad：本文件前面的用例已经提交过几份量表，班级报告不再是空的，而这条要
    // 问的是「模型说画不了的时候，页面会不会还是去画」。所以直接把那种模型摆上去。
    const page = loadPage(c, RADAR)
    page.setData({ radar: c.assessment.radarModel({ domains: [], total_average: null }) })

    assert.equal(page.data.radar.can_draw, false)
    assert.match(page.data.radar.empty_reason, /还没有任何得分/, '说明为什么没有图')

    await page.draw()

    assert.equal(c.record.canvasOps.length, 0, '一笔也没画')
    assert.equal(c.record.selectorQueries.length, 0, '连画布都没有去量')
    assert.equal(page.data.errorText, '', '没有得分不是故障')
  })

  test('缺一个领域也不画 —— 合不拢的多边形，那条边是编的', async () => {
    const c = await signedIn()
    const model = c.assessment.radarModel({
      domains: [
        { code: 'H', item_count: 10, average: 4 },
        { code: 'L', item_count: 10, average: 3 },
        { code: 'S', item_count: 10, average: 3 },
        { code: 'K', item_count: 10, average: 3 },
        { code: 'A', item_count: 0, average: null },
      ],
      total_average: 3.25,
    })
    assert.equal(model.axes.length, 5, '轴不会因为没评分就消失')
    assert.equal(model.axes[4].value, null)
    assert.equal(model.axes[4].value_label, '—', '未评显示破折号，不显示 0')
    assert.equal(model.can_draw, false)
    assert.match(model.empty_reason, /艺术/, '说出还差哪个领域')
  })

  test('班级报告：没有已提交的量表时说清楚草稿不计入', async () => {
    const c = await signedIn()
    const report = await c.assessment.classReport()
    assert.equal(report.assessed_child_count > 0, true, '前面的用例已经提交过几份')
    // 空的那一支由 radarModel 之上再包一层，断言它说的是「草稿不计入」而不是「暂无数据」。
    const src = read(SERVICE)
    assert.match(src, /草稿不计入班级报告/)
  })
})

// ── 取整规则 ───────────────────────────────────────────────────────────────

describe('取整规则：一位小数，四舍五入，图与表同一个数', () => {
  test('roundScore 保留一位小数，null 保持 null', async () => {
    const c = await signedIn()
    const { roundScore, scoreLabel } = c.assessment
    assert.equal(roundScore(3.6666666), 3.7)
    assert.equal(roundScore(3.64), 3.6)
    assert.equal(roundScore(3.65), 3.7, '四舍五入')
    assert.equal(roundScore(4), 4)
    assert.equal(roundScore(null), null, '未评不折算成 0')
    assert.equal(roundScore(undefined), null)
    assert.equal(scoreLabel(3.6666666), '3.7')
    assert.equal(scoreLabel(4), '4.0', '补一位小数，好让一列数字对得齐')
    assert.equal(scoreLabel(null), '—')
  })

  test('图画的数与表写的数是同一个 —— 服务层取整一次，页面不再算', async () => {
    const c = await signedIn()
    const model = c.assessment.radarModel({
      domains: [
        { code: 'H', item_count: 3, average: 11 / 3 },
        { code: 'L', item_count: 3, average: 10 / 3 },
        { code: 'S', item_count: 3, average: 3 },
        { code: 'K', item_count: 3, average: 2.25 },
        { code: 'A', item_count: 3, average: 4.95 },
      ],
      total_average: 11 / 3,
    })
    assert.deepEqual(model.axes.map((a) => a.value), [3.7, 3.3, 3, 2.3, 5])
    assert.deepEqual(model.axes.map((a) => a.value_label), ['3.7', '3.3', '3.0', '2.3', '5.0'])
    for (const axis of model.axes) {
      assert.equal(axis.value.toFixed(1), axis.value_label, '图与表逐个轴对得上')
    }
    assert.equal(model.total_label, '3.7')
    assert.equal(model.can_draw, true)
  })
})

// ── 题库只有一份 ───────────────────────────────────────────────────────────

describe('题库只有一份', () => {
  // data/guide-scale.json 里的真题文。抄进客户端任何一处，下面这条就红。
  const SAMPLES = ITEM_TEXT_SAMPLES()

  test('页面源码里不含题目文本 —— 题目来自服务层', () => {
    const files = [
      SCALE, 'packages/assessment/pages/scale/index.wxml',
      RADAR, 'packages/assessment/pages/radar/index.wxml',
      FIVE_CHART, 'packages/assessment/pages/five-chart/index.wxml',
      SERVICE,
    ]
    for (const file of files) {
      const src = read(file)
      for (const text of SAMPLES) {
        assert.ok(!src.includes(text), `${file} 抄了一份题库：「${text}」`)
      }
    }
  })

  test('客户端不读 data/guide-scale.json —— 那是服务端的来源', () => {
    for (const file of [SCALE, RADAR, FIVE_CHART, SERVICE]) {
      const src = stripComments(read(file))
      assert.ok(!src.includes('guide-scale'), `${file} 直接读了题库文件`)
    }
  })

  test('124 题、5 领域全部由 GET /scales/{code}/{version} 下发', async () => {
    const c = await signedIn()
    const scale = await c.assessment.scaleDefinition()

    assert.equal(scale.itemCount, 124)
    assert.equal(scale.scale_code, 'guide')
    assert.equal(scale.scale_version, '1.0')
    assert.equal(scale.domains.length, 5)
    assert.equal(
      scale.domains.reduce((n, d) => n + d.items.length, 0), 124,
      '五个领域加起来就是全部题项',
    )
    const one = scale.domains[0].items[0]
    assert.ok(one.question && one.item_name && one.question !== one.item_name,
      '短名与完整问句是两段不同的文字，合并会让其中一页没字可显示')
    assert.ok(SAMPLES.some((t) => JSON.stringify(scale).includes(t)), '题文确实来自接口')

    const sent = c.record.requests.filter((r) => r.url.includes('/scales/'))
    assert.equal(sent.length, 1)
    assert.ok(sent[0].url.endsWith('/scales/guide/1.0'))
  })
})

/** 五段真题文，从题库随机位置取，不是全部 —— 抄一句和抄一份一样要红。 */
function ITEM_TEXT_SAMPLES() {
  const items = scaleItems()
  return [0, 30, 60, 90, 123].map((i) => items[i].question)
}

// ── DO-NOT-BUILD 逐条核对（负向断言）──────────────────────────────────────

describe('不得建造清单', () => {
  test('三页不含观察记录、不通往 PC后台、没有视频入口、不做角色切换', () => {
    const files = [
      SCALE, 'packages/assessment/pages/scale/index.wxml',
      RADAR, 'packages/assessment/pages/radar/index.wxml',
      FIVE_CHART, 'packages/assessment/pages/five-chart/index.wxml',
      SERVICE,
    ]
    for (const file of files) {
      const src = read(file)
      assert.ok(!src.includes('观察记录'), `${file}: 第 1 条`)
      assert.ok(!src.includes('pc-backend') && !src.includes('/admin/'), `${file}: 第 2 条`)
      assert.ok(!src.includes('setRole'), `${file}: 第 5 条`)
      for (const forbidden of ['<video', 'chooseVideo', 'wx.chooseMedia', '<camera']) {
        assert.ok(!src.includes(forbidden), `${file}: 第 12 条 —— ${forbidden}`)
      }
      // 第 3 条：成长册不做导出、下载、分享。报告页同理，一个导出入口也没有。
      assert.ok(!src.includes('shareFileMessage'), `${file}: 第 3 条`)
      assert.ok(!src.includes('saveImageToPhotosAlbum'), `${file}: 第 3 条 —— 雷达图不落地成图`)
      assert.ok(!src.includes('canvasToTempFilePath'), `${file}: 契约明写雷达图零存储`)
    }
  })

  test('分页只有游标 —— 名册型集合整取，不发 limit 也不发 cursor（第 11 条）', async () => {
    const c = await signedIn()
    await c.assessment.listChildAssessments()
    const sent = c.record.requests.find((r) => r.url.includes('/child-assessments'))
    assert.ok(!sent.url.includes('limit='), '名册型不分页')
    assert.ok(!sent.url.includes('cursor='))
    assert.ok(!sent.url.includes('offset=') && !sent.url.includes('page='))
  })
})

// ── 入口页：三个页面是一条链 ───────────────────────────────────────────────

describe('评价五维图入口页', () => {
  test('本班名册按三态显示，未提交的去量表、已提交的去雷达图', async () => {
    const c = await signedIn()
    const page = loadPage(c, FIVE_CHART)
    await page.onLoad()

    assert.equal(page.data.rows.length, classRoster().length, '整取全班')
    const done = page.data.rows.find((r) => r.done)
    const draft = page.data.rows.find((r) => !r.done)
    assert.ok(done && draft, '前面的用例造出了两种状态')
    assert.equal(done.status_label, '已完成')
    assert.match(page.data.summary, /已提交/)

    page.onChildTap({ currentTarget: { dataset: { childId: done.child_id } } })
    assert.match(c.record.navigations.pop().url, /pages\/radar\/index\?child_id=/)

    page.onChildTap({ currentTarget: { dataset: { childId: draft.child_id } } })
    assert.match(c.record.navigations.pop().url, /pages\/scale\/index\?child_id=/)

    page.onClassRadarTap()
    assert.match(c.record.navigations.pop().url, /pages\/radar\/index\?scope=class/)
  })

  test('教研培训入口页的两条入口已经落地，点下去真的跳转', async () => {
    const c = await signedIn()
    const entry = loadPage(c, 'pages/training/index.js')
    entry.onLoad()

    for (const [key, expected] of [['scale', 'scale'], ['chart', 'five-chart']]) {
      entry.onEntryTap({ detail: { key } })
      const nav = c.record.navigations.pop()
      assert.ok(nav, `${key} 没有跳转`)
      assert.match(nav.url, new RegExp(`packages/assessment/pages/${expected}/index`))
    }
    assert.equal(c.record.toasts.length, 0, '不再是「尚未上线」')
  })
})

// ── 验收项 8：没有进行中的学期时量表只读并说出原因 ─────────────────────────
//
// LAST in this file: it flips the server's term off and back on again.

describe('没有进行中的学期时', () => {
  test('量表是只读说明，不是一句错误，也没有弹窗', async () => {
    setNoTerm(true)
    try {
      const c = await signedIn()
      const page = await openScale(c, { child_id: 120 })

      assert.equal(page.data.readonly, true, '写入区换成理由')
      assert.match(page.data.readonlyReason, /假期/)
      assert.match(page.data.readonlyReason, /没有进行中的学期/, '说出原因')
      assert.equal(page.data.errorText, '', '假期是季节，不是故障')
      assert.equal(page.data.errorCanRetry, false)
      assert.equal(c.record.toasts.length, 0, '不是弹窗 —— 是页面上的一行说明')

      // 拨滚轮也什么都不发 —— 客户端预先禁用。
      const before = c.record.requests.length
      await pick(page, ITEMS[0].item_id, 3)
      await page.onConfirmTap()
      assert.equal(c.record.requests.length, before)
    } finally {
      setNoTerm(false)
    }
  })

  test('客户端的预先禁用不是边界 —— 服务端仍独立回 409 no_active_term', async () => {
    setNoTerm(true)
    try {
      const res = await fetch(
        `${mock.baseUrl}/children/121/child-assessment/items/${ITEMS[0].item_id}`,
        {
          method: 'PUT',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ score: 3 }),
        },
      )
      assert.equal(res.status, 409)
      assert.equal((await res.json()).code, 'no_active_term')
    } finally {
      setNoTerm(false)
    }
  })

  test('学期恢复后同一页的写入入口回来了，不必重新登录', async () => {
    const c = await signedIn()
    const page = await openScale(c, { child_id: 122 })
    assert.equal(page.data.readonly, false)
    assert.equal(page.data.readonlyReason, '')
  })
})
