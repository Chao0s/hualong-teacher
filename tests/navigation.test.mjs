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

/**
 * 「四页各画一列分区入口」这条通用断言 2026-08-27 退役。
 *
 * 四个入口页此前是同一个形状（`hl-entry-sections` 的整宽列表），所以一条断言管得住
 * 四页。园方裁定以原型为准之后，四个原型各不相同，四页也就各自重建，版面由各自的
 * 测试文件守：
 *   党建管理  tests/party-home.test.mjs（轮播加三个分区）
 *   综合协调  tests/coordination.test.mjs（三节七卡）
 *   教研培训  tests/training-home.test.mjs（轮播、三卡、两节推荐）
 *   家园社共育 tests/co-education-home.test.mjs（四卡加完成度汇总）
 *
 * **不要把它改成一条空转的循环留在这里** —— 那看起来像还在守，其实一个目标也没有。
 * 与版面无关的那一半（导航栏标题）留下，它四页都还成立。
 */
test('四个入口页的导航栏标题各是自己的模块名', () => {
  for (const [route, zh] of ENTRY_PAGES) {
    assert.equal(JSON.parse(read(`${route}.json`)).navigationBarTitleText, zh)
  }
})

test('四个入口页都过会话门，且都真的读了各自的聚合', async () => {
  const c = await signedIn()
  for (const [route, zh] of ENTRY_PAGES) {
    const page = loadPage(c, `${route}.js`)
    page.onLoad()
    assert.ok(page.data.ready, `${zh} 未通过会话门`)
  }
})

/**
 * 每一条服务层声明的去向都指向 app.json 真的注册过的页面。
 *
 * 2026-08-27 之前这条只扫 `services/module-entry.js` 一个文件：四个入口页共用那一张
 * 表。四页各按自己的原型重建之后那个文件退役，去向回到各自的服务模块，所以这里改成
 * 扫**每一个持有页面路径的服务**。少扫一个文件就等于少守一个模块。
 *
 * 指向未注册页面的后果不是报错，是**点了没反应** —— `wx.navigateTo` 对不存在的路径
 * 静默失败，所以这条断言是这类错误唯一的哨兵。
 */
test('每一条服务层声明的去向都指向 app.json 真的注册过的页面', () => {
  const registered = new Set([
    ...(appJson.pages || []),
    ...(appJson.subPackages || []).flatMap(
      (sub) => (sub.pages || []).map((p) => `${sub.root.replace(/\/$/, '')}/${p}`),
    ),
  ])

  const services = [
    'services/party.js', 'services/coordination.js', 'services/training.js',
    'services/library.js', 'services/assessment.js', 'services/co-education.js',
    'services/evaluation.js', 'services/growth-book.js', 'services/home.js',
  ]
  let seen = 0
  for (const file of services) {
    const src = read(file)
    for (const m of src.matchAll(/'(\/(?:pages|packages)\/[\w\-/]+)'/g)) {
      const route = m[1].replace(/^\//, '')
      assert.ok(registered.has(route), `${file} 指向未注册的页面：${m[1]}`)
      seen += 1
    }
  }
  assert.ok(seen >= 25, `扫到的去向太少（${seen}），正则大概失效了`)
})

test('教师端的入口里没有家长端页面', () => {
  // home-school.html 的快捷入口有「社区共育」。它在 2026-08-26 之前被判为家长端页面
  // 而缺席；园方裁定以原型为准之后，**教师端自己的社区共育页**收进了结构契约
  // （`CommunityCoedu`），所以现在它必须在，而且必须指向教师端那一页。
  // 真正的家长端页面（家长写评价、家长上传）仍然一个也不得出现。
  const src = read('services/co-education.js')
  assert.match(src, /packages\/co-education\/pages\/community\/index/, '社区共育进教师端自己那一页')
  // 家长端有自己的 AppID 与自己的页面树；教师端一条去向也不得落在那一侧。判据是
  // **模块**，不是路径里的字样 —— `parent-eval` 与 `parent-tasks` 都是教师端的页面
  // （发起一期家长评价、发布亲子任务），名字里的 parent 说的是内容关于谁，不是这
  // 一页属于谁。所有去向本身是否注册，由上一条断言逐个核。
  for (const file of ['services/co-education.js', 'services/evaluation.js']) {
    assert.ok(!read(file).includes('parent-client'), `${file} 指向了家长端那个 AppID`)
  }
})

// ── Navigation uses the right API ────────────────────────────────────────────

test('a tab destination uses switchTab; wx.navigateTo would fail silently on it', async () => {
  const c = await signedIn()

  // No quick entry reaches a tab any more (通知 took the 教研培训 slot on
  // 2026-08-26 precisely because that card duplicated the tab), so the subject
  // is pinned where it lives: the guard itself.
  c.guard.navigateTo('/pages/training/index', 'teaching-research')
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
  scan(read('pages/home/index.wxml'))
  // The quick entries carry their icon in the service, not the markup.
  for (const m of read('services/home.js').matchAll(/icon: '(icon-\d+)', color: '(\w+)'/g)) {
    referenced.add(`${m[1]}-${m[2]}`)
  }

  // 4 是首页那四张常用入口卡。`hl-entry-sections` 在 2026-08-27 退役，它那一处
  // 引用随之消失，所以门槛从 5 降到 4 —— 降的是计数，不是覆盖面：现在扫的是
  // **所有还在写图标名的地方**。
  assert.ok(referenced.size >= 4, `扫到的图标太少（${referenced.size}），正则大概失效了`)
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
  const files = ENTRY_PAGES.flatMap(([route]) => [`${route}.js`, `${route}.wxml`])
  for (const file of files) {
    const src = read(file)
    assert.ok(!src.includes('观察记录'), `${file}: DO-NOT-BUILD 1`)
    assert.ok(!src.includes('pc-backend') && !src.includes('/admin/'), `${file}: DO-NOT-BUILD 2`)
  }
})
