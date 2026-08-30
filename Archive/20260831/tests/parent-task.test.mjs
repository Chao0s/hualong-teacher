/**
 * 亲子任务发布、计划时刻与名册型进度（票据 19）。
 *
 * 这一套盯住的是**肉眼审不出来的那一处**：计划时刻的字面偏移量。它不会报错，只会让
 * 教师设的 18:00 悄悄变成第二天凌晨 02:00，而两个数字都长得像一个合法的时间。
 *
 * 所以这里的断言不是「格式看起来对」，而是：
 *   - 客户端的白名单与契约的列表**逐项一致**（数列表，不数正文）；
 *   - 把 `process.env.TZ` 切到两个与园所相差极大的时区，同一次操作的产物**逐字节相同**；
 *   - 源码里一个 `new Date(` 也没有；
 *   - 提交 `Z` 或其他偏移量时收到 422，而不是被悄悄换算。
 *
 * 每一条回归用例都先在未修的代码上跑红过，确认它抓得住，再修绿。
 */

import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { start, setNoTerm, parentTaskPublications, classRoster } from '../mock/server.mjs'
import { loadClient, loadPage, loadComponent } from './helpers/seam.mjs'
import { specPath } from '../tools/openapi-source.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MP = path.resolve(HERE, '..', 'miniprogram')
const read = (rel) => fs.readFileSync(path.join(MP, rel), 'utf8')

const PUBLISH = 'packages/co-education/pages/task/publish.js'
const PROGRESS = 'packages/co-education/pages/task/progress.js'

let mock

before(async () => { mock = await start({ port: 0 }) })
after(async () => { await mock.close() })

async function signedIn(options) {
  const c = loadClient({ baseUrl: mock.baseUrl, ...options })
  await c.auth.signIn()
  return c
}

async function openPublish(c) {
  const page = loadPage(c, PUBLISH)
  // onLoad 自己就读一次并把 promise 交回来，所以这里不再补一次 load()。
  await page.onLoad()
  return page
}

/** 按教师真实的动作填一张表。 */
function fill(page, over = {}) {
  const draft = {
    parent_task_type: 't1',
    parent_task_title: '亲子观察：我的家',
    task_background: '孩子们正在讨论家中的物品与家庭成员分工。',
    task_detail: '请家长陪同幼儿选择一个家中生活场景，拍摄 1-2 张照片。',
    start_date: '2026-09-05',
    start_time: '08:00',
    due_date: '2026-09-12',
    due_time: '18:00',
    ...over,
  }
  page.onTypeTap({ currentTarget: { dataset: { key: draft.parent_task_type } } })
  for (const field of ['parent_task_title', 'task_background', 'task_detail']) {
    page.onTextInput({ currentTarget: { dataset: { field } }, detail: { value: draft[field] } })
  }
  for (const field of ['start_date', 'start_time', 'due_date', 'due_time']) {
    page.onPlannedChange({ currentTarget: { dataset: { field } }, detail: { value: draft[field] } })
  }
  return page
}

function readyToConfirm(page, over) {
  fill(page, over)
  page.onPreviewTap()
  page.onPreviewEnd()
  return page
}

function sentTo(c, fragment) {
  return c.record.requests.filter((r) => r.url.includes(fragment))
}

// ══════════════════════════════════════════════════════════════════════════
// 计划时刻的字面偏移量
// ══════════════════════════════════════════════════════════════════════════

describe('计划时刻白名单', () => {
  /**
   * 从契约 §1.2 的**代码块**里读出那份具名清单。
   *
   * 读的是列表，不是它上面那句话 —— DO-NOT-BUILD 9：正文写着「共 7 列」，列表实际有
   * 8 行（`db_party_activity.activity_at` 于 2026-08-20 补入而正文没改）。**数列表。**
   */
  function contractWhitelist() {
    const contract = path.resolve(path.dirname(specPath()), '..', 'docs', 'API-CONTRACT.md')
    const src = fs.readFileSync(contract, 'utf8')
    const at = src.indexOf('计划时刻是一份具名清单')
    assert.ok(at !== -1, '契约 §1.2 的清单段落找不到了 —— 契约变了，这条断言要跟着改')
    const block = /```([\s\S]*?)```/.exec(src.slice(at))
    assert.ok(block, '清单不再是一个代码块')
    return block[1].split(/\s+/).filter((s) => /^db_\w+\.\w+$/.test(s))
  }

  test('客户端镜像的白名单与契约的列表逐项一致', () => {
    const c = loadClient({ baseUrl: mock.baseUrl })
    const mirror = c.coEdu.SCHEDULED_TIME_COLUMNS
    const contract = contractWhitelist()

    assert.deepEqual([...mirror].sort(), [...contract].sort(),
      '镜像与契约的列表逐项一致')
    assert.equal(mirror.length, contract.length)
  })

  test('白名单有 8 列，而契约 §1.2 的正文说 7 —— 以列表为准（DO-NOT-BUILD 9）', () => {
    const c = loadClient({ baseUrl: mock.baseUrl })
    assert.equal(c.coEdu.SCHEDULED_TIME_COLUMNS.length, 8, '数列表，得 8')

    const contract = path.resolve(path.dirname(specPath()), '..', 'docs', 'API-CONTRACT.md')
    const src = fs.readFileSync(contract, 'utf8')
    assert.match(src, /计划时刻是一份具名清单，共 7 列/,
      '正文仍然说 7 —— 这条断言在正文被订正的那天会红，那时把它与上面那条一起改')
    assert.equal(contractWhitelist().length, 8, '列表实际有 8 行')

    // 差的那一列是它。教师端到不了，但镜像整份留着 —— 抄一半就等于把「这一列在不在
    // 白名单里」变成一个需要现场判断的问题。
    assert.ok(c.coEdu.SCHEDULED_TIME_COLUMNS.includes('db_party_activity.activity_at'))
  })

  test('本页真正提交的只有 start_at 与 due_at，其余六列到不了这个端点', () => {
    const c = loadClient({ baseUrl: mock.baseUrl })
    assert.deepEqual(c.coEdu.TASK_PLANNED_FIELDS, ['start_at', 'due_at'])
    for (const field of c.coEdu.TASK_PLANNED_FIELDS) {
      assert.ok(c.coEdu.SCHEDULED_TIME_COLUMNS.some((col) => col.endsWith(`.${field}`)),
        `${field} 必须在白名单上`)
    }
  })
})

describe('偏移量是字面量，不是换算', () => {
  test('教师看到的 18:00 就是保存下来的 18:00，不会变成第二天凌晨', async () => {
    const c = await signedIn()
    const page = await openPublish(c)
    readyToConfirm(page, { start_date: '2026-09-05', start_time: '18:00' })

    // 预览里显示的就是将要发出的那个字符串 —— 这一处最容易写错的东西在发布前肉眼可见。
    assert.equal(page.data.preview.startLabel, '2026-09-05T18:00:00+08:00')
    await page.onConfirmTap()

    const sent = sentTo(c, '/home-school/parent-tasks').find((r) => r.method === 'POST' && r.data)
    assert.equal(sent.data.start_at, '2026-09-05T18:00:00+08:00', '18:00 原样发出去')
    assert.equal(sent.data.due_at, '2026-09-12T18:00:00+08:00')

    // 服务端存的也是同一个墙上时间，不是隔天 02:00。
    const saved = await c.api.get(`/home-school/parent-tasks/${page.data.parentTaskId}`)
    assert.equal(saved.start_at, '2026-09-05T18:00:00+08:00')
    assert.match(saved.start_at, /T18:00:00\+08:00$/, '既不是 T02:00，也不是隔天')
    assert.ok(!saved.start_at.endsWith('Z'), '线上格式不是 UTC')
  })

  test('把设备时区切到与园所相差极大的两个地方，产物逐字节相同', () => {
    const c = loadClient({ baseUrl: mock.baseUrl })
    const draft = {
      parent_task_type: 't1',
      parent_task_title: '甲',
      task_detail: '乙',
      start_date: '2026-09-05',
      start_time: '18:00',
      due_date: '2026-09-05',
      due_time: '23:30',
    }

    const real = process.env.TZ
    const built = {}
    try {
      // UTC-11 与 UTC+14：与园所的 UTC+8 分别差 19 与 6 小时，且分处日界线两侧。
      // 任何一处偷偷构造 Date 再读回来，这两组产物就会差一天。
      for (const tz of ['Pacific/Pago_Pago', 'Pacific/Kiritimati']) {
        process.env.TZ = tz
        built[tz] = JSON.stringify(c.coEdu.buildTaskBody(draft))
      }
    } finally {
      if (real === undefined) delete process.env.TZ
      else process.env.TZ = real
    }

    assert.equal(built['Pacific/Pago_Pago'], built['Pacific/Kiritimati'],
      '设备时区不是输入 —— 两地产物必须逐字节相同')
    assert.match(built['Pacific/Pago_Pago'], /"start_at":"2026-09-05T18:00:00\+08:00"/)
    assert.match(built['Pacific/Pago_Pago'], /"due_at":"2026-09-05T23:30:00\+08:00"/)
  })

  test('显示用的格式化同样不看设备时区', () => {
    const c = loadClient({ baseUrl: mock.baseUrl })
    const real = process.env.TZ
    const shown = []
    try {
      for (const tz of ['Pacific/Pago_Pago', 'Pacific/Kiritimati']) {
        process.env.TZ = tz
        shown.push(c.time.formatShort('2026-09-05T18:00:00+08:00'))
      }
    } finally {
      if (real === undefined) delete process.env.TZ
      else process.env.TZ = real
    }
    assert.equal(shown[0], shown[1])
    assert.equal(shown[0], '09-05 18:00')
  })

  test('客户端源码里一个 new Date( 也没有', () => {
    // 构造一个 Date 就等于把设备时区请了进来：`new Date(str)` 给的是一个正确的瞬时，
    // 但之后每一次 `.getHours()` 都按设备时区读回来，而那正是 §1.2 要消掉的歧义。
    const files = [
      'utils/time.js', 'services/co-education.js', 'utils/media.js',
      PUBLISH, PROGRESS,
      'packages/co-education/pages/moment/publish.js',
      'packages/co-education/pages/moment/progress.js',
      'components/hl-child-picker/index.js', 'components/hl-progress-grid/index.js',
    ]
    for (const file of files) {
      const code = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      assert.ok(!code.includes('new Date('), `${file} 构造了 Date —— 设备时区因此进了计算`)
      assert.ok(!code.includes('Date.now('), `${file} 读了设备时钟`)
      assert.ok(!code.includes('getTimezoneOffset'), `${file} 读了设备时区`)
    }
  })

  test('提交 Z 或其他偏移量时收到 422，服务端不做转换', async () => {
    const c = await signedIn()
    const base = {
      parent_task_type: 't1',
      parent_task_title: '偏移量试探',
      task_detail: '正文',
    }
    for (const bad of ['2026-09-05T18:00:00Z', '2026-09-05T18:00:00+00:00',
                       '2026-09-05T18:00:00+09:00', '2026-09-05T18:00:00', '2026-09-05']) {
      await assert.rejects(
        () => c.api.post('/home-school/parent-tasks', { body: { ...base, start_at: bad } }),
        (err) => err.statusCode === 422 && err.code === 'timestamp_not_accepted'
          && err.details.rule === 'offset_must_be_plus0800_literal',
        `${bad} 必须被拒，且不得被悄悄换算`,
      )
    }
    // due_at 走的是同一条规则。
    await assert.rejects(
      () => c.api.post('/home-school/parent-tasks', {
        body: { ...base, start_at: '2026-09-05T08:00:00+08:00', due_at: '2026-09-06T18:00:00Z' },
      }),
      (err) => err.code === 'timestamp_not_accepted' && err.details.field === 'due_at',
    )
  })

  test('客户端拼不出一个偏移量以外的值 —— 拼接只发生在 utils/time 一处', () => {
    const c = loadClient({ baseUrl: mock.baseUrl })
    assert.equal(c.coEdu.toPlannedTime('2026-09-05', '18:00'), '2026-09-05T18:00:00+08:00')
    assert.equal(c.coEdu.toPlannedTime('2026-09-05', '9:5'), '2026-09-05T09:05:00+08:00')
    // 不设截止是一个合法的选择（契约：due_at 为 null 表示不设截止）。
    assert.equal(c.coEdu.toPlannedTime('', '18:00'), null)
    // 非法日期当场失败，不悄悄拼出一个坏字符串送到线上。
    assert.throws(() => c.coEdu.toPlannedTime('2026/09/05', '18:00'), /YYYY-MM-DD/)
  })

  test('白名单以外的时间列不由客户端提交；被提交则被忽略，不报错也不生效', async () => {
    const c = await signedIn()
    // 负向断言：送一堆事件时间戳过去。它们既不该让请求 422，也不该出现在服务端的答复里。
    const created = await c.api.post('/home-school/parent-tasks', {
      body: {
        parent_task_type: 't1',
        parent_task_title: '硬塞事件时间戳',
        task_detail: '正文',
        start_at: '2026-09-05T08:00:00+08:00',
        published_at: '2000-01-01T00:00:00+08:00',
        created_at: '2000-01-01T00:00:00+08:00',
        term_id: 'BOGUS-TERM',
        teacher_id: 999,
      },
    })
    assert.equal(created.published_at, null, '草稿还没发布 —— 不是 2000 年')
    assert.notEqual(created.created_at, '2000-01-01T00:00:00+08:00', '服务端自己的值赢了')
    assert.equal(created.term_id, null, 'term_id 在发布时才由 start_at 派生')
    assert.notEqual(created.teacher_id, 999)

    // 客户端这一道也在：白名单以外的时间列在 buildTaskBody 里根本不存在。
    const body = c.coEdu.buildTaskBody({
      parent_task_type: 't1', parent_task_title: '甲', task_detail: '乙',
      start_date: '2026-09-05', start_time: '08:00',
      published_at: '2000-01-01T00:00:00+08:00', created_at: '2000-01-01T00:00:00+08:00',
      term_id: 'BOGUS', teacher_id: 999,
    })
    assert.deepEqual(Object.keys(body).sort(),
      ['due_at', 'parent_task_title', 'parent_task_type', 'start_at', 'task_background', 'task_detail'],
      'ParentTaskWrite 的六个键，不多不少')
  })

  test('发布时 term_id 由服务端按 start_at 派生；落不进园历就拒绝发布，绝不猜一个', async () => {
    const c = await signedIn()
    // 园历是 2026-09-01 到 2027-01-15。这个开始时间落在区间外。
    const outside = await c.api.post('/home-school/parent-tasks', {
      body: {
        parent_task_type: 't1', parent_task_title: '落在学期之外', task_detail: '正文',
        start_at: '2026-08-20T08:00:00+08:00',
      },
    })
    await assert.rejects(
      () => c.api.post(`/home-school/parent-tasks/${outside.parent_task_id}/publication`,
        { idempotencyKey: c.api.uuid() }),
      (err) => err.code === 'no_active_term' && err.statusCode === 409,
      '绝不猜一个学期（§5.4）',
    )

    const inside = await c.api.post('/home-school/parent-tasks', {
      body: {
        parent_task_type: 't1', parent_task_title: '落在学期之内', task_detail: '正文',
        start_at: '2026-09-05T08:00:00+08:00',
      },
    })
    assert.equal(inside.term_id, null, '草稿可以没有 term_id')
    const published = await c.api.post(`/home-school/parent-tasks/${inside.parent_task_id}/publication`,
      { idempotencyKey: c.api.uuid() })
    assert.equal(published.term_id, '2026-2027-1', '发布时由服务端派生并写死')
    assert.equal(published.publish_status, 's2')
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 发布路径：预览、把关、幂等、作者字段
// ══════════════════════════════════════════════════════════════════════════

describe('发布亲子任务', () => {
  test('任务类型可选普通亲子任务或社区教育任务，没有第三种', async () => {
    const c = await signedIn()
    const page = await openPublish(c)
    assert.deepEqual(page.data.types.map((t) => t.key), ['t1', 't2'],
      't1／t2 是全部编码，契约里没有 all')
    assert.deepEqual(page.data.types.map((t) => t.label), ['日常任务', '社区任务'])

    page.onTypeTap({ currentTarget: { dataset: { key: 't2' } } })
    assert.equal(page.data.draft.parent_task_type, 't2')
    // 再点一次不取消：必填项取消了只会变成一个缺项。
    page.onTypeTap({ currentTarget: { dataset: { key: 't2' } } })
    assert.equal(page.data.draft.parent_task_type, 't2')
  })

  test('班级与幼儿选择直接复用在园时光那一个组件', () => {
    const json = JSON.parse(read('packages/co-education/pages/task/publish.json'))
    assert.equal(json.usingComponents['hl-child-picker'], '/components/hl-child-picker/index')
    const wxml = read('packages/co-education/pages/task/publish.wxml')
    assert.match(wxml, /<hl-child-picker/)
    // 亲子任务按班下发：契约的 ParentTaskWrite 里没有 child_id，所以这里是只读姿态。
    assert.match(wxml, /disabled="\{\{true\}\}"/)
    assert.match(wxml, /亲子任务按班下发，全班家长都会收到/)
  })

  test('预览内容与最终发出的请求体一致，确认发布后内容锁定', async () => {
    const c = await signedIn()
    const page = await openPublish(c)
    readyToConfirm(page, { parent_task_title: '预览就是发出的那一份' })

    const previewed = page.data.preview.body
    await page.onConfirmTap()

    const sent = sentTo(c, '/home-school/parent-tasks').find((r) => r.method === 'POST' && r.data)
    assert.deepEqual(sent.data, previewed, '发出去的就是预览里那一份，逐字段相同')
    assert.equal(page.data.stage, 'done')
    assert.equal(page.data.locked, true)

    page.onTextInput({ currentTarget: { dataset: { field: 'parent_task_title' } }, detail: { value: '锁定之后又改了' } })
    assert.equal(page.data.draft.parent_task_title, '预览就是发出的那一份', '锁定之后改不动')
  })

  test('改了草稿，上一次的完整预览就作废', async () => {
    const c = await signedIn()
    const page = await openPublish(c)
    readyToConfirm(page)
    assert.equal(page.data.previewedInFull, true)

    page.onPlannedChange({ currentTarget: { dataset: { field: 'start_time' } }, detail: { value: '09:30' } })
    assert.equal(page.data.previewedInFull, false, '时间变了，上一次预览不再是对它的把关')
    assert.equal(page.data.preview, null)
    assert.equal(page.data.stage, 'edit')
  })

  test('未完整预览就发布 -> 被拒，且本地契约服务没有收到任何请求', async () => {
    const c = await signedIn()
    const page = await openPublish(c)
    fill(page)
    page.onPreviewTap()          // 进了预览，但没有读到底

    const before = c.record.requests.length
    const doneBefore = parentTaskPublications().length
    await page.onConfirmTap()

    assert.equal(c.record.requests.length, before, '被拒必须发生在网络出口之前')
    assert.equal(parentTaskPublications().length, doneBefore, '服务端没有执行任何发布')
    assert.match(page.data.errorText, /完整预览/)
    assert.equal(page.data.errorCanRetry, false)
    assert.equal(page.data.locked, false, '被拒之后内容要能改')
  })

  test('未声明把关路径 -> 被拒，且没有任何请求发出', async () => {
    const c = await signedIn()
    const before = c.record.requests.length
    const draft = {
      parent_task_type: 't1', parent_task_title: '甲', task_detail: '乙',
      start_date: '2026-09-05', start_time: '08:00',
    }
    for (const gates of [undefined, null, [], 'no_such_gate']) {
      await assert.rejects(
        () => c.coEdu.createTaskDraft({ gates, draft, idempotencyKey: c.api.uuid() }),
        (err) => err instanceof c.moderation.ModerationError && /未声明内容安全闸门/.test(err.message),
        `声明为 ${JSON.stringify(gates)} 时必须拒绝`,
      )
    }
    assert.equal(c.record.requests.length, before, '四种未声明的形态都没有走到网络')
  })

  test('本页声明的是文字那一条，且本页不携带图片', () => {
    const src = read(PUBLISH)
    assert.match(src, /GATES\.HUMAN_PREVIEW_CONFIRM/)
    assert.ok(!src.includes('GATES.IMAGE_MEDIA_CHECK_ASYNC'),
      '契约的 ParentTaskWrite 里没有 file_id —— 本页不携带图片，所以不声明图片那一条')
    assert.ok(!src.includes('ADMIN_REVIEW_QUEUE'))
  })

  test('缺必填项时逐项点名，且一个请求也不发', async () => {
    const c = await signedIn()
    const page = await openPublish(c)
    page.onTextInput({ currentTarget: { dataset: { field: 'parent_task_title' } }, detail: { value: '只填了名称' } })

    const before = c.record.requests.length
    page.onPreviewTap()

    assert.equal(c.record.requests.length, before)
    assert.deepEqual(page.data.blockers.map((b) => b.key), ['task_detail', 'start_at'])
    assert.equal(page.data.stage, 'edit')
    assert.equal(page.data.errorText, '')
  })

  test('请求不发送作者字段', async () => {
    const c = await signedIn()
    const page = await openPublish(c)
    readyToConfirm(page)
    await page.onConfirmTap()

    const sent = sentTo(c, '/home-school/parent-tasks').find((r) => r.method === 'POST' && r.data)
    for (const derived of ['teacher_id', 'created_by', 'school_id', 'class_id',
                           'term_id', 'published_at', 'publish_status']) {
      assert.ok(!(derived in sent.data), `请求体里出现了服务端派生的 ${derived}`)
    }
  })

  test('携带幂等键，重复点击不产生两条任务；重放返回原始状态码与原始响应体', async () => {
    const c = await signedIn()
    const page = await openPublish(c)
    readyToConfirm(page, { parent_task_title: '两次点击' })

    const doneBefore = parentTaskPublications().length
    await page.onConfirmTap()
    const keys = page.data.attemptKeys
    assert.ok(keys && keys.create && keys.publish)

    const posts = sentTo(c, '/home-school/parent-tasks').filter((r) => r.method === 'POST' && r.data)
    assert.equal(posts[0].header['Idempotency-Key'], keys.create, '建草稿带了键')

    // 重放建草稿：不产生第二条草稿。
    const replayCreate = await c.api.post('/home-school/parent-tasks', {
      body: page.data.preview.body, idempotencyKey: keys.create,
    })
    assert.equal(replayCreate.parent_task_id, page.data.parentTaskId, '重放回的是同一条')

    // 重放发布：原始状态码与原始响应体。
    const replay = await c.api.post(`/home-school/parent-tasks/${page.data.parentTaskId}/publication`, {
      idempotencyKey: keys.publish,
    })
    assert.equal(replay.publish_status, 's2')
    assert.equal(replay.published_at, '2026-08-26T18:10:00+08:00', '原始响应体，不是重新算的')
    assert.equal(parentTaskPublications().length - doneBefore, 1, '只产生一条任务')
  })

  test('发布后不能改 —— 契约里没有回头路，服务端也拦', async () => {
    const c = await signedIn()
    const page = await openPublish(c)
    readyToConfirm(page)
    await page.onConfirmTap()

    await assert.rejects(
      () => c.api.patch(`/home-school/parent-tasks/${page.data.parentTaskId}`,
        { body: { parent_task_title: '偷偷改一下' } }),
      (err) => err.code === 'state_precondition_failed' && err.statusCode === 409,
    )
    assert.match(page.data.readonlyReason, /结束这条任务再新建/, '说清楚下一步是什么')
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 名册型进度视图
// ══════════════════════════════════════════════════════════════════════════

describe('亲子任务完成进度', () => {
  async function openProgress(c, parentTaskId = 2) {
    const page = loadPage(c, PROGRESS)
    await page.onLoad({ parent_task_id: String(parentTaskId) })
    return page
  }

  test('按幼儿逐行整体返回，请求里不带任何分页参数', async () => {
    const c = await signedIn()
    await openProgress(c)

    const reads = sentTo(c, '/submissions')
    assert.equal(reads.length, 1, '整取一次，不翻页')
    const url = reads[0].url
    for (const forbidden of ['limit=', 'cursor=', 'offset=', 'page=', 'total=']) {
      assert.ok(!url.includes(forbidden), `名册型请求带了 ${forbidden}：${url}`)
    }
    assert.ok(!url.includes('?'), '一个查询参数也没有')
  })

  test('全班每一名幼儿都有一行，行序按幼儿标识升序', async () => {
    const c = await signedIn()
    const page = await openProgress(c)
    const roster = classRoster()

    assert.equal(page.data.rows.length, roster.length, `全班 ${roster.length} 名，一个不少`)
    assert.deepEqual(page.data.rows.map((r) => r.key), roster.map((x) => String(x.child_id)),
      '行序按 child_id 升序，服务端定，客户端不重排')
    assert.deepEqual(page.data.rows.map((r) => r.name), roster.map((x) => x.child_name))
    assert.equal(page.data.totalCount, roster.length)
  })

  test('缺提交行等价未完成 —— 服务端左连接补齐，客户端不拼装', async () => {
    const c = await signedIn()
    const rows = await c.coEdu.taskSubmissions(2)
    const roster = classRoster()
    assert.equal(rows.length, roster.length)
    // 夹具：下标能被 3 整除的那几名没有提交行。
    assert.equal(rows[0].done, false, '没有提交行，读作未完成')
    assert.equal(rows[1].done, true)
    assert.equal(rows.filter((r) => r.done).length, roster.length - Math.ceil(roster.length / 3))
  })

  test('两态颜色点，每个都带可读的状态说明', async () => {
    const c = await signedIn()
    const page = await openProgress(c)
    for (const row of page.data.rows) {
      assert.equal(row.cells.length, 1, '这一页只有一列')
      const cell = row.cells[0]
      assert.equal(typeof cell.done, 'boolean', '两态，不是三态')
      assert.match(cell.hint, /(已提交|未提交)/, '每一格都有朗读文本')
      assert.ok(cell.hint.startsWith(row.name), '朗读文本先说是谁')
    }
    // 一名幼儿的提交正在内容安全批次里；看板只回布尔化的「审核中」，不回批次键。
    const checking = page.data.rows.find((r) => r.cells[0].hint.includes('内容检查中'))
    assert.ok(checking, '夹具里有一名幼儿的提交在检查中')
    const raw = await c.coEdu.taskSubmissions(2)
    assert.ok(raw.every((r) => !('active_check_batch_key' in r)), '批次键不该到客户端')
  })

  test('进度页只读 —— 不出现补录或代填入口，格子也点不动', () => {
    const wxml = read('packages/co-education/pages/task/progress.wxml')
    const js = read(PROGRESS)

    // 1. 网格不给 tappable（默认 false）。
    assert.ok(!/tappable=/.test(wxml), '这一页不给格子可点 —— 家长交的东西教师不替他交')
    // 2. 页面没有任何写入调用。
    for (const write of ['api.post', 'api.patch', 'createTaskDraft', 'updateTaskDraft',
                         'publishTask', 'closeTask', 'createMomentDraft']) {
      assert.ok(!js.includes(write), `${PROGRESS} 出现了写入调用：${write}`)
    }
    // 3. 界面上一个补录、代填、代交的入口也没有。
    const visible = wxml.replace(/<!--[\s\S]*?-->/g, '')
    for (const word of ['补录', '代填', '代交', '替家长', '手工录入']) {
      assert.ok(!visible.includes(word), `界面上出现了「${word}」`)
    }
    assert.ok(!/bindtap="onCell/.test(visible), '没有会写东西的点击处理器')
  })

  test('班级没有数据时显示一句说明，而不是一片空白', () => {
    const grid = read('components/hl-progress-grid/index.wxml')
    assert.match(grid, /rows\.length === 0/)
    assert.match(grid, /\{\{emptyText\}\}/)
    const wxml = read('packages/co-education/pages/task/progress.wxml')
    assert.match(wxml, /empty-text="[^"]+"/, '这一页给了自己的那一句')

    const c = loadClient({ baseUrl: mock.baseUrl })
    const empty = c.coEdu.taskProgressMatrix([])
    assert.deepEqual(empty.rows, [])
    assert.equal(empty.columns.length, 1, '没有行也仍然有列定义')
  })

  test('显示已提交与未提交各多少 —— 教师要的是缺口，不是一个百分比', async () => {
    const c = await signedIn()
    const page = await openProgress(c)
    assert.match(page.data.summary, /全班 \d+ 名幼儿，已提交 \d+ 名，未提交 \d+ 名。/)
    assert.ok(page.data.doneCount <= page.data.totalCount)
  })

  test('缺少任务编号时说出来，不发请求', async () => {
    const c = await signedIn()
    const before = c.record.requests.length
    const page = loadPage(c, PROGRESS)
    page.onLoad({})
    assert.equal(c.record.requests.length, before)
    assert.match(page.data.errorText, /缺少任务编号/)
    assert.equal(page.data.errorCanRetry, false)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 进度矩阵是一个不知道自己在渲染哪个模块的通用网格
// ══════════════════════════════════════════════════════════════════════════

describe('通用进度矩阵', () => {
  test('组件里没有任何模块专属的词', () => {
    for (const file of ['components/hl-progress-grid/index.js',
                        'components/hl-progress-grid/index.wxml',
                        'components/hl-progress-grid/index.wxss']) {
      const src = read(file).replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '')
      for (const word of ['在园时光', '亲子任务', '月度评价', '学期评价', '成长册',
                          'moment', 'parent_task', 'evaluation', 'child_id']) {
        assert.ok(!src.includes(word), `${file} 内置了模块专属逻辑：${word}`)
      }
    }
  })

  test('组件的输入只有列定义与行数据', () => {
    const c = loadClient({ baseUrl: mock.baseUrl })
    const def = loadComponent(c, 'components/hl-progress-grid/index.js')
    assert.deepEqual(Object.keys(def.properties).sort(),
      ['columns', 'emptyText', 'nameLabel', 'rows', 'tappable'],
      '五个属性：数据两个，列定义一个，其余是形态')
    assert.equal(def.properties.tappable.value, false,
      '默认不可点 —— 可点是要显式要的那一种能力（进度页只读）')
  })

  test('两个模块喂给它的是同一种形状', async () => {
    const c = await signedIn()
    const taskRows = await c.coEdu.taskSubmissions(2)
    const taskMatrix = c.coEdu.taskProgressMatrix(taskRows)
    const momentMatrix = c.coEdu.momentProgressMatrix(
      classRoster().slice(0, 2),
      ['2026-W34', '2026-W35'],
      [{ items: [{ child_id: 101, count: 2, done: true }] },
        { items: [{ child_id: 102, count: 0, done: false }] }],
    )
    const shapeOf = (m) => ({
      columns: Object.keys(m.columns[0]).sort(),
      row: Object.keys(m.rows[0]).sort(),
      cell: Object.keys(m.rows[0].cells[0]).sort(),
    })
    assert.deepEqual(shapeOf(taskMatrix), shapeOf(momentMatrix),
      '列、行、格三层的键逐个相同 —— 换用它时只提供数据与列定义')
    assert.deepEqual(shapeOf(taskMatrix), {
      columns: ['key', 'label'], row: ['cells', 'key', 'name'], cell: ['done', 'hint', 'key'],
    })
  })

  test('不可点时不发事件；可点时回的是行键与列键，不是幼儿标识', () => {
    const c = loadClient({ baseUrl: mock.baseUrl })
    const def = loadComponent(c, 'components/hl-progress-grid/index.js')
    const emitted = []
    const self = Object.assign(Object.create(null), def.methods, {
      data: { tappable: false },
      triggerEvent(name, detail) { emitted.push({ name, detail }) },
    })
    self.onCellTap({ currentTarget: { dataset: { rowKey: '105', colKey: 'x' } } })
    assert.equal(emitted.length, 0, '不可点时什么也不发')

    self.data.tappable = true
    self.onCellTap({ currentTarget: { dataset: { rowKey: '105', colKey: 'x' } } })
    assert.deepEqual(emitted[0], { name: 'celltap', detail: { rowKey: '105', colKey: 'x' } })
  })
})

// ══════════════════════════════════════════════════════════════════════════
// DO-NOT-BUILD 与假期
// ══════════════════════════════════════════════════════════════════════════

describe('不得建造清单', () => {
  test('发布页与进度页都没有视频入口（第 12 条）', () => {
    for (const file of [PUBLISH, PROGRESS,
                        'packages/co-education/pages/task/publish.wxml',
                        'packages/co-education/pages/task/progress.wxml']) {
      const src = read(file)
      for (const forbidden of ['<video', 'chooseVideo', 'chooseMedia', 'mediaType', '<camera']) {
        assert.ok(!src.includes(forbidden), `${file} 出现了视频入口：${forbidden}`)
      }
    }
  })

  test('两页都不通往 PC后台，也不出现观察记录（第 1、2 条）', () => {
    for (const file of [PUBLISH, PROGRESS,
                        'packages/co-education/pages/task/publish.wxml',
                        'packages/co-education/pages/task/progress.wxml']) {
      const src = read(file)
      assert.ok(!src.includes('观察记录'), `${file} 出现了观察记录`)
      assert.ok(!src.includes('/admin/') && !src.includes('pc-backend'), `${file} 通往管理端`)
    }
  })

  test('分页只有游标 —— 列表读取不发页号、偏移量或总数（第 11 条）', async () => {
    const c = await signedIn()
    await c.coEdu.listTasks({})
    const url = sentTo(c, '/home-school/parent-tasks')[0].url
    for (const forbidden of ['offset=', 'page=', 'total=']) {
      assert.ok(!url.includes(forbidden), `${forbidden} 不该存在`)
    }
    assert.ok(url.includes('limit='), '时间流用的是游标分页，limit 是它的一半')
  })
})

describe('没有进行中的学期时', () => {
  test('发布页是只读说明，不是一句错误，也没有弹窗', async () => {
    setNoTerm(true)
    try {
      const c = await signedIn()
      const page = await openPublish(c)

      assert.equal(page.data.readonly, true)
      assert.match(page.data.readonlyReason, /假期/)
      assert.equal(page.data.errorText, '', '假期是季节，不是故障')
      assert.equal(c.record.toasts.length, 0, '不是弹窗 —— 是页面上的一行说明')

      const before = c.record.requests.length
      page.onPreviewTap()
      await page.onConfirmTap()
      assert.equal(c.record.requests.length, before)
      assert.equal(page.data.stage, 'edit')

      // §6.4：客户端预先禁用不是边界，服务端独立拒绝。
      await assert.rejects(
        () => c.api.post('/home-school/parent-tasks', {
          body: {
            parent_task_type: 't1',
            parent_task_title: '甲',
            task_detail: '乙',
            start_at: '2026-09-05T08:00:00+08:00',
          },
        }),
        (err) => err.code === 'no_active_term' && err.statusCode === 409,
      )
    } finally {
      setNoTerm(false)
    }
  })
})
