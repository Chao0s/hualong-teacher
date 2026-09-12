// 把全集检测的结论写进 wayfinder：重界定 #81，新增三张决策票，更新地图 #76。
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const REPO = 'Chao0s/hualong-teacher';
const DIR = 'G:/My Drive/Workplace/China KG Platform/hualong-teacher/.scratch/wayfinder';
mkdirSync(DIR, { recursive: true });
const sh = (c) => execSync(c, { encoding: 'utf8', maxBuffer: 1 << 26 }).trim();

// ── ① 重界定 #81：DevTools 装好了，卡点变了 ───────────────────────────────
const t81 = `## Question

不是决策，是**先把一件挡住判断的事做掉**：教师端 56 屏**一屏都渲染不出来**，所以「这一屏长对了吗」
谁也答不了。十步闸门、15 支探针、\`scan:wiring\`、以及本技能的另外九层**全部查不出渲染问题**。

**进展（2026-09-12 更新）**：

| 步骤 | 状态 |
|---|---|
| 装微信开发者工具 | ✓ 已装 |
| 扫码登录 | ✓ 已做 |
| **服务端口** | ✓ 已在「设置 → 安全 → 服务端口」开启（端口号 17284） |
| \`miniprogram-automator\` | ✓ 已装（0.12.1），但**不能用它的 \`launch()\`** —— 见下 |
| 起 IDE + \`connect()\` | ✓ **连上了**（第 2 次尝试，约 4 秒） |
| **页面真的画出来** | ✗ **卡在这里** |

**当前卡点（实测报错）**：

\`\`\`
✗ /pages/login/index  —— timeout waiting for automator response
✗ /pages/home/index   —— Cannot destructure property 'rawPath' of
                          't.getPageMetaByWebviewId(...)' as it is null.
✗ /pages/growth-book/index —— 同上
跑通 0 屏，失败 3 屏。
\`\`\`

**判读**：连接通了、协议也认了，但 \`reLaunch\` 拿不到页面元信息。方向是
**automator 0.12.1 与这套 DevTools 的版本差** —— \`getPageMetaByWebviewId\` 的返回形状变了或
需要先等某个就绪事件。**不是环境问题，是两版协议之间的事。**

**要做的：**

1. 查 DevTools 的版本号与本机 Node 版本，对 \`miniprogram-automator\` 的新版（或它的 GitHub issue）。
2. 先试**不开页**的最小动作（只读当前页、不 \`reLaunch\`），把「连接可用」与「导航可用」分开。
3. 若确实是版本差，**升级 automator**（它在 \`devDependencies\`，升级要重装 —— 注意 Drive 上装不了，
   见 CLAUDE.md §7.9）。
4. 三条路都不通时，**退路**：用 \`--auto-port\` 起 IDE 后由人点，脚本只做截图与取字；
   但那条路不能自动化，要在票里写明。

**做不到的**：挂进 CI。它要 GUI 与登录，GitHub Actions 上跑不起来。

**做完要回填的**：3 屏各自跑通的证据（元素文本或截图路径）。`;
writeFileSync(`${DIR}/t81.md`, t81);
sh(`gh issue edit 81 -R ${REPO} --body-file "${DIR}/t81.md"`);
console.log('✓ #81 重界定');

// ── ② 新增决策票 ─────────────────────────────────────────────────────────
const tickets = [
  {
    label: 'wayfinder:grilling',
    title: 'G113 · `GET /moments` 的 `child_id` 在教师侧没实现：补按幼儿筛，还是另立相册端点',
    body: `## Question

按票 #82 给「填写学期评价」接相册时，先量「相册的源在哪条端点」，量出这条：

**契约写的是**（\`openapi.yaml\` 的 \`listMoments\`）：\`child_id\` —— 「teacher 端 scoped
（必须在本班内，越界 422 \`scope_violation\`）；admin-pc 端 free；parent 端是 derived 上下文」。

**实测任何值都 200**：本班（1／10）、他班（11／20／60）、**根本不存在（999）**。
结果集也从不收窄 —— 幼儿 4／1／6 的回包**逐条相同**（都 21 条），而库里按 \`db_moment_upload\`
筛幼儿 4 只该有 15 条已发布（\`s3\`）的 moment，班 1 全部 19 条。

**代码处**：\`db/testdata/server/routes/shared.mjs:284\` 的 teacher 分支是 \`WHERE m.class_id = $1\`，
\`c.query.child_id\` 一次都没读。**parent 分支反而是对的**（join 了 \`db_moment_upload\` 与 \`caretakers\`）。

**不是泄漏**（谓词仍是本班），但它咬到**已决的 G28**：G28／E7 定的相册 =
「该幼儿有份的那些 moment 的**全部照片**，靠 \`db_moment_upload\` 筛 moment」。
教师分支从不 join 那张表，所以那套已决设计**今天没有可用的教师侧端点**，
\`teacher-term-form\`（填写学期评价）与 \`teacher-monthly-form\`（填写月度评价）都搭不出相册。

已登记 \`hualong-backend/db/GAPS.md\` **G113**。同物种：**G95**。

**两条出路，必须选一条：**

1. 让 \`child_id\` 在 teacher 侧真按 \`db_moment_upload\` 筛，并在班外／不存在时回 422。
   **要连带定一件事**：\`child_id\` 是「筛条件」还是「纯范围断言」—— 两者语义不同，
   前者会改变回包条数，后者只挡越界。
2. 另立一条教师侧相册端点，\`/moments\` 的 \`child_id\` 只做范围检查。
   要定端点形状、周次分组从哪来（G28 说取 \`db_moment.week_key\`）。

**要答的**：选哪条；若选 1，\`child_id\` 是筛还是断言。`,
  },
  {
    label: 'wayfinder:grilling',
    title: '页面级对照 · 22 个操作小程序够得着、原型却没有对应控件',
    body: `## Question

\`db/spec/screen-operations.tsv\` 的 \`trigger_flag\` 列实测（2026-09-12，142 行）：

| 值 | 数 | 含义 |
|---|---:|---|
| （空） | 100 | 两侧都无触发词 —— 纯读，正常 |
| **\`只wxml\`** | **22** | **小程序够得着，原型没有对应控件** |
| **\`原型无按钮\`** | **20** | **原型没有为这个操作给按钮** |
| 两侧都有 | 29 | 已比对，对得上 |

**本票专管那 22 条 \`只wxml\`。** 逐条要么是**原型该补这个控件**，要么是
**客户端做了原型没表达的事**（那要记一条决议）。**不能靠沉默代替说明** ——
这正是「小程序一直没把原型表达的交互意图包全」这件事的另一面：这一回是小程序**多**了。

**要做的**：把那 22 条逐条给一个结论，分三类：

1. **原型该补** → 记进原型待办（或直接改原型）。
2. **客户端多做，有决议依据** → 把依据写进那一行的 \`notes\`，以后不再报。
3. **客户端多做，没依据** → 要么补决议，要么把客户端那一处去掉。

**做完要回填的**：22 条各自的结论 + 落在哪一列。重跑 \`proto\` 层应相应减少。`,
  },
  {
    label: 'wayfinder:grilling',
    title: '页面级对照 · 20 个操作原型没给按钮，30 个写入没有原型控件',
    body: `## Question

同一份 \`trigger_flag\` 实测里剩下两类，**都归本票**：

| 类 | 数 | 含义 |
|---|---:|---|
| \`原型无按钮\` | 20 | 原型没有为这个操作给按钮 |
| \`trigger_prototype\` 为空且**是写入**（非 GET） | 30 | 写入操作，原型里找不到触发它的控件 |
| \`trigger_prototype\` 为空但有决议依据 | 7 | 已追到决议，**原型该跟着改** |

**已追到依据的那 7 条**（\`proto\` 层里逐条列了理由，不重复）：

| 操作 | 依据 |
|---|---|
| \`publishMonthEval\` | F17／§10.4 —— 教师人工把关后发布给家长；原型那页只有「保存评价」 |
| \`closeParentTask\` | F11／F16／Q60-l —— 任务要能从 \`s2\` 走到 \`s3\` |
| \`deleteMoment\` | Q59-m1a／m3／m4／n6 —— 教师删自己发的那条 |
| \`updateParentTaskDraft\` | §4／§7.3／F16 —— 草稿可回头改 |
| \`createResourceDownloadLink\` | §10／§4／F5 —— 取档要签短链、要记一笔 |
| \`createSession\`／\`revokeSession\` | §8 —— 整套原型没有登录页，刻意没做 |
| \`listMyProfileChanges\` | G45 —— 档案修改走申请制 |

**结论先说**：那 7 条**一条都不是我们凭空发明的**，是**原型落后于决议**。
要动的是原型，不是客户端。

**要答的（两类）：**

1. 那 7 条：**现在改原型，还是记进原型待办**（票里写明理由，以后不再报）。
2. 剩下 20 + 30 条：逐条给结论。写入而没有原型控件这一类**尤其要看清** ——
   有可能是**一次点按隐式触发**（例如保存后回头刷新又调了一次），
   而扫描器看不见那种链；也有可能是原型真的漏了。**不要把「扫描器看不见」当成「不存在」。**`,
  },
];

const created = [];
for (const t of tickets) {
  const f = `${DIR}/t${created.length + 7}.md`;
  writeFileSync(f, t.body);
  const url = sh(`gh issue create -R ${REPO} --label "${t.label}" --title ${JSON.stringify(t.title)} --body-file "${f}"`);
  created.push({ num: url.split('/').pop(), title: t.title, url });
  console.log(`✓ #${url.split('/').pop()}  ${t.title.slice(0, 46)}`);
}

// ── ③ 更新地图 #76 ───────────────────────────────────────────────────────
const oldBody = sh(`gh issue view 76 -R ${REPO} --json body --jq .body`);

const ticketsList = [
  ...oldBody.match(/^- \[.*$/gm) ?? [],
  ...created.map((c) => `- [${c.title}](${c.url})`),
];

const newBody = `## Destination

\`db/spec/screen-operations.tsv\`（一屏一操作一行）里每一屏要用的操作，在契约里都有落点。
达标判据：表里 \`no-api\`／\`planned\`／带缺口的 \`human\` 行全部有结论；五条新登记缺口
G109–G113 各自定夺；页面级那 72 条对照（22 只wxml + 20 原型无按钮 + 30 写入无原型控件）
逐条有结论；原型与契约的差集收敛到「不建」或「误报」两类。

## Notes

- 来源：2026-09-12 的三组原型↔映射表对账（\`docs/audit/proto-vs-table-2026-09-12.md\`，读 57 页），
  以及同日的十层检测全集（\`node .claude/skills/hualong-api-test/run.mjs --all\`，28 条发现）。
- 五条缺口已登记在 \`hualong-backend/db/GAPS.md\` 的 **G109–G113**。**契约一个字节还没改。**
- **本图由 herman925 起、由 herman925 推进。** 另一条开发线是 **linem7（朝湃）**，
  交接与审计件按这两个 handle 署名。
- 改动顺序不能反（CLAUDE.md §2）：先 \`hualong-backend/api/openapi.yaml\`，再服务端，最后客户端；
  改契约要同步 \`api/action-registry.tsv\` 与 \`docs/API-CONTRACT.md\` §15。
- 检测用 \`.claude/skills/hualong-api-test/run.mjs\`：**快集**（\`contract wire cover proto repo\`，
  不碰凭据／云／GUI）每改一次跑；**\`--all\`** 用于收尾与交接。两层都印出用的是哪一套。
- 权威顺序：\`DECISIONS.md\` > \`db/01_schema.sql\` > \`DATABASE_SPEC.md\` > spec 文件 > 原型。
  **但原型是「交互意图」的参考** —— 本图的整个问题就是小程序有没有把原型表达的意图包全。
- 决策票用 \`/grilling\` 与 \`/domain-modeling\`。
- 名词注解规则见 CLAUDE.md §1：第一次提到 G 编号、表名、端点名要带一句它是什么。

## Decisions so far

${ticketsList.join('\n')}

## Not yet specified

- 原型落后要不要系统性修一次。那 7 条「契约先行、原型掉了」是同一件事的七个面，
  一条一条改原型不解决它。
- \`screen-operations.tsv\` 的 \`state\` 列每格还带 \`?\` —— 机器按 handler 名猜的，没人核过。
- 对账里 \`unsure\` 那 18 条（三组各自标了「没把握」）要不要再扫一轮。

## Out of scope

**生产环境那一线** —— 不同目的地（把已选的安全与部署决议落到机器上），归后端仓库的票，本图不开票：

| 检测报的 | 归谁 |
|---|---|
| \`db/authz-not-built\`：RLS **0/62 张表**开着（ADR-0016 §3 是授权模型） | \`hualong-backend#7\` |
| \`db/migrations\` 跳过：无 \`db/migrations\` 与 \`schema_migrations\` | \`hualong-backend#6\` |
| \`vm/exposure-surface\`：80 端口公开挂着 nginx 默认页且无 TLS；4 个监听超出回环 | \`hualong-backend#11\` |
| \`vm/deploy-key\` 跳过：主机上还没有部署密钥 | \`hualong-backend#5\` |
| \`api\` 整层跳过：3001 上没有服务 | \`hualong-backend#9\` |

- 地图 #1「接线审计 2026-09-08」—— 另一个目的地，不动它。
- 原型文件本身的排版与样式。`;

writeFileSync(`${DIR}/map76.md`, newBody);
sh(`gh issue edit 76 -R ${REPO} --body-file "${DIR}/map76.md"`);
console.log(`\n✓ 地图 #76 更新：子票 ${ticketsList.length} 条`);
