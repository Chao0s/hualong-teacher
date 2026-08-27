/**
 * 教研培训阅读（票据 14 收口）：办园理念与课程体系、研修列表、研修详情。
 *
 * 这个文件盯住的是六类看不见的东西：
 *
 *   1. **研修的可见范围与党建／综合协调不同。** 列表恒为 s1，详情多 admit 一个 s5。
 *      抄错一边，要么已撤回的研修留在列表里，要么点进去只看到 404。
 *   2. **阶段不是状态。** `training_phase` 是派生值，与 `training_status` 同处一枚徽章
 *      的位置。混起来会让「已撤回」显示成「已结束」。
 *   3. **时间是字面量。** 服务端写 14:00 就显示 14:00，任何设备任何时区。一处 `new Date`
 *      就会让这条在半个地球之外静静地错掉。
 *   4. **假期不是错误。** 没有进行中的学期时，只读页面照常读。
 *   5. **本票不含写入。** 报名、反馈与评论属于票据 16 与 18，三个页面上一个写入控件
 *      也不能有——而「多了一个入口」不会报错，只会悄悄提前上线。
 *   6. **打不开要说话。** 材料打不开时给中文说明，能带追踪号的带上，绝不留白。
 */

import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { start, setNoTerm } from '../mock/server.mjs'
import { loadClient, loadPage } from './helpers/seam.mjs'

let mock

before(async () => { mock = await start({ port: 0 }) })
after(async () => { await mock.close() })

async function signedIn(options) {
  const c = loadClient({ baseUrl: mock.baseUrl, ...options })
  await c.auth.signIn()
  return c
}

const COURSE = 'packages/training/pages/course/detail.js'
const LIST = 'packages/training/pages/train/list.js'
const DETAIL = 'packages/training/pages/train/detail.js'

/** 打开一场研修的详情。 */
async function openDetail(c, trainingId) {
  const page = loadPage(c, DETAIL)
  page.onLoad({ training_id: trainingId })
  await page.load(trainingId)
  return page
}
const DETAIL_PAGE = '/packages/training/pages/train/detail'
const COURSE_PAGE = '/packages/training/pages/course/detail'

const read = (rel) => readFileSync(`miniprogram/${rel}`, 'utf8')

/**
 * Source with comments removed.
 *
 * A path named in a head comment is documentation — `services/training.js` cites
 * `/trainings` and `/media/files/{file_id}/url` by name all over its head note.
 * Only code can HOLD an endpoint.
 */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** The wire URLs the client actually built, in order. */
function urls(c) {
  return c.record.requests.map((r) => r.url)
}

/**
 * Open the list page and wait for its first read.
 *
 * `onLoad` fires `loadFirst()` without returning it — the page has nobody to
 * hand a promise to. So a test that wants the rows awaits `loadFirst()` itself,
 * the convention the资源库 and 案例库 suites already use. The first read therefore
 * happens twice; request counts below are measured as deltas from after this
 * call, never from zero.
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
    const page = await c.training.listTrainings({ ...filters, cursor })
    rows.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)
  return rows
}

// ── 从教研培训入口一次到达 ──────────────────────────────────────────────────

// 入口页 2026-08-26 按原型 training-center.html 重建：整宽链接换成三张快捷入口卡，
// 事件也从组件的 `detail` 换成了卡片自己的 `dataset`。版面本身由
// tests/training-home.test.mjs 守住；这里只管「这两条路通不通」。
describe('两个入口都落地了', () => {
  test('办园理念与课程体系从入口一次到达 —— 中间没有第二层列表', async () => {
    const c = await signedIn()
    const page = loadPage(c, 'pages/training/index.js')
    page.onLoad()

    page.onQuickTap({ currentTarget: { dataset: { key: 'course' } } })
    assert.deepEqual(c.record.navigations.pop(), { api: 'navigateTo', url: COURSE_PAGE })
    assert.equal(c.record.toasts.length, 0, '不再是「尚未上线」')
  })

  test('研修入口进的是研修列表', async () => {
    const c = await signedIn()
    const page = loadPage(c, 'pages/training/index.js')
    page.onLoad()

    page.onQuickTap({ currentTarget: { dataset: { key: 'train' } } })
    assert.deepEqual(c.record.navigations.pop(),
      { api: 'navigateTo', url: '/packages/training/pages/train/list' })
  })

  test('列表的行进的是研修详情', async () => {
    const c = await signedIn()
    const page = await openList(c, loadPage(c, LIST))
    const row = page.data.items[0]

    page.onTap({ currentTarget: { dataset: { id: row.training_id } } })
    assert.deepEqual(c.record.navigations.pop(),
      { api: 'navigateTo', url: `${DETAIL_PAGE}?training_id=${row.training_id}` })
  })
})

// ── 办园理念与课程体系 ──────────────────────────────────────────────────────

describe('办园理念与课程体系详情页', () => {
  test('完整图文都在：引子、三节正文、每节的条目', async () => {
    const c = await signedIn()
    const page = loadPage(c, COURSE)
    page.onLoad()
    await page.load()

    const intro = page.data.intro
    assert.ok(intro.intro_title, '标题')
    assert.ok(intro.intro_summary, '一句话概述')
    assert.ok(intro.intro_lead, '引子正文')
    assert.equal(intro.sections.length, 3, '办园理念、课程体系架构、五个课程范畴')
    for (const section of intro.sections) {
      assert.ok(section.section_title, '每节都有标题')
      assert.ok(section.items.length > 0, `${section.section_title} 至少一条`)
      for (const item of section.items) assert.ok(item.item_title, '每条都有标题')
    }
    assert.equal(c.record.navTitles.pop(), intro.intro_title, '导航栏跟着内容走')
  })

  test('读失败时说的是失败，不是一页空白', async () => {
    const c = await signedIn()
    const page = loadPage(c, COURSE)
    page.onLoad()

    const realRequest = globalThis.wx.request
    globalThis.wx.request = (opts) => {
      globalThis.wx.request = realRequest
      opts.success({
        statusCode: 404,
        data: { code: 'not_found', message: '资源不存在或不在可见范围内', request_id: 'req-ci1' },
        header: {},
      })
    }
    await page.load()

    assert.ok(page.data.errorText, '中文，来自错误登记表')
    assert.equal(page.data.errorRequestId, 'req-ci1', '教师报得出的故障码')
    assert.equal(page.data.intro, null, '没有半页图文留在屏幕上')
  })
})

// ── 研修时间：字面量，不换算 ────────────────────────────────────────────────

describe('研修的时间按字面量呈现', () => {
  test('列表上每一项都带时间 —— 这是这张票要的那件事', async () => {
    const c = await signedIn()
    const { items } = await c.training.listTrainings({})

    assert.ok(items.length > 0)
    for (const row of items) {
      assert.match(row.time_label, /^\d{2}-\d{2} \d{2}:\d{2}$/, '时间由服务层格式化')
    }
  })

  test('服务端写的钟点原样出现在列表上', async () => {
    const c = await signedIn()
    // 夹具第 46 条是 2026-10-23T09:30:00+08:00。换算过就不会是 09:30。
    const raw = await c.api.get('/trainings/46')
    assert.equal(raw.start_at, '2026-10-23T09:30:00+08:00', '夹具带的是字面偏移量')

    const { items } = await c.training.listTrainings({})
    assert.equal(items.find((r) => r.training_id === 46).time_label, '10-23 09:30')
  })

  test('同一个钟点熬得过一个敌意的设备时区 —— 任何一层都不做算术', async () => {
    const c = await signedIn()
    const original = process.env.TZ
    const listLabels = []
    const detailLabels = []
    try {
      // 两个与园所时区相差极大的时区。任何一处 new Date 都会让两次结果分家。
      for (const tz of ['UTC', 'America/Los_Angeles']) {
        process.env.TZ = tz
        const { items } = await c.training.listTrainings({})
        listLabels.push(items.find((r) => r.training_id === 46).time_label)
        detailLabels.push((await c.training.trainingDetail(46)).start_label)
      }
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }

    assert.equal(listLabels[0], '10-23 09:30', `UTC 下变成了 ${listLabels[0]}`)
    assert.equal(listLabels[1], '10-23 09:30', `美西时区下变成了 ${listLabels[1]}`)
    assert.equal(detailLabels[0], '2026年10月23日 09:30', `UTC 下变成了 ${detailLabels[0]}`)
    assert.equal(detailLabels[1], '2026年10月23日 09:30', `美西时区下变成了 ${detailLabels[1]}`)
  })

  test('读时间的那一层不得建 Date —— 设备时区会从那里漏进来', () => {
    // 注释里讲得起 Date（utils/time.js 的头注正是在解释为什么不建），所以先剥注释。
    for (const file of ['services/training.js', 'utils/time.js', COURSE, LIST, DETAIL]) {
      assert.ok(!codeOnly(read(file)).includes('new Date('), `${file} 建了 Date`)
    }
  })
})

// ── 列表：两区切分与游标 ────────────────────────────────────────────────────

describe('研修列表', () => {
  test('不切分时不发 phase —— 空串是「全部」，不是一个值', async () => {
    const c = await signedIn()
    await openList(c, loadPage(c, LIST))

    const listUrl = urls(c).find((u) => u.includes('/trainings'))
    assert.ok(listUrl, '读了研修列表')
    assert.ok(!listUrl.includes('phase='), `空串不该上线：${listUrl}`)
  })

  for (const key of ['latest', 'history']) {
    test(`换到 ${key} 分区丢弃旧游标，从头读一页`, async () => {
      const c = await signedIn()
      const page = await openList(c, loadPage(c, LIST))
      const before = page.data.cursor
      assert.ok(before, '首读之后手上有一枚游标')

      const sentBefore = urls(c).length
      await page.onPhaseTap({ currentTarget: { dataset: { key } } })
      const sent = urls(c).slice(sentBefore)

      assert.ok(sent[sent.length - 1].includes(`phase=${key}`), '新分区上了线')
      // 看这一次点击发出的**每一个**请求，不只是最后那个。只看最后一个，「先带着旧游标
      // 发一次、撞了 cursor_filter_mismatch 再自愈」会通过 —— 而那正是要防的写法。
      for (const u of sent) {
        assert.ok(!u.includes(encodeURIComponent(before)), `旧游标跟着新分区发出去了：${u}`)
      }
      // 夹具的两区都做到「切完仍多于一页」，所以新分区必须自己签一枚新游标。
      assert.ok(page.data.cursor, '新分区签发了它自己的游标')
      assert.notEqual(page.data.cursor, before, '而且不是旧的那一枚')
    })
  }

  test('换分区先清空旧行 —— 上一区的结果留在新标签下就是在骗人', async () => {
    const c = await signedIn()
    const page = await openList(c, loadPage(c, LIST))
    const seen = page.data.items.map((r) => r.training_id)

    await page.onPhaseTap({ currentTarget: { dataset: { key: 'history' } } })
    assert.notDeepEqual(page.data.items.map((r) => r.training_id), seen,
      '换了一组结果，不是把新的接在旧的后面')
  })

  test('点同一个分区不重读 —— 没变就是没变', async () => {
    const c = await signedIn()
    const page = await openList(c, loadPage(c, LIST))
    const before = c.record.requests.length

    await page.onPhaseTap({ currentTarget: { dataset: { key: '' } } })
    assert.equal(c.record.requests.length, before, '一个请求也没多发')
  })

  test('翻到底就停，游标为空是结束的唯一信号', async () => {
    const c = await signedIn()
    const page = await openList(c, loadPage(c, LIST))
    for (let i = 0; i < 10 && !page.data.exhausted; i += 1) await page.loadMore()

    assert.equal(page.data.exhausted, true, '走到了尽头')
    assert.equal(page.data.cursor, null, '尽头的信号就是空游标')
    const before = c.record.requests.length
    await page.loadMore()
    assert.equal(c.record.requests.length, before, '尽头之后不再发请求')
  })

  test('游标失效时自愈一次，从头重载', async () => {
    const c = await signedIn()
    const page = await openList(c, loadPage(c, LIST))
    // 一枚在另一个分区下签发的游标：服务端按指纹判定不匹配，回 cursor_filter_mismatch。
    const other = await c.training.listTrainings({ phase: 'history' })
    page.setData({ cursor: other.nextCursor })

    const before = c.record.requests.length
    await page.loadMore()

    assert.equal(page.data.errorText, '', '自愈不该在屏幕上留下一条错误')
    assert.ok(page.data.items.length > 0, '重载回了第一页')
    assert.equal(c.record.requests.length - before, 2, '一次失败的取页，加一次从头重载')
  })

  test('未知的分区值被服务端拒绝 —— 客户端不得靠自己拦', async () => {
    const c = await signedIn()
    await assert.rejects(
      () => c.training.listTrainings({ phase: 'next_week_not_a_region' }),
      (err) => err.code === 'malformed_request',
      '服务端回 400，不是悄悄给一个空结果集',
    )
  })

  test('两区切分的取值由服务层给，页面不自带一张表', async () => {
    const c = await signedIn()
    const page = await openList(c, loadPage(c, LIST))

    assert.deepEqual(page.data.phaseOptions, c.training.phaseFilters())
    assert.deepEqual(page.data.phaseOptions[0], { key: '', label: '全部' })
  })
})

// ── 三态：加载中、空、失败 ──────────────────────────────────────────────────

describe('列表的三态', () => {
  test('空结果与读失败在界面上是两回事', async () => {
    const c = await signedIn()
    const page = await openList(c, loadPage(c, LIST))

    // 空：有结果集，只是没有行。不得出现错误文案。
    page.setData({ items: [], errorText: '' })
    assert.equal(page.data.errorText, '', '空不是错')

    const wxml = read(LIST.replace('.js', '.wxml'))
    // 空态必须同时按 !errorText 开合 —— 票据 08 评审最严重的那条：读失败时喊「暂无」，
    // 把「读不到」说成了「没有东西可读」。
    assert.match(wxml, /items\.length === 0 && !errorText/,
      '空态没有挂 !errorText，读失败时会同时喊「暂无」')
  })

  test('读失败时说的是失败，不是「暂无研修」', async () => {
    const c = await signedIn()
    const page = loadPage(c, LIST)
    page.onLoad()

    const realRequest = globalThis.wx.request
    globalThis.wx.request = (opts) => {
      globalThis.wx.request = realRequest
      opts.success({
        statusCode: 404,
        data: { code: 'not_found', message: '资源不存在或不在可见范围内', request_id: 'req-t1' },
        header: {},
      })
    }
    await page.loadFirst()

    assert.ok(page.data.errorText, '中文，来自错误登记表')
    assert.equal(page.data.errorRequestId, 'req-t1', '教师报得出的故障码')
    assert.equal(page.data.items.length, 0, '失败时行是空的 —— 空态因此必须让位')
    assert.equal(page.data.loadingFirst, false, '转圈停了')
  })
})

// ── 状态列与可见范围：研修单独确认的那一条 ──────────────────────────────────

describe('研修的状态列与可见范围', () => {
  test('列表只回 s1 —— 已撤回的那一场不在里面', async () => {
    const c = await signedIn()
    const rows = await c.api.getPage('/trainings', { limit: 100 })

    assert.equal(rows.items.length, 45, '46 条里有一条已撤回')
    for (const row of rows.items) {
      assert.equal(row.training_status, 's1', `${row.training_id} 不该出现在列表里`)
    }
    assert.ok(!rows.items.some((r) => r.training_id === 20), '夹具第 20 条是已撤回的那一场')
  })

  test('已撤回的那一场详情仍打得开，但只是壳', async () => {
    const c = await signedIn()
    const detail = await c.training.trainingDetail(20)

    // 可见范围多 admit 一个 s5：这是与党建管理／综合协调最大的差别，那两个模块教师
    // 只看得到一态。
    assert.equal(detail.status_label, '已撤回')
    assert.equal(detail.status_pill, 'hl-pill--danger', '已撤回要显眼')
    assert.ok(detail.training_title, '原标题还在')
    assert.ok(detail.start_label, '原时间还在')
    assert.deepEqual(detail.materials, [], '撤回后不提供研修材料')
    assert.equal(detail.meeting, null, '撤回后不提供会议入口')
    assert.match(detail.withdrawn_notice, /已撤回/, '说清楚为什么这一页什么材料也没有')
  })

  test('还在的研修不挂状态徽章 —— 已发布是常态，挂上去只是重复「一切正常」', async () => {
    const c = await signedIn()
    const detail = await c.training.trainingDetail(46)
    assert.equal(detail.status_label, '', 's1 不挂徽章')
    assert.equal(detail.withdrawn_notice, '', '也没有那句撤回说明')
  })

  test('阶段不是状态 —— 三个派生阶段各有各的文案与颜色', async () => {
    const c = await signedIn()
    const rows = await allRows(c)

    const labels = new Map(rows.map((r) => [r.phase_label, r.phase_pill]))
    assert.equal(labels.get('即将开始'), 'hl-pill--pending')
    assert.equal(labels.get('进行中'), 'hl-pill--ok')
    assert.equal(labels.get('已结束'), 'hl-pill--info')
    // 灰只留给未知码：读不懂的阶段与历史研修在屏幕上必须分得出来。
    assert.notEqual(labels.get('已结束'), 'hl-pill--unknown')
  })

  test('未知的派生阶段码照常渲染，不崩不留空', async () => {
    const c = await signedIn()
    const unknown = (await allRows(c)).find((r) => r.training_id === 6)

    assert.ok(unknown, '夹具里那条未来阶段码在')
    assert.equal(unknown.phase_label, '未知阶段')
    assert.equal(unknown.phase_pill, 'hl-pill--unknown')
    assert.ok(unknown.training_title, '整行照常显示，丢掉的只是那一枚徽章的文案')
    assert.ok(unknown.time_label, '时间照常显示')
  })

  test('两区切分只收得懂的码 —— 读不懂的阶段两区都不落，不替服务端猜', async () => {
    const c = await signedIn()
    const latest = await allRows(c, { phase: 'latest' })
    const history = await allRows(c, { phase: 'history' })

    assert.equal(latest.length, 23)
    assert.equal(history.length, 21)
    for (const rows of [latest, history]) {
      assert.ok(!rows.some((r) => r.training_id === 6), '未知阶段码不该被塞进任何一区')
    }
  })
})

// ── 详情：研修通知与研修材料 ────────────────────────────────────────────────

describe('研修详情', () => {
  test('研修通知与三类研修材料都在', async () => {
    const c = await signedIn()
    const detail = await c.training.trainingDetail(46)

    assert.ok(detail.training_content, '研修通知的正文')
    // 三类：演示文稿、PDF、视频（线上会议）链接。前两类是 file_refs，第三类是契约的
    // meeting 对 —— `Training` schema 上**没有** video_links 这一列，党建学习资料才有。
    const names = detail.materials.map((m) => m.file_name)
    assert.ok(names.some((n) => n.endsWith('.pdf')), 'PDF 讲义')
    assert.ok(names.some((n) => n.endsWith('.pptx')), '演示文稿')
    assert.ok(detail.meeting, '线上会议链接')
    assert.match(detail.meeting.url, /^https:\/\//, '契约要求 https')
  })

  test('可空列缺席时页面不被撑塌', async () => {
    const c = await signedIn()

    // 第 44 条是纯线上：没有地点，只有会议入口。
    const online = await c.training.trainingDetail(44)
    assert.equal(online.location_label, '', '没有地点就是空串，不是 null')
    assert.ok(online.meeting, '纯线上的那一场靠会议入口成立')

    // 第 40 条没有主讲。
    const noSpeaker = await c.training.trainingDetail(40)
    assert.equal(noSpeaker.speaker_label, '')
    assert.ok(noSpeaker.location_label, '地点那一半照常显示')

    // 第 38 条没有结束时间（F9 允许 end_at 为空）。
    const noEnd = await c.training.trainingDetail(38)
    assert.equal(noEnd.end_label, '', '空串让页面按空串开合，不渲染一个空盒子')
    assert.ok(noEnd.start_label, '开始时间照常显示')
  })

  test('一份材料也没有的研修照常显示，只是那一节是空态', async () => {
    const c = await signedIn()
    const detail = await c.training.trainingDetail(34)

    assert.deepEqual(detail.materials, [], '夹具里这条一份材料也没有（F9：材料全部可选）')
    assert.ok(detail.training_content, '研修通知照常在')
    assert.match(read(DETAIL.replace('.js', '.wxml')), /materials\.length === 0/, '空态有它自己的分支')
  })

  test('不在可见范围与不存在读作同一个 404', async () => {
    const c = await signedIn()
    const page = loadPage(c, DETAIL)
    page.onLoad({ training_id: 999999 })
    await page.load(999999)

    assert.ok(page.data.errorText, '说了读不到')
    assert.equal(page.data.errorCanRetry, false, '重试同一个编号不会有别的结果')
    assert.equal(page.data.train, null, '没有半张详情留在屏幕上')
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

// ── 材料：打得开就打开，打不开就说话 ────────────────────────────────────────

describe('研修材料的打开与失败', () => {
  test('点开一份材料现签一次短时地址，带上它的 owner', async () => {
    const c = await signedIn()
    const page = loadPage(c, DETAIL)
    page.onLoad({ training_id: 46 })
    await page.load(46)

    const pdf = page.data.train.materials.find((m) => m.file_name.endsWith('.pdf'))
    await page.onOpenMaterial({ currentTarget: { dataset: { id: pdf.file_id, name: pdf.file_name } } })

    const url = c.record.requests.pop().url
    assert.match(url, new RegExp(`/media/files/${pdf.file_id}/url`), '§8.4：取档另走签名端点')
    // owner 首先是授权参数：同一个 file_id 可被多条记录引用。
    assert.match(url, /owner_object=db_training/)
    assert.match(url, /owner_id=46/)
    assert.equal(c.record.opened.length, 1, '签完就打开')
    assert.equal(c.record.opened[0].fileType, 'pdf')

    // 第二次点击重新签一次：短时 URL 不缓存，服务端借每次调用重跑授权。
    await page.onOpenMaterial({ currentTarget: { dataset: { id: pdf.file_id, name: pdf.file_name } } })
    assert.match(c.record.requests.pop().url, /\/media\/files\//, '不复用上一次的地址')
  })

  test('微信打不开的格式当场说清楚，也不白跑一次签名', async () => {
    const c = await signedIn()
    const page = loadPage(c, DETAIL)
    page.onLoad({ training_id: 46 })
    await page.load(46)

    const zip = page.data.train.materials.find((m) => m.file_name.endsWith('.zip'))
    assert.ok(zip, '夹具里那份打不开的录像包在')

    const before = c.record.requests.length
    await page.onOpenMaterial({ currentTarget: { dataset: { id: zip.file_id, name: zip.file_name } } })

    assert.equal(c.record.requests.length, before, '格式是本机判定的，一个请求也不必发')
    const toast = c.record.toasts.pop()
    assert.match(toast.title, /[一-龥]/, '中文说明')
    assert.match(toast.title, /无法在手机上打开/)
    // 一个请求也没发过，就没有故障码可报。编一个只会让教师报上来一串对不上日志的数字。
    assert.ok(!toast.title.includes('故障码'), '没发请求就没有追踪号')
    assert.equal(c.record.downloads.length, 0, '也没有留白 —— 既没打开，也没沉默')
  })

  test('签名被拒时给中文说明**加**追踪号', async () => {
    const c = await signedIn()
    const page = loadPage(c, DETAIL)
    page.onLoad({ training_id: 46 })
    await page.load(46)

    const pdf = page.data.train.materials.find((m) => m.file_name.endsWith('.pdf'))
    const realRequest = globalThis.wx.request
    globalThis.wx.request = (opts) => {
      globalThis.wx.request = realRequest
      opts.success({
        statusCode: 404,
        data: { code: 'not_found', message: '资源不存在或不在可见范围内', request_id: 'req-m9' },
        header: {},
      })
    }
    await page.onOpenMaterial({ currentTarget: { dataset: { id: pdf.file_id, name: pdf.file_name } } })

    const toast = c.record.toasts.pop()
    assert.match(toast.title, /[一-龥]/, '中文说明')
    assert.match(toast.title, /故障码 req-m9/, '教师报得出的追踪号')
    assert.equal(c.record.opened.length, 0, '没打开任何东西')
  })

  test('下载失败与打开失败也各有一句中文，不留白', async () => {
    const c = await signedIn()
    const page = loadPage(c, DETAIL)
    page.onLoad({ training_id: 46 })
    await page.load(46)
    const pdf = page.data.train.materials.find((m) => m.file_name.endsWith('.pdf'))
    const tap = () => page.onOpenMaterial({ currentTarget: { dataset: { id: pdf.file_id, name: pdf.file_name } } })

    c.control.downloadFails = true
    await tap()
    assert.match(c.record.toasts.pop().title, /下载失败/)

    c.control.downloadFails = false
    c.control.openFails = true
    await tap()
    assert.match(c.record.toasts.pop().title, /打开失败/)
    c.control.openFails = false
  })

  test('线上会议只提供复制，不内嵌外站', async () => {
    const c = await signedIn()
    const page = loadPage(c, DETAIL)
    page.onLoad({ training_id: 46 })
    await page.load(46)

    page.onCopyMeeting()
    assert.equal(c.record.clipboard.pop(), page.data.train.meeting.url, '复制的是那条链接本身')
    assert.match(c.record.toasts.pop().title, /浏览器|会议 App/, '说清楚要去哪里打开')
    // 内嵌外站需要 web-view，且需要业务域名备案。契约明说不内嵌。
    assert.ok(!read(DETAIL.replace('.js', '.wxml')).includes('web-view'), '没有 web-view')
  })
})

// ── 只读与边界 ──────────────────────────────────────────────────────────────

describe('三个页面只读，且不通往 PC后台', () => {
  const BASES = [
    'packages/training/pages/course/detail',
    'packages/training/pages/train/list',
    'packages/training/pages/train/detail',
  ]

  // 票据 16 把研修反馈落在**研修详情**上，所以那一页从此有一个写入控件，而且只有一个。
  // 另外两页仍然一个也不该有 —— 报名与评分属于票据 18，「多了一个入口」不会报错，
  // 只会悄悄提前上线。
  const READ_ONLY_BASES = BASES.filter((b) => b !== 'packages/training/pages/train/detail')

  test('办园理念与研修列表两页都没有任何写入控件', () => {
    for (const base of READ_ONLY_BASES) {
      const wxml = read(`${base}.wxml`)
      for (const word of ['提交', '反馈', '评论', '评分', '报名', '上传', '新建', '编辑', '删除']) {
        assert.ok(!wxml.includes(word), `${base}.wxml 出现了写入入口「${word}」`)
      }
      // 控件本身也不能有：一个没有文案的输入框同样是写入面。
      for (const tag of ['<input', '<textarea', '<form', '<button', '<checkbox', '<radio', '<switch', '<slider']) {
        assert.ok(!wxml.includes(tag), `${base}.wxml 出现了写入控件 ${tag}`)
      }
    }
  })

  /**
   * 2026-08-27：原型 `#signupBlock` 那一节按园方裁定补建，所以「报名」不再是禁词。
   * 这条守住的边界换了个说法留下来：**这一页只有两处写入，都不带内容**——
   * 报名／取消报名没有请求体，反馈是唯一带文字的那一处，且只有一个输入框。
   */
  test('研修详情只有两处写入：报名与反馈，评分仍不建', () => {
    const wxml = read('packages/training/pages/train/detail.wxml')
    for (const word of ['评分', '上传', '新建', '删除']) {
      assert.ok(!wxml.includes(word), `研修详情出现了不该有的写入入口「${word}」`)
    }
    assert.match(wxml, /bindtap="onRegistrationTap"/, '报名那一枚在')

    // 一个输入框，不是两个。反馈是纯文字，附件一概不接（F9）。
    assert.equal((wxml.match(/<textarea/g) || []).length, 1, '反馈只有一个输入框')
    for (const tag of ['<input', '<form', '<checkbox', '<radio', '<switch', '<slider']) {
      assert.ok(!wxml.includes(tag), `研修详情出现了写入控件 ${tag}`)
    }
  })

  test('报名与取消报名都不带请求体 —— 纯状态转移，不过内容安全闸门', async () => {
    const c = await signedIn()
    const page = await openDetail(c, 44)          // 夹具：44 号未开始且已报名（s1）
    assert.equal(page.data.registration.show, true, '这一节画出来了')
    assert.equal(page.data.registration.open, true, '未开始，改得动')
    assert.equal(page.data.registration.registered, true)
    assert.equal(page.data.registration.label, '取消报名')

    await page.onRegistrationTap()
    const cancel = c.record.requests.filter((r) => r.url.includes('registration-cancellation'))
    assert.equal(cancel.length, 1)
    assert.equal(cancel[0].data, undefined, '无请求体')
    assert.equal(page.data.registration.label, '立即报名', '取消之后按钮翻面')

    await page.onRegistrationTap()
    const reg = c.record.requests.filter((r) => r.url.endsWith('/registration'))
    assert.equal(reg.length, 1)
    assert.equal(reg[0].data, undefined, '无请求体')
    assert.equal(page.data.registration.registered, true, '又报上了')
  })

  test('研修开始之后这一节只剩一行理由，按钮不画', async () => {
    const c = await signedIn()
    const page = await openDetail(c, 22)          // 夹具：22 号已结束
    assert.equal(page.data.registration.show, true, '这一节照画 —— 教师要知道自己报没报上')
    assert.equal(page.data.registration.open, false, '开始之后参与状态冻结')
    assert.match(page.data.registration.reason, /已开始/)

    const before = c.record.requests.length
    await page.onRegistrationTap()
    assert.equal(c.record.requests.length, before, '关着的入口点了不发请求')
  })

  test('三个页面都不出现观察记录（DO-NOT-BUILD 1）', () => {
    for (const base of BASES) {
      for (const ext of ['.js', '.wxml']) {
        assert.ok(!read(base + ext).includes('观察记录'), `${base}${ext}`)
      }
    }
  })

  test('三个页面都不含 PC后台 路径（DO-NOT-BUILD 2）', () => {
    for (const base of BASES) {
      for (const ext of ['.js', '.wxml']) {
        const src = read(base + ext)
        assert.ok(!src.includes('pc-backend'), `${base}${ext} 提到了 pc-backend`)
        assert.ok(!src.includes('/admin/'), `${base}${ext} 提到了 /admin/`)
      }
    }
  })

  test('页面不持有端点路径，也不自己格式化时间', () => {
    for (const base of BASES) {
      const src = codeOnly(read(`${base}.js`))
      assert.ok(!src.includes('utils/request'), `${base}.js 直连了传输层`)
      assert.ok(!src.includes('utils/time'), `${base}.js 自己格式化了时间`)
      // `/packages/training/...` is a PAGE path and legitimate; an endpoint path
      // is the API one. Match that shape, not the substring 'training'.
      assert.ok(!/['"`]\/trainings?\b/.test(src), `${base}.js 持有了端点路径`)
      assert.ok(!src.includes('/media/files/'), `${base}.js 自己拼了取档地址`)
    }
  })

  test('列表卡片不带参与状态与反馈计数 —— 报名仍属票据 18', async () => {
    const c = await signedIn()
    const { items } = await c.training.listTrainings({})
    // 票据 16 之后，详情**要**读参与状态：反馈入口按它开合。列表不同 —— 列表上没有
    // 报名入口，显示「已报名」教师看得到却改不了，比不显示更糟。所以断言按行为下，
    // 不按源码里有没有那个字符串下：源码里现在必然有它。
    for (const row of items) {
      assert.equal(row.my_participation_status, undefined, '列表卡片不带参与状态')
      assert.equal(row.feedback_count, undefined, '列表卡片不带反馈计数')
    }
    // 夹具第 16 条既参加过又已结束，服务端确实回了这两列 —— 上面那条断言因此不是
    // 因为服务端根本没给才通过的。
    const raw = await c.api.get('/trainings/16')
    assert.equal(raw.my_participation_status, 's3')
    assert.ok(raw.feedback_count > 0)
  })
})

// ── 角色门 ──────────────────────────────────────────────────────────────────

describe('教研培训三条路径的角色门', () => {
  const PATHS = [
    ['GET', '/trainings'],
    ['GET', '/trainings/46'],
    // 契约里没有这条路径，连表都没有。手写路由因此必须自己登记角色，漏登记就是安全缺陷。
    ['GET', '/training/course-intro'],
  ]

  test('无会话一律 401', async () => {
    for (const [method, path] of PATHS) {
      const res = await fetch(mock.baseUrl + path, { method })
      assert.equal(res.status, 401, `${method} ${path}`)
      assert.equal((await res.json()).code, 'unauthenticated')
    }
  })

  test('角色不在 allowlist 上回 403 route_not_allowed_for_role，不是 404', async () => {
    // §4 规则 21：合作园不得进入教研培训。§2.3：「这个角色能不能走这条路」不泄露业务
    // 事实，所以诚实回 403；「这一行你能不能看」才藏进 404。两者不得互换。
    for (const surface of ['parent', 'partner']) {
      const token = await fetch(mock.baseUrl + '/auth/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ surface, js_code: 'mock-js-code' }),
      }).then((r) => r.json()).then((b) => b.session_token)
      assert.ok(token, `${surface} 会话签出来了`)

      for (const [method, path] of PATHS) {
        const res = await fetch(mock.baseUrl + path, {
          method,
          headers: { authorization: `Bearer ${token}` },
        })
        assert.equal(res.status, 403, `${surface} 走 ${method} ${path} 应当是 403`)
        assert.equal((await res.json()).code, 'route_not_allowed_for_role')
      }
    }
  })

  test('范围不匹配回 404，与不存在无法区分', async () => {
    const c = await signedIn()
    await assert.rejects(
      () => c.training.trainingDetail(999999),
      (err) => err.statusCode === 404 && err.code === 'not_found',
    )
  })
})

// ── 假期：没有进行中的学期 ──────────────────────────────────────────────────
//
// LAST in this file: it flips the server's term off and back on again.

describe('没有进行中的学期时，三个页面照常只读浏览', () => {
  test('假期是一种状态，不是一个错误', async () => {
    setNoTerm(true)
    try {
      const c = await signedIn()
      assert.equal(c.identity.homeIdentity().noTerm, true, '服务端确实报了没有进行中的学期')
      assert.equal(c.guard.canWriteThisTerm(), false, '写入面此时确实是关的')

      // 1. 办园理念与课程体系
      const course = loadPage(c, COURSE)
      course.onLoad()
      await course.load()
      assert.ok(course.data.intro, '图文照常读回来了')
      assert.equal(course.data.errorText, '', '假期不该在屏幕上留下一条错误')

      // 2. 研修列表
      const list = await openList(c, loadPage(c, LIST))
      assert.ok(list.data.items.length > 0, '研修照常读回来了')
      assert.equal(list.data.errorText, '', '假期不该在屏幕上留下一条错误')

      // 3. 研修详情
      const detail = loadPage(c, DETAIL)
      detail.onLoad({ training_id: 46 })
      await detail.load(46)
      assert.ok(detail.data.train, '详情照常读回来了')
      assert.ok(detail.data.train.materials.length > 0, '研修材料也照常在')
      assert.equal(detail.data.errorText, '', '假期不该在屏幕上留下一条错误')

      // 三个页面一句话也没弹：这三页全是只读的，假期与它们无关。
      assert.deepEqual(c.record.toasts, [], `假期里弹了话：${JSON.stringify(c.record.toasts)}`)
      assert.deepEqual(c.record.navigations, [], '也没有被踢回登录页')
    } finally {
      setNoTerm(false)
    }
  })
})
