/**
 * 学期编册与栏目版面（2026-08-27 补建）。
 *
 * 两页此前整页没有，成长册页上那条「编辑样板 ›」也没有 —— 教师无处编排班级模板，
 * 也就进不了新建栏目。园方逐页比对原型时报的正是这两处。
 *
 * 这一套盯的是三条契约铁律，不是版面像不像：
 *   1. 版面保存是 **PUT 整份**，任一处重叠拒绝整个栏目；前端标红只是体验。
 *   2. 发布之后版面**永久冻结**（W16）。
 *   3. 存进去的必须是**整数格坐标** —— 手指停在哪里不重要。
 */

import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { start } from '../mock/server.mjs'
import { loadClient, loadPage } from './helpers/seam.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MP = path.resolve(HERE, '..', 'miniprogram')
const read = (rel) => fs.readFileSync(path.join(MP, rel), 'utf8')

const COMPILE = 'packages/growth-book/pages/compile/index'
const SECTION = 'packages/growth-book/pages/section/index'

let mock

before(async () => { mock = await start({ port: 0 }) })
after(async () => { await mock.close() })

async function signedIn() {
  const c = loadClient({ baseUrl: mock.baseUrl })
  await c.auth.signIn()
  return c
}

/** 打开编册页并读完首屏。 */
async function openCompile(c) {
  const page = loadPage(c, `${COMPILE}.js`)
  page.onLoad()
  await page.load()
  return page
}

/** 打开一张空白的新栏目版面。 */
function openNewSection(c) {
  const page = loadPage(c, `${SECTION}.js`)
  page.onLoad({})
  return page
}

// ── 入口 ─────────────────────────────────────────────────────────────────────

describe('编辑样板这条路通了', () => {
  test('成长册页有原型那条「编辑样板 ›」，去的是编册页', async () => {
    const c = await signedIn()
    const wxml = read('packages/growth-book/pages/create/index.wxml')
    assert.match(wxml, /编辑样板/, '原型那条入口在')

    const page = loadPage(c, 'packages/growth-book/pages/create/index.js')
    page.onCompileTap()
    assert.equal(c.record.navigations.pop().url, `/${COMPILE}`)
  })

  test('编册页有「＋ 新建栏目」，不带编号就是新建', async () => {
    const c = await signedIn()
    const page = await openCompile(c)

    page.onAddSectionTap()
    assert.equal(c.record.navigations.pop().url, `/${SECTION}`, '新建不带 section_id')

    page.onSectionTap({ currentTarget: { dataset: { id: 400 } } })
    assert.equal(c.record.navigations.pop().url, `/${SECTION}?section_id=400`)
  })
})

// ── 栏目勾选与锁定 ───────────────────────────────────────────────────────────

describe('编册', () => {
  test('勾选走 revision CAS，改完读回来的是新版本', async () => {
    const c = await signedIn()
    const page = await openCompile(c)
    const before = page.data.compilation.revision

    await page.onToggle({ currentTarget: { dataset: { key: 'time' } } })

    const sent = c.record.requests.filter((r) => r.method === 'PATCH').pop()
    assert.ok(sent, '发了一次 PATCH')
    // `revision` 由请求层按 §5.1 加进去，不是页面拼的 —— 所以请求体是这两个键。
    assert.deepEqual(Object.keys(sent.data).sort(), ['enabled_sections', 'revision'])
    assert.ok(page.data.compilation.revision > before, 'revision 往前走了')
  })

  test('锁定是单向的：按之前先问一次，锁完这枚不再可点', async () => {
    const c = await signedIn()
    const page = await openCompile(c)

    // 直接点不发请求 —— 先弹确认。
    const beforeAsk = c.record.requests.length
    page.onLockTap()
    assert.equal(c.record.requests.length, beforeAsk, '没确认就不发请求')
    assert.match(c.record.modals.pop().content, /不能再改/, '问的是「锁了不能回头」')

    await page.doLock()
    assert.equal(page.data.compilation.locked, true)

    // 锁完之后勾选与新建栏目都不再动得了。
    const afterLock = c.record.requests.length
    await page.onToggle({ currentTarget: { dataset: { key: 'time' } } })
    page.onAddSectionTap()
    assert.equal(c.record.requests.length, afterLock, '锁定之后一个写请求也不发')
    assert.equal(c.record.navigations.length, 0, '也不再通往新建栏目')
  })
})

// ── 栏目版面 ─────────────────────────────────────────────────────────────────

describe('栏目版面', () => {
  test('新建时先建栏目再存版面，两步同一个幂等键', async () => {
    const c = await signedIn()
    await c.api.post('/teacher/growth-book/compilation', {})
    const page = openNewSection(c)

    page.onNameInput({ detail: { value: '入学第一天' } })
    page.onAddImage()
    assert.equal(page.data.widgets.length, 1)

    await page.onSaveTap()

    const posts = c.record.requests.filter((r) => r.url.endsWith('/growth-book/sections') && r.method === 'POST')
    const puts = c.record.requests.filter((r) => r.method === 'PUT' && r.url.includes('/widgets'))
    assert.equal(posts.length, 1, '建了一次栏目')
    assert.equal(puts.length, 1, '版面是**整份 PUT**，不是逐 widget PATCH')
    assert.ok(page.data.sectionId > 0, '拿到了栏目编号')
  })

  test('请求体只有契约白名单里的键，界面字段一个也不送', async () => {
    const c = await signedIn()
    await c.api.post('/teacher/growth-book/compilation', {})
    const page = openNewSection(c)
    page.onNameInput({ detail: { value: '园长寄语' } })
    page.onAddImage()
    page.onAddText()
    await page.onSaveTap()

    const body = c.record.requests.filter((r) => r.method === 'PUT').pop().data
    for (const w of body.widgets) {
      const keys = Object.keys(w).sort()
      for (const k of keys) {
        assert.ok(
          ['widget_id', 'page_index', 'grid_x', 'grid_y', 'grid_w', 'grid_h',
            'widget_type', 'binding_key', 'content'].includes(k),
          `请求体里出现了契约没有的键：${k}`,
        )
      }
      // 只有 literal 才可以在 widget 上存 content（DDL ck_bw_literal）。
      if (w.binding_key !== 'literal') {
        assert.equal('content' in w, false, `${w.binding_key} 不该带 content`)
      }
    }
  })

  test('拖动落点取整到格 —— 手指停在哪里不重要', async () => {
    const c = await signedIn()
    const page = openNewSection(c)
    page.onAddImage()

    const cell = page.data.cellPx
    // 停在两格半的位置上。
    page.onWidgetMoveEnd({ currentTarget: { dataset: { index: 0 } }, detail: { x: cell * 2.5, y: cell * 3.4 } })

    const w = page.data.widgets[0]
    assert.equal(Number.isInteger(w.grid_x), true, '存的是整数格')
    assert.equal(Number.isInteger(w.grid_y), true)
    assert.equal(w.grid_x, 3, '2.5 取到 3')
    assert.equal(w.grid_y, 3, '3.4 取到 3')
  })

  test('拖出网格会被夹回来 —— 边距留给美术边框', async () => {
    const c = await signedIn()
    const page = openNewSection(c)
    page.onAddImage()

    const cell = page.data.cellPx
    page.onWidgetMoveEnd({ currentTarget: { dataset: { index: 0 } }, detail: { x: cell * 99, y: cell * 99 } })

    const w = page.data.widgets[0]
    assert.equal(w.grid_x + w.grid_w <= 15, true, 'grid_x + grid_w <= 15')
    assert.equal(w.grid_y + w.grid_h <= 24, true, 'grid_y + grid_h <= 24')
  })

  test('重叠时就地标红，且拦住保存 —— 但服务端才是边界', async () => {
    const c = await signedIn()
    await c.api.post('/teacher/growth-book/compilation', {})
    const page = openNewSection(c)
    page.onNameInput({ detail: { value: '重叠测试' } })
    page.onAddImage()
    page.onAddText()

    // 把第二个搬到第一个身上。
    const first = page.data.widgets[0]
    page.onWidgetMoveEnd({
      currentTarget: { dataset: { index: 1 } },
      detail: { x: first.grid_x * page.data.cellPx, y: first.grid_y * page.data.cellPx },
    })
    assert.ok(page.data.problems.length > 0, '本地判定报了重叠')
    assert.match(page.data.problems[0].text, /重叠|叠在一起/)

    const before = c.record.requests.length
    await page.onSaveTap()
    assert.equal(c.record.requests.length, before, '有冲突时一个请求也不发')

    // §6.4：客户端预先拦截不是边界。服务端独立拒绝同一件事，且拒的是**整个栏目**。
    const made = await c.growthBook.createSection({ name: '直发', anchorAfter: 'time', anchorType: 'a1' })
    await assert.rejects(
      () => c.growthBook.saveWidgets({
        sectionId: made.section_id,
        widgets: [
          { page_index: 0, grid_x: 0, grid_y: 0, grid_w: 4, grid_h: 4, widget_type: 'image', binding_key: 'parent.upload' },
          { page_index: 0, grid_x: 1, grid_y: 1, grid_w: 4, grid_h: 4, widget_type: 'image', binding_key: 'parent.upload' },
        ],
      }),
      (err) => err.statusCode === 422 || err.statusCode === 409,
      '服务端自己也拒绝重叠',
    )
  })

  test('新加的组件放在第一个空得下的位置，不叠在别人身上', async () => {
    const c = await signedIn()
    const page = openNewSection(c)
    page.onAddImage()
    page.onAddImage()
    page.onAddImage()

    assert.equal(page.data.problems.length, 0, '连加三个也不重叠')
  })

  test('一个栏目至少一页，删到最后一页时拦住', async () => {
    const c = await signedIn()
    const page = openNewSection(c)
    assert.deepEqual(page.data.pageTabs, [0])

    page.onDeletePage()
    assert.deepEqual(page.data.pageTabs, [0], '最后一页删不掉')
    assert.match(page.data.notice, /至少要有一页/)

    page.onAddPage()
    assert.deepEqual(page.data.pageTabs, [0, 1])
    assert.equal(page.data.pageIndex, 1, '加完页就停在新页上')
  })

  test('这两页不出现观察记录，也不通往 PC后台', () => {
    for (const base of [COMPILE, SECTION]) {
      for (const ext of ['.js', '.wxml']) {
        const src = read(base + ext)
        assert.ok(!src.includes('观察记录'), `${base}${ext}: DO-NOT-BUILD 1`)
        assert.ok(!src.includes('PC后台'), `${base}${ext}: DO-NOT-BUILD 2`)
        assert.ok(!src.includes('/admin/'), `${base}${ext}: DO-NOT-BUILD 2`)
      }
    }
  })
})
