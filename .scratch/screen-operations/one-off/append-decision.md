
## 2026-09-11：Swagger 加一层「按屏幕查看」——两份新表、ELI10、闸门与视图

本轮只定决议，不写代码。未落的部分列在文末。

### 一、要做的事

Swagger UI 现在按 15 个模块 tag 分组（`auth`、`library`、`party`、`growth-book` 等）。这个分组看不出「某一页要用哪些 API」，于是看不出「某一页要用的 API 还不存在」。

要加一层按屏幕看的视图。教师端 55 屏先做；家长端 18 屏与管理端 9 屏以后加行，机制不改。

### 二、为什么现有产物不够

| 现有产物 | 为什么不够 |
|---|---|
| `miniprogram/pages/` 的 55 页 | 是**静态页面**，不是 JS 生成的。JS 生成的是页面里的内容（`setData`） |
| `npm run scan:wiring`（接线扫描） | 能算出「已接的页面调了哪些操作」，算不出「该有却没有」——后者是意图，不是现状 |
| `api/openapi.yaml`（契约） | 七种 `x-hualong-*` 扩展里**没有屏幕维度**。15 个 tag 是模块名 |
| `screens/*.html`（网页原型） | 没有可机读的按钮表。唯一词表 `data-ui` 只标表单字段；主页原型 `<button>` 0 个、`fetch` 0 处 |
| `summary` | 标题式片段，中位 19 字（例：「当前主体、范围与学期上下文」） |
| `description` | 工程口吻，中位 320 字、最长 987 字。`listResources` 的正文就是三条角色的 SQL predicate |

「这个 API 做什么」这句人话，契约里**一句都没有**。本轮补上，并且补的那一层叫 **ELI10**（Explain Like I Am 10，解释给十岁小孩听），不是 ELI5。

### 三、两份新表

两份都住 `hualong-backend/db/spec/`。

**`screen-operations.tsv`** —— 一个屏幕的一个操作一行。列：`screen`（目录名）、`mp_file`（与 `screens.tsv` 同键）、`screen_title`（中文标题，取自各页 `index.json` 的 `navigationBarTitleText`）、`state`、`operation_id`、`method`、`path`、`source`、`trigger_wxml`、`trigger_prototype`、`trigger_flag`、`gap`、`notes`。

- `state` 是**屏幕状态**，不是业务状态机。受控词表六个：`list`／`detail`／`form`／`overlay`／`dialog`／`empty`。机器猜的带问号（`list?`），人核过的不带。理由：同一列里两种把握混在一起，事后没人分得清，而这一列正是拿来看缺口的。`growth-book`（「成长册」）就是需要拆状态的例子——列表、预检弹层、定稿对话框三处操作不同。
- `operation_id` 是契约现成的唯一名（167 个操作每个都有），不拼 `method+path`。
- 契约还没有的操作：`operation_id` 留空、`path` 写目标形态并标未存在。**不编假外键。**
- `source` 取 `gen`／`human`／`planned`／`stale`。生成器只重写 `gen` 行。
- `trigger_wxml` 与 `trigger_prototype` 两列都存，`trigger_flag` 记「只wxml／只原型／文案不同」。**以 wxml 为准；不一致要 flag；wxml 没有就提示原型有。** 存下原型那句是留证据，不是留权威。

**`operation-eli10.tsv`** —— 一个操作一段人话。列：`key`、`幹嘛`、`怎麼走`、`碰到誰`、`derived_from`。

- 三个固定标签，每个 1–2 短句。中文，说给不懂代码的人听（园长、教师、客户），照本仓库 CLAUDE.md §1 的 ASD-STE100 写法。例：`幹嘛` 写「教师把本班的栏目列出来」，不写「本班本学期栏目清单（SCOPED: class_id）」。
- `碰到誰` 一格两行：`调用:` 与 `影响:`。
- `key` 是 `operationId`。planned 行没有 `operationId`，用 `planned:<屏幕>:<短名>`。**闸门数 167 只数 key 是真 `operationId` 的行。**

**`影响:` 那一行怎么算得出来**（不是猜的）：

```
api/action-registry.tsv（动作登记表）的 target_table / also_writes
   ∩  db/spec/screens.tsv（屏幕登记表）的 primary_tables
```

两者用同一套 `db_*` 表名。教师端只读屏 36 个、写屏 20 个，所以影响关系只在那 20 屏一侧有内容。读操作只有 `调用:` 一行。

### 四、生成器住本仓库

`tools/scan-wiring.mjs` 加一个子命令，直接写 `../hualong-backend/db/spec/` 的两份表。

**理由：**「页面 → service → 操作」这段遍历已经在 `scan-wiring` 手里，它也已经读过契约。搬到后端就是第二份实现，两份一定会漂开——与契约副本同一个毛病（本仓库 CLAUDE.md §7.3）。

**一条硬规则：** `gen` 行下次跑不再出现时，标 `stale` 并让闸门变红。页面不再调某个操作是个信号，不是垃圾。静默删除会把信号吞掉。

**子代理不写最终表。** 它们只交「批次稿」（一屏一组），生成器合并后写唯一那份 tsv。同一条 `调用:` 若两屏各算一份而不一致，报冲突，不静默取一份。

### 五、视图

| 路由 | 是什么 |
|---|---|
| `/` | **不动。** 传统 tag 分组继续可用——家长端与管理端的人在看 |
| `/pages` | 新。一屏一卡，卡内四段，每行深链进 Swagger UI（`#/growth-book/listBookSections`，`deepLinking` 已开） |
| `/pages.yaml` | 新。派生 spec：167 个操作全部保留，按屏幕分组（tag = 屏幕名），保留 try-it-out。无认领的单独一组 |
| `/roles` | 加一列 ELI10 |

卡内四段：已实作／页面要用契约没有／契约有页面没调／页面调了契约没有。

**ELI10 不写进契约。** 它由本仓库 `tools/swagger/pages.mjs` 的 `specForUi()` 注入——那个函数已经在改 spec（往 `servers` 前面插本地后端），不新造机制。三条理由：①不往 478KB 的共享契约里塞 167 行人工文本；②`specForUi()` 已有先例；③**下一个人翻契约找不到它，所以本仓库 CLAUDE.md §7 要记一条。** 不同意的理由：不写进契约，家长端／管理端就看不到。

### 六、无认领的两类，不要混

167 个操作里约 63 个的角色里没有教师。本轮不映射它们的屏。**写成「无人认领」就是假发现**——它们有人用，只是不在这次范围。

| 类别 | 怎么判 | 算不算发现 |
|---|---|---|
| 教师可达但无教师屏调用 | `x-hualong-roles` 含 `teacher`，且两份表里都没有行 | **算。** 这就是要找的缺口 |
| 非教师角色 | `x-hualong-roles` 不含 `teacher` | 不算。标「本轮未覆盖（家长端／管理端）」 |

这个分法机器能验，不是人拍的。ELI10 的 `碰到誰` 对第一类显式写「无（没有页面调用它）」，不留空——**留空与还没填长得一模一样。**

### 七、闸门

两个新检查文件（`db/tools/check-*.mjs`），`check-all.mjs` 由八步变十步。三个计数：

1. 55 屏每屏至少一行
2. 167 个操作逐个有 ELI10
3. 无认领操作显式列出

后两条只数计数，不需要新逻辑。**不设 `reviewed` 列**——起草完直接上。

**代价：** 后端的「八步」字样要改（`hualong-backend/CLAUDE.md` 六处：第 62、65、78、80、82、84 行）。查过了：**「八步」没有被任何机器验。** `check-consistency.mjs` 的 `steps` 数的是 `DECISIONS.md` 的表数链（45 → 62），不是 `check-all` 的步数。所以改字样是纯文档改动，不会弄红任何一步。

### 八、批次

**按屏幕分批。** 一个子代理读一屏的 `index.js` 与 `index.wxml`，一趟同时交两样：这一屏的映射行、它认领的每个操作的 ELI10 三标签。

**子代理串行跑**（用户偏好一次一个内置子代理，也顺带消掉并行撞车）。一批跑完把行给用户过目，同时追加进表。**进度存盘，不靠对话记。**

**最后加一趟「契约直读」扫尾**，专收无人认领的操作——那批没有屏可派，按屏幕分批永远盖不到。

### 九、不做的事

- **不做「操作 × 屏幕」矩阵。** 167 × 55 太长，而且矩阵看不出状态。
- **不做控件级**（每个可点元素一行）。那是接线报告的活，不塞进契约视图。
- **不把 ELI10 写进 `openapi.yaml`。** 理由见 §五。
- **不改 `/` 的默认分组。** 那是三端共享入口。

### 十、计数（2026-09-11 实测）

| 计数 | 值 | 出处 |
|---|---|---|
| 契约 | 137 paths／167 operations／153 schemas | `npm run spec:inventory` |
| 教师端可达操作 | 104 | 同上 |
| 教师端屏幕 | 55（46 已接 service，9 未接） | `docs/audit/wiring-2026-09-10.md` |
| 教师端写屏 | 20（只读 36） | `hualong-backend/db/spec/screens.tsv` 的 `writes` 列 |
| 动作登记表 | 135 行 | `hualong-backend/api/action-registry.tsv` |
| 屏幕登记表 | 84 行（教师 57／家长 18／管理端 9） | 同上 `screens.tsv` |

**一条容易搞错的判据：** `require('../../services/…')` **不等于已接**。`home-school`（「家园社共育」，底部导航那一项）`require` 了 `co-education`，却**一次都没调用**，扫描器判它未接——**扫描器是对的**。按「有没有 require」数得 47，按「有没有真调用」数才得 46。

### 未落

本轮只定决议。未落的部分：两份新表、生成器子命令、`/pages` 与 `/pages.yaml` 与 `/roles` 的新列、两个检查文件、`hualong-backend/CLAUDE.md` 的步数字样、`hualong-backend/db/spec/README.md` 的文件登记、本仓库 CLAUDE.md §7 的一条。
