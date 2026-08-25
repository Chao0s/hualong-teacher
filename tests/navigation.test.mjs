/**
 * 底部导航与四个模块入口页 (ticket 09).
 *
 * The bar itself is declarative and the icons are artwork, so neither can be
 * asserted here — those are the compile-and-device checks the ticket names.
 * What IS testable is everything a wrong edit would break silently: the five
 * pairs actually exist on disk and are wired to real routes, the tab ceiling is
 * respected, tab destinations use switchTab rather than the API that fails
 * quietly on them, and no page names an icon path.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { start } from '../mock/server.mjs'
import { loadClient, loadPage, loadComponent } from './helpers/seam.mjs'

const MP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'miniprogram')
const read = (rel) => fs.readFileSync(path.join(MP, rel), 'utf8')
const appJson = JSON.parse(read('app.json'))

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

const ENTRY_PAGES = [
  ['pages/party-building/index', '党建管理'],
  ['pages/coordination/index', '综合协调'],
  ['pages/training/index', '教研培训'],
  ['pages/co-education/index', '家园社共育'],
]

// ── The bar ──────────────────────────────────────────────────────────────────

test('the bar is exactly five items, in the agreed order, with the canonical names', () => {
  const list = appJson.tabBar.list
  assert.equal(list.length, 5, '平台上限即五；第六个模块入口走首页常用入口（DO-NOT-BUILD 14）')
  assert.deepEqual(
    list.map((t) => t.text),
    ['首页', '党建管理', '综合协调', '教研培训', '家园社共育'],
  )
  // The prototypes label the last tab with a variant the glossary forbids.
  const raw = read('app.json')
  assert.ok(!raw.includes('家园共育"'), '旧称不得回流')
})

test('every tab icon pair exists on disk and every tab page is registered', () => {
  for (const tab of appJson.tabBar.list) {
    for (const key of ['iconPath', 'selectedIconPath']) {
      const file = path.join(MP, tab[key])
      assert.ok(fs.existsSync(file), `${tab.text} 的 ${key} 指向不存在的文件：${tab[key]}`)
      assert.ok(fs.statSync(file).size > 0, `${tab[key]} 是空文件`)
    }
    assert.ok(
      appJson.pages.includes(tab.pagePath),
      `${tab.pagePath} 未登记在 pages 里，编译会失败`,
    )
  }
})

test('every registered page has all three of its files', () => {
  // A route in app.json whose .js/.json/.wxml is missing is a compile failure,
  // and nothing else in the suite would notice — the seam only loads the pages
  // a test names. This checks the manifest against the disk.
  for (const route of appJson.pages) {
    for (const ext of ['.js', '.json', '.wxml']) {
      const file = path.join(MP, route + ext)
      assert.ok(fs.existsSync(file), `${route} 缺 ${ext}，编译会失败`)
    }
  }
  assert.ok(appJson.pages.length >= 10, `登记的页面太少（${appJson.pages.length}）`)
})

test('tabBar pages sit in the main package', () => {
  // 官方分包规则：tabBar 页面必须位于主包内。分包自票据 12 起存在，所以这条不再
  // 断言「没有分包」，而是逐个核对每个 tab 页都不在任何分包的 root 底下。
  const roots = (appJson.subPackages || []).map((s) => s.root.replace(/\/$/, ''))
  assert.ok(roots.length > 0, '分包已在票据 12 引入；这条断言失效说明分包声明被删了')
  for (const tab of appJson.tabBar.list) {
    for (const root of roots) {
      assert.ok(
        !tab.pagePath.startsWith(`${root}/`),
        `${tab.pagePath} 落在分包 ${root} 里 —— tabBar 页面必须在主包`,
      )
    }
    assert.ok(appJson.pages.includes(tab.pagePath), `${tab.pagePath} 不在主包 pages 里`)
  }
})

// ── The four entry pages ─────────────────────────────────────────────────────

test('each entry page renders its module sections and names its own module', async () => {
  const c = await signedIn()
  for (const [route, zh] of ENTRY_PAGES) {
    const page = loadPage(c, `${route}.js`)
    page.onLoad()
    assert.ok(page.data.ready, `${zh} 未通过会话门`)
    assert.ok(page.data.sections.length > 0, `${zh} 没有分区入口`)
    for (const group of page.data.sections) {
      assert.ok(group.title, `${zh} 有一个无标题分组`)
      assert.ok(group.entries.length > 0, `${zh} 的「${group.title}」是空分组`)
      for (const entry of group.entries) {
        assert.ok(entry.badge && entry.label, `${zh} 有一条不完整的入口`)
      }
    }
    assert.equal(JSON.parse(read(`${route}.json`)).navigationBarTitleText, zh)
  }
})

test('an entry whose screen is not built yet is refused by name, not in silence', async () => {
  const c = await signedIn()
  // 党建管理三条自票据 12 起全部落地，都会真的跳转，所以这条改用综合协调仍未落地的
  // 「行政资料」。落地它的票据同样要把这条挪到下一个仍未落地的入口，不要删。
  const page = loadPage(c, 'pages/coordination/index.js')
  page.onLoad()

  const pending = page.data.sections[0].entries.find((e) => e.key === 'xz')
  page.onEntryTap({ detail: { key: pending.key } })

  assert.equal(c.record.navigations.length, 0, '没有跳转')
  assert.match(c.record.toasts.pop().title, new RegExp(`${pending.label}尚未上线`), '说出了是哪一条')
})

test('the parent-only screens the prototype offered are absent', () => {
  const src = read('services/module-entry.js')
  // home-school.html 的快捷入口有「社区共育」，指向 community-coeducation.html，
  // 那是家长端页面；成长档案在结构契约里没有页面。两者都不得进教师端入口页。
  const entryLabels = src.split('\n').filter((l) => l.includes("label: '"))
  for (const line of entryLabels) {
    assert.ok(!line.includes('社区共育'), '社区共育 是家长端页面，不属于教师端 45 页')
    assert.ok(!line.includes('成长档案'), '成长档案 在结构契约里没有对应页面')
  }
})

// ── Navigation uses the right API ────────────────────────────────────────────

test('a tab destination uses switchTab; wx.navigateTo would fail silently on it', async () => {
  const c = await signedIn()
  const page = loadPage(c, 'pages/home/index.js')
  page.hydrateFromSession()

  page.onQuickTap({ currentTarget: { dataset: { key: 'training' } } })
  assert.deepEqual(c.record.navigations.pop(), { api: 'switchTab', url: '/pages/training/index' })

  // A non-tab destination keeps the ordinary API.
  c.guard.navigateTo('/pages/notice/list', 'home')
  assert.deepEqual(c.record.navigations.pop(), { api: 'navigateTo', url: '/pages/notice/list' })
})

test('every route in guard.TAB_PAGES is a real registered tab', () => {
  const declared = appJson.tabBar.list.map((t) => `/${t.pagePath}`).sort()
  const c = loadClient({})
  assert.deepEqual([...c.guard.TAB_PAGES].sort(), declared, 'guard 与 app.json 必须说同一件事')
})

// ── Icons are referenced by name, never by path ──────────────────────────────

test('no page or component writes an icon path; hl-icon is the only place', () => {
  const files = [
    'pages/home/index.wxml', 'pages/home/index.js',
    'components/hl-entry-sections/index.wxml',
    ...ENTRY_PAGES.flatMap(([route]) => [`${route}.wxml`, `${route}.js`]),
  ]
  for (const file of files) {
    const src = read(file)
    assert.ok(!src.includes('assets/icons'), `${file} 写了资源位置，应只写图标名与颜色`)
    assert.ok(!src.includes('.png'), `${file} 直接引用了图片文件`)
    // 实现决定 12: the prototype's parent-inherited tint does not survive here.
    assert.ok(!src.includes('currentColor'), `${file} 残留了 currentColor 换色机制`)
  }
  assert.ok(read('components/hl-icon/index.js').includes('/assets/icons'), 'hl-icon 才是唯一知道位置的地方')
})

test('hl-icon rejects a colour that has no file, instead of rendering blank', () => {
  const c = loadClient({})
  const icon = loadComponent(c, 'components/hl-icon/index.js')
  assert.ok(icon.properties.color, 'colour is a property, so a re-tint is not a markup change')
  const observer = icon.observers['name, color']
  const fakeComponent = { data: {}, setData(p) { Object.assign(this.data, p) } }

  observer.call(fakeComponent, 'icon-17', 'green')
  assert.equal(fakeComponent.data.src, '/assets/icons/icon-17-green@3x.png')

  assert.throws(
    () => observer.call(fakeComponent, 'icon-17', 'chartreuse'),
    /未知颜色/,
    '一个不存在的配色必须当场失败，而不是渲染成空白',
  )
})

test('every icon the client references actually exists on disk', () => {
  const referenced = new Set()
  const scan = (src) => {
    for (const m of src.matchAll(/name="(icon-\d+)"\s+color="(\w+)"/g)) referenced.add(`${m[1]}-${m[2]}`)
  }
  scan(read('components/hl-entry-sections/index.wxml'))
  scan(read('pages/home/index.wxml'))
  // The quick entries carry their icon in the service, not the markup.
  for (const m of read('services/home.js').matchAll(/icon: '(icon-\d+)', color: '(\w+)'/g)) {
    referenced.add(`${m[1]}-${m[2]}`)
  }

  assert.ok(referenced.size >= 5, `扫到的图标太少（${referenced.size}），正则大概失效了`)
  for (const ref of referenced) {
    const file = path.join(MP, 'assets/icons', `${ref}@3x.png`)
    assert.ok(fs.existsSync(file), `引用了不存在的图标：${ref}@3x.png`)
  }
})

test('both densities ship for every referenced icon', () => {
  // The component serves @3x; @2x must still exist for the designer's device
  // check and for the day density selection is added.
  for (const density of ['@2x', '@3x']) {
    const file = path.join(MP, 'assets/icons', `icon-17-green${density}.png`)
    assert.ok(fs.existsSync(file), `缺 ${density} 档`)
  }
})

// ── WXML is not just text ────────────────────────────────────────────────────

test('every WXML binding is well formed', () => {
  // Born from a real defect: the four entry pages were generated by a script
  // whose template escaped braces for Python's format(), and format() was never
  // called — so `{{{{ready}}}}` shipped and every one of those pages failed to
  // compile. The suite did not notice, because it only ever asked whether
  // certain substrings were ABSENT from the markup. This asks whether the
  // markup is valid.
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    return e.isDirectory() ? walk(full) : (e.name.endsWith('.wxml') ? [full] : [])
  })

  const files = walk(MP)
  assert.ok(files.length >= 8, `扫到的 WXML 太少（${files.length}），遍历大概写错了`)

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    const rel = path.relative(MP, file)

    assert.ok(!src.includes('{{{'), `${rel}: 出现 {{{，多半是模板转义没展开`)
    assert.ok(!src.includes('}}}'), `${rel}: 出现 }}}`)

    const opens = (src.match(/\{\{/g) || []).length
    const closes = (src.match(/\}\}/g) || []).length
    assert.equal(opens, closes, `${rel}: {{ 与 }} 数量不等（${opens} / ${closes}）`)

    for (const m of src.matchAll(/\{\{(.*?)\}\}/gs)) {
      assert.ok(m[1].trim().length > 0, `${rel}: 出现空绑定 {{}}`)
      assert.ok(!m[1].includes('{'), `${rel}: 绑定里还有 {，未闭合：${m[0].slice(0, 40)}`)
    }
  }
})

// ── Structure: what must not be here ─────────────────────────────────────────

test('no entry page carries 观察记录 or a path to the PC后台', () => {
  const files = [
    'services/module-entry.js',
    ...ENTRY_PAGES.flatMap(([route]) => [`${route}.js`, `${route}.wxml`]),
  ]
  for (const file of files) {
    const src = read(file)
    assert.ok(!src.includes('观察记录'), `${file}: DO-NOT-BUILD 1`)
    assert.ok(!src.includes('pc-backend') && !src.includes('/admin/'), `${file}: DO-NOT-BUILD 2`)
  }
})
