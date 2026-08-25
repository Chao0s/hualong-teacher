/**
 * 资源库阅读（票据 13）：入口页、资源列表、资源详情，加选择控件的三条行为规则。
 *
 * 这个文件盯住的是三类看不见的东西：
 *
 *   1. 游标属于签发它的那一组筛选条件。换筛选还用旧游标，服务端回 400，页面若不
 *      自愈就再也翻不出下一页——而且屏幕上什么也不会说。
 *   2. 状态列是真信息。资源与党建三类不同，教师看得到自己写的非 s3，所以「已发布」
 *      与「还在我手里」必须分得出来。
 *   3. 「尚未上线」必须说出口。关联案例的目标还没落地，点了没反应比说一句拒绝更糟。
 *
 * 选择控件（hl-picker-row）的三条规则也在这里：滑动中不写、只有确认才写、取消不改。
 * 它们靠组件不持有选中值达成，所以断言的是「组件没有可改的东西」，不是「组件很自律」。
 */

import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { start } from '../mock/server.mjs'
import { loadClient, loadPage, loadComponent } from './helpers/seam.mjs'

let mock

before(async () => { mock = await start({ port: 0 }) })
after(async () => { await mock.close() })

async function signedIn(options) {
  const c = loadClient({ baseUrl: mock.baseUrl, ...options })
  await c.auth.signIn()
  return c
}

const LIST = 'packages/library/pages/resource/list.js'
const DETAIL = 'packages/library/pages/resource/detail.js'
const HOME = 'packages/library/pages/home/index.js'

/**
 * Source with comments removed.
 *
 * A path named in a head comment is documentation — `services/library.js` is
 * cited by name all over these files. Only code can HOLD an endpoint.
 */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** The wire URLs the client actually built, in order. */
function urls(c) {
  return c.record.requests.map((r) => r.url)
}

/**
 * Open a list page and wait for its first read.
 *
 * `onLoad` fires `loadFirst()` without returning it — the page has nobody to
 * hand a promise to. So a test that wants the rows awaits `loadFirst()` itself,
 * which is the convention the coordination and party suites already use. The
 * first read therefore happens twice; that is why request counts below are
 * measured as deltas from after this call, never from zero.
 */
async function openList(c, page, query = {}) {
  page.onLoad(query)
  await page.loadFirst()
  return page
}

/** Every row, walked to the end of the cursor. */
async function allRows(c, filters = {}) {
  const rows = []
  let cursor = null
  do {
    const page = await c.library.listResources({ ...filters, cursor })
    rows.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)
  return rows
}

// ── 入口页 ──────────────────────────────────────────────────────────────────

describe('统一入口页', () => {
  test('同时通向资源库与案例库', async () => {
    const c = await signedIn()
    const page = loadPage(c, HOME)
    page.onLoad({})
    const keys = page.data.entries.map((e) => e.key)
    assert.deepEqual(keys, ['resource', 'case'], '两条去向都在')
  })

  test('案例库未落地时在跳转前拦下并说出原因', async () => {
    const c = await signedIn()
    const page = loadPage(c, HOME)
    page.onLoad({})

    page.onEntryTap({ currentTarget: { dataset: { key: 'case' } } })
    assert.equal(c.record.navigations.length, 0, '没有跳转')
    assert.match(c.record.toasts.pop().title, /尚未上线/, '说了是哪一条以及为什么')
  })

  test('资源库已落地，点了真的跳', async () => {
    const c = await signedIn()
    const page = loadPage(c, HOME)
    page.onLoad({})

    page.onEntryTap({ currentTarget: { dataset: { key: 'resource' } } })
    assert.equal(c.record.navigations.length, 1)
    assert.match(c.record.navigations[0].url, /packages\/library\/pages\/resource\/list/)
  })
})

// ── 列表：筛选与游标 ────────────────────────────────────────────────────────

describe('资源列表', () => {
  test('不筛选时不发这个参数 —— 空串是「全部」，不是一个值', async () => {
    const c = await signedIn()
    const page = await openList(c, loadPage(c, LIST))

    const listUrl = urls(c).find((u) => u.includes('/library/resources'))
    assert.ok(listUrl, '读了资源列表')
    assert.ok(!listUrl.includes('resource_tag='), `空串不该上线：${listUrl}`)
    assert.ok(!listUrl.includes('grade='), `空串不该上线：${listUrl}`)
  })

  test('换筛选丢弃旧游标，从头读一页', async () => {
    const c = await signedIn()
    const page = await openList(c, loadPage(c, LIST))
    // 32 条、每页 20，所以首读之后手上正好有一枚指向第二页的游标。翻完第二页它就
    // 该是 null 了（§3.1：空游标是结束的唯一信号），所以在这里取，不在 loadMore 之后取。
    const before = page.data.cursor
    assert.ok(before, '首读之后手上有一枚游标')
    await page.onFilterTap({ currentTarget: { dataset: { field: 'resource_tag', key: 'g2' } } })

    const last = urls(c)[urls(c).length - 1]
    assert.ok(last.includes('resource_tag=g2'), '新筛选上了线')
    assert.ok(!last.includes(encodeURIComponent(before)), '旧游标没有跟着新筛选一起发出去')
  })

  test('换筛选先清空旧行 —— 上一组条件的结果留在新标签下就是在骗人', async () => {
    const c = await signedIn()
    const page = await openList(c, loadPage(c, LIST))
    assert.ok(page.data.items.length > 0)

    const seen = page.data.items.map((r) => r.resource_id)
    await page.onFilterTap({ currentTarget: { dataset: { field: 'resource_tag', key: 'g3' } } })
    const now = page.data.items.map((r) => r.resource_id)
    assert.notDeepEqual(now, seen, '换了一组结果，不是把新的接在旧的后面')
  })

  test('点同一个筛选不重读 —— 没变就是没变', async () => {
    const c = await signedIn()
    const page = await openList(c, loadPage(c, LIST))
    const before = c.record.requests.length

    await page.onFilterTap({ currentTarget: { dataset: { field: 'resource_tag', key: '' } } })
    assert.equal(c.record.requests.length, before, '一个请求也没多发')
  })

  test('两个维度同时筛，组合上线', async () => {
    const c = await signedIn()
    const page = await openList(c, loadPage(c, LIST))

    await page.onFilterTap({ currentTarget: { dataset: { field: 'resource_tag', key: 'g1' } } })
    await page.onFilterTap({ currentTarget: { dataset: { field: 'grade', key: 'k2' } } })

    const last = urls(c)[urls(c).length - 1]
    assert.ok(last.includes('resource_tag=g1'), last)
    assert.ok(last.includes('grade=k2'), last)
  })

  test('翻到底就停，游标为空是结束的唯一信号', async () => {
    const c = await signedIn()
    const page = await openList(c, loadPage(c, LIST))
    for (let i = 0; i < 8 && !page.data.exhausted; i += 1) await page.loadMore()

    assert.equal(page.data.exhausted, true, '走到了尽头')
    const before = c.record.requests.length
    await page.loadMore()
    assert.equal(c.record.requests.length, before, '尽头之后不再发请求')
  })

  test('入口页带进来的分类被采纳', async () => {
    const c = await signedIn()
    const page = await openList(c, loadPage(c, LIST), { resource_tag: 'g5' })

    assert.equal(page.data.filters.resource_tag, 'g5')
    assert.ok(urls(c).some((u) => u.includes('resource_tag=g5')))
  })
})

// ── 三态与状态列 ────────────────────────────────────────────────────────────

describe('列表的三态与状态列', () => {
  test('空结果与读失败在界面上是两回事', async () => {
    const c = await signedIn()
    const page = await openList(c, loadPage(c, LIST))

    // 空：有结果集，只是没有行。不得出现错误文案。
    page.setData({ items: [], errorText: '' })
    assert.equal(page.data.items.length, 0)
    assert.equal(page.data.errorText, '', '空不是错')

    const wxml = readFileSync(`miniprogram/${LIST.replace('.js', '.wxml')}`, 'utf8')
    // 空态必须同时按 !errorText 开合 —— 票据 08 评审最严重的那条：读失败时喊「暂无」，
    // 把「读不到」说成了「没有东西可读」。
    assert.match(wxml, /items\.length === 0 && !errorText/,
      '空态没有挂 !errorText，读失败时会同时喊「暂无」')
  })

  test('教师自己写的非 s3 带状态徽章，已发布的不带', async () => {
    const c = await signedIn()
    // 教师自己的那三条非 s3 是 id 3／5／7，按 updated_at DESC 排在末页，所以要走到底。
    const rows = await allRows(c)

    const draft = rows.find((r) => r.status_label === '草稿')
    assert.ok(draft, '夹具里有教师自己的草稿 —— 这是资源与党建三类最大的差别')
    assert.ok(draft.status_pill, '非 s3 要显眼')

    // s3 的 status_label 是空串，标记里 wx:if 因此不渲染徽章：s3 是常态，不必挂一枚
    // 徽章重复「一切正常」。所以这里按空标签找已发布的，不按文案找。
    const published = rows.find((r) => r.status_label === '')
    assert.ok(published, '绝大多数是已发布的')

    // 详情页不同：它只展示一条资源，状态从不缺席，所以徽章无条件渲染。s3 因此必须
    // 有自己的样式键，否则会落到「未知状态」的告警色上。
    const detail = await c.library.resourceDetail(published.resource_id)
    assert.equal(detail.status_label, '已发布')
    assert.equal(detail.status_pill, 'hl-pill--ok', '已发布不得穿告警色')
  })

  test('未知分类码照常渲染，不崩不留空', async () => {
    const c = await signedIn()
    const rows = await allRows(c)

    const unknown = rows.find((r) => r.resource_id === 9)
    assert.ok(unknown, '夹具里那条未来分类码在')
    assert.ok(unknown.tag_label !== undefined && unknown.tag_label !== null,
      '未知码降级成中性文案，不是空')
  })

  test('可空的年级列是 null 不是空数组 —— 客户端不得把 null 当数组', async () => {
    const c = await signedIn()
    const rows = await allRows(c)

    const nullGrade = rows.find((r) => r.resource_id === 14)
    assert.ok(nullGrade, '夹具里那条没有年级的在')
    assert.equal(typeof nullGrade.tag_label, 'string', '照常给出一行文案')
  })
})

// ── 详情与下载 ──────────────────────────────────────────────────────────────

describe('资源详情', () => {
  test('四段正文与关联案例都在', async () => {
    const c = await signedIn()
    const detail = await c.library.resourceDetail(20)

    for (const field of ['resource_explain', 'resource_access', 'resource_trans']) {
      assert.ok(detail[field], `${field} 有内容`)
    }
    assert.ok(Array.isArray(detail.related_cases), '关联案例是数组')
  })

  test('关联案例未落地时在跳转前拦下并说明', async () => {
    const c = await signedIn()
    c.library.openCase(71)

    assert.equal(c.record.navigations.length, 0, '没有跳转')
    assert.match(c.record.toasts.pop().title, /尚未上线/, '说了原因')
  })

  test('下载只调 download-link，不自拼第二个「我看过了」请求', async () => {
    const c = await signedIn()
    const before = c.record.requests.length
    await c.library.downloadWordFile(20)

    const sent = c.record.requests.slice(before)
    assert.equal(sent.length, 1, `只该发一个请求，实际发了 ${sent.length} 个`)
    assert.equal(sent[0].method, 'POST')
    assert.match(sent[0].url, /\/library\/resources\/20\/download-link$/)
  })

  test('没有详案的资源照常显示，只是少一个下载入口', async () => {
    const c = await signedIn()
    const detail = await c.library.resourceDetail(12)

    assert.equal(detail.word_file_id, null, '夹具里这条没有 Word 详案')
    assert.ok(detail.resource_explain, '正文照常在')
  })
})

// ── 选择控件的三条行为规则 ──────────────────────────────────────────────────

describe('hl-picker-row', () => {
  const OPTIONS = [{ key: 'k1', label: '小班' }, { key: 'k2', label: '中班' }, { key: 'k3', label: '大班' }]

  function mountPicker(c) {
    const def = loadComponent(c, 'components/hl-picker-row/index.js')
    const instance = Object.create(def.methods)
    instance.data = { options: OPTIONS, labels: OPTIONS.map((o) => o.label), index: 1 }
    instance.events = []
    instance.triggerEvent = function triggerEvent(name, detail) {
      this.events.push({ name, detail })
    }
    instance.setData = function setData(patch) { Object.assign(this.data, patch) }
    return instance
  }

  test('规则 1：滑动过程中什么也不写 —— 组件没有 bindcolumnchange', async () => {
    const src = readFileSync('miniprogram/components/hl-picker-row/index.wxml', 'utf8')
    assert.ok(!src.includes('bindcolumnchange'),
      '监听了列变化就等于边滑边预览，页面数据会在滑动过程中改变')
  })

  test('规则 2：只有确认才写入，且写出去的是 key 不是下标', async () => {
    const c = await signedIn()
    const picker = mountPicker(c)

    picker.onChange({ detail: { value: 2 } })
    assert.deepEqual(picker.events, [{ name: 'pick', detail: { key: 'k3', label: '大班' } }])
  })

  test('规则 3：取消不改变已选值 —— 组件根本没有可改的东西', async () => {
    const c = await signedIn()
    const picker = mountPicker(c)
    const before = { ...picker.data }

    picker.onCancel()
    assert.deepEqual(picker.data, before, '取消没有动任何数据')
    assert.deepEqual(picker.events, [], '取消没有发出任何事件')

    // 结构性的那一半：选中值是属性，父页面持有，组件里没有它的副本。
    const src = readFileSync('miniprogram/components/hl-picker-row/index.js', 'utf8')
    assert.ok(!/data:\s*\{[^}]*\bvalue\b\s*:/.test(src),
      'value 一旦进 data 就有了副本，「取消不改」就得靠自律而不是靠结构')
  })

  test('越界的下标不写入，不抛错', async () => {
    const c = await signedIn()
    const picker = mountPicker(c)

    picker.onChange({ detail: { value: 99 } })
    assert.deepEqual(picker.events, [], '没有这一项就什么也不发')
  })
})

// ── 只读与边界 ──────────────────────────────────────────────────────────────

describe('教师端只读，且不通往 PC后台', () => {
  const FILES = [
    'miniprogram/packages/library/pages/home/index',
    'miniprogram/packages/library/pages/resource/list',
    'miniprogram/packages/library/pages/resource/detail',
  ]

  test('三个页面都没有上传、创建或编辑入口', () => {
    for (const base of FILES) {
      const wxml = readFileSync(`${base}.wxml`, 'utf8')
      for (const word of ['上传', '新建', '编辑', '删除', '提交审核']) {
        assert.ok(!wxml.includes(word), `${base}.wxml 出现了写入入口「${word}」`)
      }
    }
  })

  test('三个页面都不含 PC后台 路径', () => {
    for (const base of FILES) {
      for (const ext of ['.js', '.wxml']) {
        const src = readFileSync(base + ext, 'utf8')
        assert.ok(!src.includes('pc-backend'), `${base}${ext} 提到了 pc-backend`)
        assert.ok(!src.includes('/admin/'), `${base}${ext} 提到了 /admin/`)
      }
    }
  })

  test('页面不持有端点路径，也不自己格式化时间', () => {
    for (const base of FILES) {
      const src = codeOnly(readFileSync(`${base}.js`, 'utf8'))
      assert.ok(!src.includes('utils/request'), `${base}.js 直连了传输层`)
      assert.ok(!src.includes('utils/time'), `${base}.js 自己格式化了时间`)
      // `/packages/library/...` is a PAGE path and legitimate; an endpoint path
      // is the API one. Match that shape, not the substring 'library'.
      assert.ok(!/['"`]\/library\/(resources|cases)/.test(src), `${base}.js 持有了端点路径`)
    }
  })
})
