## Destination

`db/spec/screen-operations.tsv`（一屏一操作一行）里每一屏要用的操作，在契约里都有落点。
达标判据：表里 `no-api`／`planned`／带缺口的 `human` 行全部有结论；五条新登记缺口
G109–G113 各自定夺；页面级那 72 条对照（22 只wxml + 20 原型无按钮 + 30 写入无原型控件）
逐条有结论；原型与契约的差集收敛到「不建」或「误报」两类。

## Notes

- 来源：2026-09-12 的三组原型↔映射表对账（`docs/audit/proto-vs-table-2026-09-12.md`，读 57 页），
  以及同日的十层检测全集（`node .claude/skills/hualong-api-test/run.mjs --all`，28 条发现）。
- 五条缺口已登记在 `hualong-backend/db/GAPS.md` 的 **G109–G113**。**契约一个字节还没改。**
- **本图由 herman925 起、由 herman925 推进。** 另一条开发线是 **linem7（朝湃）**，
  交接与审计件按这两个 handle 署名。
- 改动顺序不能反（CLAUDE.md §2）：先 `hualong-backend/api/openapi.yaml`，再服务端，最后客户端；
  改契约要同步 `api/action-registry.tsv` 与 `docs/API-CONTRACT.md` §15。
- 检测用 `.claude/skills/hualong-api-test/run.mjs`：**快集**（`contract wire cover proto repo`，
  不碰凭据／云／GUI）每改一次跑；**`--all`** 用于收尾与交接。两层都印出用的是哪一套。
- 权威顺序：`DECISIONS.md` > `db/01_schema.sql` > `DATABASE_SPEC.md` > spec 文件 > 原型。
  **但原型是「交互意图」的参考** —— 本图的整个问题就是小程序有没有把原型表达的意图包全。
- 决策票用 `/grilling` 与 `/domain-modeling`。
- 名词注解规则见 CLAUDE.md §1：第一次提到 G 编号、表名、端点名要带一句它是什么。

## Decisions so far

- [G109 · 资源详情要显示「这个资源被哪些案例用了」：契约补读端点，还是从原型摘掉](https://github.com/Chao0s/hualong-teacher/issues/77)
- [G110 · 课程资源要能按关键词搜：契约加 keyword 参数，还是客户端本地过滤够用](https://github.com/Chao0s/hualong-teacher/issues/78)
- [G111 · 教研培训部的首页三块推荐：补聚合端点，还是客户端多打几次](https://github.com/Chao0s/hualong-teacher/issues/79)
- [G112 · 教师看不看得到家长交上来的栏目素材：补读端点，还是「查看」不做](https://github.com/Chao0s/hualong-teacher/issues/80)
- [task · 让 56 屏能真渲染：装微信开发者工具，用已经装好的 miniprogram-automator](https://github.com/Chao0s/hualong-teacher/issues/81)
- [task · 三页该调契约已有的端点：教师档案回显、文件列表取档、学期评价照片来源](https://github.com/Chao0s/hualong-teacher/issues/82)
- [G113 · `GET /moments` 的 `child_id` 在教师侧没实现：补按幼儿筛，还是另立相册端点](https://github.com/Chao0s/hualong-teacher/issues/83)
- [页面级对照 · 22 个操作小程序够得着、原型却没有对应控件](https://github.com/Chao0s/hualong-teacher/issues/84)
- [页面级对照 · 20 个操作原型没给按钮，30 个写入没有原型控件](https://github.com/Chao0s/hualong-teacher/issues/85)

## Not yet specified

- 原型落后要不要系统性修一次。那 7 条「契约先行、原型掉了」是同一件事的七个面，
  一条一条改原型不解决它。
- `screen-operations.tsv` 的 `state` 列每格还带 `?` —— 机器按 handler 名猜的，没人核过。
- 对账里 `unsure` 那 18 条（三组各自标了「没把握」）要不要再扫一轮。

## Out of scope

**生产环境那一线** —— 不同目的地（把已选的安全与部署决议落到机器上），归后端仓库的票，本图不开票：

| 检测报的 | 归谁 |
|---|---|
| `db/authz-not-built`：RLS **0/62 张表**开着（ADR-0016 §3 是授权模型） | `hualong-backend#7` |
| `db/migrations` 跳过：无 `db/migrations` 与 `schema_migrations` | `hualong-backend#6` |
| `vm/exposure-surface`：80 端口公开挂着 nginx 默认页且无 TLS；4 个监听超出回环 | `hualong-backend#11` |
| `vm/deploy-key` 跳过：主机上还没有部署密钥 | `hualong-backend#5` |
| `api` 整层跳过：3001 上没有服务 | `hualong-backend#9` |

- 地图 #1「接线审计 2026-09-08」—— 另一个目的地，不动它。
- 原型文件本身的排版与样式。