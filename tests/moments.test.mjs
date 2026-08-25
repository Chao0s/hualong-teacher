/**
 * 在园时光发布与发布进度（票据 17）。
 *
 * 每一条回归用例都先在未修的代码上跑红过，确认它抓得住，再修绿。断言对着**行为**，
 * 不对着字符串：把关路径的拒绝发生在网络出口之前（数请求条数），10 MB 的拒绝发生在
 * 选完照片的那一刻（数请求条数），幂等重放不产生第二则（数服务端自己的记录）。
 *
 * 视频入口那一条是**负向断言**：它不检查「有没有做对」，检查的是「有没有被顺手补上」。
 */

import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { start, setNoTerm, momentPublications, classRoster } from '../mock/server.mjs'
import { loadClient, loadPage, loadComponent } from './helpers/seam.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MP = path.resolve(HERE, '..', 'miniprogram')
const read = (rel) => fs.readFileSync(path.join(MP, rel), 'utf8')

const PUBLISH = 'packages/co-education/pages/moment/publish.js'
const PROGRESS = 'packages/co-education/pages/moment/progress.js'

let mock

before(async () => { mock = await start({ port: 0 }) })
after(async () => { await mock.close() })

async function signedIn(options) {
  const c = loadClient({ baseUrl: mock.baseUrl, ...options })
  await c.auth.signIn()
  return c
}

/** 打开发布页并读完首屏。 */
async function openPublish(c, query = {}) {
  const page = loadPage(c, PUBLISH)
  // onLoad 自己就读一次并把 promise 交回来，所以这里不再补一次 load()。
  await page.onLoad(query)
  return page
}

/** 一份填满的草稿，按教师真实的动作填。 */
function fill(page, { title = '端午艾草手作', content = '孩子们互相提醒，整体参与度较高。', children = [101, 102] } = {}) {
  page.onTextInput({ currentTarget: { dataset: { field: 'moment_title' } }, detail: { value: title } })
  page.onTextInput({ currentTarget: { dataset: { field: 'moment_content' } }, detail: { value: content } })
  page.onDateChange({ detail: { value: '2026-08-26' } })
  page.onChildrenChange({ detail: { childIds: children } })
  return page
}

/** 走完「填 → 预览 → 读到底」，停在可以确认的那一刻。 */
function readyToConfirm(page, options) {
  fill(page, options)
  page.onPreviewTap()
  page.onPreviewEnd()
  return page
}

function sentTo(c, fragment) {
  return c.record.requests.filter((r) => r.url.includes(fragment))
}

/**
 * 一个可驱动的组件实例：`data` 加一个合并的 `setData`，再把 `methods` 挂上去，
 * 因为组件的方法互相调用（`onRowTap` 调 `emit`）。渲染不在测试范围内，与 loadPage 同理。
 */
function driveComponent(def, data) {
  const emitted = []
  const self = Object.assign(Object.create(null), def.methods, {
    data: { ...data },
    setData(patch) { Object.assign(this.data, patch) },
    triggerEvent(name, detail) { emitted.push({ name, detail }) },
  })
  return { self, emitted }
}

// ── 验收项 2：只有图片入口，一个视频入口也没有（负向断言）─────────────────────

describe('页面上一个视频入口也没有', () => {
  test('四个页面与它们的服务、组件里都没有视频入口（DO-NOT-BUILD 12）', () => {
    const files = [
      PUBLISH, 'packages/co-education/pages/moment/publish.wxml',
      PROGRESS, 'packages/co-education/pages/moment/progress.wxml',
      'packages/co-education/pages/task/publish.js', 'packages/co-education/pages/task/publish.wxml',
      'packages/co-education/pages/task/progress.js', 'packages/co-education/pages/task/progress.wxml',
      'services/co-education.js', 'utils/media.js',
      'components/hl-child-picker/index.js', 'components/hl-child-picker/index.wxml',
      'components/hl-progress-grid/index.js', 'components/hl-progress-grid/index.wxml',
    ]
    for (const file of files) {
      const src = read(file)
      for (const forbidden of ['<video', 'chooseVideo', 'openVideoEditor', 'compressVideo',
                               'camera-', '<camera', 'mediaType']) {
        assert.ok(!src.includes(forbidden), `${file} 出现了视频入口：${forbidden}`)
      }
    }
  })

  test('选照片走 wx.chooseImage —— chooseMedia 的视频只隔着一个参数', () => {
    // 注释里讲得起 chooseMedia（utils/media.js 的头注正是在解释为什么不用它），
    // 所以先剥注释再扫代码。
    const code = read('utils/media.js')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.match(code, /wx\.chooseImage\(/)
    assert.ok(!/wx\.chooseMedia\(/.test(code), 'chooseMedia 默认同时收视频')
  })

  test('发布页不通往 PC后台，也不出现观察记录（第 1、2 条）', () => {
    for (const file of [PUBLISH, 'packages/co-education/pages/moment/publish.wxml']) {
      const src = read(file)
      assert.ok(!src.includes('观察记录'), `${file} 出现了观察记录`)
      assert.ok(!src.includes('/admin/') && !src.includes('pc-backend'), `${file} 通往管理端`)
    }
  })

  test('客户端不调用内容安全接口，只声明把关路径（第 13 条）', () => {
    for (const file of [PUBLISH, 'services/co-education.js']) {
      const src = read(file)
      assert.ok(!src.includes('msgSecCheck'), `${file} 调了 security.msgSecCheck`)
      assert.ok(!src.includes('mediaCheckAsync('), `${file} 调了 security.mediaCheckAsync`)
    }
  })
})

// ── 验收项 3：10 MB 在选完照片的那一刻就拦 ──────────────────────────────────

describe('平台单次 10 MB 硬上限', () => {
  test('超过 10 MB 的照片在选完的那一刻被拒，一个请求也没发，并说出它多大', async () => {
    const c = await signedIn()
    const page = await openPublish(c)
    c.control.picked = { path: 'wxfile://tmp/big.jpg', size: 10 * 1024 * 1024 + 1, name: '大图.jpg' }

    const before = c.record.requests.length
    await page.onPickPhotos()

    assert.equal(c.record.requests.length, before, '连签凭证都不必去问')
    assert.match(page.data.photoNotice, /10 MB/, '说出上限')
    assert.match(page.data.photoNotice, /10\.0 MB/, '也说出这张照片多大')
    assert.deepEqual(page.data.draft.file_id, [], '没有半张照片留在草稿上')
  })

  test('刚好 10 MB 走得通，走的是契约 §8 的三步媒体流', async () => {
    const c = await signedIn()
    const page = await openPublish(c)
    c.control.picked = { path: 'wxfile://tmp/ok.jpg', size: 10 * 1024 * 1024, name: '照片.jpg' }

    await page.onPickPhotos()

    assert.equal(page.data.draft.file_id.length, 1, 'file_id 落到了草稿上')
    const cred = c.record.requests.find((r) => r.url.includes('/media/upload-credentials'))
    const commit = c.record.requests.find((r) => r.url.includes('/media/files'))
    assert.ok(cred && commit, '签凭证与落库各一次')
    assert.equal(cred.data.byte_size, 10 * 1024 * 1024)
    assert.equal(cred.data.usage_key, 'moment_photo')

    // §8.1 铁律：字节不经过 API 实例。
    assert.equal(c.record.uploads.length, 1)
    assert.ok(!c.record.uploads[0].url.includes('/api/v1'), '字节送去了对象存储，不是 API')
  })

  test('教师取消选择不是失败 —— 不说话，也不发请求', async () => {
    const c = await signedIn()
    const page = await openPublish(c)
    c.control.pickCancels = true

    const before = c.record.requests.length
    await page.onPickPhotos()
    c.control.pickCancels = false

    assert.equal(c.record.requests.length, before)
    assert.equal(page.data.photoNotice, '', '取消不是一句要解释的话')
    assert.equal(page.data.errorText, '')
  })

  test('选满九张之后就地说明，不再让教师选第十张', async () => {
    const c = await signedIn()
    const page = await openPublish(c)
    page.setData({ draft: { ...page.data.draft, file_id: [1, 2, 3, 4, 5, 6, 7, 8, 9] } })

    const before = c.record.requests.length
    await page.onPickPhotos()

    assert.equal(c.record.requests.length, before)
    assert.match(page.data.photoNotice, /9 张/)
  })
})

// ── 验收项 5：图文两类内容，两条把关路径都要声明 ────────────────────────────

describe('把关路径的声明', () => {
  test('本页声明两条：文字走人工把关，图片走先发后审', () => {
    const src = read(PUBLISH)
    assert.match(src, /GATES\.HUMAN_PREVIEW_CONFIRM/, '教师写的文字走完整预览＋明确发布')
    assert.match(src, /GATES\.IMAGE_MEDIA_CHECK_ASYNC/, '每一张上传图片走服务端 mediaCheckAsync')
    assert.ok(!src.includes('ADMIN_REVIEW_QUEUE'),
      '这一票不是资源与案例那条管理端审核路径 —— 抄错会让发布当场变成待审')
  })

  test('带了照片却只声明文字那条 -> 图片这一类未声明，请求发不出去', async () => {
    const c = await signedIn()
    const before = c.record.requests.length

    await assert.rejects(
      () => c.coEdu.createMomentDraft({
        gates: [c.moderation.GATES.HUMAN_PREVIEW_CONFIRM],
        draft: { moment_title: '甲', child_id: [101], file_id: [8801] },
        // 文字那条已经满足，所以拒绝只可能来自图片那一类没有声明。
        previewedInFull: true,
        confirmed: true,
        idempotencyKey: c.api.uuid(),
      }),
      (err) => err instanceof c.moderation.ModerationError && /没有声明图片把关路径/.test(err.message),
    )
    assert.equal(c.record.requests.length, before, '没有请求发出')
  })

  test('未声明把关路径 -> 被拒，且本地契约服务没有收到任何请求', async () => {
    const c = await signedIn()
    const before = c.record.requests.length

    for (const gates of [undefined, null, [], 'no_such_gate']) {
      await assert.rejects(
        () => c.coEdu.createMomentDraft({
          gates, draft: { moment_title: '甲', child_id: [101] }, idempotencyKey: c.api.uuid(),
        }),
        (err) => err instanceof c.moderation.ModerationError && /未声明内容安全闸门/.test(err.message),
        `声明为 ${JSON.stringify(gates)} 时必须拒绝`,
      )
    }
    assert.equal(c.record.requests.length, before, '四种未声明的形态都没有走到网络')
  })

  test('触达家长端批次路径 -> 失败，且没有任何请求发出', async () => {
    const c = await signedIn()
    const before = c.record.requests.length
    await assert.rejects(
      () => c.coEdu.createMomentDraft({
        gates: [c.moderation.GATES.WECHAT_API_BATCH],
        draft: { moment_title: '甲' }, idempotencyKey: c.api.uuid(),
      }),
      (err) => err instanceof c.moderation.ModerationError && /家长端路径/.test(err.message),
    )
    assert.equal(c.record.requests.length, before)
  })

  test('未完整预览就发布 -> 被拒，且本地契约服务没有收到任何请求', async () => {
    const c = await signedIn()
    const page = await openPublish(c)
    fill(page)
    page.onPreviewTap()          // 进了预览，但没有读到底

    const before = c.record.requests.length
    const doneBefore = momentPublications().length
    await page.onConfirmTap()

    assert.equal(c.record.requests.length, before, '被拒必须发生在网络出口之前')
    assert.equal(momentPublications().length, doneBefore, '服务端没有执行任何发布')
    assert.match(page.data.errorText, /完整预览/, '告诉教师缺的是哪一步')
    assert.equal(page.data.errorCanRetry, false, '这不是服务故障，没有可重试的东西')
    assert.equal(page.data.locked, false, '被拒之后内容要能改')
  })

  test('教师端没有「审核中」中间态 —— 界面把图片说成待审就是错的', () => {
    const c = loadClient({ baseUrl: mock.baseUrl })
    const { GATES, ModerationError, assertGate, pendingLabel } = c.moderation
    assert.throws(
      () => assertGate(GATES.IMAGE_MEDIA_CHECK_ASYNC, { claimsPending: true }),
      (err) => err instanceof ModerationError && /审核中/.test(err.message),
    )
    assert.equal(pendingLabel(GATES.IMAGE_MEDIA_CHECK_ASYNC), '', '先发后审没有等待文案')
    // 界面上也确实一个「待审」字样都没有。
    // 注释里讲得起「审核中」（头注正是在解释为什么没有这个状态），所以先剥注释。
    for (const file of [PUBLISH, 'packages/co-education/pages/moment/publish.wxml']) {
      const src = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/<!--[\s\S]*?-->/g, '')
      assert.ok(!src.includes('审核中'), `${file} 出现了「审核中」`)
      assert.ok(!src.includes('待审'), `${file} 出现了「待审」`)
    }
  })
})

// ── 验收项 4：完整预览，确认后锁定 ──────────────────────────────────────────

describe('预览就是发布的内容', () => {
  test('预览内容与最终发出的请求体一致，确认发布后内容锁定', async () => {
    const c = await signedIn()
    const page = await openPublish(c)
    readyToConfirm(page, { title: '沙池里的水渠' })

    const previewed = page.data.preview.body
    await page.onConfirmTap()

    const sent = sentTo(c, '/moments').find((r) => r.method === 'POST' && r.data)
    assert.deepEqual(sent.data, previewed, '发出去的就是预览里那一份，逐字段相同')
    assert.equal(page.data.stage, 'done')
    assert.equal(page.data.locked, true, '确认之后内容锁定')

    page.onTextInput({ currentTarget: { dataset: { field: 'moment_title' } }, detail: { value: '锁定之后又改了' } })
    assert.equal(page.data.draft.moment_title, '沙池里的水渠', '锁定之后改不动')
  })

  test('改了草稿，上一次的完整预览就作废', async () => {
    const c = await signedIn()
    const page = await openPublish(c)
    readyToConfirm(page)
    assert.equal(page.data.previewedInFull, true)

    page.onTextInput({ currentTarget: { dataset: { field: 'moment_content' } }, detail: { value: '第二版' } })
    assert.equal(page.data.previewedInFull, false, '内容变了，上一次预览不再是对它的把关')
    assert.equal(page.data.preview, null)
    assert.equal(page.data.stage, 'edit')
  })

  test('发布前置没满足时逐条点名，且一个请求也不发', async () => {
    const c = await signedIn()
    const page = await openPublish(c)
    page.onTextInput({ currentTarget: { dataset: { field: 'moment_title' } }, detail: { value: '只填了名称' } })

    const before = c.record.requests.length
    page.onPreviewTap()

    assert.equal(c.record.requests.length, before, '缺项时根本不发请求')
    assert.deepEqual(page.data.blockers.map((b) => b.key), ['child_id', 'moment_content'],
      '缺的每一项都点名，而不是一句「还不能发布」')
    assert.equal(page.data.stage, 'edit', '也进不去预览')
    assert.equal(page.data.errorText, '', '这不是一次服务故障')
  })
})

// ── 验收项 6：不发送作者字段，发布时间由服务端设置 ──────────────────────────

describe('请求体与服务端设值', () => {
  test('请求体只有契约白名单里的五个键，一个派生作者字段也没有', async () => {
    const c = await signedIn()
    const page = await openPublish(c)
    readyToConfirm(page)
    await page.onConfirmTap()

    const sent = sentTo(c, '/moments').find((r) => r.method === 'POST' && r.data)
    assert.deepEqual(Object.keys(sent.data).sort(),
      ['child_id', 'file_id', 'moment_content', 'moment_date', 'moment_title'],
      'MomentDraftWrite 的五个键，不多不少')
    for (const derived of ['teacher_id', 'created_by', 'school_id', 'class_id',
                           'week_key', 'published_at', 'publish_status']) {
      assert.ok(!(derived in sent.data), `请求体里出现了服务端派生的 ${derived}`)
    }

    // 就算调用方塞进来，客户端也在出口之前剥掉，不依赖服务端的忽略顺序。
    const dirty = c.coEdu.buildMomentBody({
      moment_title: '甲', teacher_id: 999, created_by: 999,
      week_key: '2000-W01', published_at: '2000-01-01T00:00:00+08:00',
    })
    assert.ok(!('teacher_id' in dirty) && !('week_key' in dirty) && !('published_at' in dirty))
  })

  test('发布时间由服务端设置；客户端提交的值被静默忽略，不报错也不生效', async () => {
    const c = await signedIn()
    // 两道各测一半。`published_at` 与 `teacher_id` 由 utils/derived 在**客户端**就剥掉，
    // 所以它们根本没上线；`week_key` 不在客户端的剥离表上，它真的发出去了，由**服务端**
    // 静默忽略。两道都在，先后不重要，缺一才重要（§7.3）。
    const created = await c.api.post('/moments', {
      body: {
        moment_title: '客户端硬塞时间',
        moment_content: '正文在这里，否则发布前置会先拦下来。',
        moment_date: '2026-08-26',
        child_id: [101],
        published_at: '2000-01-01T00:00:00+08:00',
        week_key: '2000-W01',
        teacher_id: 999,
      },
    })
    const sent = c.record.requests.find((r) => r.method === 'POST' && r.url.endsWith('/moments'))
    assert.ok(!('published_at' in sent.data), '客户端在出口之前就剥掉了 published_at')
    assert.ok(!('teacher_id' in sent.data), '也剥掉了 teacher_id')
    assert.equal(sent.data.week_key, '2000-W01', 'week_key 确实发出去了 —— 由服务端忽略')

    assert.equal(created.published_at, null, '草稿还没发布，服务端的值是 null，不是 2000 年')
    assert.equal(created.week_key, '2026-W35', 'week_key 由 moment_date 服务端派生，提交值不生效')
    assert.notEqual(created.teacher_id, 999, '作者由登录上下文决定')

    const published = await c.api.post(`/moments/${created.moment_id}/publication`, {
      idempotencyKey: c.api.uuid(),
    })
    assert.equal(published.published_at, '2026-08-26T17:40:00+08:00', '服务端自己写的发布时间')
  })
})

// ── 验收项 7：幂等 ──────────────────────────────────────────────────────────

describe('携带幂等键，重复点击不产生两条', () => {
  test('重复点击复用同一对键，服务端只发布一次', async () => {
    const c = await signedIn()
    const page = await openPublish(c)
    readyToConfirm(page, { title: '两次点击' })

    const doneBefore = momentPublications().length
    await page.onConfirmTap()
    const keys = page.data.attemptKeys
    assert.ok(keys && keys.create && keys.publish)

    // 第二次点击：`locked` 已经为真，页面自己就挡住了。绕过它直接再发一次，测的是
    // 服务端只做了一次 —— 客户端的锁与服务端的幂等是两道，缺一才要紧。
    const replay = await c.api.post(`/moments/${page.data.momentId}/publication`, {
      idempotencyKey: keys.publish,
    })
    assert.equal(replay.publish_status, 's3')
    assert.equal(replay.published_at, '2026-08-26T17:40:00+08:00', '原始响应体，不是重新算的')
    assert.equal(momentPublications().length - doneBefore, 1, '只产生一则在园时光')

    const posts = sentTo(c, '/moments').filter((r) => r.method === 'POST' && r.data)
    assert.equal(posts[0].header['Idempotency-Key'], keys.create, '建草稿带了键')
  })

  test('同键不同体是 422，不是悄悄替换成第一次的结果', async () => {
    const c = await signedIn()
    const key = c.api.uuid()
    await c.api.post('/moments', { body: { moment_title: '甲' }, idempotencyKey: key })
    await assert.rejects(
      () => c.api.post('/moments', { body: { moment_title: '乙' }, idempotencyKey: key }),
      (err) => err.code === 'idempotency_key_reused' && err.statusCode === 422,
    )
  })
})

// ── 验收项 1：班级与幼儿选择器，单选与多选一套 ──────────────────────────────

describe('班级与幼儿选择器', () => {
  test('多选模式：勾一个进，再勾一次出，并算出已选人数与占比', () => {
    const c = loadClient({ baseUrl: mock.baseUrl })
    const def = loadComponent(c, 'components/hl-child-picker/index.js')
    const children = classRoster().slice(0, 4)

    const { self, emitted } = driveComponent(def, { mode: 'multi', children, value: [] })
    def.observers['children, value'].call(self, children, [])
    assert.equal(self.data.totalCount, 4)
    assert.equal(self.data.pickedCount, 0)
    assert.equal(self.data.pickedRate, 0)
    assert.equal(self.data.allPicked, false)

    self.onRowTap({ currentTarget: { dataset: { childId: children[0].child_id } } })
    assert.deepEqual(emitted[0].detail.childIds, [children[0].child_id])
    assert.deepEqual(emitted[0].detail.children.map((x) => x.child_name), [children[0].child_name],
      '同时给出整行 —— 预览要显示姓名，让页面拿 id 回名册再查一次就是第二份换算')

    // 再勾一次同一个：出。
    self.data.value = [children[0].child_id]
    self.onRowTap({ currentTarget: { dataset: { childId: children[0].child_id } } })
    assert.deepEqual(emitted[1].detail.childIds, [])
  })

  test('多选模式：全选与清空是同一个入口', () => {
    const c = loadClient({ baseUrl: mock.baseUrl })
    const def = loadComponent(c, 'components/hl-child-picker/index.js')
    const children = classRoster().slice(0, 3)
    const { self, emitted } = driveComponent(def, { mode: 'multi', children, value: [], allPicked: false })
    self.onToggleAll()
    assert.deepEqual(emitted[0].detail.childIds, children.map((x) => x.child_id), '全选')

    self.data.allPicked = true
    self.onToggleAll()
    assert.deepEqual(emitted[1].detail.childIds, [], '已经全选时同一个入口做清空')
  })

  test('单选模式复用已定案的滚轮，写入的仍是一个数组 —— 两种模式一种形状', () => {
    const c = loadClient({ baseUrl: mock.baseUrl })
    const def = loadComponent(c, 'components/hl-child-picker/index.js')
    const children = classRoster().slice(0, 3)
    const { self, emitted } = driveComponent(def, { mode: 'single', children, value: [] })
    def.observers['children, value'].call(self, children, [children[1].child_id])
    assert.deepEqual(self.data.pickerOptions[0], { key: String(children[0].child_id), label: children[0].child_name })
    assert.equal(self.data.pickerValue, String(children[1].child_id))

    self.onPick({ detail: { key: String(children[2].child_id) } })
    assert.deepEqual(emitted[0].detail.childIds, [children[2].child_id], '单选也回数组，长度为 1')

    // 单选那一半就是 form-control-spec §2.2 已经判过的滚轮，所以组件 require 它而不是抄。
    const wxml = read('components/hl-child-picker/index.wxml')
    assert.match(wxml, /<hl-picker-row/, '单选走已定案的滚轮组件')
    const json = JSON.parse(read('components/hl-child-picker/index.json'))
    assert.equal(json.usingComponents['hl-picker-row'], '../hl-picker-row/index')
  })

  test('只读时不触发任何事件 —— 假期与内容锁定共用这一个姿态', () => {
    const c = loadClient({ baseUrl: mock.baseUrl })
    const def = loadComponent(c, 'components/hl-child-picker/index.js')
    const { self, emitted } = driveComponent(def, {
      mode: 'multi', children: classRoster().slice(0, 2), value: [], disabled: true,
    })
    self.onRowTap({ currentTarget: { dataset: { childId: 101 } } })
    self.onToggleAll()
    self.onPick({ detail: { key: '101' } })
    assert.equal(emitted.length, 0)
  })

  test('班级是一行说明，不是一个选择位 —— class_id 是 derived', () => {
    const wxml = read('components/hl-child-picker/index.wxml')
    assert.match(wxml, /班级由登录身份决定，不可更改/)
    // 头注里讲得起 class_id（它正是在解释为什么班级不可选），所以先剥注释再扫代码。
    const code = read('components/hl-child-picker/index.js')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.ok(!code.includes('class_id'), '组件不碰 class_id，它由服务端按登录上下文设值')
  })

  test('两张票用的是同一个组件 —— 形态在票据 17 定死，票据 19 照抄', () => {
    const momentJson = JSON.parse(read('packages/co-education/pages/moment/publish.json'))
    const taskJson = JSON.parse(read('packages/co-education/pages/task/publish.json'))
    assert.equal(momentJson.usingComponents['hl-child-picker'], '/components/hl-child-picker/index')
    assert.equal(taskJson.usingComponents['hl-child-picker'], '/components/hl-child-picker/index')
  })
})

// ── 发布进度汇总：整取不分页、两态颜色点、点一格进表单 ──────────────────────

describe('在园时光发布进度汇总', () => {
  async function openProgress(c) {
    const page = loadPage(c, PROGRESS)
    // onLoad 自己就读一次并把 promise 交回来，所以这里不再补一次 load()。
    await page.onLoad()
    // 平台顺序：onLoad 之后紧接着一次 onShow。它被跳过，不重复读 —— 照真实顺序驱动，
    // 后面那一条「返回后重读」才测得到第二次 onShow。
    await page.onShow()
    return page
  }

  test('周覆盖整取不分页 —— 请求里没有 limit，也没有 cursor', async () => {
    const c = await signedIn()
    await openProgress(c)

    const reads = sentTo(c, '/moments/weekly-coverage')
    assert.ok(reads.length > 1, '一段时间要按周各读一次（契约的端点一次只回一周）')
    for (const r of reads) {
      assert.ok(!r.url.includes('limit='), `名册型请求带了 limit：${r.url}`)
      assert.ok(!r.url.includes('cursor='), `名册型请求带了 cursor：${r.url}`)
      assert.ok(!r.url.includes('offset=') && !r.url.includes('page='),
        '契约里没有页号，也没有偏移量（DO-NOT-BUILD 11）')
    }
    // 名册也一样整取。
    const roster = sentTo(c, '/org/class-roster')
    assert.equal(roster.length, 1)
    assert.ok(!roster[0].url.includes('limit='))
  })

  test('全班每一名幼儿都有一行，行序按幼儿标识升序', async () => {
    const c = await signedIn()
    const page = await openProgress(c)
    const roster = classRoster()

    assert.equal(page.data.rows.length, roster.length, `全班 ${roster.length} 名，一个不少`)
    assert.deepEqual(page.data.rows.map((r) => r.key), roster.map((c2) => String(c2.child_id)),
      '行序按 child_id 升序，服务端定，客户端不重排')
    assert.deepEqual(page.data.rows.map((r) => r.name), roster.map((c2) => c2.child_name))
  })

  test('每个颜色点带可读的状态说明，供无障碍朗读', async () => {
    const c = await signedIn()
    const page = await openProgress(c)

    for (const row of page.data.rows) {
      for (const cell of row.cells) {
        assert.ok(cell.hint && cell.hint.length > 0, '每一格都有朗读文本')
        assert.match(cell.hint, /已发布 \d+ 次/, '说出次数')
        assert.match(cell.hint, /(已达到|未达到)参考频率/, '也说出达没达到')
        assert.equal(typeof cell.done, 'boolean', '两态，不是三态')
      }
    }

    // 组件把它绑到 aria-label 上 —— 一个颜色点对读屏软件本来是空的。
    const wxml = read('components/hl-progress-grid/index.wxml')
    assert.match(wxml, /aria-label="\{\{cell\.hint\}\}"/)
  })

  test('两态颜色点，不是三态文字', () => {
    const wxml = read('components/hl-progress-grid/index.wxml')
    assert.match(wxml, /hl-grid__dot--done/)
    assert.match(wxml, /hl-grid__dot--todo/)
    const wxss = read('components/hl-progress-grid/index.wxss')
    assert.equal((wxss.match(/\.hl-grid__dot--/g) || []).length, 2, '只有两态')
    // 格子里没有文字：`已上传`／`待确认`／`未上传` 那种三态文案是原型的写法，不是本次的。
    assert.ok(!wxml.includes('已上传') && !wxml.includes('待确认') && !wxml.includes('未上传'))
  })

  test('姓名列在 scroll-view 之外 —— 横向滚动时它不动', () => {
    const wxml = read('components/hl-progress-grid/index.wxml')
    const scrollAt = wxml.indexOf('<scroll-view')
    const namesAt = wxml.indexOf('hl-grid__names')
    assert.ok(namesAt !== -1 && scrollAt !== -1)
    assert.ok(namesAt < scrollAt, '姓名列是 scroll-view 的兄弟节点，不是它的子节点')
    assert.match(wxml, /<scroll-view[^>]*scroll-x/, '横向滚动的是右边那半')
    // sticky 在两套渲染器上的表现不一致，所以这里靠的是结构，不是一条盼它别动的样式。
    assert.ok(!read('components/hl-progress-grid/index.wxss').includes('sticky'))
  })

  test('列多到一屏放不下，所以横向滚动是真的会发生的事', async () => {
    const c = await signedIn()
    const page = await openProgress(c)
    assert.ok(page.data.columns.length >= 5,
      `这一段有 ${page.data.columns.length} 列；少于 5 列就测不到横向滚动`)
    assert.deepEqual(page.data.columns.map((col) => col.key).slice(0, 2), ['2026-W30', '2026-W31'])
  })

  test('显示本班这段时间的发布情况与参考频率的差距', async () => {
    const c = await signedIn()
    const page = await openProgress(c)
    assert.match(page.data.summary, /周 × \d+ 名幼儿/)
    assert.match(page.data.gapText, /还差 \d+ 格没达到参考频率（每周 2 次）/)
    assert.equal(page.data.target, 2, '参考频率来自契约的计数口径，不是本页挑的阈值')
  })

  test('点一格进发布表单，带上幼儿与周期', async () => {
    const c = await signedIn()
    const page = await openProgress(c)

    page.onCellTap({ detail: { rowKey: '105', colKey: '2026-W33' } })
    const nav = c.record.navigations.pop()
    assert.equal(nav.api, 'navigateTo')
    assert.match(nav.url, /\/packages\/co-education\/pages\/moment\/publish\?/)
    assert.ok(nav.url.includes('week_key=2026-W33'), '带上周期')
    assert.ok(nav.url.includes('child_id=105'), '带上幼儿')
  })

  test('返回后那一格的状态已经更新 —— onShow 重读，教师不必下拉', async () => {
    const c = await signedIn()
    const page = await openProgress(c)
    const week = page.data.columns[page.data.columns.length - 1].key
    const cellOf = (p) => p.data.rows.find((r) => r.key === '128')
      .cells.find((cell) => cell.key === week)

    assert.equal(cellOf(page).done, false, '128 号是新转入的幼儿，本周一次也没有')

    // 教师去发了两则覆盖他的在园时光（参考频率是每周两次）。
    for (const title of ['补一则甲', '补一则乙']) {
      const created = await c.api.post('/moments', {
        body: { moment_title: title, moment_content: '正文', moment_date: '2026-08-26', child_id: [128] },
        idempotencyKey: c.api.uuid(),
      })
      await c.api.post(`/moments/${created.moment_id}/publication`, { idempotencyKey: c.api.uuid() })
    }

    await page.onShow()
    assert.equal(cellOf(page).done, true, '返回后那一格已经更新')
  })

  test('首次 onShow 不重复发一次请求', async () => {
    const c = await signedIn()
    const page = loadPage(c, PROGRESS)
    await page.onLoad()

    const before = c.record.requests.length
    // 平台顺序：onLoad 先于 onShow。
    await page.onShow()
    assert.equal(c.record.requests.length, before, 'onLoad 已经读过了')
  })

  test('撤回的那一则退出周覆盖计数 —— 计数只统计已发布', async () => {
    const c = await signedIn()
    const created = await c.api.post('/moments', {
      body: { moment_title: '会被撤回的一则', moment_content: '正文', moment_date: '2026-08-26', child_id: [127] },
      idempotencyKey: c.api.uuid(),
    })
    await c.api.post(`/moments/${created.moment_id}/publication`, { idempotencyKey: c.api.uuid() })
    const after = await c.coEdu.momentWeeklyCoverage('2026-W35')
    const before = after.items.find((r) => r.child_id === 127).count

    await c.coEdu.withdrawMoment(created.moment_id, { idempotencyKey: c.api.uuid() })
    const withdrawn = await c.coEdu.momentWeeklyCoverage('2026-W35')
    assert.equal(withdrawn.items.find((r) => r.child_id === 127).count, before - 1,
      '撤回退出聚合是派生的，不是一次写入')

    // 恢复重新纳入。
    await c.coEdu.restoreMoment(created.moment_id, { idempotencyKey: c.api.uuid() })
    const restored = await c.coEdu.momentWeeklyCoverage('2026-W35')
    assert.equal(restored.items.find((r) => r.child_id === 127).count, before)
  })

  test('教师不得推翻管理端下架的那一笔', async () => {
    const c = await signedIn()
    const page = await c.coEdu.listMoments({ publish_status: 's5' })
    const byAdmin = page.items.find((m) => m.withdrawn_by_admin)
    assert.ok(byAdmin, '夹具里有一则是管理端下架的')
    assert.equal(byAdmin.can_restore, false, '界面上不给它恢复入口')

    await assert.rejects(
      () => c.coEdu.restoreMoment(byAdmin.moment_id, { idempotencyKey: c.api.uuid() }),
      (err) => err.code === 'state_precondition_failed' && err.statusCode === 409,
      '客户端不给入口不是边界，服务端独立拒绝',
    )
  })
})

// ── 验收项 8：没有进行中的学期时是只读状态，不是错误弹窗 ────────────────────
//
// LAST in this file: it flips the server's term off and back on again.

describe('没有进行中的学期时', () => {
  test('发布页是只读说明，不是一句错误，也没有弹窗', async () => {
    setNoTerm(true)
    try {
      const c = await signedIn()
      const page = await openPublish(c)

      assert.equal(page.data.readonly, true, '写入区换成理由')
      assert.match(page.data.readonlyReason, /假期/)
      assert.equal(page.data.errorText, '', '假期是季节，不是故障')
      assert.equal(page.data.errorCanRetry, false)
      assert.equal(c.record.toasts.length, 0, '不是弹窗 —— 是页面上的一行说明')

      // 点下去也什么都不发 —— 客户端预先禁用。
      const before = c.record.requests.length
      page.onPreviewTap()
      await page.onConfirmTap()
      await page.onPickPhotos()
      assert.equal(c.record.requests.length, before)
      assert.equal(page.data.stage, 'edit', '预览也进不去')

      // §6.4：客户端预先禁用不是边界，服务端独立拒绝同一件事。
      await assert.rejects(
        () => c.api.post('/moments', { body: { moment_title: '甲' } }),
        (err) => err.code === 'no_active_term' && err.statusCode === 409,
      )
    } finally {
      setNoTerm(false)
    }
  })
})
