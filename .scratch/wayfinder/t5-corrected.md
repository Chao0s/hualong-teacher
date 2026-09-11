## Question

不是决策，是**先把一件挡住判断的事做掉**：教师端 56 屏今天**一屏都渲染不出来**，所以「这一屏长对了没有」谁也答不了 —— 十步闸门、探针、接线扫描**全部查不出渲染问题**（CLAUDE.md §6 最后一行写着「上面全部查不出来」）。

**查清的事实**（2026-09-12 逐条实测）：

| 查了什么 | 结果 |
|---|---|
| 微信开发者工具 | **没装**（四个常见安装目录 + `LOCALAPPDATA` 都查过） |
| `miniprogram-automator` | **声明在 `devDependencies`（`^0.12.1`）、`package-lock.json` 里也有，但没装** —— `npm ls miniprogram-automator` 回 `(empty)`，`node_modules` 只有 `@scarf`／`argparse`／`js-yaml`／`swagger-ui-dist` 四个。全仓无一处引用它 |
| `tools/web-capture/` | 是给**网页原型**写的；抓的是 `screens/*.html`，与 miniprogram 无关 |

**所以「渲不了」不是被封，是这条路从来没接上。** `project.config.json` 的 `appid` 是真的（`wxbda23b3884ae4d69`），`urlCheck: false`。

**要做的：**

1. 装微信开发者工具（官方下载）。**唯一一次性的门槛**：它要扫码登录一次，只有人能做。
2. `npm i` 把 `miniprogram-automator` 真正装上（它今天只在 `package-lock.json` 里）。
3. 用它写一支脚本：编译、逐页跳、取元素文本、截图。
4. **先只做 3 屏样板**（`login`／`home`／`growth-book`），证明这条路通，再决定铺不铺 56 屏。一次铺 56 屏会先撞上一堆「元素找不到」。

**做不到的**：挂进 CI。它要 GUI 与登录，GitHub Actions 上跑不起来。所以「每页截图」只能是本机能力。

**做完要回填的**：3 屏样板跑通的证据（元素文本或截图路径），以及第 1 步卡在哪（如果要人扫码，就写清楚卡在那一格）。
