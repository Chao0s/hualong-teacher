/**
 * 成长档案这条链（2026-08-27 按原型建）—— 七个页面，五条读面，两条写入。
 *
 * 园方裁定以原型为准，`growth-record.html` 这条链因此收进结构契约（45 -> 52）。
 * 它此前被迁移清单记作「原型与评审走在了契约前面」而停建。
 *
 * 这一组测试盯住最容易悄悄坏掉的六件事：
 *
 *   1. **寄语提交即终局。** 重复提交回 409，不是覆盖。一个能覆盖的实现会悄悄把
 *      上一条抹掉，而教师看到的仍然是「提交成功」。
 *   2. **教职工文本走预览后发布。** 少了完整预览或明确确认，请求根本不该发出去
 *      （ADR-0016 第二行）。这一条不是提示，它是把关本身。
 *   3. **教师端只读家长交没交，读不到家长写了什么。** 家长的答案属于家长端。
 *   4. **教师评价聚合页一个写入控件也没有**（spec 05 的 write_control_count = 0）。
 *   5. **社区共育不著作内容**，因此不声明把关路径；它读的是已经过关的家长提交。
 *   6. 五条读面都有门：无身份 401，家长身份 403。
 */

import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { start } from '../mock/server.mjs'
import { loadClient, loadPage } from './helpers/seam.mjs'

const MP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'miniprogram')
const read = (rel) => fs.readFileSync(path.join(MP, rel), 'utf8')
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const EV = 'packages/evaluation/pages'
const CO = 'packages/co-education/pages'

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

// ── 成长档案页 ───────────────────────────────────────────────────────────────

describe('儿童成长档案', () => {
  test('三个入口，不是五个 —— spec 05 的 entry_reduction', async () => {
    const c = await signedIn()
    const page = loadPage(c, `${EV}/growth-record/index.js`)
    page.onLoad()
    await page.load()

    assert.deepEqual(page.data.entries.map((e) => e.label),
      ['发布家长评价', '教师评价', '成长册'],
      '月度与学期评价在「教师评价」里面，不在这一层')
  })

  test('六列进度，每一列都来自它自己那张表', async () => {
    const c = await signedIn()
    const rows = await c.evaluation.growthRecordRoster()

    assert.ok(rows.length > 0, '本班有幼儿')
    assert.equal(c.evaluation.GROWTH_RECORD_COLUMNS.length, 6)
    for (const row of rows) {
      assert.equal(row.cells.length, 6, `${row.name} 的列数与表头对不上`)
      for (const cell of row.cells) {
        assert.equal(typeof cell.done, 'boolean', '二元，没有第三种状态')
        // 一个颜色点对读屏软件是空的：颜色给眼睛，hint 给耳朵。
        assert.ok(cell.hint, `${row.name} 有一格没有读屏文案`)
      }
    }
  })

  test('三个入口各进各的页面', async () => {
    const c = await signedIn()
    const page = loadPage(c, `${EV}/growth-record/index.js`)
    page.onLoad()

    const expected = {
      parentEval: '/packages/evaluation/pages/parent-eval/index',
      teacherEval: '/packages/evaluation/pages/teacher-eval/index',
      book: '/packages/growth-book/pages/create/index',
    }
    for (const [key, url] of Object.entries(expected)) {
      page.onEntryTap({ currentTarget: { dataset: { key } } })
      assert.deepEqual(c.record.navigations.pop(), { api: 'navigateTo', url }, key)
    }
  })
})

// ── 教师评价聚合页 ───────────────────────────────────────────────────────────

describe('教师评价聚合页', () => {
  test('一个写入控件也没有（spec 05：write_control_count = 0）', () => {
    const src = read(`${EV}/teacher-eval/index.wxml`)
    for (const control of ['<textarea', '<input', 'bindinput', 'bindsubmit']) {
      assert.ok(!src.includes(control), `这一页出现了写入控件：${control}`)
    }
    const js = codeOnly(read(`${EV}/teacher-eval/index.js`))
    assert.ok(!js.includes('assertGate'), '没有写入就没有把关路径要声明')
    assert.ok(!/\bsubmit|\bpublish/i.test(js), '这一页只导航与只读展示')
  })

  test('四个入口都不带幼儿 —— 选谁是下一页的事', async () => {
    const c = await signedIn()
    const page = loadPage(c, `${EV}/teacher-eval/index.js`)
    page.onLoad()

    for (const key of ['month', 'term', 'comprehensive', 'message']) {
      page.onEntryTap({ currentTarget: { dataset: { key } } })
      const nav = c.record.navigations.pop()
      assert.ok(nav, `${key} 没有跳转`)
      assert.ok(!nav.url.includes('child_id'), `${key} 带上了幼儿，那是下一页要问的`)
    }
  })
})

// ── 教师寄语：终局性与把关 ───────────────────────────────────────────────────

describe('教师寄语', () => {
  test('提交后永久只读：同一名幼儿再提交回 409', async () => {
    const c = await signedIn()
    // 夹具里 101 号已经有寄语了。
    await assert.rejects(
      () => c.evaluation.submitMessage({
        gates: [c.moderation.GATES.HUMAN_PREVIEW_CONFIRM],
        draft: { child_id: '101', message_text: '想把上一条覆盖掉。' },
        previewedInFull: true,
        confirmed: true,
        idempotencyKey: c.evaluation.newMessageKey(),
      }),
      (err) => err.statusCode === 409,
      '覆盖会悄悄抹掉上一条，而教师看到的仍是「提交成功」',
    )
  })

  test('没有完整预览就不发请求 —— 把关在网络之前', async () => {
    const c = await signedIn()
    const before = c.record.requests.length

    await assert.rejects(
      () => c.evaluation.submitMessage({
        gates: [c.moderation.GATES.HUMAN_PREVIEW_CONFIRM],
        draft: { child_id: '102', message_text: '还没看过就想发。' },
        previewedInFull: false,
        confirmed: true,
        idempotencyKey: c.evaluation.newMessageKey(),
      }),
      (err) => err instanceof c.moderation.ModerationError,
    )
    assert.equal(c.record.requests.length, before, '闸门拒绝时一个请求也没有发出去')
  })

  test('缺少明确确认同样拦下 —— 预览与确认是两个动作', async () => {
    const c = await signedIn()
    await assert.rejects(
      () => c.evaluation.submitMessage({
        gates: [c.moderation.GATES.HUMAN_PREVIEW_CONFIRM],
        draft: { child_id: '102', message_text: '看过了，但没点确认。' },
        previewedInFull: true,
        confirmed: false,
        idempotencyKey: c.evaluation.newMessageKey(),
      }),
      (err) => err instanceof c.moderation.ModerationError,
    )
  })

  test('未声明把关路径的写入一律拒绝', async () => {
    const c = await signedIn()
    await assert.rejects(
      () => c.evaluation.submitMessage({
        gates: [],
        draft: { child_id: '102', message_text: '没有声明把关路径。' },
        previewedInFull: true,
        confirmed: true,
        idempotencyKey: c.evaluation.newMessageKey(),
      }),
      (err) => err instanceof c.moderation.ModerationError,
      '「我忘了想把关」不得看起来像「这里不需要把关」',
    )
  })

  test('写成功之后，完成情况表上那一格真的变了', async () => {
    const c = await signedIn()
    const page = loadPage(c, `${EV}/message/index.js`)
    page.onLoad()
    await page.load()

    const target = page.data.rows.find((r) => !r.done)
    assert.ok(target, '夹具里要有一名还没有寄语的幼儿')

    page.setData({ draft: { child_id: target.key, message_text: '写给这名幼儿的寄语。' } })
    page.onPreviewTap()
    page.onPreviewEnd()
    await page.onConfirmTap()

    assert.equal(page.data.stage, 'done')
    const after = page.data.rows.find((r) => r.key === target.key)
    assert.equal(after.done, true, '刚提交的那一格现在是已完成')
  })

  test('页面上没有编辑入口 —— 写入是终局的', () => {
    const src = read(`${EV}/message/detail.wxml`)
    for (const word of ['编辑', '修改内容', 'bindinput', '<textarea']) {
      assert.ok(!src.includes(word), `寄语详情出现了 ${word}`)
    }
    assert.match(src, /永久只读/, '把终局性说出来，而不是让教师自己发现')
  })
})

// ── 家长评价：教师发起，家长作答 ─────────────────────────────────────────────

describe('发布家长评价', () => {
  test('教师写的是给家长看的说明，不是家长的答案', () => {
    const src = codeOnly(read(`${EV}/parent-eval/index.js`))
    assert.ok(src.includes('evaluation_prompt'), '教师写的是 prompt')
    assert.ok(!src.includes('evaluation_text'), '家长的答案由家长端写，教师端一个字也不碰')
  })

  test('说明也是教职工文本，同样走预览后发布', async () => {
    const c = await signedIn()
    const before = c.record.requests.length
    await assert.rejects(
      () => c.evaluation.publishParentEval({
        gates: [c.moderation.GATES.HUMAN_PREVIEW_CONFIRM],
        draft: { evaluation_type: 't1', evaluation_period: '2026-02', evaluation_prompt: '没看过就发。' },
        previewedInFull: false,
        confirmed: true,
        idempotencyKey: c.evaluation.newParentEvalKey(),
      }),
      (err) => err instanceof c.moderation.ModerationError,
    )
    assert.equal(c.record.requests.length, before, '闸门拒绝时一个请求也没有发出去')
  })

  test('同一周期同一类型只能发起一次', async () => {
    const c = await signedIn()
    const publish = (period) => c.evaluation.publishParentEval({
      gates: [c.moderation.GATES.HUMAN_PREVIEW_CONFIRM],
      draft: { evaluation_type: 't1', evaluation_period: period, evaluation_prompt: '这一期的说明。' },
      previewedInFull: true,
      confirmed: true,
      idempotencyKey: c.evaluation.newParentEvalKey(),
    })

    await publish('2026-01')
    await assert.rejects(() => publish('2026-01'), (err) => err.statusCode === 409,
      '重发是覆盖，不是新建 —— 服务端要拦下它')
  })

  test('进度页只回交没交，不回家长写了什么', async () => {
    const c = await signedIn()
    const view = await c.evaluation.parentEvalProgress(701)

    assert.ok(view.rows.length > 0)
    for (const row of view.rows) {
      assert.equal(row.cells.length, 1)
      assert.equal(typeof row.cells[0].done, 'boolean')
      // 家长写的正文一个字也不该出现在这份视图模型里。
      assert.ok(!('evaluation_text' in row), `${row.name} 的行上带了家长的答案`)
    }
  })

  test('客户端不送派生的作者字段', async () => {
    const c = await signedIn()
    c.record.requests.length = 0
    await c.evaluation.publishParentEval({
      gates: [c.moderation.GATES.HUMAN_PREVIEW_CONFIRM],
      draft: { evaluation_type: 't2', evaluation_period: '2026-2027-1', evaluation_prompt: '学期这一期。' },
      previewedInFull: true,
      confirmed: true,
      idempotencyKey: c.evaluation.newParentEvalKey(),
    })

    const sent = c.record.requests.pop().data
    // §7.3 / DO-NOT-BUILD 8：作者由服务端派生，客户端发出前就不该有这些键。
    for (const derived of ['requested_by_teacher_id', 'teacher_id', 'class_id', 'created_by']) {
      assert.ok(!(derived in sent), `请求体里带了派生字段 ${derived}`)
    }
  })
})

// ── 社区共育 ─────────────────────────────────────────────────────────────────

describe('社区共育', () => {
  test('读的是亲子任务的提交，没有第二张提交表', () => {
    const src = codeOnly(read('services/co-education.js'))
    assert.ok(!src.includes('community_submission'),
      'DECISIONS B11／E5 拔掉了 db_community_submission')
  })

  test('不著作内容，因此不声明把关路径', () => {
    const js = codeOnly(read(`${CO}/community/index.js`))
    assert.ok(!js.includes('assertGate'), '这一页一个字也不写，没有要声明的把关路径')
    assert.ok(!js.includes('<textarea'), '也没有写入控件')
  })

  test('仍在内容安全批次里的提交不出现在流上', async () => {
    const c = await signedIn()
    const items = await c.coEdu.communityFeed({ parent_task_type: 'all' })
    assert.ok(items.length > 0, '流上要有内容，否则这条断言什么也没证明')
    // 夹具里有一条 `under_content_check`。教师读到的每一条都必须是已经过关的。
    assert.ok(!items.some((i) => i.pending), '把关未完成的内容不上流')
  })

  test('「全部」不是一个值，是不加这一条筛选', async () => {
    const c = await signedIn()
    c.record.requests.length = 0
    await c.coEdu.communityFeed({ parent_task_type: 'all' })
    const url = c.record.requests.pop().url
    assert.ok(!url.includes('parent_task_type'), '「全部」不该变成一个筛选值发出去')

    await c.coEdu.communityFeed({ parent_task_type: 't2' })
    assert.match(c.record.requests.pop().url, /parent_task_type=t2/)
  })

  test('换筛选先清空，读失败时不把上一组内容留在新标签下', async () => {
    const c = await signedIn()
    const page = loadPage(c, `${CO}/community/index.js`)
    page.onLoad()
    await page.load()
    assert.ok(page.data.items.length > 0)

    const realRequest = globalThis.wx.request
    globalThis.wx.request = (opts) => {
      globalThis.wx.request = realRequest
      opts.success({ statusCode: 500, data: { code: 'internal_error', message: '服务出错' }, header: {} })
    }
    await page.onFilterTap({ currentTarget: { dataset: { key: 't2' } } })

    assert.ok(page.data.errorText, '读失败了')
    assert.deepEqual(page.data.items, [], '上一组内容属于上一个筛选，留着就是在骗人')
  })
})

// ── 入口页 ───────────────────────────────────────────────────────────────────

describe('家园社共育入口页', () => {
  test('四张快捷入口卡，四条都通', async () => {
    const c = await signedIn()
    const page = loadPage(c, 'pages/co-education/index.js')
    page.onLoad()
    await page.load()

    assert.deepEqual(page.data.quickEntries.map((e) => e.label),
      ['在园时光', '亲子任务', '成长档案', '社区共育'], '原型 home-school.html 的四张')

    const expected = {
      moment: '/packages/co-education/pages/moment/progress',
      task: '/packages/co-education/pages/task/publish',
      record: '/packages/evaluation/pages/growth-record/index',
      community: '/packages/co-education/pages/community/index',
    }
    for (const [key, url] of Object.entries(expected)) {
      page.onQuickTap({ currentTarget: { dataset: { key } } })
      assert.deepEqual(c.record.navigations.pop(), { api: 'navigateTo', url }, key)
    }
    assert.equal(c.record.toasts.length, 0, '四条都已落地，没有一句「尚未上线」')
  })

  test('三个数字与逐儿四列出自同一次读取', async () => {
    const c = await signedIn()
    c.record.requests.length = 0
    const view = await c.coEdu.homeSchoolHome()

    assert.equal(c.record.requests.length, 1, '一个请求，不是三个')
    assert.deepEqual(view.metrics.map((m) => m.label), ['班级幼儿', '平均完成', '待提醒'])
    assert.equal(view.metrics[0].value, String(view.rows.length),
      '「班级幼儿」这个数与表里的行数必须一致，否则两处各说各话')
    for (const row of view.rows) {
      assert.equal(row.cells.length, 4, `${row.name} 的列数与表头对不上`)
      for (const cell of row.cells) assert.ok(cell.hint, `${row.name} 有一格没有读屏文案`)
    }
  })

  test('读失败时不画那张表 —— 读不到与没有幼儿是两件事', () => {
    const src = read('pages/co-education/index.wxml')
    const grid = src.split('\n').find((l) => l.includes('<hl-progress-grid'))
    assert.ok(grid, '入口页有那张表')
    assert.match(src.slice(src.indexOf('<hl-progress-grid')), /wx:if="\{\{!errorText\}\}"/)
  })
})

// ── 分层 ─────────────────────────────────────────────────────────────────────

test('七个新页面都不持有端点路径，也不碰传输层', () => {
  const pages = [
    `${EV}/growth-record/index.js`, `${EV}/teacher-eval/index.js`,
    `${EV}/message/index.js`, `${EV}/message/detail.js`,
    `${EV}/parent-eval/index.js`, `${EV}/parent-eval/progress.js`,
    `${CO}/community/index.js`,
  ]
  for (const file of pages) {
    const src = codeOnly(read(file))
    assert.ok(!src.includes('/home-school/'), `${file} 持有端点路径`)
    assert.ok(!src.includes('utils/request'), `${file} 直接使用了传输层`)
    assert.ok(!src.includes('utils/time'), `${file} 自己格式化时间`)
  }
})

test('每个分包仍然只读一个服务模块', () => {
  const pairs = [
    [`${EV}/growth-record/index.js`, 'evaluation'],
    [`${EV}/teacher-eval/index.js`, 'evaluation'],
    [`${EV}/message/index.js`, 'evaluation'],
    [`${EV}/message/detail.js`, 'evaluation'],
    [`${EV}/parent-eval/index.js`, 'evaluation'],
    [`${EV}/parent-eval/progress.js`, 'evaluation'],
    [`${CO}/community/index.js`, 'co-education'],
  ]
  for (const [file, service] of pairs) {
    const requires = [...codeOnly(read(file)).matchAll(/require\('([^']+)'\)/g)].map((m) => m[1])
    assert.deepEqual(
      requires.filter((r) => r.includes('/services/')),
      [`../../../../services/${service}`],
      `${file} 读了第二个服务模块`,
    )
  }
})
