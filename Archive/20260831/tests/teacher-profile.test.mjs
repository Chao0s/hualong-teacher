/**
 * 教师个人档案与我的研修（2026-08-27 补建）。
 *
 * 两页此前整页没有。个人档案建不出来的原因不是漏了，是**契约里连读都没有** —— 缺口 G45
 * 记着「教师直接改」与「教师提申请」两套契约互斥，未拍板前 API 契约只枚举管理端的审核侧。
 * 园方 2026-08-27 拍板走申请制，契约补齐三条，这一页才有落点。
 *
 * 所以这一套盯的第一件事是那条分界：**教师读得到 canonical，写不了 canonical**。
 * 「编辑」提交的是一份 `db_teacher_profile_change`，不是档案本身。
 */

import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { start, resetProfileChanges } from '../mock/server.mjs'
import { loadClient, loadPage } from './helpers/seam.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MP = path.resolve(HERE, '..', 'miniprogram')
const read = (rel) => fs.readFileSync(path.join(MP, rel), 'utf8')

const PROFILE = 'packages/profile/pages/mine/index'
const MINE = 'packages/training/pages/mine/list'

let mock

before(async () => { mock = await start({ port: 0 }) })
after(async () => { await mock.close() })

async function signedIn() {
  // 「同时最多一份 s2」是服务端的前置，所以每条用例开场先把申请清空 ——
  // 否则前一条留下的那一份会挡住后一条，两条都是对的却一起变红。
  resetProfileChanges()
  const c = loadClient({ baseUrl: mock.baseUrl })
  await c.auth.signIn()
  return c
}

/**
 * 打开档案页。`onLoad` 自己会读一次但不返回 promise，所以这里再 `await` 一次读
 * —— 于是记录里有两条。要数请求条数的用例先清一次记录，见下面第一条。
 */
async function openProfile(c) {
  const page = loadPage(c, `${PROFILE}.js`)
  page.onLoad()
  await page.load()
  return page
}

/** 填一份最小可提交的草稿：改岗位，加一份带原件的证书。 */
function fillDraft(page) {
  page.onChipTap({ currentTarget: { dataset: { field: 'job_role', key: 'j4' } } })
  page.onAddCredential()
  page.onCredentialInput({ currentTarget: { dataset: { index: 0, field: 'credential_name' } }, detail: { value: '幼儿园教师资格证' } })
  page.onCredentialChipTap({ currentTarget: { dataset: { index: 0, field: 'credential_level', key: 'l2' } } })
  // 原件已经传好了：真流程走 onPickFile，这里直接给 file_id，测的是提交那一段。
  page.onCredentialChipTap({ currentTarget: { dataset: { index: 0, field: 'file_id', key: 9901 } } })
  return page
}

// ── 读：档案是本人的，姓名与班级来自会话 ─────────────────────────────────────

describe('档案读得到，且只读得到本人的', () => {
  test('端点不收任何指别人的参数 —— teacher_id 是 derived', async () => {
    const c = await signedIn()
    const page = await openProfile(c)

    c.record.requests.length = 0
    await page.load()
    const sent = c.record.requests.filter((r) => /\/teacher-profile(\?|$)/.test(r.url))
    assert.equal(sent.length, 1, '一次读取只发一个请求')
    assert.equal(sent[0].url.includes('teacher_id'), false, '没有参数可以指别人')
  })

  test('姓名与任教班级来自会话，不来自这个端点', async () => {
    const c = await signedIn()
    const page = await openProfile(c)

    assert.ok(page.data.profile.teacher_name, '姓名显示出来了')
    assert.ok(page.data.profile.class_label, '班级显示出来了')
    // 端点自己不回这两样：它们是名册权威持有的身份字段（§6.4 scope 只作显示用）。
    const raw = await c.api.get('/teacher-profile')
    assert.equal(raw.teacher_name, undefined)
    assert.equal(raw.class_id, undefined)
  })

  test('枚举翻成中文，原值不出现在界面上', async () => {
    const c = await signedIn()
    const page = await openProfile(c)

    assert.equal(page.data.profile.job_role_label, '主班')
    assert.equal(page.data.profile.education_label, '本科')
    for (const one of page.data.profile.certificates) {
      assert.ok(!/^(c1|c2|c3)$/.test(one.type_label), `界面上出现了枚举原值：${one.type_label}`)
    }
  })

  test('证书按原型分成两节：资格证书与专业奖项', async () => {
    const c = await signedIn()
    const page = await openProfile(c)

    // c1／c2 归资格证书，c3 归专业奖项。
    assert.ok(page.data.profile.certificates.length > 0)
    assert.ok(page.data.profile.awards.length > 0)
    for (const one of page.data.profile.awards) {
      assert.equal(one.credential_type, 'c3')
    }
  })

  test('教龄与在园年数取不到就不画那两行', async () => {
    const c = await signedIn()
    const page = await openProfile(c)

    // 契约把 first_taught_at／joined_school_at 标了 x-hualong-blocked-on: G45 ——
    // 原型的「教龄 8 年」「在园 5 年」在任何一张表里都没有列。
    assert.equal(page.data.profile.first_taught_label, '')
    assert.equal(page.data.profile.joined_school_label, '')

    const wxml = read(`${PROFILE}.wxml`)
    assert.match(wxml, /wx:if="\{\{profile\.first_taught_label\}\}"/, '空就不画，不摆一个「—」冒充')
  })
})

// ── 写：教师提的是申请，不是档案 ─────────────────────────────────────────────

describe('教师改的是一份申请，不是档案本身', () => {
  test('提交打的是 changes，不是档案本身', async () => {
    const c = await signedIn()
    const page = await openProfile(c)

    page.onEditTap()
    fillDraft(page)
    page.onPreviewTap()
    page.onPreviewEnd()
    await page.onConfirmTap()

    // 登录本身也是一次 POST，所以只数打到档案上的那些。
    const writes = c.record.requests.filter((r) => r.url.includes('/teacher-profile'))
      .filter((r) => r.method !== 'GET')
    assert.equal(writes.length, 1, '只发了一次写')
    assert.match(writes[0].url, /\/teacher-profile\/changes$/, '打的是申请，不是档案')
    assert.equal(page.data.editing, false, '提交后弹层关上')
  })

  test('请求体只有契约白名单里的键，一个派生字段也没有', async () => {
    const c = await signedIn()
    const page = await openProfile(c)
    page.onEditTap()
    fillDraft(page)
    page.onPreviewTap()
    page.onPreviewEnd()
    await page.onConfirmTap()

    const body = c.record.requests.filter((r) => r.url.includes('/changes')).pop().data
    assert.deepEqual(Object.keys(body), ['change_payload'])
    for (const derived of ['school_id', 'teacher_id', 'teacher_profile_id', 'submitted_at']) {
      assert.equal(derived in body, false, `派生字段 ${derived} 不该被送出去`)
      assert.equal(derived in body.change_payload, false, `派生字段 ${derived} 不该被送出去`)
    }
    // 只给界面看的字段（key／type_label／is_image）一个也不进请求体。
    for (const one of body.change_payload.credentials || []) {
      assert.deepEqual(Object.keys(one).sort(),
        ['credential_level', 'credential_name', 'credential_type', 'file_id'])
    }
  })

  test('没读完预览就点不动「提交审核」 —— ADR-0016 的完整预览', async () => {
    const c = await signedIn()
    const page = await openProfile(c)
    page.onEditTap()
    fillDraft(page)
    page.onPreviewTap()

    const before = c.record.requests.length
    await page.onConfirmTap()
    assert.equal(c.record.requests.length, before, '没读到底，一个请求也不发')

    page.onPreviewEnd()
    await page.onConfirmTap()
    assert.equal(c.record.requests.length > before, true, '读完了才发得出去')
  })

  test('预览之后改了字，预览作废，必须重看一遍', async () => {
    const c = await signedIn()
    const page = await openProfile(c)
    page.onEditTap()
    fillDraft(page)
    page.onPreviewTap()
    page.onPreviewEnd()
    assert.equal(page.data.previewedInFull, true)

    page.onChipTap({ currentTarget: { dataset: { field: 'education_level', key: 'e4' } } })
    assert.equal(page.data.previewedInFull, false, '改了字，上一次的预览就不算数')
  })

  test('上一份还在审时不让再提 —— 服务端 409，页面先拦', async () => {
    const c = await signedIn()
    const page = await openProfile(c)
    page.onEditTap()
    fillDraft(page)
    page.onPreviewTap()
    page.onPreviewEnd()
    await page.onConfirmTap()

    // 重读之后页面知道有一份待审的了。
    assert.match(page.data.profile.pending_label, /待审核/)

    const before = c.record.requests.length
    page.onEditTap()
    assert.equal(c.record.requests.length, before, '页面就地拦，不白跑一次 409')
    assert.equal(page.data.editing, false)
    assert.match(page.data.notice, /还在审核中/)

    // §6.4：客户端预先拦截不是边界，服务端独立拒绝同一件事。
    await assert.rejects(
      () => c.api.post('/teacher-profile/changes', { body: { change_payload: { job_role: 'j2' } } }),
      (err) => err.code === 'state_precondition_failed' && err.statusCode === 409,
    )
  })

  test('契约白名单之外的键被服务端 422 挡下', async () => {
    const c = await signedIn()
    await assert.rejects(
      () => c.api.post('/teacher-profile/changes', {
        body: { change_payload: { job_role: 'j2', teacher_name: '改个名字' } },
      }),
      (err) => err.code === 'validation_failed' && err.statusCode === 422,
      '姓名不在 change_payload 的白名单里',
    )
  })
})

// ── 版面：逐格对着 screens/teacher-profile.html ──────────────────────────────

describe('版面照原型', () => {
  test('两节两张卡，编辑是弹层不是另一个页面', () => {
    const wxml = read(`${PROFILE}.wxml`)
    assert.match(wxml, /基本履历/)
    assert.match(wxml, /资质与荣誉/)
    assert.match(wxml, /资格证书/)
    assert.match(wxml, /专业奖项/)
    assert.match(wxml, /class="sheet"/, '编辑是同页弹层')
    assert.match(wxml, /提交个人档案修改/, '弹层标题照原型')
  })

  test('姓名与任教班级在弹层里是只读回显，不是控件', () => {
    const wxml = read(`${PROFILE}.wxml`)
    const panel = wxml.slice(wxml.indexOf('class="panel"'))
    // 原型自己的注释写着理由：留着这两个控件等于让教师给自己改授权边界。
    assert.match(panel, /class="readback"/, '两格是只读回显')
    assert.equal((panel.match(/data-field="teacher_name"/g) || []).length, 0)
    assert.equal((panel.match(/data-field="class_id"/g) || []).length, 0)
    assert.match(panel, /姓名与任教班级由园方名册维护/, '并且说清楚该找谁改')
  })

  test('学历证书那一行不画等级类别 —— 学历层级的落点是「最高学历」（G37）', () => {
    const wxml = read(`${PROFILE}.wxml`)
    assert.match(wxml, /wx:if="\{\{item\.credential_type !== 'c1'\}\}"/)
  })

  test('这一页不通往 PC后台，也不出现观察记录', () => {
    for (const ext of ['.js', '.wxml']) {
      const src = read(PROFILE + ext)
      assert.ok(!src.includes('观察记录'), `${ext}: DO-NOT-BUILD 1`)
      assert.ok(!src.includes('PC后台'), `${ext}: DO-NOT-BUILD 2`)
      assert.ok(!src.includes('/admin/'), `${ext}: DO-NOT-BUILD 2`)
    }
  })
})

// ── 我的研修 ─────────────────────────────────────────────────────────────────

describe('我的研修', () => {
  test('只读本人 participation，一次请求就够 —— 不是第二份活动表', async () => {
    const c = await signedIn()
    const page = loadPage(c, `${MINE}.js`)
    page.onLoad()
    await page.loadFirst()
    assert.ok(page.data.items.length > 0, '读到了报名记录')

    // 一页记录只发一个请求：契约把整张活动卡内嵌在 participation 里，
    // 不必再逐条去读研修（§4 规则 21：它是活动列表的子集，不是第二份活动表）。
    c.record.requests.length = 0
    await page.loadFirst()
    const reads = c.record.requests.filter((r) => r.url.includes('/training'))
    assert.equal(reads.length, 1, '内嵌了整张活动卡，不再逐条去读研修')
    assert.match(reads[0].url, /\/training-participations/)

    for (const row of page.data.items) {
      assert.ok(row.training_title, '标题来自内嵌的活动卡')
      assert.ok(row.participation_label, '参与状态翻成了中文')
      assert.ok(!/^(s1|s2|s3)$/.test(row.participation_label), '界面上不出现枚举原值')
    }
  })

  test('已撤回的研修留在记录里，但点不进去', async () => {
    const c = await signedIn()
    const page = loadPage(c, `${MINE}.js`)
    page.onLoad()
    await page.loadFirst()

    const before = c.record.navigations.length
    page.onTap({ currentTarget: { dataset: { id: 20, withdrawn: true } } })
    assert.equal(c.record.navigations.length, before, '撤回的那一条不跳转')

    page.onTap({ currentTarget: { dataset: { id: 44, withdrawn: false } } })
    assert.match(c.record.navigations.pop().url, /\/packages\/training\/pages\/train\/detail\?training_id=44/)
  })

  test('研修列表顶部有原型那两张入口卡，各指各的页面', async () => {
    const c = await signedIn()
    const page = loadPage(c, 'packages/training/pages/train/list.js')
    page.onLoad({})

    page.onProfileTap()
    assert.equal(c.record.navigations.pop().url, `/${PROFILE}`)

    page.onMineTap()
    assert.equal(c.record.navigations.pop().url, `/${MINE}`)
  })
})
