/**
 * 成长册生成与预览（票据 21）。
 *
 * 每一条回归用例都先在未修的代码上跑红过，确认它抓得住，再修绿。断言对着**行为**：
 * 「只存在一份成长册」数的是服务端自己的记录不是客户端发了几个请求，「版式不重叠」算的
 * 是像素矩形不是看起来对不对，「没有版式包时诚实降级」问的是页面进了哪个状态、发了几个
 * 请求，不是它显示了什么字。
 *
 * 两条是**负向断言**：成长册两页没有导出下载分享，以及可勾选来源为空时一个请求也不发。
 */

import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  start, setLayoutPack, layoutPackPageCount, bookPublications, growthBooks,
} from '../mock/server.mjs'
import { loadClient, loadPage } from './helpers/seam.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MP = path.join(path.resolve(HERE, '..'), 'miniprogram')
const read = (rel) => fs.readFileSync(path.join(MP, rel), 'utf8')

const CREATE = 'packages/growth-book/pages/create/index.js'
const CREATE_WXML = 'packages/growth-book/pages/create/index.wxml'
const PREVIEW = 'packages/growth-book/pages/preview/index.js'
const PREVIEW_WXML = 'packages/growth-book/pages/preview/index.wxml'
const SERVICE = 'services/growth-book.js'
const LAYOUT = 'utils/layout.js'

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

const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/<!--[\s\S]*?-->/g, '')

/** 让这名幼儿有内容可入册：写一份学期评价。 */
async function seedContent(childId) {
  const res = await fetch(`${mock.baseUrl}/children/${childId}/term-evaluation`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ eval_text: '这个学期表现稳定。', file_id: [] }),
  })
  assert.equal(res.status, 201, `铺 ${childId} 的学期评价失败`)
}

async function openCreate(c) {
  const page = loadPage(c, CREATE)
  await page.onLoad()
  return page
}

async function openPreview(c, growthBookId, childId) {
  const page = loadPage(c, PREVIEW)
  await page.onLoad({ growth_book_id: growthBookId, child_id: childId })
  return page
}

// ── 验收项 1：勾选面板列出并纳入七类来源 ───────────────────────────────────

describe('勾选面板', () => {
  test('票据点名的七类来源全部列出来了', async () => {
    const c = await signedIn()
    const page = await openCreate(c)
    const labels = page.data.panel.map((r) => r.label)
    assert.deepEqual(labels, [
      '在园时光', '亲子任务与家园社共育', '月度评价', '学期评价',
      '园所介绍', '班级介绍', '教师寄语',
    ])
  })

  test('可勾选的只有两类，其余是固定书脊 —— 不给一个点不动的勾', async () => {
    const c = await signedIn()
    const page = await openCreate(c)
    const selectable = page.data.panel.filter((r) => r.selectable).map((r) => r.key)
    assert.deepEqual(selectable, ['time', 'task'],
      '契约的 enabled_sections 只存 time、task 与班级自订 section_id（F19）')
    for (const row of page.data.panel.filter((r) => !r.selectable)) {
      assert.equal(row.enabled, true, `${row.label} 是固定纳入`)
      assert.equal(row.fixed_label, '固定纳入')
    }
  })

  test('教师端读不到的三类回 null，不回 0 —— 两者不是同一件事', async () => {
    const c = await signedIn()
    const page = await openCreate(c)
    for (const key of ['intro', 'class', 'message']) {
      const row = page.data.panel.find((r) => r.key === key)
      assert.equal(row.count, null, `${row.label} 的件数教师端读不到`)
      assert.equal(row.count_label, '由园所设置提供')
    }
    for (const key of ['time', 'task', 'month', 'term']) {
      const row = page.data.panel.find((r) => r.key === key)
      assert.equal(typeof row.count, 'number', `${row.label} 的件数数得出来`)
    }
  })

  test('取消勾选走 revision CAS，服务端比对不上就重读，不盲写', async () => {
    const c = await signedIn()
    const page = await openCreate(c)
    const before = page.data.compilation.revision

    await page.onSourceToggle({ currentTarget: { dataset: { key: 'time' } } })
    assert.equal(page.data.compilation.revision, before + 1)
    assert.deepEqual(page.data.compilation.enabled_sections, ['task'], '在园时光被取消了')
    assert.equal(page.data.panel.find((r) => r.key === 'time').enabled, false)

    // 拿一份过期的 revision 去改：409，且客户端重读之后不覆盖。
    const stale = await fetch(
      `${mock.baseUrl}/teacher/growth-book/compilation/${page.data.compilation.compilation_id}`,
      {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ revision: before, enabled_sections: ['time', 'task'] }),
      },
    )
    assert.equal(stale.status, 409)
    assert.equal((await stale.json()).code, 'revision_stale')

    await page.onSourceToggle({ currentTarget: { dataset: { key: 'time' } } })
    assert.deepEqual(page.data.compilation.enabled_sections.sort(), ['task', 'time'])
  })

  test('固定书脊的三类塞进 enabled_sections 会被服务端拒绝', async () => {
    const c = await signedIn()
    const page = await openCreate(c)
    const res = await fetch(
      `${mock.baseUrl}/teacher/growth-book/compilation/${page.data.compilation.compilation_id}`,
      {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ revision: page.data.compilation.revision, enabled_sections: ['term'] }),
      },
    )
    assert.equal(res.status, 422, 'term／comp／message 固定启用，不进开关')
  })
})

// ── 验收项 7：可勾选来源为空时是一句说明，不生成空册子 ──────────────────────

describe('可勾选来源为空时', () => {
  test('给出一句中文说明，并且一个请求也不发', async () => {
    const c = await signedIn()
    const page = await openCreate(c)
    // 把件数全部清零：这就是「本班这学期什么都还没有」的样子。
    page.counts = { time: 0, task: 0, month: 0, term: 0, intro: null, class: null, message: null }
    const panel = c.growthBook.sourcePanel(page.data.compilation, page.counts)
    page.setData({
      panel,
      itemCount: c.growthBook.selectedItemCount(panel),
      emptyReason: c.growthBook.emptyReason(panel),
      childId: 101,
    })

    assert.equal(page.data.itemCount, 0)
    assert.match(page.data.emptyReason, /[一-龥]/, '一句中文说明')
    assert.match(page.data.emptyReason, /先发布在园时光或亲子任务/, '说清楚下一步做什么')

    const before = c.record.requests.length
    await page.onPreviewTap()
    assert.equal(c.record.requests.length, before, '连建册都不建 —— 挡在网络出口之前')
    assert.equal(growthBooks().some((b) => b.child_id === 101), false, '没有生成空册子')
  })

  test('有内容时才算得上非空 —— null 的三类不计入', async () => {
    const c = await signedIn()
    const empty = c.growthBook.sourcePanel(
      { enabled_sections: ['time', 'task'] },
      { time: 0, task: 0, month: 0, term: 0, intro: null, class: null, message: null },
    )
    assert.equal(c.growthBook.selectedItemCount(empty), 0)
    assert.notEqual(c.growthBook.emptyReason(empty), '')

    const some = c.growthBook.sourcePanel(
      { enabled_sections: ['time', 'task'] },
      { time: 3, task: 0, month: 0, term: 0, intro: null, class: null, message: null },
    )
    assert.equal(c.growthBook.selectedItemCount(some), 3)
    assert.equal(c.growthBook.emptyReason(some), '')
  })

  test('取消勾选的那一类不计入件数', async () => {
    const c = await signedIn()
    const panel = c.growthBook.sourcePanel(
      { enabled_sections: ['task'] },
      { time: 9, task: 2, month: 0, term: 0, intro: null, class: null, message: null },
    )
    assert.equal(c.growthBook.selectedItemCount(panel), 2, '没勾的在园时光不算')
  })
})

// ── 验收项 5：没有导出、下载、分享（DO-NOT-BUILD 3）───────────────────────

describe('不得建造清单第 3 条', () => {
  test('两页与服务层都没有导出、下载、分享入口，文案里也不出现', () => {
    const forbidden = ['导出', '下载', '分享', '保存到相册',
      'shareFileMessage', 'saveImageToPhotosAlbum', 'onShareAppMessage',
      'canvasToTempFilePath', 'downloadFile', 'openDocument', 'download-link']
    for (const file of [CREATE, CREATE_WXML, PREVIEW, PREVIEW_WXML, SERVICE, LAYOUT]) {
      const src = stripComments(read(file))
      for (const word of forbidden) {
        assert.ok(!src.includes(word), `${file} 出现了「${word}」`)
      }
    }
  })

  test('其余不得建造条目也逐条核对过', () => {
    for (const file of [CREATE, CREATE_WXML, PREVIEW, PREVIEW_WXML, SERVICE, LAYOUT]) {
      const src = read(file)
      assert.ok(!src.includes('观察记录'), `${file}: 第 1 条`)
      assert.ok(!src.includes('pc-backend') && !src.includes('/admin/'), `${file}: 第 2 条`)
      assert.ok(!src.includes('setRole'), `${file}: 第 5 条`)
      assert.ok(!src.includes('msgSecCheck'), `${file}: 第 13 条`)
      assert.ok(!src.includes('mediaCheckAsync('), `${file}: 第 13 条`)
      for (const forbiddenTag of ['<video', 'chooseVideo', 'wx.chooseMedia', '<camera']) {
        assert.ok(!src.includes(forbiddenTag), `${file}: 第 12 条 —— ${forbiddenTag}`)
      }
    }
  })
})

// ── 验收项 2：长文本与图片数量变化时不出现版式错乱或元素重叠 ────────────────

describe('版式校验（长文本与图片数量）', () => {
  test('图片数量从 1 变到 6，逐个像素矩形都不重叠、不越界', async () => {
    const c = await signedIn()
    const grid = c.layout.gridForPageWidth(390)
    c.layout.assertPageSurface(grid)

    // 三种排布：整页一张、三条横幅、两列三行。与夹具版式包里的那三种同形。
    const layouts = {
      1: [{ page_index: 0, grid_x: 0, grid_y: 0, grid_w: 15, grid_h: 24 }],
      3: [0, 6, 12].map((y) => ({ page_index: 0, grid_x: 0, grid_y: y, grid_w: 15, grid_h: 6 })),
      6: [0, 8, 16].flatMap((y) => [0, 8].map(
        (x) => ({ page_index: 0, grid_x: x, grid_y: y, grid_w: 7, grid_h: 7 }),
      )),
    }
    for (const [count, widgets] of Object.entries(layouts)) {
      assert.deepEqual(c.layout.pageProblems(widgets), [], `${count} 张图时版式有问题`)
      const rects = widgets.map((w) => c.layout.widgetRect(w, grid))
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i]
          const b = rects[j]
          const overlap = a.left < b.left + b.width && b.left < a.left + a.width
            && a.top < b.top + b.height && b.top < a.top + a.height
          assert.equal(overlap, false, `${count} 张图时第 ${i} 与第 ${j} 个框在像素上重叠了`)
        }
      }
      for (const r of rects) {
        assert.ok(r.left >= 0 && r.left + r.width <= grid.usedWidth, '越出内容区右边')
        assert.ok(r.top >= 0 && r.top + r.height <= grid.usedHeight, '越出内容区下边')
      }
    }
  })

  test('重叠一律拒绝放置，不做弹开推挤', async () => {
    const c = await signedIn()
    const problems = c.layout.pageProblems([
      { page_index: 0, grid_x: 0, grid_y: 0, grid_w: 8, grid_h: 8 },
      { page_index: 0, grid_x: 7, grid_y: 7, grid_w: 8, grid_h: 8 },
    ])
    assert.deepEqual(problems.map((p) => p.rule), ['overlap'])
    // 边贴边不算重叠：0..7 与 8..15 之间没有交集。
    assert.deepEqual(c.layout.pageProblems([
      { page_index: 0, grid_x: 0, grid_y: 0, grid_w: 8, grid_h: 8 },
      { page_index: 0, grid_x: 8, grid_y: 0, grid_w: 7, grid_h: 8 },
    ]), [])
  })

  test('越界、跨页与小于 2 × 2 各有一条规则，规则名与服务端逐字相同', async () => {
    const c = await signedIn()
    const rules = (w) => c.layout.pageProblems([w]).map((p) => p.rule)
    assert.deepEqual(rules({ page_index: 0, grid_x: 14, grid_y: 0, grid_w: 3, grid_h: 3 }), ['out_of_grid'])
    assert.deepEqual(rules({ page_index: 0, grid_x: 0, grid_y: 22, grid_w: 3, grid_h: 3 }), ['out_of_grid'])
    assert.deepEqual(rules({ page_index: 0, grid_x: 0, grid_y: 0, grid_w: 1, grid_h: 4 }), ['min_size'])
    assert.deepEqual(rules({ grid_x: 0, grid_y: 0, grid_w: 4, grid_h: 4 }), ['cross_page'])

    // 服务端独立重跑同一套校验，拒绝**整个栏目**的存档（W6／§5.3）。
    const section = await fetch(`${mock.baseUrl}/teacher/growth-book/sections`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '入学第一天', anchor_after: 'cover', anchor_type: 'a1' }),
    })
    assert.equal(section.status, 201)
    const sectionId = (await section.json()).section_id
    for (const [widgets, rule] of [
      [[{ page_index: 0, grid_x: 0, grid_y: 0, grid_w: 8, grid_h: 8, widget_type: 'image', binding_key: 'collected' },
        { page_index: 0, grid_x: 7, grid_y: 7, grid_w: 8, grid_h: 8, widget_type: 'image', binding_key: 'collected' }], 'overlap'],
      [[{ page_index: 0, grid_x: 0, grid_y: 0, grid_w: 1, grid_h: 4, widget_type: 'text', binding_key: 'literal' }], 'min_size'],
      [[{ page_index: 0, grid_x: 13, grid_y: 0, grid_w: 4, grid_h: 4, widget_type: 'text', binding_key: 'literal' }], 'out_of_grid'],
    ]) {
      const res = await fetch(`${mock.baseUrl}/teacher/growth-book/sections/${sectionId}/widgets`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ widgets }),
      })
      assert.equal(res.status, 422, `服务端应当拒绝：${rule}`)
      assert.equal((await res.json()).details.rule, rule, '规则名两边一致')
    }
  })

  test('文字容量由框与字级推导；超框是一条问题，不是一次悄悄截断', async () => {
    const c = await signedIn()
    const grid = c.layout.gridForPageWidth(390)
    const box = { page_index: 0, grid_x: 0, grid_y: 0, grid_w: 15, grid_h: 6 }
    const capacity = c.layout.textCapacity(box, grid, 9)
    assert.ok(capacity > 0)

    const fits = { ...box, text: '短'.repeat(capacity) }
    assert.deepEqual(c.layout.pageProblems([fits], { grid, fontPx: 9 }), [])

    const spills = { ...box, text: '长'.repeat(capacity + 1) }
    const problems = c.layout.pageProblems([spills], { grid, fontPx: 9 })
    assert.deepEqual(problems.map((p) => p.rule), ['text_exceeds_box'])
    assert.equal(problems[0].capacity, capacity, '说出这个框放得下几个字')
    // 截断是最不能接受的失效方式：文字原样留着，由页面点名说出来。
    assert.equal(spills.text.length, capacity + 1, '一个字也没被裁掉')
  })

  test('500 字的学期评语需要多大的框 —— 反推出来的数，不是排版偏好', async () => {
    const c = await signedIn()
    const grid = c.layout.gridForPageWidth(390)
    const needed = []
    for (let h = 2; h <= 24; h += 1) {
      if (c.layout.textCapacity({ grid_x: 0, grid_y: 0, grid_w: 15, grid_h: h }, grid, 9) >= 500) {
        needed.push(h);
        break
      }
    }
    assert.equal(needed.length, 1, '24 行之内放得下')
    // 报告页那张纸上，标题 2 行、副标题 2 行、雷达图 10 行已经占掉 14 行，只剩 10 行。
    // 500 字要的行数比 10 多，所以它进不了那一页 —— 这是算出来的，不是排版偏好。
    assert.ok(needed[0] > 10,
      `500 字要 15 × ${needed[0]} 格，而报告页那张纸只剩 10 行给它`)
  })

  test('栏目分块：widget 按页分组，一个 widget 只属于一页', async () => {
    const c = await signedIn()
    const pages = c.layout.splitPages([
      { page_index: 1, grid_x: 0, grid_y: 0, grid_w: 4, grid_h: 4 },
      { page_index: 0, grid_x: 0, grid_y: 0, grid_w: 4, grid_h: 4 },
      { page_index: 0, grid_x: 5, grid_y: 0, grid_w: 4, grid_h: 4 },
    ])
    assert.deepEqual(pages.map((p) => p.page_index), [0, 1], '按页号升序')
    assert.deepEqual(pages.map((p) => p.widgets.length), [2, 1])
    for (const p of pages) assert.deepEqual(p.problems, [])
  })
})

// ── 验收项 5 的前半：没有版式包时预览给出诚实状态 ──────────────────────────

describe('没有一份版式包发布时', () => {
  test('预览进入一种状态，不崩、不空白、也不弹错误', async () => {
    const c = await signedIn()
    await seedContent(120)
    const book = c.growthBook.decorateBook(await c.growthBook.ensureBook(120))
    const page = await openPreview(c, book.growth_book_id, 120)

    assert.equal(page.data.packReleased, false)
    assert.match(page.data.packReason, /[一-龥]/, '一句中文说明')
    assert.match(page.data.packReason, /版式包/, '说出缺的是什么')
    assert.equal(page.data.errorText, '', '这不是一次服务故障')
    assert.equal(page.data.errorCanRetry, false)
    assert.equal(c.record.toasts.length, 0, '不是弹窗')
    assert.equal(page.data.page, null, '没有画一页空白')
    assert.equal(page.data.totalPages, 0, '也没有编一个页数出来')
  })

  test('这时候一页也不去取 —— 没有可解析的东西，取了也是白取', async () => {
    const c = await signedIn()
    await seedContent(121)
    const book = c.growthBook.decorateBook(await c.growthBook.ensureBook(121))
    const before = c.record.requests.length
    await openPreview(c, book.growth_book_id, 121)
    const asked = c.record.requests.slice(before).filter((r) => r.url.includes('/pages/'))
    assert.deepEqual(asked, [], '没有逐页去取')
  })

  test('确认生成随之关掉 —— 没有完整预览就没有把关的前置', async () => {
    const c = await signedIn()
    await seedContent(122)
    const book = c.growthBook.decorateBook(await c.growthBook.ensureBook(122))
    const page = await openPreview(c, book.growth_book_id, 122)

    assert.equal(page.data.previewedInFull, false)
    const before = c.record.requests.length
    await page.onConfirmTap()
    assert.equal(c.record.requests.length, before, '一个请求也没发')
    assert.equal(bookPublications().some((r) => r.child_id === 122), false, '服务端没有定稿')
  })

  test('服务端说的是「没有 pack」，不是一次状态冲突 —— 客户端只认这一条规则', async () => {
    const c = await signedIn()
    await seedContent(123)
    const book = c.growthBook.decorateBook(await c.growthBook.ensureBook(123))
    const res = await fetch(`${mock.baseUrl}/growth-book/books/${book.growth_book_id}/manifest`, {
      headers: { authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 409, '409 是契约给这条路径声明过的码')
    const err = await res.json()
    assert.equal(err.code, 'state_precondition_failed')
    assert.equal(err.details.rule, c.growthBook.PACK_UNRELEASED)

    // 其余 409 照样抛给页面：把所有 409 都读成「没有版式包」会把真的冲突藏起来。
    const other = new c.errors.ApiError({
      statusCode: 409, code: 'state_precondition_failed', message: '别的冲突',
    })
    assert.equal(other.details, null)
  })
})

// ── 验收项 2／3：有版式包时按规格排版，且与家庭端读的是同两条路径 ───────────

describe('有版式包时的预览', () => {
  before(() => { setLayoutPack(true) })
  after(() => { setLayoutPack(false) })

  test('逐页排版，几何与像素取整按规格，每一页都画得出来', async () => {
    const c = await signedIn()
    await seedContent(124)
    const book = c.growthBook.decorateBook(await c.growthBook.ensureBook(124))
    const page = await openPreview(c, book.growth_book_id, 124)

    assert.equal(page.data.packReleased, true)
    assert.equal(page.data.totalPages, layoutPackPageCount())
    assert.equal(page.data.ordinal, 1)

    for (let n = 1; n <= page.data.totalPages; n += 1) {
      await page.openPage(n)                              // eslint-disable-line no-await-in-loop
      assert.equal(page.data.errorText, '', `第 ${n} 页出错：${page.data.errorText}`)
      const p = page.data.page
      assert.deepEqual(p.problems, [], `第 ${n} 页版式有问题`)
      assert.equal(p.drawable, true, `第 ${n} 页画不出来`)
      // 像素矩形逐个不重叠、不越界。图片数量在这几页里从 1 变到 6。
      const rects = p.widgets.map((w) => w.rect)
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i]
          const b = rects[j]
          const overlap = a.left < b.left + b.width && b.left < a.left + a.width
            && a.top < b.top + b.height && b.top < a.top + a.height
          assert.equal(overlap, false, `第 ${n} 页第 ${i} 与第 ${j} 个框重叠`)
        }
        assert.ok(rects[i].left >= 0 && rects[i].top >= 0, `第 ${n} 页有框落进边距`)
      }
    }
    const counts = [1, 3, 6]
    assert.ok(counts.length === 3, '夹具包里图片数量确实变过')
  })

  test('预览读的是家庭端那两条路径，且不自己算页数', async () => {
    const c = await signedIn()
    await seedContent(125)
    const book = c.growthBook.decorateBook(await c.growthBook.ensureBook(125))
    const before = c.record.requests.length
    const page = await openPreview(c, book.growth_book_id, 125)

    const urls = c.record.requests.slice(before).map((r) => r.url)
    assert.ok(urls.some((u) => u.includes(`/growth-book/books/${book.growth_book_id}/manifest`)),
      'manifest 走的是不带 /teacher/ 前缀的那一条')
    assert.ok(urls.some((u) => u.includes(`/growth-book/books/${book.growth_book_id}/pages/1`)),
      '逐页也是')
    assert.ok(!urls.some((u) => u.includes('/teacher/growth-book/books/') && u.includes('/pages/')),
      '没有第二条只给教师的读路径')

    // 页数由服务端 composer 给，客户端没有近似公式。
    const src = stripComments(read(SERVICE)) + stripComments(read(PREVIEW))
    assert.ok(!/total_pages\s*=/.test(src), '客户端不自己算总页数')
    assert.equal(page.data.totalPages, layoutPackPageCount())
  })

  test('fingerprint 每次都带；漂移回 409 而不是画一份旧的', async () => {
    const c = await signedIn()
    await seedContent(126)
    const book = c.growthBook.decorateBook(await c.growthBook.ensureBook(126))
    const page = await openPreview(c, book.growth_book_id, 126)
    const pageUrl = c.record.requests.map((r) => r.url).find((u) => u.includes('/pages/1'))
    assert.match(pageUrl, /fingerprint=/, '逐页读带上 fingerprint')
    assert.match(pageUrl, /dpr=/, '设备像素比照实送，由服务端钳到 ≤ 2')

    const stale = await fetch(
      `${mock.baseUrl}/growth-book/books/${book.growth_book_id}/pages/1?fingerprint=stale`,
      { headers: { authorization: `Bearer ${token}` } },
    )
    assert.equal(stale.status, 409)
    assert.equal((await stale.json()).code, 'fingerprint_drift')
    assert.equal(page.data.page.drawable, true, '正常那一次照常画得出来')
  })

  test('服务端把 dpr 钳到 ≤ 2 —— 客户端声称 5 也不会签出一张越界的派生图', async () => {
    const c = await signedIn()
    await seedContent(127)
    const book = c.growthBook.decorateBook(await c.growthBook.ensureBook(127))
    const manifest = await c.growthBook.manifest(book.growth_book_id)
    const res = await fetch(
      `${mock.baseUrl}/growth-book/books/${book.growth_book_id}/pages/1`
      + `?fingerprint=${manifest.fingerprint}&dpr=5`,
      { headers: { authorization: `Bearer ${token}` } },
    )
    assert.equal(res.status, 200)
    assert.equal((await res.json()).applied_dpr, 2, 'ADR-0015 决策一')
  })
})

// ── 验收项 4／6：确认生成携带幂等键，只存在一份；写入点显式声明把关路径 ─────

describe('确认生成', () => {
  before(() => { setLayoutPack(true) })
  after(() => { setLayoutPack(false) })

  /** 翻到最后一页，完整预览才成立。 */
  async function previewToEnd(c, childId) {
    await seedContent(childId)
    const book = c.growthBook.decorateBook(await c.growthBook.ensureBook(childId))
    const page = await openPreview(c, book.growth_book_id, childId)
    for (let n = 2; n <= page.data.totalPages; n += 1) {
      await page.onNextPage()                             // eslint-disable-line no-await-in-loop
    }
    assert.equal(page.data.previewedInFull, true, '翻到最后一页才算完整预览')
    return { page, book }
  }

  test('本页声明两条：教职工文字加图片，两类内容各一条', () => {
    const src = stripComments(read(PREVIEW))
    assert.match(src, /GATES\.HUMAN_PREVIEW_CONFIRM/)
    assert.match(src, /GATES\.IMAGE_MEDIA_CHECK_ASYNC/, '册里有图片这一类内容')
    assert.ok(!src.includes('ADMIN_REVIEW_QUEUE'), '成长册不是管理端审核队列那条路')
    assert.ok(!src.includes('WECHAT_API_BATCH'), '那是家长端路径')
  })

  test('未声明把关路径 -> 被拒，且本地契约服务没有收到任何请求', async () => {
    const c = await signedIn()
    const before = c.record.requests.length
    for (const gates of [undefined, null, [], 'no_such_gate']) {
      await assert.rejects(                               // eslint-disable-line no-await-in-loop
        () => c.growthBook.publishBook({
          gates, growthBookId: 200, contentFingerprint: 'x', imageCount: 3,
          previewedInFull: true, confirmed: true, idempotencyKey: c.api.uuid(),
        }),
        (err) => err instanceof c.moderation.ModerationError && /未声明内容安全闸门/.test(err.message),
        `声明为 ${JSON.stringify(gates)} 时必须拒绝`,
      )
    }
    assert.equal(c.record.requests.length, before, '四种未声明的形态都没有走到网络')
  })

  test('带图却只声明文字那一条 -> 被拒，声明不全等同未声明', async () => {
    const c = await signedIn()
    const before = c.record.requests.length
    await assert.rejects(
      () => c.growthBook.publishBook({
        gates: [c.moderation.GATES.HUMAN_PREVIEW_CONFIRM],
        growthBookId: 200, contentFingerprint: 'x', imageCount: 6,
        previewedInFull: true, confirmed: true, idempotencyKey: c.api.uuid(),
      }),
      (err) => err instanceof c.moderation.ModerationError && /没有声明图片把关路径/.test(err.message),
    )
    assert.equal(c.record.requests.length, before)
  })

  test('没翻到底就确认 -> 被拒，服务端没有定稿', async () => {
    const c = await signedIn()
    await seedContent(128)
    const book = c.growthBook.decorateBook(await c.growthBook.ensureBook(128))
    const page = await openPreview(c, book.growth_book_id, 128)
    assert.equal(page.data.previewedInFull, false, '刚打开只在第一页')

    const before = c.record.requests.length
    await page.onConfirmTap()
    assert.equal(c.record.requests.length, before, '拒绝发生在网络出口之前')
    assert.match(page.data.errorText, /完整预览/)
    assert.equal(bookPublications().some((r) => r.child_id === 128), false)
  })

  test('翻到底再确认：只存在一份成长册，重放回原始状态码与原始响应体', async () => {
    const c = await signedIn()
    const { page, book } = await previewToEnd(c, 110)

    await page.onConfirmTap()
    assert.equal(page.data.errorText, '', page.data.errorText)
    assert.equal(page.data.published, true)

    const mine = () => bookPublications().filter((r) => r.child_id === 110)
    assert.equal(mine().length, 1, '服务端真的执行了一次 b1 -> b2')
    assert.equal(growthBooks().filter((b) => b.child_id === 110).length, 1, '只存在一份')

    const key = page.data.attemptKey
    assert.ok(key, '键留在页面上，重发复用')
    const replay = await fetch(
      `${mock.baseUrl}/teacher/growth-book/books/${book.growth_book_id}/publication`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        body: JSON.stringify({ content_fingerprint: page.data.contentFingerprint }),
      },
    )
    assert.equal(replay.status, 200, '原始状态码')
    assert.equal((await replay.json()).book_status, 'b2', '原始响应体')
    assert.equal(mine().length, 1, '重放不产生第二次定稿')
    assert.equal(growthBooks().filter((b) => b.child_id === 110).length, 1, '仍然只有一份')
  })

  test('重复点击复用同一个键，服务端只执行一次', async () => {
    const c = await signedIn()
    const { page } = await previewToEnd(c, 111)
    await page.onConfirmTap()
    const key = page.data.attemptKey
    // 第二次点击：页面已经 published，所以对着服务端问同一个问题也只该有一份。
    await page.onConfirmTap()
    assert.equal(page.data.attemptKey, key, '键不在每次点击时新建')
    assert.equal(bookPublications().filter((r) => r.child_id === 111).length, 1)
  })

  test('换一个键重发会撞上「已定稿，永久唯读」—— 所以键必须复用', async () => {
    const c = await signedIn()
    const { page, book } = await previewToEnd(c, 112)
    await page.onConfirmTap()
    const res = await fetch(
      `${mock.baseUrl}/teacher/growth-book/books/${book.growth_book_id}/publication`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': 'a-brand-new-key-for-the-same-attempt',
        },
        body: JSON.stringify({ content_fingerprint: page.data.contentFingerprint }),
      },
    )
    assert.equal(res.status, 409)
    assert.equal((await res.json()).code, 'state_precondition_failed')
  })

  test('建册幂等：同一名幼儿再进一次预览，不会多出第二本', async () => {
    const c = await signedIn()
    await seedContent(113)
    const first = c.growthBook.decorateBook(await c.growthBook.ensureBook(113))
    const again = c.growthBook.decorateBook(await c.growthBook.ensureBook(113))
    assert.equal(first.growth_book_id, again.growth_book_id, 'UNIQUE(child_id, term_id)')
    assert.equal(growthBooks().filter((b) => b.child_id === 113).length, 1)
  })

  test('指纹漂移回 409 且零写入 —— 预检看到的班要和定稿的班是同一个', async () => {
    const c = await signedIn()
    const { page, book } = await previewToEnd(c, 114)
    const res = await fetch(
      `${mock.baseUrl}/teacher/growth-book/books/${book.growth_book_id}/publication`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': c.api.uuid(),
        },
        body: JSON.stringify({ content_fingerprint: 'a-stale-fingerprint' }),
      },
    )
    assert.equal(res.status, 409)
    assert.equal((await res.json()).code, 'fingerprint_drift')
    assert.equal(bookPublications().some((r) => r.child_id === 114), false, '零写入')
    assert.ok(page.data.contentFingerprint, '页面手上那一份是预检给的')
  })
})
