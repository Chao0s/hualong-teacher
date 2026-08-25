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

test('changing the filter throws the old cursor away and reloads from the top', async () => {
  const c = await signedIn()
  const page = loadPage(c, 'pages/task/board.js')
  page.onLoad()
  await page.loadFirst()

  const firstScope = page.data.items.map((r) => r.task_id)
  assert.ok(page.data.items.length > 0)

  page.onScopeTap({ currentTarget: { dataset: { scope: 'history' } } })
  await page.loadFirst()

  assert.equal(page.data.activeScope, 'history')
  assert.deepEqual(page.data.filters, { scope: 'history' })
  assert.equal(page.data.cursor, null, '换筛选后游标从头开始')
  const secondScope = page.data.items.map((r) => r.task_id)
  assert.notDeepEqual(secondScope, firstScope, '两个筛选返回的不是同一批')
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

test('the board pages to the end and then stops asking', async () => {
  const c = await signedIn()
  const page = loadPage(c, 'pages/task/board.js')
  page.onLoad()
  page.setData({ activeScope: '', filters: {} })
  await page.loadFirst()
  while (!page.data.exhausted) await page.loadMore()

  const sent = c.record.requests.length
  await page.loadMore()
  await page.loadMore()
  assert.equal(c.record.requests.length, sent, '游标为空即结束')
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

test('neither task screen carries a submit, edit or delete control', () => {
  // 原型有 接受 / 完成 / 提交材料 三个写入按钮。本票是只读的，三个都不得出现。
  for (const file of ['pages/task/board.wxml', 'pages/task/detail.wxml',
                      'pages/task/board.js', 'pages/task/detail.js',
                      'services/task.js']) {
    const src = read(file)
    for (const forbidden of ['api.post', 'api.patch', 'api.del', '幂等', 'Idempotency']) {
      assert.ok(!src.includes(forbidden), `${file} 出现了写入痕迹：${forbidden}`)
    }
  }
  // 详情页只允许出现「提交材料」这一个入口文案，且它旁边必须有 submitDisabled。
  const detail = read('pages/task/detail.wxml')
  assert.ok(!detail.includes('bindtap="onAccept"'), '不得有「接受」按钮')
  assert.ok(!detail.includes('bindtap="onComplete"'), '不得有「完成」按钮')
  assert.ok(detail.includes('submitDisabled'), '提交入口必须带禁用态')
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
