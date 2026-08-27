/**
 * 办园质量评估（`QualityAssessment`，2026-08-27 建）。
 *
 * 这一页是**沿着首页那张卡查出来的**：卡上写着「质量评估」，却打开了五大领域量表 ——
 * 那是评一名幼儿的另一件量具。`01 home-spec.md` 的 `btn_assessment` 指的一直是这件
 * 评园所的 120 题工具，角标分母也是这 120，而它从没建过。
 *
 * 这一组测试盯住三件最容易再错一次的事：
 *
 *   1. **两件量具不许再混。** 首页那张卡进这一页，分母是 120 不是班上的幼儿数。
 *   2. **照契约，不在契约旁边另造。** 第一稿把三条已有的路径当成缺口，另发明了
 *      `/assessment-tools/…`、`/assessments/current` 与一条 `POST …/submission`。
 *      契约根本没有「提交」这个动作 —— 末题落下即 s3。这几条断言守着那次更正。
 *   3. **题库随客户端发版。** 契约要客户端按 `tool_code + tool_version` 自己解析题文，
 *      所以它不该出现在任何一个请求里。
 */

import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { start } from '../mock/server.mjs'
import { loadClient, loadPage } from './helpers/seam.mjs'

const require = createRequire(import.meta.url)
const MP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'miniprogram')
const TOOL = require(path.join(MP, 'packages/quality/assets/tool.js'))
const read = (rel) => fs.readFileSync(path.join(MP, rel), 'utf8')
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const PAGE = 'packages/quality/pages/tool/index'

let mock

before(async () => {
  mock = await start({ port: 0 })
  for (let i = 0; i < 20; i += 1) {
    try { await fetch(mock.baseUrl + '/__ready'); break }
    catch { await new Promise((r) => setTimeout(r, 50)) }
  }
})

after(async () => { await mock.close() })

async function signedIn() {
  const c = loadClient({ baseUrl: mock.baseUrl })
  await c.auth.signIn()
  return c
}

async function openTool(c) {
  const home = await c.home.load()
  const page = loadPage(c, `${PAGE}.js`)
  page.onLoad({ assessment_id: home.assessmentId })
  // `onLoad` 里那次 load 没有被 await，所以这里显式再等一次读完。
  await page.load()
  return page
}

// ── 两件量具 ─────────────────────────────────────────────────────────────────

describe('它和五大领域量表是两件不同的量具', () => {
  test('这一件评园所：9 个一级指标、120 题', async () => {
    const c = await signedIn()
    const page = await openTool(c)

    assert.equal(page.data.sections.length, 9, '九个一级指标')
    const total = page.data.sections.reduce((n, s) => n + s.total, 0)
    assert.equal(total, 120, '120 题')
    assert.equal(page.data.summary.required, 120)
  })

  test('那一件评一名幼儿：5 个领域、124 题，是另一条路径', async () => {
    const c = await signedIn()
    const scale = await c.assessment.scaleDefinition()
    assert.equal(scale.domains.length, 5)
    // 两件工具的题号形状不同，混用会撞 404 —— 这正是第一版走查踩的那一脚。
    assert.match(scale.domains[0].items[0].item_id, /^[A-Z]\d/)
    assert.match(TOOL.indicators[0].code, /^I\d{3}$/)
  })
})

test('首页那张卡进这一页，分母是 120', async () => {
  const c = await signedIn()
  const view = await c.home.load()
  const assessment = view.stats.find((s) => s.key === 'assessment')

  assert.equal(assessment.title, '质量评估')
  assert.match(assessment.badge, /\/120$/, '分母是工具的题数，不是班上的幼儿数')

  const page = loadPage(c, 'pages/home/index.js')
  await page.load()
  page.onTodoTap({ currentTarget: { dataset: { kind: 'assessment' } } })
  assert.deepEqual(c.record.navigations.pop(), {
    api: 'navigateTo',
    url: `/packages/quality/pages/tool/index?assessment_id=${view.assessmentId}`,
  })
})

// ── 照契约 ───────────────────────────────────────────────────────────────────

describe('照契约，不在它旁边另造', () => {
  test('只用契约声明的那三条路径', () => {
    const src = codeOnly(read('services/quality.js'))
    // 第一稿发明的三条，一条也不许回来。
    assert.ok(!src.includes('/assessment-tools'), '题库不从端点取 —— 契约要客户端自己解析')
    assert.ok(!src.includes('/current'), '没有 current 这条路径')
    assert.ok(!src.includes('submission'), '契约里没有提交这个动作')
    assert.match(src, /'\/assessments'/, '用契约的 /assessments')
  })

  test('页面上没有提交按钮 —— 末题落下即完成', () => {
    const wxml = read(`${PAGE}.wxml`)
    assert.ok(!wxml.includes('onSubmitTap'), '给一个不存在的动作画一扇门比不画更糟')
    assert.ok(!/提交评估|保存评估/.test(wxml))
    assert.match(wxml, /评完最后一题即完成/, '把这件事说出来，而不是让教师自己发现')

    const js = codeOnly(read(`${PAGE}.js`))
    assert.ok(!js.includes('submit'), '页面也没有提交处理器')
  })

  test('评满最后一题时服务端把状态推到 s3，页面随之只读', async () => {
    const c = await signedIn()
    const view = await c.home.load()

    // 评满 120 题。走服务层而不是手搭状态：要问的是「谁把它推到 s3」。
    for (const ind of TOOL.indicators) {
      // eslint-disable-next-line no-await-in-loop
      await c.quality.scoreItem(view.assessmentId, ind.code, {
        score: 4, idempotencyKey: c.quality.newScoreKey(),
      })
    }
    const done = await c.quality.load(view.assessmentId)
    assert.equal(done.summary.done, 120)
    assert.equal(done.readonly, true, '评满即完成，没有第二个动作')
  })

  test('作答请求体只有契约的三个键，派生值一个也不送', async () => {
    const c = await signedIn()
    const view = await c.home.load()
    c.record.requests.length = 0
    await c.quality.scoreItem(view.assessmentId, 'I002', {
      score: 3, note: '记一句', idempotencyKey: c.quality.newScoreKey(),
    })

    const sent = c.record.requests.pop()
    assert.equal(sent.method, 'PUT')
    assert.deepEqual(Object.keys(sent.data).sort(), ['file_id', 'note', 'score'])
    // `completed_count` 与 `assessment_status` 是派生值，请求体里没有它们（契约原话）。
    for (const derived of ['completed_count', 'assessment_status', 'teacher_id', 'class_id']) {
      assert.ok(!(derived in sent.data), `请求体里带了派生字段 ${derived}`)
    }
  })
})

// ── 题库 ─────────────────────────────────────────────────────────────────────

describe('题库随客户端发版', () => {
  test('题文一个字也不进请求', async () => {
    const c = await signedIn()
    const view = await c.home.load()
    c.record.requests.length = 0
    await c.quality.scoreItem(view.assessmentId, 'I001', {
      score: 5, idempotencyKey: c.quality.newScoreKey(),
    })
    const sent = c.record.requests.pop()
    const title = TOOL.indicators[0].title
    assert.ok(!JSON.stringify(sent).includes(title),
      '契约：题文不随作答复制，只回 tool_item_code 与作答')
  })

  test('工具版本对不上时说出来，不拿新版题文解释旧作答', async () => {
    const c = await signedIn()
    const realRequest = globalThis.wx.request
    globalThis.wx.request = (opts) => {
      globalThis.wx.request = realRequest
      opts.success({
        statusCode: 200,
        data: {
          assessment_id: 401,
          tool_code: 'school-quality-120',
          tool_version: '0.9.0',
          assessment_period: '2026-07',
          required_count: 120,
          completed_count: 0,
          assessment_status: 's1',
          items: [],
        },
        header: {},
      })
    }
    const view = await c.quality.load(401)
    assert.equal(view.staleTool, true)
    assert.deepEqual(view.sections, [], '题文对不上就不画题')
    assert.match(view.staleReason, /0\.9\.0/, '说清楚是哪一版')
  })

  test('五个打分档与三档锚点都来自题库，页面一个也没写死', () => {
    const wxml = read(`${PAGE}.wxml`)
    for (const label of ['不适宜', '及格', '一般', '良好', '优秀']) {
      assert.ok(!wxml.includes(label), `页面写死了打分档「${label}」`)
    }
    assert.match(wxml, /\{\{opt\.label\}\}/, '档位文案来自数据')
    assert.match(wxml, /\{\{anchor\.text\}\}/, '锚点文字来自数据')
  })
})

// ── 分层 ─────────────────────────────────────────────────────────────────────

test('页面不持有端点路径，也不碰传输层', () => {
  const src = codeOnly(read(`${PAGE}.js`))
  assert.ok(!src.includes('/assessments'), '端点在服务层')
  assert.ok(!src.includes('utils/request'), '页面不碰传输层')
})

test('本分包只读一个服务模块', () => {
  const requires = [...codeOnly(read(`${PAGE}.js`)).matchAll(/require\('([^']+)'\)/g)].map((m) => m[1])
  assert.deepEqual(
    requires.filter((r) => r.includes('/services/')),
    ['../../../../services/quality'],
    '一个分包一个服务模块（票据 12）',
  )
})
