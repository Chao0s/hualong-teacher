/**
 * 待办事项看板与任务详情 (ticket 10) — read-only, and the first list with a
 * real filter.
 *
 * Two things here are not repeats of ticket 08's list tests: the cursor is now
 * bound to a filter set, so changing the filter must throw the old cursor away;
 * and the page carries an ENTRY to a write screen that must refuse by reason
 * rather than by error, without ever becoming a write control.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { start } from '../mock/server.mjs'
import { loadClient, loadPage } from './helpers/seam.mjs'

const MP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'miniprogram')
const read = (rel) => fs.readFileSync(path.join(MP, rel), 'utf8')

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

// ── The board ────────────────────────────────────────────────────────────────

test('the board shows the teacher own状态 as words, never the enum code', async () => {
  const c = await signedIn()
  const { items } = await c.task.listPage({})

  assert.ok(items.length > 0)
  for (const row of items) {
    assert.ok(row.status_label, '每行都有状态文案')
    assert.ok(!/^[at]\d$/.test(row.status_label), `界面上出现了枚举原值：${row.status_label}`)
    assert.ok(row.status_class.startsWith('hl-pill--'))
    assert.match(row.due_label, /^\d{2}-\d{2} \d{2}:\d{2}$/, '时间由服务层格式化')
  }
})

test('an unknown status code still renders a row, neutrally', async () => {
  const c = await signedIn()
  const { items } = await c.task.listPage({})
  // 7 号任务的 task_status 是本客户端不认识的码。
  const row = items.find((r) => r.task_id === 7)
  assert.ok(row, '这一行没有被丢掉')
  assert.ok(row.status_label, '仍有文案')
  assert.equal(row.closed_note, '', '未知码不会被当成已取消')
})

test('已取消 is shown apart from the teacher own status, not instead of it', async () => {
  const c = await signedIn()
  const { items } = await c.task.listPage({})
  const cancelled = items.find((r) => r.task_id === 3)
  assert.equal(cancelled.closed_note, '任务已取消')
  assert.ok(cancelled.status_label, '教师自己那一行的状态仍然显示')
})

/**
 * 2026-08-27：看板改回原型的**两节堆叠**（当前任务／历史任务），此前是三枚筛选标签。
 * 「换筛选丢游标」那条断言因此没有目标了 —— 现在没有筛选可换，两节各持各的游标。
 * 它守的那件事换了个形状留下来：**两节读的不是同一批，而且各自的游标互不相干**。
 */
test('两节各读各的，游标互不相干', async () => {
  const c = await signedIn()
  const page = loadPage(c, 'pages/task/board.js')
  page.onLoad()
  await page.loadAll()

  const [current, history] = page.data.sections
  assert.equal(current.key, 'current')
  assert.equal(history.key, 'history')
  assert.ok(current.items.length > 0, '当前任务这一节有内容')

  const ids = (s) => s.items.map((r) => r.task_id)
  for (const id of ids(current)) {
    assert.ok(!ids(history).includes(id), `任务 ${id} 同时出现在两节里`)
  }
})

test('计数只在这一节读完时才报 —— 游标分页没有总数', async () => {
  const c = await signedIn()
  const page = loadPage(c, 'pages/task/board.js')
  page.onLoad()
  await page.loadAll()

  for (const section of page.data.sections) {
    if (section.exhausted) {
      assert.equal(section.countLabel, `${section.items.length}项`, '读完了才报数')
    } else {
      assert.equal(section.countLabel, '', '没读完就不报 —— 报一个已加载数冒充总数更糟')
    }
  }
})

test('a cursor from one filter is refused under another, and the page self-heals', async () => {
  const c = await signedIn()
  // 拿一个 current 作用域下的游标，再拿它去请求 history。
  const first = await c.task.listPage({ scope: 'current', limit: 2 })
  assert.ok(first.nextCursor, '夹具够长，有下一页')

  await assert.rejects(
    () => c.task.listPage({ scope: 'history', cursor: first.nextCursor }),
    (err) => err.code === 'cursor_filter_mismatch',
    '§3.3：换了筛选还用旧游标是 400，不是悄悄给错答案',
  )
})

test('一节翻到底就不再问 —— 游标为空是结束的唯一信号', async () => {
  const c = await signedIn()
  const page = loadPage(c, 'pages/task/board.js')
  page.onLoad()
  await page.loadAll()

  const key = 'current'
  const at = () => page.data.sections.find((s) => s.key === key)
  let guardCount = 0
  while (!at().exhausted && guardCount < 20) {
    // eslint-disable-next-line no-await-in-loop
    await page.onMoreTap({ currentTarget: { dataset: { key } } })
    guardCount += 1
  }
  assert.ok(at().exhausted, '这一节翻到了底')

  const sent = c.record.requests.length
  await page.onMoreTap({ currentTarget: { dataset: { key } } })
  await page.onMoreTap({ currentTarget: { dataset: { key } } })
  assert.equal(c.record.requests.length, sent, '到底之后一个请求也不再发')
})

// ── The detail ───────────────────────────────────────────────────────────────

test('detail carries the requirement, the deadline and the filed material', async () => {
  const c = await signedIn()
  const row = await c.task.detail(1)

  assert.ok(row.task_division, '分工要求')
  assert.match(row.due_label, /年.*月.*日/, '截止时间是长格式')
  assert.ok(row.files.length > 0, '已提交材料清单')
  assert.ok(row.files[0].size_label, '体积也是服务层转好的')
  assert.ok(row.progress_label, '进度来自服务端实算')
})

test('the deadline is shown as written — no timezone arithmetic anywhere', async () => {
  const c = await signedIn()
  const raw = await c.api.get('/tasks/1')
  const row = await c.task.detail(1)

  // 服务端返回 ...T18:00:00+08:00，界面必须还是 18:00。
  assert.match(raw.due_at, /T18:00:00\+08:00$/)
  assert.match(row.due_label, /18:00$/, '18:00 不得被换算成别的时刻')
})

test('out-of-scope and gone read identically, with no retry', async () => {
  const c = await signedIn()
  const page = loadPage(c, 'pages/task/detail.js')

  await page.load(99999)
  assert.match(page.data.errorText, /不存在|不在可见范围/)
  assert.equal(page.data.errorCanRetry, false, '重试改变不了任何事')
  assert.equal(page.data.errorRequestId !== undefined, true, '带一个可以报给园方的追踪号')
})

test('a retryable failure offers retry and says so differently', async () => {
  const c = await signedIn()
  const page = loadPage(c, 'pages/task/detail.js')

  const realRequest = globalThis.wx.request
  globalThis.wx.request = (opts) => {
    globalThis.wx.request = realRequest
    opts.success({
      statusCode: 503,
      data: { code: 'upstream_unavailable', message: '服务暂时不可用', request_id: 'req-t1' },
      header: { 'Retry-After': '600' },
    })
  }
  await page.load(1)

  assert.equal(page.data.errorCanRetry, true, '可重试的失败给重试入口')
  assert.equal(page.data.errorRequestId, 'req-t1')
  assert.ok(page.data.errorText)
})

// ── The submit entry is an entry, not a control ──────────────────────────────

test('the submit entry explains a closed task instead of erroring', async () => {
  const c = await signedIn()

  const cancelled = c.task.submitEntry({ taskStatus: 't4', canWrite: true })
  assert.equal(cancelled.disabled, true)
  assert.match(cancelled.reason, /已取消/)

  const finished = c.task.submitEntry({ taskStatus: 't3', canWrite: true })
  assert.equal(finished.disabled, true)
  assert.match(finished.reason, /已结束/)

  const holiday = c.task.submitEntry({ taskStatus: 't2', canWrite: false })
  assert.equal(holiday.disabled, true)
  assert.match(holiday.reason, /假期/)

  const open = c.task.submitEntry({ taskStatus: 't2', canWrite: true })
  assert.equal(open.disabled, false)
  assert.equal(open.reason, '')
})

test('tapping a disabled entry does nothing — the reason is already on screen', async () => {
  const c = await signedIn()
  const page = loadPage(c, 'pages/task/detail.js')
  page.setData({ submitDisabled: true, submitReason: '任务已取消，不能再提交材料' })

  page.onSubmitTap()
  assert.equal(c.record.toasts.length, 0, '不把已经写在页面上的理由再弹一次')
  assert.equal(c.record.navigations.length, 0)

  // 票据 11 之后入口通向真正的写入页，且必须带上任务编号。
  page.setData({ submitDisabled: false, taskId: 1 })
  page.onSubmitTap()
  assert.deepEqual(
    c.record.navigations.pop(),
    { api: 'navigateTo', url: '/pages/task/submit?task_id=1' },
    '入口仍然只是入口：跳转，不提交',
  )
})

/**
 * 2026-08-27：原型的「任务操作」一节按园方裁定补回详情页，所以这条不再是
 * 「两屏都没有写入控件」。看板仍然一个也没有；详情页那两枚的分界换了个说法留下来：
 *
 *   接受   真写入，但**无请求体** —— 它不携带任何用户内容，所以不过内容安全闸门。
 *   完成   点得下去、办不成（G40），因此详情页仍然不提交、不编辑、不删除内容。
 */
test('看板一个写入控件也没有，详情页只接受、不提交内容', () => {
  for (const file of ['pages/task/board.wxml', 'pages/task/board.js', 'services/task.js']) {
    const src = read(file)
    for (const forbidden of ['api.post', 'api.patch', 'api.del', '幂等', 'Idempotency']) {
      assert.ok(!src.includes(forbidden), `${file} 出现了写入痕迹：${forbidden}`)
    }
  }

  const detail = read('pages/task/detail.wxml')
  const detailJs = read('pages/task/detail.js')

  // 原型那两枚都在，位置也在「任务操作」那一节里。
  assert.match(detail, /bindtap="onAcceptTap"/, '「接受」按钮在')
  assert.match(detail, /bindtap="onCompleteTap"/, '「完成」按钮在')
  assert.match(detail, /任务操作/, '这一节的标题照原型')

  // 详情页自己不发任何带请求体的写入：接受走 services/task-submit.js，且无 body。
  assert.ok(!detailJs.includes('api.post'), '详情页不直接发请求')
  assert.ok(!detailJs.includes('api.patch'), '详情页不改内容')
  assert.ok(!detailJs.includes('api.del'), '详情页不删内容')

  // 提交仍然只是入口，带禁用态。
  assert.ok(detail.includes('submitDisabled'), '提交入口必须带禁用态')
})

test('「完成」点得下去但一个请求也不发 —— 它办不成，就说为什么', async () => {
  const c = await signedIn()
  const page = loadPage(c, 'pages/task/detail.js')
  page.onLoad({ task_id: '11' })
  await page.load(11)

  const before = c.record.requests.length
  page.onCompleteTap()

  assert.equal(c.record.requests.length, before, '一个请求也没发')
  assert.match(page.data.opNotice, /提交材料/, '说清楚该走哪一条路')
  assert.equal(c.record.toasts.length, 0, '就地写出来，不弹窗')
})

test('「接受」是真写入：a1 的任务点一下就转 a2', async () => {
  const c = await signedIn()
  const page = loadPage(c, 'pages/task/detail.js')
  page.onLoad({ task_id: '6' })            // 夹具里 6—10 是待接收（a1）
  await page.load(6)
  assert.equal(page.data.task.assign_status, 'a1', '这一条本来就待接收')

  await page.onAcceptTap()

  const sent = c.record.requests.filter((r) => r.url.includes('/acceptance'))
  assert.equal(sent.length, 1, '发了一次接受')
  assert.equal(sent[0].data, undefined, '无请求体 —— 不携带内容，所以不过闸门')
  assert.equal(page.data.task.assign_status, 'a2', '读回来的状态已经是已接收')
})

test('the board is reachable from 首页 待办事项, and it is a real navigation', async () => {
  const c = await signedIn()
  const home = loadPage(c, 'pages/home/index.js')
  // 票据 15 起，待办卡片带上自己的类型：只有「待上传」那一类进上传表单，其余照旧
  // 进任务看板。这里测的是「其余」。
  home.onTodoTap({ currentTarget: { dataset: { kind: 'task' } } })

  assert.deepEqual(
    c.record.navigations.pop(),
    { api: 'navigateTo', url: '/pages/task/board' },
    '看板不是 tab 页，用 navigateTo',
  )
})
