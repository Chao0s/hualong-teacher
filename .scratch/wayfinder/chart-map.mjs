// 开一张新地图 + 它的子票。地图先建，拿到号再建子票并互相引用。
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const REPO = 'Chao0s/hualong-teacher';
const DIR = 'G:/My Drive/Workplace/China KG Platform/hualong-teacher/.scratch/wayfinder';
mkdirSync(DIR, { recursive: true });

const sh = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 1 << 26 }).trim();

const mapBody = `## Destination

\`db/spec/screen-operations.tsv\`（一屏一操作一行，56 屏 142 行）里每一屏要用的操作，在契约里都有落点。达标判据：表里 \`no-api\`／\`planned\`／带缺口的 \`human\` 行全部有结论；四条新登记缺口 G109–G112 各自定夺；原型与契约的差集收敛到「不建」或「误报」两类。

## Notes

- 来源：2026-09-12 的三组原型↔映射表对账（\`docs/audit/proto-vs-table-2026-09-12.md\`，读 57 页，报 15 missing / 9 invented / 18 unsure）。
- 四条缺口已登记在 \`hualong-backend/db/GAPS.md\` 的 G109–G112（后端提交 \`30adf36\`）。**契约一个字节还没改。**
- **本图由 herman925 起、由 herman925 推进。**
- 改动顺序不能反（CLAUDE.md §2）：先 \`hualong-backend/api/openapi.yaml\`，再服务端，最后客户端；改契约要同步 \`api/action-registry.tsv\` 与 \`docs/API-CONTRACT.md\` §15。
- 权威顺序：\`DECISIONS.md\` > \`db/01_schema.sql\` > \`DATABASE_SPEC.md\` > spec 文件 > 原型。
- **「我们自己发明的」9 条不是本图的票。** 每条都追到一份决议或规范节号，要动的是原型，不是契约。
- 决策票用 \`/grilling\` 与 \`/domain-modeling\`。
- 名词注解规则见 CLAUDE.md §1：第一次提到 G 编号、表名、端点名要带一句它是什么。

## Decisions so far

<!-- 一条未关。 -->

## Not yet specified

- 原型落后要不要系统性修一次。9 条「契约先行、原型掉了」是同一件事的九个面，一条一条改原型不解决它。
- \`screen-operations.tsv\` 的 \`state\` 列每格还带 \`?\` —— 机器按 handler 名猜的，没人核过。消问号要人逐屏过。
- 对账里 \`unsure\` 那 18 条（三组各自标了「没把握」）要不要再扫一轮。

## Out of scope

- 地图 #1「接线审计 2026-09-08 的两份审核意见落成可执行工单」—— 另一个目的地，不动它。
- 原型文件本身的排版与样式。`;

const tickets = [
  {
    label: 'wayfinder:grilling',
    title: 'G109 · 资源详情要显示「这个资源被哪些案例用了」：契约补读端点，还是从原型摘掉',
    body: `## Question

资源详情那一屏（\`resource-detail\`，教研培训 → 课程资源 → 资源库 → 点一条）要显示一个「课程应用」小节，列出这个资源被哪些案例引用了。

**契约今天装不下它。** \`getResource\` 回的 \`Resource\` schema 里 \`case\` 字样零命中；\`/library/resources/{resource_id}/\` 下只有两条，\`submission\`（\`updateResourceDraft\`）与 \`download-link\`（\`submitResource\`），两条都不是「被谁用了」。

已登记 \`db/GAPS.md\` **G109**。原型位置：\`screens/resource-detail.html\` 第 87-95 行。

**两条出路，必须选一条：**

1. 契约补一条读端点（例如 \`/library/resources/{resource_id}/cases\`），或给 \`Resource\` 加一列 \`case_ids\`。补端点要同步 \`action-registry.tsv\`，并决定范围（谁能看到全部引用，还是只看自己班／自己的）。
2. 认定「课程应用」暂不做，从原型摘掉这一节。原型与屏幕都要摘，不然下一个人会再报一次。

**要答的**：选哪条；若选 1，端点的范围规则是什么（那是范围规则，不是简单加一条）。`,
  },
  {
    label: 'wayfinder:grilling',
    title: 'G110 · 课程资源要能按关键词搜：契约加 keyword 参数，还是客户端本地过滤够用',
    body: `## Question

课程资源那一屏（\`resource-center\`，教研培训 → 课程资源）要有一个搜索框。原型 \`screens/resource-center.html\` 第 74-78 行是表单，第 156-162 行把关键词推成 \`?q=\`。

**契约两个列表操作都没有关键词参数。** 实测：\`listResources\` 只有 \`limit\`／\`cursor\`／\`mine_only\`／\`resource_status\`／\`resource_tag\`／\`grade\`／\`class_id\`；\`listCases\` 只有 \`limit\`／\`cursor\`／\`mine_only\`／\`case_status\`／\`case_grade\`／\`case_field\`／\`case_area\`。

这一屏今天在 \`screen-operations.tsv\` 里记 \`no-api\`（\`source=human\`）。已登记 \`db/GAPS.md\` **G110**。

**两条出路，必须选一条：**

1. 加一个 \`keyword\` 参数。**要先定三件事**：用哪几个列做匹配、要不要加索引（不加索引在大表上会全表扫）、要不要支持拼音或分词。
2. 认定客户端本地过滤够用，从原型摘掉搜索框。这条要能回答：资源库与案例库的规模上限是多少，本地过滤撑得住吗。

**要答的**：选哪条；若选 1，匹配哪几个列、要不要索引。`,
  },
  {
    label: 'wayfinder:grilling',
    title: 'G111 · 教研培训部的首页三块推荐：补聚合端点，还是客户端多打几次',
    body: `## Question

教研培训部（\`training-center\`，底部导航「教研培训」）的首页要三块内容：一个轮播、推荐资源 3 卡、推荐案例 3 卡。原型 \`screens/training-center.html\` 第 43-145 行。

**契约里 \`traininghome\` 零命中。** \`/trainings\` 下只有列表、详情、报名、取消报名四条。已登记 \`db/GAPS.md\` **G111**。

**同形状的 \`getPartyHome\`（党建首页聚合）有。** 所以问题不是「聚合不该存在」，是这一个模块还没有。

**两条出路，必须选一条：**

1. 照 \`getPartyHome\` 的样子补一条聚合端点。它要回答「推荐」按什么排（谁推荐、按什么分），那是产品决定。
2. 认定那三块由客户端拼出来 —— 那样客户端要多打 2 到 3 次请求，首屏会慢，且三次请求之间没有一致性。

**要答的**：选哪条；若选 1，推荐排序的口径是什么。`,
  },
  {
    label: 'wayfinder:grilling',
    title: 'G112 · 教师看不看得到家长交上来的栏目素材：补读端点，还是「查看」不做',
    body: `## Question

栏目投稿那一屏（\`growth-book-section-materials\`，2026 春季学期编册 → 点一个已发布的班级栏目）每条记录有一个「查看」，点开要展开家长写的正文与照片。原型 \`screens/growth-book-section-materials.html\` 第 61 行。

**教师端读不到。** \`BookMaterialSubmission\`（成长册栏目要素材，教师向家长征集，家长交上来的那一笔）全契约**只出现在一处**：\`autosaveBookMaterial\`，即 \`PUT /parent/growth-book/sections/{section_id}/submissions\` —— 那是家长端的自动保存。

后果：教师看不到家长交了什么，就评不了这一栏、也统不了稿。已登记 \`db/GAPS.md\` **G112**，与 G70／G108 同批（成长册那一族）。

**两条出路，必须选一条：**

1. 补一条教师侧读端点。**要先定范围规则**：教师能读哪些班、哪些栏目、能不能读别班的，以及家长撤回后那条记录怎么算。这不是简单加一条。
2. 认定「查看」不做，把入口摘掉。

**要答的**：选哪条；若选 1，范围规则是什么。`,
  },
  {
    label: 'wayfinder:task',
    title: 'task · 让 56 屏能真渲染：装微信开发者工具，用已经装好的 miniprogram-automator',
    body: `## Question

不是决策，是**先把一件挡住判断的事做掉**：教师端 56 屏今天**一屏都渲染不出来**，所以「这一屏长对了没有」谁也答不了 —— 十步闸门、探针、接线扫描**全部查不出渲染问题**（CLAUDE.md §6 最后一行写着「上面全部查不出来」）。

**查清的事实**：微信开发者工具**这台机器上没装**（四个常见安装目录 + \`LOCALAPPDATA\` 都查过，没有服务、PATH 里没有）。\`miniprogram-automator\` **装了**（在 \`package.json\`），但**一处都没引用**。所以「渲不了」不是被封，是这条路从来没接上。\`tools/web-capture/\` 是给网页原型写的，抓的是 \`screens/*.html\`，与 miniprogram 无关。

\`project.config.json\` 的 \`appid\` 是真的（\`wxbda23b3884ae4d69\`），\`urlCheck: false\`。

**要做的：**

1. 装微信开发者工具（官方下载）。**唯一一次性的门槛**：它要扫码登录一次，只有人能做。
2. 用已装的 \`miniprogram-automator\` 写一支脚本：编译、逐页跳、取元素文本、截图。
3. **先只做 3 屏样板**（\`login\`／\`home\`／\`growth-book\`），证明这条路通，再决定铺不铺 56 屏。一次铺 56 屏会先撞上一堆「元素找不到」。

**做不到的**：挂进 CI。它要 GUI 与登录，GitHub Actions 上跑不起来。所以「每页截图」只能是本机能力。

**做完要回填的**：3 屏样板跑通的证据（元素文本或截图路径），以及第 1 步卡在哪（如果要人扫码，就写清楚卡在那一格）。`,
  },
  {
    label: 'wayfinder:task',
    title: 'task · 三页该调契约已有的端点：教师档案回显、文件列表取档、学期评价照片来源',
    body: `## Question

不是决策，是**执行**：三条对账报出来的「客户端缺口」，缺的不是契约，是这几页没去调契约里**已经有**的端点。

| 屏（屏幕上叫） | 契约已有的端点 | 今天的状态 |
|---|---|---|
| \`teacher-profile\`（个人档案，教研培训 → 个人档案） | \`getSession\` | 编辑弹层要回显「姓名」「任教班级」，两页映射表里对应 \`getSession\` 的行数是 **0** |
| \`coordination-file-list\`（文件列表，综合协调 → 文件列表） | \`GET /media/files/{file_id}/url\` | 卡片与弹层里的「下载」（原型第 219／238 行）没有取档调用。契约明写教师取 k6 会写一笔 \`downloaded\` |
| \`teacher-term-form\`（填写学期评价） | 照片来源那一条读 | 入口在小程序里**已置灰并写明待接入** |

**要做的**：给这三页接上对应的调用，并补进 \`db/spec/screen-operations.tsv\` 的相应行（那三行今天是 \`human\`，带缺口说明）。

**注意**：\`coordination-file-list\` 那两条读已经在表里，缺的是取档那一格 —— 别把两条读当成「已经接好了」。

**做完要回填的**：三页各自接上后的探针或渲染证据。`,
  },
];

// 1) 地图
writeFileSync(`${DIR}/map.md`, mapBody);
const mapUrl = sh(`gh issue create -R ${REPO} --label "wayfinder:map" --title "地图：每一屏要用的操作，契约里都有落点" --body-file "${DIR}/map.md"`);
const mapNum = mapUrl.split('/').pop();
console.log('地图', `#${mapNum}`, mapUrl);

// 2) 子票
const created = [];
for (const t of tickets) {
  const f = `${DIR}/t${created.length + 1}.md`;
  writeFileSync(f, t.body);
  const url = sh(`gh issue create -R ${REPO} --label "${t.label}" --title ${JSON.stringify(t.title)} --body-file "${f}"`);
  created.push({ num: url.split('/').pop(), label: t.label, title: t.title, url });
  console.log(`  #${url.split('/').pop()}  [${t.label}]  ${t.title.slice(0, 46)}`);
}

// 3) 把子票列进地图正文（本图携带执行票，与地图 #1 同一形状）
let body = mapBody.replace('<!-- 一条未关。 -->', created.map((c) => `- [${c.title}](${c.url})`).join('\n'));
writeFileSync(`${DIR}/map-final.md`, body);
sh(`gh issue edit ${mapNum} -R ${REPO} --body-file "${DIR}/map-final.md"`);
console.log('\n地图正文已回填', created.length, '条子票');
