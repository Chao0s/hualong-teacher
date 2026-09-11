# 页面覆盖与代码阅读证据

快照：2026-09-11，教师端提交 `81fc7a6`。注册页55个，全部分配至21张教师端审核草案；原14已移至 external，仅为外部联验参考，不计入用户审核范围。

初次快照直接引用service为46页；01总览接入后，当前工作区为47页直接引用、8页未直接引用。**直接引用service不代表整页数据已真实化，更不代表接口或渲染通过。** 比如成长册页面可同时包含真实抬头与样张正文；固定入口配置也不一定需要接口。

标题来自当前页面配置；动态页面标题可能被对象名覆盖。此表保留技术定位，具体人手步骤在票内，不要求审核者阅读源码。

| 注册页面（定位用） | 当前配置标题 | 直接引用service | 审核草案 |
| --- | --- | --- | --- |
| `home` | 首页 | 是 | [15 首页快捷入口与教师待办处理](drafts/15-home-tasks.md) |
| `upload-resource` | 上传资料 | 是 | [18 上传资源案例、草稿与驳回后重交](drafts/18-resource-upload.md) |
| `teacher-tasks` | 待办任务 | 是 | [15 首页快捷入口与教师待办处理](drafts/15-home-tasks.md) |
| `teacher-task-detail` | 任务详情 | 是 | [15 首页快捷入口与教师待办处理](drafts/15-home-tasks.md) |
| `assessment-tool` | 质量评估 | 是 | [16 办园质量评估与首页徽标回查](drafts/16-school-assessment.md) |
| `school-affairs` | 党建管理部 | 是 | [19 党建三类内容浏览与附件](drafts/19-party.md) |
| `party-study-list` | 党建学习 | 是 | [19 党建三类内容浏览与附件](drafts/19-party.md) |
| `party-study-detail` | 文件预览 | 是 | [19 党建三类内容浏览与附件](drafts/19-party.md) |
| `party-activity-list` | 党建活动 | 是 | [19 党建三类内容浏览与附件](drafts/19-party.md) |
| `party-activity-detail` | 活动介绍 | 是 | [19 党建三类内容浏览与附件](drafts/19-party.md) |
| `party-brand-list` | 品牌建设 | 是 | [19 党建三类内容浏览与附件](drafts/19-party.md) |
| `party-brand-detail` | 图文介绍 | 是 | [19 党建三类内容浏览与附件](drafts/19-party.md) |
| `comprehensive-coordination` | 综合协调部 | 否 | [20 综合协调七类文件入口与占位反馈](drafts/20-coordination.md) |
| `coordination-file-list` | 文件列表 | 否 | [20 综合协调七类文件入口与占位反馈](drafts/20-coordination.md) |
| `training-center` | 教研培训部 | 否 | [17 课程入口、资源案例检索与取档](drafts/17-resource-browse.md) |
| `course-building` | 课程建设 | 否 | [17 课程入口、资源案例检索与取档](drafts/17-resource-browse.md) |
| `resource-center` | 课程资源 | 否 | [17 课程入口、资源案例检索与取档](drafts/17-resource-browse.md) |
| `training-list` | 教研培训 | 是 | [21 教研培训报名、反馈与我的研修](drafts/21-training.md) |
| `training-detail` | 研修详情 | 是 | [21 教研培训报名、反馈与我的研修](drafts/21-training.md) |
| `teacher-profile` | 个人档案 | 是 | [22 个人档案修改申请与证书回看](drafts/22-teacher-profile.md) |
| `my-training` | 我的研修 | 是 | [21 教研培训报名、反馈与我的研修](drafts/21-training.md) |
| `resource-library` | 资源库 | 是 | [17 课程入口、资源案例检索与取档](drafts/17-resource-browse.md) |
| `resource-detail` | 资源详情 | 是 | [17 课程入口、资源案例检索与取档](drafts/17-resource-browse.md) |
| `case-library` | 案例库 | 是 | [17 课程入口、资源案例检索与取档](drafts/17-resource-browse.md) |
| `case-detail` | 案例详情 | 是 | [17 课程入口、资源案例检索与取档](drafts/17-resource-browse.md) |
| `home-school` | 家园社共育 | 是 | [01 家园共育入口与三处进度表核对](drafts/01-family-overview.md) |
| `home-school-moments` | 在园时光 | 是 | [02 在园时光发布、照片与幼儿关联](drafts/02-moments.md) |
| `home-school-moment-feed` | 全部活动 | 是 | [02 在园时光发布、照片与幼儿关联](drafts/02-moments.md) |
| `home-school-moment-publish` | 发布活动 | 是 | [02 在园时光发布、照片与幼儿关联](drafts/02-moments.md) |
| `parent-tasks` | 亲子任务 | 是 | [03 亲子任务草稿、发布与家长完成情况](drafts/03-parent-tasks.md) |
| `parent-task-detail` | 任务详情 | 是 | [03 亲子任务草稿、发布与家长完成情况](drafts/03-parent-tasks.md) |
| `parent-task-publish` | 发布新任务 | 是 | [03 亲子任务草稿、发布与家长完成情况](drafts/03-parent-tasks.md) |
| `growth-record` | 儿童成长档案 | 是 | [01 家园共育入口与三处进度表核对](drafts/01-family-overview.md) |
| `teacher-evaluation` | 教师评价 | 否 | [01 家园共育入口与三处进度表核对](drafts/01-family-overview.md) |
| `teacher-monthly-evaluation` | 教师月度评价 | 是 | [05 月度评价选片、草稿与发布给家长](drafts/05-monthly-evaluation.md) |
| `teacher-monthly-form` | 填写月度评价 | 是 | [05 月度评价选片、草稿与发布给家长](drafts/05-monthly-evaluation.md) |
| `teacher-term-evaluation` | 教师学期评价 | 是 | [06 学期评价保存及发送入口真实性](drafts/06-term-evaluation.md) |
| `teacher-term-form` | 填写学期评价 | 是 | [06 学期评价保存及发送入口真实性](drafts/06-term-evaluation.md) |
| `teacher-message` | 教师寄语 | 是 | [07 教师寄语提交对象与永久只读](drafts/07-teacher-message.md) |
| `teacher-message-detail` | 寄语详情 | 是 | [07 教师寄语提交对象与永久只读](drafts/07-teacher-message.md) |
| `parent-evaluation-publish` | 发布家长测评 | 是 | [04 发起家长评价与阅读家长回复](drafts/04-parent-evaluations.md) |
| `parent-evaluation-detail` | 测评进度 | 是 | [04 发起家长评价与阅读家长回复](drafts/04-parent-evaluations.md) |
| `community-coeducation` | 社区共育 | 是 | [09 社区共育投稿阅读与逐幼儿收录](drafts/09-community-feed.md) |
| `growth-comprehensive-assessment` | 综合评估 | 是 | [08 幼儿综合评估保存、明细与雷达图](drafts/08-child-assessment.md) |
| `comprehensive-assessment-form` | 开始综合评估 | 是 | [08 幼儿综合评估保存、明细与雷达图](drafts/08-child-assessment.md) |
| `comprehensive-assessment-report` | 综合评估结果 | 是 | [08 幼儿综合评估保存、明细与雷达图](drafts/08-child-assessment.md) |
| `comprehensive-assessment-class-report` | 班级评估报告 | 是 | [08 幼儿综合评估保存、明细与雷达图](drafts/08-child-assessment.md) |
| `growth-book` | 成长册 | 是 | [13 成长册样本、编册锁定与定稿开放](drafts/13-book-publish.md) |
| `growth-book-time-manage` | 在园时光管理 | 是 | [10 在园活动入册与主题管理](drafts/10-book-moments.md) |
| `growth-book-task-manage` | 亲子时光管理 | 否 | [11 亲子时光管理的示例与真实收录区分](drafts/11-book-family.md) |
| `growth-book-section-materials` | 栏目投稿 | 是 | [12 自定义栏目排版、征集与提醒家长](drafts/12-book-sections.md) |
| `growth-book-edit` | 2026 春季学期编册 | 是 | [13 成长册样本、编册锁定与定稿开放](drafts/13-book-publish.md) |
| `growth-book-sample` | 成长册样本 | 否 | [13 成长册样本、编册锁定与定稿开放](drafts/13-book-publish.md) |
| `growth-book-view` | 成长册预览 | 是 | [13 成长册样本、编册锁定与定稿开放](drafts/13-book-publish.md) |
| `growth-book-section-edit` | 栏目版面 | 是 | [12 自定义栏目排版、征集与提醒家长](drafts/12-book-sections.md) |

## 入口与待接入证据

- **01 家园共育入口与三处进度表核对**：`miniprogram/pages/home-school/index.js`；`miniprogram/pages/home-school/index.wxml`；`miniprogram/pages/teacher-evaluation/index.js`；`miniprogram/pages/growth-record/index.wxml`。
- **02 在园时光发布、照片与幼儿关联**：`miniprogram/pages/home-school-moment-publish/index.wxml`；`miniprogram/pages/home-school-moment-publish/index.js`；`miniprogram/pages/home-school-moment-feed/index.wxml`。
- **03 亲子任务草稿、发布与家长完成情况**：`miniprogram/pages/parent-task-detail/index.wxml`；`miniprogram/pages/parent-task-publish/index.wxml`。
- **04 发起家长评价与阅读家长回复**：`miniprogram/pages/parent-evaluation-publish/index.wxml`；`miniprogram/pages/parent-evaluation-detail/index.wxml`。
- **05 月度评价选片、草稿与发布给家长**：`miniprogram/pages/teacher-monthly-form/index.wxml`；`miniprogram/pages/teacher-monthly-form/index.js`。
- **06 学期评价保存及发送入口真实性**：`miniprogram/pages/teacher-term-evaluation/index.wxml`；`miniprogram/pages/teacher-term-evaluation/index.js`；`miniprogram/pages/teacher-term-form/index.js`。
- **07 教师寄语提交对象与永久只读**：`miniprogram/pages/teacher-message/index.wxml`；`miniprogram/pages/teacher-message-detail/index.wxml`；`decision.md`；`docs/DO-NOT-BUILD.md`。
- **08 幼儿综合评估保存、明细与雷达图**：`miniprogram/pages/growth-comprehensive-assessment/index.wxml`；`miniprogram/pages/growth-comprehensive-assessment/index.js`；`miniprogram/pages/comprehensive-assessment-report/index.wxml`。
- **09 社区共育投稿阅读与逐幼儿收录**：`miniprogram/pages/community-coeducation/index.js`；`miniprogram/pages/community-coeducation/index.wxml`。
- **10 在园活动入册与主题管理**：`miniprogram/pages/home-school-moment-feed/index.js`；`miniprogram/pages/growth-book-time-manage/index.wxml`。
- **11 亲子时光管理的示例与真实收录区分**：`miniprogram/pages/growth-book-task-manage/index.js`。
- **12 自定义栏目排版、征集与提醒家长**：`miniprogram/pages/growth-book-section-edit/index.wxml`；`miniprogram/pages/growth-book-section-materials/index.js`；`decision.md`。
- **13 成长册样本、编册锁定与定稿开放**：`miniprogram/pages/growth-book-view/index.js`；`miniprogram/pages/growth-book-edit/index.wxml`；`miniprogram/pages/growth-book/index.wxml`；`miniprogram/app.json`。
- **外部参考14 家长实际收发与跨幼儿范围联验**：`../hualong-parent/README.md`；`miniprogram/pages/teacher-term-evaluation/index.js`；`decision.md`。
- **15 首页快捷入口与教师待办处理**：`miniprogram/pages/home/index.js`；`miniprogram/pages/teacher-task-detail/index.wxml`。
- **16 办园质量评估与首页徽标回查**：`miniprogram/pages/home/index.js`；`miniprogram/pages/assessment-tool/index.js`。
- **17 课程入口、资源案例检索与取档**：`miniprogram/pages/training-center/index.js`；`miniprogram/pages/resource-center/index.js`；`miniprogram/pages/course-building/index.js`。
- **18 上传资源案例、草稿与驳回后重交**：`miniprogram/pages/upload-resource/index.wxml`；`miniprogram/pages/upload-resource/index.js`；`docs/DO-NOT-BUILD.md`。
- **19 党建三类内容浏览与附件**：`miniprogram/pages/school-affairs/index.js`；`miniprogram/pages/party-study-detail/index.wxml`。
- **20 综合协调七类文件入口与占位反馈**：`miniprogram/pages/comprehensive-coordination/index.js`；`miniprogram/pages/coordination-file-list/index.js`。
- **21 教研培训报名、反馈与我的研修**：`miniprogram/pages/training-detail/index.wxml`；`miniprogram/pages/my-training/index.wxml`。
- **22 个人档案修改申请与证书回看**：`miniprogram/pages/teacher-profile/index.wxml`。

另已对照：`docs/DO-NOT-BUILD.md`、`decision.md`最新覆盖段、`docs/audit/wiring-2026-09-10.md`、`docs/audit/growth-book-endpoints.md`及2026-09-09交接。历史文档与当前代码有冲突时已在票面标明，不照搬过期“已做／未做”结论。

## 特别记录：找不到逐幼儿成长册预览入口

对当前小程序页面、组件的跳转引用检索发现，“成长册预览”只有注册与自身实现，没有用户可点的跳转引用；成长册进度表幼儿行也没有绑定该跳转。故13写“入口缺口”，没有编造“点幼儿姓名即可预览”。

助手如需协助查看该页，可按当前工程路由 `pages/growth-book-view/index` 与有效测试幼儿参数准备临时直达；这属于辅助定位，不能替代正式入口审核。

## 家长端边界

只读查看了相邻 `D:/hualong-parent` 的README与文件清单：现有目录为静态HTML原型，没有发现小程序注册文件。没有读取真实家庭数据，也没有运行跨端测试。external/14内的原型入口仅供外部负责人参考，不要求用户操作、准备家长账号或完成联验。

