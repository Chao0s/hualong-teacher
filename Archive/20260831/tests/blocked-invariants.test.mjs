/**
 * 挂账票据 23 与 24 的客户端那一半。
 *
 * 两张票的**决定**在上游：备案、微信认证、类目资质、手机号领取表的 DDL、监护人
 * 同意的签核。客户端等不来，也不该等——它们各自的验收里有一批**负向断言**，说的是
 * 「这些东西不得出现」，而那正是客户端今天就能守住的部分。
 *
 * 负向断言的性质与别处不同：它不检查功能做对了没有，它检查功能**有没有被顺手补上**。
 * 一个「重置密码」按钮不会让任何测试变红，也不会让任何人不舒服——它只是悄悄把一条
 * 硬停止变成了软停止。所以这些断言必须存在，而且必须在代码里而不是在文档里。
 *
 * 票据 22 的那一条（在园时光与亲子任务不出现视频入口）已经在 tests/moments.test.mjs
 * 里，不在这里重复。
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'

const MP = 'miniprogram'

// The client is CommonJS. These assertions read it as source most of the time,
// but `pendingLabel` is behaviour, not text, so that one needs the real module.
const requireHere = createRequire(import.meta.url)
const requireClient = (rel) => requireHere(resolve(MP, rel))

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const SOURCES = walk(MP).filter((f) => ['.js', '.wxml', '.json', '.wxss'].includes(extname(f)))

/** Comments are documentation; only code can build a thing. WXML comments too. */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')
}

function sourcesContaining(needle, { code = true } = {}) {
  return SOURCES.filter((f) => {
    const raw = readFileSync(f, 'utf8')
    return (code ? codeOnly(raw) : raw).includes(needle)
  }).map((f) => relative(MP, f).replace(/\\/g, '/'))
}

// ── 票据 24：身份入口没有侧门 ───────────────────────────────────────────────

describe('票据 24 · 身份入口只有一条，没有任何回退', () => {
  // 每一条都是一扇侧门。它们的共同点是加上去很容易、加上去之后没有任何测试会变红，
  // 而其中任何一条都会把「配额耗尽是硬停止」变成一句空话（DO-NOT-BUILD 10）。
  const SIDE_DOORS = [
    ['短信', '短信验证码回退'],
    ['邀请码', '邀请码入口'],
    ['人工绑定', '人工绑定'],
    ['手动绑定', '手工绑定'],
    ['账号密码', '密码登录'],
    ['重置密码', '重置密码界面'],
    ['忘记密码', '找回密码入口'],
  ]

  /**
   * 一扇侧门是一个**可点的东西**，不是一个词。
   *
   * 登录页的硬停止文案里就写着「平台不提供短信、邀请码或人工绑定等其他登录方式」——
   * 那句话是这条规则的落实，不是违反。所以断言找的是这些词附近有没有交互：按钮、
   * 点击处理器、导航。第一版把那句文案判成了侧门，那是把说明当成了入口。
   */
  function interactiveNear(needle) {
    const hits = []
    for (const f of SOURCES) {
      const code = codeOnly(readFileSync(f, 'utf8'))
      for (const line of code.split('\n')) {
        if (!line.includes(needle)) continue
        if (/<button|bindtap|catchtap|navigateTo|redirectTo|open-type/.test(line)) {
          hits.push(`${relative(MP, f)}: ${line.trim().slice(0, 70)}`)
        }
      }
    }
    return hits
  }

  for (const [needle, what] of SIDE_DOORS) {
    test(`没有${what}`, () => {
      const hits = interactiveNear(needle)
      assert.deepEqual(hits, [], `出现了${what}：\n  ${hits.join('\n  ')}`)
    })
  }

  test('硬停止文案明说没有别的路 —— 这是规则的落实，不是违反', () => {
    const wxml = readFileSync(join(MP, 'pages', 'login', 'index.wxml'), 'utf8')
    assert.match(wxml, /不提供短信/, '硬停止时要告诉教师没有替代入口，而不是让他自己猜')
  })

  test('唯一的身份凭证来自微信按钮，客户端不自造输入框', () => {
    // A2：`phone_code` 只能来自 <button open-type="getRealtimePhoneNumber">。
    // 一个手机号输入框意味着用户可以输入别人的号码，名册匹配因此变成一句摆设。
    const inputs = SOURCES
      .filter((f) => f.includes('login'))
      .filter((f) => extname(f) === '.wxml')
      .filter((f) => /<input[^>]*type=["'](number|idcard|digit)["']/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(MP, f))
    assert.deepEqual(inputs, [], `登录页出现了数字输入框：${inputs.join(', ')}`)
  })

  test('客户端不含任何手机号规范化逻辑', () => {
    // 自造一条规范化规则的冲突表现是：同一个人两条领取记录，或者永远登不进去。
    // 规则由服务端持有，客户端**原样提交**微信给的凭证。
    const auth = codeOnly(readFileSync(join(MP, 'utils', 'auth.js'), 'utf8'))
    for (const smell of ['replace(/\\s', 'trim()', "startsWith('+86", "slice(3)", 'padStart']) {
      assert.ok(!auth.includes(smell), `utils/auth.js 在加工手机号凭证：${smell}`)
    }
  })

  test('配额耗尽是硬停止 —— 三种失败都不引导到替代入口', () => {
    const identity = readFileSync(join(MP, 'services', 'identity.js'), 'utf8')
    for (const code of ['wechat_phone_quota_exhausted', 'identity_not_on_roster', 'identity_binding_conflict']) {
      assert.ok(identity.includes(code), `${code} 应当各有自己的落点`)
    }
    // 硬停止的意思是没有下一步可点。任何一句「改用…」都是把它变软。
    for (const fallback of ['改用', '或者试试', '换一种方式', '稍后可用其他']) {
      assert.ok(!identity.includes(fallback), `出现了替代入口的措辞：${fallback}`)
    }
  })

  test('一个客户端一个角色 —— 没有角色切换', () => {
    const session = codeOnly(readFileSync(join(MP, 'utils', 'session.js'), 'utf8'))
    assert.ok(!/\bsetRole\b/.test(session), 'session 出现了 setRole —— 角色在登录时确定，会话期内固定')
    assert.ok(!/switchRole|changeRole/.test(session), '出现了角色切换')
  })
})

// ── 票据 24：未成年人数据与监护人同意 ───────────────────────────────────────

describe('票据 24 · 教师端不出现监护人同意与留存期告知', () => {
  // 单独同意的主体是监护人，教师代勾无效，还制造一份虚假的合规证据。
  // 留存期未经签核，写出来的任何数字都是编的。
  const FORBIDDEN = ['监护人同意', '家长同意', '同意版本', '撤回同意', '留存期', '到期删除', '数据清除']

  for (const needle of FORBIDDEN) {
    test(`界面与代码里都没有「${needle}」`, () => {
      const hits = sourcesContaining(needle, { code: false })
      assert.deepEqual(hits, [], `${needle} 出现在：${hits.join(', ')}`)
    })
  }
})

// ── 票据 23：上线前置的客户端后果 ───────────────────────────────────────────

describe('票据 23 · 上线闸门在客户端留下的债', () => {
  test('客户端不调用内容安全接口 —— 那需要 AppSecret', () => {
    // DO-NOT-BUILD 13。客户端的义务是**声明**把关路径，不是调用。
    // 找的是**调用**，不是子串：`moderation.js` 里有一句描述把关路径的字符串字面量
    // 提到了 mediaCheckAsync，那是文档不是调用。第一版把它判成了违规。
    const CALL = /(wx\.)?security\.\s*(msgSecCheck|mediaCheckAsync)\s*\(/
    const offenders = SOURCES
      .filter((f) => CALL.test(codeOnly(readFileSync(f, 'utf8'))))
      .map((f) => relative(MP, f))
    assert.deepEqual(offenders, [], `客户端调用了内容安全接口：${offenders.join(', ')}`)
  })

  test('教师自己发布的内容不渲染「检查中」的等待态', async () => {
    // ADR-0016 行 2 是**先发后审**：教师的内容立即可见，检查随后跑。给它渲染一个
    // 等待态等于把先发后审说成了先审后发，教师会以为自己还要等。
    //
    // 家长提交的内容不同 —— ADR-0016 行 3，微信接口阻断批次，**失败关闭**，通过前
    // 不可见。所以亲子任务进度矩阵上「内容检查中」是对的：那一格是家长交的东西。
    // 第一版没有分开这两者，把一条正确的渲染判成了违规。
    const { GATES, pendingLabel } = requireClient('utils/moderation.js')
    assert.equal(pendingLabel(GATES.HUMAN_PREVIEW_CONFIRM), '', '教职工文字：没有等待态')
    assert.equal(pendingLabel(GATES.IMAGE_MEDIA_CHECK_ASYNC), '', '教职工图片：先发后审，没有等待态')
    assert.equal(pendingLabel(GATES.WECHAT_API_BATCH), '内容检查中', '家长内容：有等待态，且只有这一处')
  })

  test('源码里没有明文 http 地址 —— 本地契约服务除外', () => {
    // 真机联调用局域网地址是受支持的路径，但它属于本地配置，不属于源码。
    const offenders = []
    for (const f of SOURCES) {
      const code = codeOnly(readFileSync(f, 'utf8'))
      for (const m of code.matchAll(/http:\/\/[^\s'"`)]+/g)) {
        // config.js 的开发档指向本地契约服务；那是开发期的落点，不是要上线的地址。
        if (/127\.0\.0\.1|localhost/.test(m[0])) continue
        // towxml/parse/parse2/entities/escape.js 的行内注释里引了一篇文章。codeOnly
        // 只剥行首的 //，剥不掉它。放行的是这一个域名，不是整个 towxml —— towxml 里
        // 真出现新的明文 http 接口，这条断言仍然拦得住。
        if (/mathiasbynens\.be/.test(m[0])) continue
        offenders.push(`${relative(MP, f)}: ${m[0]}`)
      }
    }
    assert.deepEqual(offenders, [], `明文 http 地址：\n  ${offenders.join('\n  ')}`)
  })

  test('生产档的 baseUrl 是空的 —— 域名备案完成前它没有合法值', () => {
    const config = readFileSync(join(MP, 'config.js'), 'utf8')
    // 填一个还没备案的域名进去，会在提审那天变成一个说不清来历的地址。
    assert.match(config, /prod[\s\S]{0,200}baseUrl:\s*''/,
      '生产档的 baseUrl 应当留空，等域名备案与白名单落定')
  })

  test('关闭域名校验这笔债有人记着', () => {
    // 它最危险的地方是：留着不影响任何日常开发，只在提审那天变成阻断。
    const shared = readFileSync('project.config.json', 'utf8')
    const example = readFileSync('project.private.config.json.example', 'utf8')
    assert.match(shared, /"urlCheck":\s*false/, '当前确实关着 —— 这条断言在它被打开时应当更新')
    assert.ok(
      /urlCheck/.test(example) && /(pending|备案|filed)/i.test(example),
      'urlCheck 关闭的理由与还债条件必须写在配置模板里，不能只在某个人的记忆里',
    )
  })
})
