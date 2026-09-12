# 交接：01号票已验收，下一步02号票

本文件保留01号票完成时的历史交接。当前已进入12号票，最新合并与待办见[main交接](2026-09-12-main-integration.md)。

交接日期：2026-09-12（Asia/Shanghai）。明日待办日期：2026-09-13。
本文件按用户指定保存在教师仓库docs/handoff。
handoff技能默认写入系统临时目录，本文件覆盖那条要求。

## 最新用户说明，优先于旧票据

原交接保留两个问题，均已解决：自动联动已修复并测试，用户随后明确确认四项人工复查全部完成。最新验收见01号票J段，下一步02号票。每次回复必须明确下一步的要求已写入根目录AGENTS.md。

用户特别强调：**“现在主页中已经没有成长档案了，因为界定不清楚。”**

用户后来明确加入成长册：当前完成度表为幼儿、在园时光、亲子活动、成长册，平均与待提醒按三项计算。未恢复成长档案总状态列。存量“成长档案”入口仍通往已修复的评价进度页，不把它与已删除的总状态概念混淆。

## 待办状态

- [x] **评价进度自动更新联动。** 已改为读取时按真实评价记录重算并刷新派生缓存。已核对用户报告的已提交学期评价，并用数据库回滚测试覆盖源状态变化、未来月份不抵消当前缺月和缺缓存恢复。旧人工汇总样本已失效，不再直接修改缓存造状态。is_term_end仍沿用已有阶段标志。
- [x] **最终人工复查。** 用户已明确确认上面四项均检查完成，01标记passed。保留原证据与边界，不把其他票据也判为通过。

**01号票已完成，下一步02号票。** 进入家园社共育→在园时光→发布活动，先看选照片、选幼儿与人数反馈，再走发布和回读。家长端不在用户责任范围内。

## 接手先看这些，不重做已有调查

- [01号票](../../.scratch/manual-page-review-2026-09-11/drafts/01-family-overview.md)：D—H记录当前实现、样本、验证与边界。C明确是旧四项历史说明。先看最新段。勿照旧段恢复功能。
- [审核清单](../../.scratch/manual-page-review-2026-09-11/README.md)及[页面覆盖](../../.scratch/manual-page-review-2026-09-11/coverage.md)：21张教师端票，原14为外部参考。
- [前端决策](../../decision.md)：2026-09-12的总览圆点、评价进度与教师评价接线记录。
- [教师端字段规格](../backend%20spec%20files/05%20home-school-spec.md)：进度口径和页面绑定。业务边界先遵循用户最新说明。
- 后端权威有三处：[DECISIONS.md](../../../hualong-backend/DECISIONS.md) F30/F31、[API-CONTRACT.md](../../../hualong-backend/docs/API-CONTRACT.md) v0.29/v0.30、后端AGENTS.md。
- 新校验流程已有10步。

## 三条读取链不要混淆

| 链路 | 当前实现及核验边界 |
| --- | --- |
| 家园社共育总览 | GET /home-school/progress实时计算在园时光、亲子活动、成长册三项，平均按三项计算。没有成长档案总状态列。 |
| 教师评价四项进度 | GET /teacher-evaluations/progress实时读取业务记录；已与四个子页及完成项详情比对。月评／学期评估限定当前教师，寄语按幼儿+学期共享。 |
| growth-record路由中的“评价进度” | GET /growth-records及单条读取实时重算真实记录，刷新派生缓存，缺缓存自动建立；旧人工显示状态不再作为依据。 |

直接定位：[评价进度页面](../../miniprogram/pages/growth-record/index.js)、[评估service](../../miniprogram/services/assessment.js)、[后端读取与提交路由](../../../hualong-backend/db/testdata/server/routes/teacher.mjs)、[教师评价总览路由](../../../hualong-backend/db/testdata/server/routes/teacher-evaluation.mjs)。

## 工作区与测试环境

- 教师仓库是D:/hualong-teacher，分支master。后端是D:/hualong-backend，分支main。交接开始时基线分别是e924817、391a7dc。随后用户要求提交并推送。又合入同事更新至8901d1b、d4bcee3。**最终提交和推送状态以Git记录为准。** 新会话先git status／log，别把这份交接的编写时状态当作当前状态。不要reset、clean或覆盖后续改动。
- 合并两份页面映射表后，保留了同事的人工说明与新状态词。加入本轮接口后，用新版生成器重算映射表。文件级改动与交付结果直接看两仓库提交记录。本文件不复制diff。
- 本地测试API是http://127.0.0.1:3860/api/v1。Swagger是http://127.0.0.1:3830/。按屏幕视图是/pages。新会话先检查健康接口，不要假定进程还活着。生产服务没有部署。
- 测试基准日是2026-04-25，不是真实日期。月份、学期和本周都按测试服务基准日算。不要用电脑日期解释当前样本。
- 样本、变更前备份与新增记录ID在[本地证据目录](../../.scratch/manual-page-review-2026-09-11/evidence/)。仓库的忽略清单盖住了*.local.json和*.log，这两份不在GitHub。不要清掉它们。准备脚本各自注明边界。别无条件重跑脚本。不要重新导入种子数据覆盖用户正在审核的样本。

## 已有验证，可在相关修复后复用

前端8项检查（含tools语法）、后端10项常规检查通过；新一轮另有3个数据库回滚测试、4个综合评估交互回归测试和三页HTTP探针通过。评价进度自动重算已验证，界面人工验收仍未完成；详见01号票I段。

- [probe-home-school-progress.mjs](../../tools/probe-home-school-progress.mjs)
- [probe-growth-record.mjs](../../tools/probe-growth-record.mjs)
- [probe-teacher-evaluation.mjs](../../tools/probe-teacher-evaluation.mjs)
- 后端db/testdata/server/tests/teacher-evaluation.test.mjs

额外全前端data-ui扫描此前有86条既有问题。
与当时基线相比，这批问题没有新增。不要把“常规10项通过”说成全量前端扫描全绿。后续改接口要同步Swagger所用的screen-operations.tsv和operation-eli10.tsv。后者只手工填写规定的两列。流程见两仓库工作约定。

## Suggested skills

- **implement**：若人工复查再提出明确修复，用于那一项实现，不批量执行全部审核票。该技能带Git提交步骤；人工显示通过与代码检查通过须分别记录。
- **grilling**：如果用户需要重新界定“评价进度”或入口是否保留，用它讨论产品决定；先自行查事实，不把代码调查交给用户。
- **context7-mcp**：只有涉及库、框架或公共API用法时读取并查文档；当前会话没有可调用的Context7工具，不要虚报已查。
- **caveman-commit**：用户进入提交／推送收尾时使用简短Conventional Commits；跨仓库涉及契约时先推后端、再推教师端。
- **handoff**：下次再次交接时更新待办和链接，沿用户指定目录存放。

## 下次开场可直接使用

“01号票已完成人工验收，接下来审核02号票。请进入家园社共育→在园时光→发布活动，先添加横图和竖图、勾选两名幼儿，检查预览和人数反馈。”

用户已确认只在交接文件中列待办，不建立自动通知。01的两个旧问题均已解决，下一会话提醒02号票的第一个检查动作，不重复要求验收01。
