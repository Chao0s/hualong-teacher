# 不得建造清单 — 教师端

> 建立：2026-08-23（票据 01）。**每张施工票据开工前逐条核对本清单，核对结论写进票据。**
> 与清单冲突的提议直接拒收，不再逐次讨论。
> 清单只增不删：新增一条必须带上禁止它的权威；删除一条必须带上取代该权威的决定。

| # | 不得建造 | 权威 |
| --- | --- | --- |
| 1 | 观察记录不作为页面出现，不建任何入口。它经既定外部渠道收集。 | Platform `app-structure.json` invariants；`docs/APP-STRUCTURE.md` 结构不变量 4 |
| 2 | 教师端不存在任何通往 PC后台 的路径。管理职能不进小程序。 | 结构不变量 3；`roleAccess`（PC后台 仅 admin） |
| 3 | 成长册不做导出、下载、分享。册子只存在于应用内，无 PDF、无图册、无 `wx.shareFileMessage`。 | 后端 `DECISIONS.md` F17；Platform `docs/SECURITY.md` §5 |
| 4 | 教师端不实现监护人同意采集界面。同意与留存是园方／法务签核事项，不是客户端功能。 | 后端 `db/GAPS.md` G11／G25／G26（BLOCKER）；教师端 spec Out of Scope |
| 5 | 不做角色切换。一个客户端一个角色，登录时确定、会话期内固定。 | API 契约 §6.1；`utils/session.js`（无 `setRole`，有意为之） |
| 6 | 不做个性化推荐与兴趣画像。涉及自动化决策与算法备案，另议。 | Platform `docs/adr/0011-personalization-and-habit-analytics.md`；教师端 spec Out of Scope |
| 7 | 解析不到角色必须致命，绝不当作空规则集。空规则集会被读成「没有限制」。 | API 契约 §7.2；`utils/guard.js`（`RoleResolutionError`） |
| 8 | 客户端永不发送服务端派生的作者字段（`teacher_id`、`created_by` 等）。发出前剥离，不依赖服务端忽略顺序。 | API 契约 §7.3／§7.3.1；`utils/derived.js` |
| 9 | 时间戳不做时区转换。白名单内的计划时间带 `+08:00` 字面量提交；白名单以契约的列表为准，不以其上方正文计数为准。 | API 契约 §1.2；`utils/time.js` |
| 10 | 身份入口无侧门：没有短信回退、没有邀请码、没有手工绑定、没有密码后门。配额耗尽是硬停止。 | API 契约 §6.2；后端 F17（登录部分）；`utils/auth.js` 头注 |
| 11 | 分页只有游标。不存在页号、偏移量、总数；游标为空是结束的唯一信号。名册型集合整取不分页。 | API 契约 §3.1／§3.5；`utils/request.js` |
| 12 | 在园时光与亲子任务不出现视频入口。`wx.uploadFile` 单次 10 MB 硬上限使手机视频根本发不出去；三条出路未拍板。 | 后端 `db/GAPS.md` G41（BLOCKER）；ADR-0016 视频音频行；Platform PRD §7.4 |
| 13 | 客户端不调用内容安全接口。`security.*` 需要 AppSecret，只能在服务端调用；客户端的义务是**声明**把关路径（`utils/moderation` 的 GATES／assertGate／requireHumanGate），不是调用。 | Platform ADR-0016；`utils/moderation.js` |
| 14 | 底部导航就是五项（首页／党建管理／综合协调／教研培训／家园社共育），也只能是五项——平台上限即五。第六个模块入口走页面内入口，不动导航。 | 微信平台 tabBar 上限；`app-structure.json` 四个入口页的登记 |

## 核对方式

开工一张票据时，在其 `## Comments` 里写一行：

```
DO-NOT-BUILD 核对（2026-MM-DD）：无冲突。
```

或指名冲突条目并停下来——冲突意味着票据本身有错，或清单需要按上面的规则修订。
