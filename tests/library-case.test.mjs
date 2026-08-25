/**
 * 案例库阅读（票据 13 收口）：案例列表、案例详情，以及通向它们的三条路。
 *
 * 这个文件盯住的是四类看不见的东西：
 *
 *   1. **三条路进同一个案例详情页。** 首页推荐卡片、资源详情的关联案例、案例列表的
 *      行。三处各写一条路径不会报错，只会慢慢分叉，直到某一天首页进的是另一个屏幕。
 *   2. **卡片必须带对 id。** 票据 08 让首页的推荐卡片故意不带 id，因为当时没地方送。
 *      现在有了，而「忘了接上 id」的症状是跳进一个空详情页，不是崩溃 —— 没人会注意。
 *   3. 游标属于签发它的那一组筛选条件。三个维度都在指纹里，换任一个还用旧游标，
 *      服务端回 400，页面若不自愈就再也翻不出下一页。
 *   4. 状态列是真信息。教师看得到自己写的非 s3，所以「已发布」与「还在我手里」必须
 *      分得出来。
 */

import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { start } from '../mock/server.mjs'
import { loadClient, loadPage } from './helpers/seam.mjs'

let mock

before(async () => { mock = await start({ port: 0 }) })
after(async () => { await mock.close() })

async function signedIn(options) {
  const c = loadClient({ baseUrl: mock.baseUrl, ...options })
  await c.auth.signIn()
  return c
}

const LIST = 'packages/library/pages/case/list.js'
const DETAIL = 'packages/library/pages/case/detail.js'
const CASE_DETAIL_PAGE = '/packages/library/pages/case/detail'

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
 * which is the convention the资源库 suite already uses. The first read therefore
 * happens twice; that is why request counts below are measured as deltas from
 * after this call, never from zero.
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
    const page = await c.library.listCases({ ...filters, cursor })
    rows.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)
  return rows
}

// ── 三条路，一个案例详情页 ──────────────────────────────────────────────────

describe('通向案例详情的三条路', () => {
  test('首页推荐课程案例卡片带着被点那一条的 case_id 跳进案例详情', async () => {
    const c = await signedIn()
    const page = loadPage(c, 'pages/home/index.js')
    await page.load()

    // 用真实读回来的第一张卡片，不是一个手写的数字：这样「卡片没带 id」会当场暴露成
    // undefined，而不是被测试里那个常量替 production 代码打了圆场。
    const card = page.data.cases[0]
    assert.ok(card.case_id, '推荐卡片带着 case_id')

    page.onCaseTap({ currentTarget: { dataset: { id: card.case_id } } })
    assert.deepEqual(c.record.navigations.pop(),
      { api: 'navigateTo', url: `${CASE_DETAIL_PAGE}?case_id=${card.case_id}` })
  })

  test('首页那张卡片在标记上真的挂了 data-id —— 少这一行，id 就是 undefined', () => {
    const wxml = readFileSync('miniprogram/pages/home/index.wxml', 'utf8')
    const caseCard = wxml.split('\n')
      .filter((line) => line.includes('data-id') || line.includes('item.case_id'))
    assert.ok(caseCard.some((line) => line.includes('data-id="{{item.case_id}}"')),
      '推荐课程案例卡片没有 data-id，点进去的详情页拿不到编号')
  })

  test('资源详情的关联案例进的是同一个案例详情页', async () => {
    const c = await signedIn()
    const page = loadPage(c, 'packages/library/pages/resource/detail.js')
    page.onLoad({ resource_id: 30 })
    await page.load(30)

    // 第 30 条挂着两条关联案例（夹具如此），点第一条。
    const related = page.data.resource.related_cases[0]
    assert.ok(related.case_id, '关联案例带着 case_id')

    page.onOpenCase({ currentTarget: { dataset: { id: related.case_id } } })
    assert.deepEqual(c.record.navigations.pop(),
      { api: 'navigateTo', url: `${CASE_DETAIL_PAGE}?case_id=${related.case_id}` })
  })

  test('案例列表的行进的也是同一个案例详情页', async () => {
    const c = await signedIn()
    const page = await openList(c, loadPage(c, LIST))
    const row = page.data.items[0]

    page.onTap({ currentTarget: { dataset: { id: row.case_id } } })
    assert.deepEqual(c.record.navigations.pop(),
      { api: 'navigateTo', url: `${CASE_DETAIL_PAGE}?case_id=${row.case_id}` })
  })

  test('三条路的目标由服务层一处决定 —— 页面里没有第二份案例详情路径', () => {
    // 首页与资源详情都不得自己写案例详情的路径；写了就是分叉的起点。案例列表页自己
    // 写是允许的：它与详情页同在一个分包，且那是页面路径不是端点路径。
    for (const file of ['miniprogram/services/home.js',
      'miniprogram/packages/library/pages/resource/detail.js']) {
      assert.ok(!codeOnly(readFileSync(file, 'utf8')).includes('pages/case/detail'),
        `${file} 自己持有了案例详情的路径`)
    }
  })
})

// ── 列表：三维筛选与游标 ────────────────────────────────────────────────────

describe('案例列表', () => {
  test('不筛选时三个参数都不发 —— 空串是「全部」，不是一个值', async () => {
    const c = await signedIn()
    await openList(c, loadPage(c, LIST))

    const listUrl = urls(c).find((u) => u.includes('/library/cases'))
    assert.ok(listUrl, '读了案例列表')
    for (const param of ['case_grade=', 'case_field=', 'case_area=']) {
      assert.ok(!listUrl.includes(param), `空串不该上线：${listUrl}`)
    }
  })

  for (const [field, key] of [['case_grade', 'k3'], ['case_field', 'f2'], ['case_area', 'a4']]) {
    test(`换 ${field} 丢弃旧游标，从头读一页`, async () => {
      const c = await signedIn()
      const page = await openList(c, loadPage(c, LIST))
      const before = page.data.cursor
      assert.ok(before, '首读之后手上有一枚游标')

      const sentBefore = urls(c).length
      await page.onFilterTap({ currentTarget: { dataset: { field, key } } })
      const sent = urls(c).slice(sentBefore)

      const last = sent[sent.length - 1]
      assert.ok(last.includes(`${field}=${key}`), '新筛选上了线')
      // 看这一次点击发出的**每一个**请求，不只是最后那个。只看最后一个，「先带着旧
      // 游标发一次、撞了 cursor_filter_mismatch 再自愈」会通过 —— 而那正是要防的写法：
      // 自愈是为游标过期准备的，不是给换筛选兜底的。
      for (const u of sent) {
        assert.ok(!u.includes(encodeURIComponent(before)), `旧游标跟着新筛选发出去了：${u}`)
      }
      // 夹具的三个维度都做到「单维筛完仍多于一页」，所以新筛选集必须自己签一枚新游标。
      // 少了这一条，「丢弃旧游标」可以靠「新筛选集只有一页」蒙混过去。
      assert.ok(page.data.cursor, '新筛选集签发了它自己的游标')
      assert.notEqual(page.data.cursor, before, '而且不是旧的那一枚')
    })
  }

  test('三维组合筛选一起上线', async () => {
    const c = await signedIn()
    const page = await openList(c, loadPage(c, LIST))

    await page.onFilterTap({ currentTarget: { dataset: { field: 'case_grade', key: 'k1' } } })
    await page.onFilterTap({ currentTarget: { dataset: { field: 'case_field', key: 'f3' } } })
    await page.onFilterTap({ currentTarget: { dataset: { field: 'case_area', key: 'a5' } } })

    const last = urls(c)[urls(c).length - 1]
    for (const part of ['case_grade=k1', 'case_field=f3', 'case_area=a5']) {
      assert.ok(last.includes(part), `${part} 不在 ${last}`)
    }
    // 三维都是真筛选：组合之后的结果必须是全量的真子集，否则某一维根本没生效。
    const all = await allRows(c)
    assert.ok(page.data.items.length < all.length, '组合筛选真的筛掉了东西')
  })

  test('换筛选先清空旧行 —— 上一组条件的结果留在新标签下就是在骗人', async () => {
    const c = await signedIn()
    const page = await openList(c, loadPage(c, LIST))
    assert.ok(page.data.items.length > 0)

    const seen = page.data.items.map((r) => r.case_id)
    await page.onFilterTap({ currentTarget: { dataset: { field: 'case_field', key: 'f4' } } })
    assert.notDeepEqual(page.data.items.map((r) => r.case_id), seen,
      '换了一组结果，不是把新的接在旧的后面')
  })

  test('点同一个筛选不重读 —— 没变就是没变', async () => {
    const c = await signedIn()
    const page = await openList(c, loadPage(c, LIST))
    const before = c.record.requests.length

    await page.onFilterTap({ currentTarget: { dataset: { field: 'case_area', key: '' } } })
    assert.equal(c.record.requests.length, before, '一个请求也没多发')
  })

  test('游标失效时自愈一次，从头重载', async () => {
    const c = await signedIn()
    const page = await openList(c, loadPage(c, LIST))
    // 一枚在另一组筛选下签发的游标：服务端按指纹判定不匹配，回
    // cursor_filter_mismatch。页面必须从头重载一次，而不是把列表卡死在这里。
    const other = await c.library.listCases({ case_field: 'f1' })
    page.setData({ cursor: other.nextCursor })

    const before = c.record.requests.length
    await page.loadMore()

    assert.equal(page.data.errorText, '', '自愈不该在屏幕上留下一条错误')
    assert.ok(page.data.items.length > 0, '重载回了第一页')
    assert.equal(c.record.requests.length - before, 2, '一次失败的取页，加一次从头重载')
  })

  test('翻到底就停，游标为空是结束的唯一信号', async () => {
    const c = await signedIn()
    const page = await openList(c, loadPage(c, LIST))
    // 单维筛到最窄的一档再翻，否则 120 条要翻六次。
    await page.onFilterTap({ currentTarget: { dataset: { field: 'case_field', key: 'f5' } } })
    for (let i = 0; i < 10 && !page.data.exhausted; i += 1) await page.loadMore()

    assert.equal(page.data.exhausted, true, '走到了尽头')
    const before = c.record.requests.length
    await page.loadMore()
    assert.equal(c.record.requests.length, before, '尽头之后不再发请求')
  })

  test('入口带进来的领域被采纳', async () => {
    const c = await signedIn()
    const page = await openList(c, loadPage(c, LIST), { case_field: 'f2' })

    assert.equal(page.data.filters.case_field, 'f2')
    assert.ok(urls(c).some((u) => u.includes('case_field=f2')))
  })

  test('未知的筛选值被服务端拒绝 —— 客户端不得靠自己拦', async () => {
    const c = await signedIn()
    await assert.rejects(
      () => c.library.listCases({ case_area: 'a9_not_a_real_area' }),
      (err) => err.code === 'malformed_request',
      '服务端回 400，不是悄悄给一个空结果集',
    )
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

  test('读失败时说的是失败，不是「暂无案例」', async () => {
    const c = await signedIn()
    const page = loadPage(c, LIST)
    page.onLoad({})

    const realRequest = globalThis.wx.request
    globalThis.wx.request = (opts) => {
      globalThis.wx.request = realRequest
      opts.success({
        statusCode: 503,
        data: { code: 'upstream_unavailable', message: '服务暂时不可用', request_id: 'req-c1' },
        header: { 'Retry-After': '600' },
      })
    }
    await page.loadFirst()

    assert.ok(page.data.errorText, '中文，来自错误登记表')
    assert.equal(page.data.errorRequestId, 'req-c1', '教师报得出的故障码')
    assert.equal(page.data.errorCanRetry, true, '可重试的失败给出重试入口')
    assert.equal(page.data.items.length, 0, '失败时行是空的 —— 空态因此必须让位')
  })

  test('教师自己写的非 s3 带状态徽章，已发布的不带', async () => {
    const c = await signedIn()
    // 教师自己的那三条非 s3 是 id 4／6／8，按 updated_at DESC 排在末页，所以要走到底。
    const rows = await allRows(c)

    for (const label of ['草稿', '待审核', '已驳回']) {
      const row = rows.find((r) => r.status_label === label)
      assert.ok(row, `夹具里有教师自己的${label} —— 这是案例与党建三类最大的差别`)
      assert.ok(row.status_pill, '非 s3 要显眼')
    }

    // s3 的 status_label 是空串，标记里 wx:if 因此不渲染徽章：s3 是常态，不必挂一枚
    // 徽章重复「一切正常」。所以这里按空标签找已发布的，不按文案找。
    const published = rows.find((r) => r.status_label === '')
    assert.ok(published, '绝大多数是已发布的')

    // 详情页不同：它只展示一条案例，状态从不缺席，所以徽章无条件渲染。s3 因此必须
    // 有自己的样式键，否则会落到「未知状态」的告警色上。
    const detail = await c.library.caseDetail(published.case_id)
    assert.equal(detail.status_label, '已发布')
    assert.equal(detail.status_pill, 'hl-pill--ok', '已发布不得穿告警色')
  })

  test('未知领域码照常渲染，不崩不留空', async () => {
    const c = await signedIn()
    const rows = await allRows(c)

    const unknown = rows.find((r) => r.case_id === 91)
    assert.ok(unknown, '夹具里那条未来领域码在')
    assert.equal(unknown.thumb_label, '案', '未知码丢掉的是缩略图上那个字，不是整张卡片')
    assert.ok(unknown.tag_label, '年级与活动形式那两半照常显示')
  })

  test('数组列里混进未知码，丢掉的是那一项而不是整行', async () => {
    const c = await signedIn()
    const rows = await allRows(c)

    const mixed = rows.find((r) => r.case_id === 88)
    assert.ok(mixed, '夹具里那条混了未知活动形式码的在')
    assert.ok(mixed.tag_label.includes('主题探究'), '同一行里已知的那一项照常显示')
    assert.ok(!mixed.tag_label.includes('z9_future_area'), '未知码不得以原样露在界面上')
  })
})

// ── 详情、详案与关联资源 ────────────────────────────────────────────────────

describe('案例详情', () => {
  test('简介、转化、详案入口与关联资源都在', async () => {
    const c = await signedIn()
    const detail = await c.library.caseDetail(100)

    assert.ok(detail.case_intro, '活动简介')
    assert.ok(detail.case_trans, '活动转化')
    assert.ok(detail.word_file_id, '详案入口')
    assert.ok(Array.isArray(detail.related_resources), '关联资源是数组')
    assert.ok(detail.related_resources.length > 0, '夹具里这条挂着关联资源')
    for (const r of detail.related_resources) {
      assert.ok(r.resource_name, '关联资源带着名称，不是一个光秃秃的 ID')
    }
  })

  test('自评、他评与活动反思在详案里，页面不发明这三个字段', async () => {
    const c = await signedIn()
    const detail = await c.library.caseDetail(100)

    // db_case 没有这三列，契约的 Case schema 也没有，原型把它们排在 Word 详案的
    // 第七、八、九节。页面若凭空长出三个字段，就是在展示一份服务端从未给过的内容。
    for (const invented of ['self_review', 'peer_review', 'reflection']) {
      assert.equal(detail[invented], undefined, `凭空多出了 ${invented}`)
    }
    const wxml = readFileSync(`miniprogram/${DETAIL.replace('.js', '.wxml')}`, 'utf8')
    assert.match(wxml, /自评/, '详案入口说清楚了这三节在文档里')
    assert.match(wxml, /他评/)
    assert.match(wxml, /活动反思/)
  })

  test('关联资源跳向资源详情', async () => {
    const c = await signedIn()
    const page = loadPage(c, DETAIL)
    page.onLoad({ case_id: 100 })
    await page.load(100)

    const first = page.data.kase.related_resources[0]
    page.onOpenResource({ currentTarget: { dataset: { id: first.resource_id } } })
    assert.deepEqual(c.record.navigations.pop(), {
      api: 'navigateTo',
      url: `/packages/library/pages/resource/detail?resource_id=${first.resource_id}`,
    })
  })

  test('没有关联资源的案例照常显示，只是那一节是空态', async () => {
    const c = await signedIn()
    const detail = await c.library.caseDetail(84)

    assert.deepEqual(detail.related_resources, [], '夹具里这条 resource_ids 为 null')
    assert.ok(detail.case_intro, '正文照常在')
    const wxml = readFileSync(`miniprogram/${DETAIL.replace('.js', '.wxml')}`, 'utf8')
    assert.match(wxml, /related_resources\.length === 0/, '空态有它自己的分支')
  })

  test('没有详案的案例照常显示，只是少一个下载入口', async () => {
    const c = await signedIn()
    const detail = await c.library.caseDetail(82)

    assert.equal(detail.word_file_id, null, '夹具里这条没有 Word 详案')
    assert.ok(detail.case_intro, '正文照常在')
  })

  test('查看详案只调 download-link，不自拼第二个「我看过了」请求', async () => {
    const c = await signedIn()
    const before = c.record.requests.length
    await c.library.downloadCaseWordFile(100)

    const sent = c.record.requests.slice(before)
    assert.equal(sent.length, 1, `只该发一个请求，实际发了 ${sent.length} 个`)
    assert.equal(sent[0].method, 'POST')
    assert.match(sent[0].url, /\/library\/cases\/100\/download-link$/)
  })

  test('不在可见范围与不存在读作同一个 404', async () => {
    const c = await signedIn()
    const page = loadPage(c, DETAIL)
    page.onLoad({ case_id: 999999 })
    await page.load(999999)

    assert.ok(page.data.errorText, '说了读不到')
    assert.equal(page.data.errorCanRetry, false, '重试同一个编号不会有别的结果')
    assert.equal(page.data.kase, null, '没有半张详情留在屏幕上')
  })

  test('缺少编号是调用方的错，不发请求也不假装在加载', async () => {
    const c = await signedIn()
    const page = loadPage(c, DETAIL)
    const before = c.record.requests.length
    page.onLoad({})

    assert.equal(c.record.requests.length, before, '一个请求也没发')
    assert.equal(page.data.loading, false, '转圈停了')
    assert.match(page.data.errorText, /编号/)
  })
})

// ── 筛选取值的来源 ──────────────────────────────────────────────────────────

describe('分类与标签取值来自服务层的同一份来源', () => {
  test('三份筛选取值都由服务层给，页面不自带枚举表', async () => {
    const c = await signedIn()
    const page = await openList(c, loadPage(c, LIST))

    assert.deepEqual(page.data.gradeOptions, c.library.gradeFilters())
    assert.deepEqual(page.data.fieldOptions, c.library.fieldFilters())
    assert.deepEqual(page.data.areaOptions, c.library.areaFilters())

    // 每一份的第一项都是「全部」，且它的 key 是空串 —— buildQuery 丢掉空串，
    // 「不筛」因此就是「不发这个参数」，而不是发一个服务端不认识的 all。
    for (const options of [page.data.gradeOptions, page.data.fieldOptions, page.data.areaOptions]) {
      assert.deepEqual(options[0], { key: '', label: '全部' })
    }
  })

  test('枚举表只有一份 —— 案例的三张表归 services/case.js', async () => {
    const c = await signedIn()
    // 年级：资源库与案例库读的是同一张表，`db_resource.grade` 与 `db_case.case_grade`
    // 是同一个值域。两处若各抄一份，改一个中文名就会只改到一半。
    assert.deepEqual(c.library.gradeFilters().slice(1),
      Object.keys(c.kase.CASE_GRADE).map((key) => ({ key, label: c.kase.CASE_GRADE[key] })))

    const src = readFileSync('miniprogram/services/library.js', 'utf8')
    for (const table of ['CASE_FIELD =', 'CASE_GRADE =', 'CASE_AREA =']) {
      assert.ok(!src.includes(table), `services/library.js 抄了第二份 ${table}`)
    }
  })
})

// ── 只读与边界 ──────────────────────────────────────────────────────────────

describe('教师端只读，且不通往 PC后台', () => {
  const FILES = [
    'miniprogram/packages/library/pages/case/list',
    'miniprogram/packages/library/pages/case/detail',
  ]

  test('两个页面都没有上传、创建或编辑入口', () => {
    for (const base of FILES) {
      const wxml = readFileSync(`${base}.wxml`, 'utf8')
      for (const word of ['上传', '新建', '编辑', '删除', '提交审核']) {
        assert.ok(!wxml.includes(word), `${base}.wxml 出现了写入入口「${word}」`)
      }
    }
  })

  test('两个页面都不含 PC后台 路径', () => {
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

  test('两个页面都不出现观察记录（DO-NOT-BUILD 1）', () => {
    for (const base of FILES) {
      for (const ext of ['.js', '.wxml']) {
        assert.ok(!readFileSync(base + ext, 'utf8').includes('观察记录'), `${base}${ext}`)
      }
    }
  })
})

// ── 授权：三条案例路径都登记进了角色门 ──────────────────────────────────────

describe('三条案例路径的角色门', () => {
  const PATHS = [
    ['GET', '/library/cases'],
    ['GET', '/library/cases/100'],
    ['POST', '/library/cases/100/download-link'],
  ]

  test('无会话一律 401', async () => {
    for (const [method, path] of PATHS) {
      const res = await fetch(mock.baseUrl + path, { method })
      assert.equal(res.status, 401, `${method} ${path}`)
      assert.equal((await res.json()).code, 'unauthenticated')
    }
  })

  test('角色不在 allowlist 上回 403 route_not_allowed_for_role，不是 404', async () => {
    // 家长端的会话。§2.3：「这个角色能不能走这条路」不泄露业务事实，所以诚实回 403；
    // 「这一行你能不能看」才藏进 404。两者不得互换。
    const token = await fetch(mock.baseUrl + '/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ surface: 'parent', js_code: 'mock-js-code' }),
    }).then((r) => r.json()).then((b) => b.session_token)
    assert.ok(token, '家长会话签出来了')

    for (const [method, path] of PATHS) {
      const res = await fetch(mock.baseUrl + path, {
        method,
        headers: { authorization: `Bearer ${token}` },
      })
      assert.equal(res.status, 403, `${method} ${path} 应当是 403`)
      assert.equal((await res.json()).code, 'route_not_allowed_for_role')
    }
  })

  test('范围不匹配回 404，与不存在无法区分', async () => {
    const c = await signedIn()
    await assert.rejects(
      () => c.library.caseDetail(999999),
      (err) => err.statusCode === 404 && err.code === 'not_found',
    )
  })
})
