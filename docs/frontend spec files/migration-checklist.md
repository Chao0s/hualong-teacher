# 迁移清单 — 结构契约 45 个页面 ↔ 原型文件

> 建立：2026-08-23（票据 01）。
> 权威：`Hualong Platform/harness/structure/app-structure.json` —— 教师端可达页面 **45 个 = 41 个流程图页面
> + 4 个底部导航入口页**。**按本清单施工，不按 `screens/` 目录施工**：目录里有 55 个原型，多于 45，多出的
> 部分是家长端页面、评审工作页与画廊入口，见末节。
> 原型列是「最接近的视觉参照」，不是 1:1 承诺；一个原型可服务多个页面，反之亦然。标 `?` 的映射在该模块
> 开工时再核对。

## 首页（7）

| Screen id | 中文 | UGC | 原型参照 |
| --- | --- | --- | --- |
| Home | 首页 | | home.html |
| TaskBoard | 任务进度看板 | | teacher-tasks.html |
| UploadForm | 上传表单 | UGC | upload-resource.html |
| TaskDetail | 任务详情页 | | teacher-task-detail.html |
| SubmitMaterial | 提交材料 / 反馈 | UGC | teacher-task-detail.html（提交区） |
| NoticeList | 通知列表页 | | home.html（通知区）? —— 无独立原型，样式沿列表约定 |
| NoticeDetail | 通知详情页 | | 无独立原型 ? —— 沿详情页约定 |

## 党建管理（6 + 入口页）

| Screen id | 中文 | UGC | 原型参照 |
| --- | --- | --- | --- |
| PartyHome | 党建管理入口页 | | school-affairs.html（notInFlowchart） |
| LearnList | 学习资料列表 | | party-study-list.html |
| LearnDetail | 资料详情页 | | party-study-detail.html |
| ActivityList | 活动列表页 | | party-activity-list.html |
| ActivityDetail | 活动详情页 | | party-activity-detail.html |
| BrandList | 品牌建设资料列表 | | party-brand-list.html |
| BrandDetail | 品牌建设详情页 | | party-brand-detail.html |

## 综合协调（6 + 入口页）

| Screen id | 中文 | UGC | 原型参照 |
| --- | --- | --- | --- |
| CoordHome | 综合协调入口页 | | comprehensive-coordination.html（notInFlowchart） |
| XZList / XZDetail | 行政资料列表 / 详情 | | coordination-file-list.html（三类共用一套列表原型，按类目参数化） |
| HQList / HQDetail | 后勤资料列表 / 详情 | | coordination-file-list.html |
| HRList / HRDetail | 人事资料列表 / 详情 | | coordination-file-list.html |

## 教研培训（7 + 入口页）

| Screen id | 中文 | UGC | 原型参照 |
| --- | --- | --- | --- |
| TrainHome | 教研培训入口页 | | training-center.html（notInFlowchart） |
| CourseIntroDetail | 办园理念 / 课程体系详情页 | | course-building.html |
| FiveChart | 评价五维图 | | assessment-tool.html ? |
| Scale | 填写五大领域量表 | UGC | assessment-tool.html / comprehensive-assessment-form.html ? |
| Radar | 生成五维雷达图 | | comprehensive-assessment-report.html（雷达区） |
| TrainList | 研修列表页 | | training-list.html |
| TrainDetail | 研修详情页 | | training-detail.html |
| TrainFeedback | 研修反馈 / 评论 | UGC | training-detail.html（反馈区） |

## 资源库（3）＋ 案例库（3）

| Screen id | 中文 | UGC | 原型参照 |
| --- | --- | --- | --- |
| CourseResourceHome | 课程库 + 资源库首页 | | resource-center.html |
| ResourceList | 资源列表页 | | resource-library.html |
| ResourceDetail | 资源详情页 | | resource-detail.html |
| CaseList | 案例列表页 | | case-library.html |
| CaseDetail | 案例详情页 | | case-detail.html |
| TeacherUpload | 教师上传资源或案例 | UGC | upload-resource.html |

## 家园社共育（9 + 入口页）

| Screen id | 中文 | UGC | 原型参照 |
| --- | --- | --- | --- |
| CoEduHome | 家园社共育入口页 | | home-school.html（notInFlowchart；原型底部导航标签为旧称，须改为 家园社共育） |
| GardenPublish | 在园时光发布页 | UGC | home-school-moment-publish.html（**只收图片**，G41 未拍板前不建视频入口） |
| TaskPublish | 教师发布亲子任务 | UGC | parent-task-publish.html |
| TaskProgress | 教师查看完成进度 | | home-school.html（进度区）? |
| GardenProgress | 在园时光发布进度汇总 | | home-school-moments.html / home-school-moment-feed.html ? |
| MonthEval | 月度评价填写页 | UGC | teacher-monthly-form.html + teacher-monthly-evaluation.html |
| TermEval | 学期评价 | UGC | teacher-term-form.html + teacher-term-evaluation.html |
| TermReport | 综合评估报告 | | growth-comprehensive-assessment.html / comprehensive-assessment-class-report.html ? |
| BookCreate | 生成成长册 | UGC | growth-book.html + growth-book-edit.html 家族（版式权威见 growth-book-layout-spec.md） |
| BookPreview | 成长册预览 | | growth-book-view.html / growth-book-sample.html |

## 不属于教师端 45 个页面的原型（施工时不得照搬）

| 原型 | 归属 |
| --- | --- |
| index.html（仓库根） | 原型画廊入口，不属于任何应用 |
| component-showcase.html | 设计系统样例页，令牌来源，不是应用页面 |
| parent-tasks.html / parent-task-detail.html | 家长端 |
| parent-evaluation-publish.html / parent-evaluation-detail.html | 家长端 |
| community-coeducation.html | 家长端（社区共育动态） |
| teacher-profile.html / my-training.html | 结构契约中无对应页面——不建，若需要先改契约 |
| teacher-evaluation.html / teacher-message.html / teacher-message-detail.html | 评审中新增的中间页与教师寄语（decision.md 第 2 条）；**结构契约尚未收录**，建它们之前先按守卫流程把契约改了，否则结构判定拦下 |
| growth-book-section-edit / section-materials / task-manage / time-manage.html | 成长册编辑族的工作页，随 BookCreate 一并核对是否需要独立路由 |
| growth-record.html | 成长档案首页；结构契约无独立页面，随家园社共育模块开工时核对 |

> 上表最后四行是真实的结构缺口：原型与评审已经走到了契约前面。它们不是本票据要解决的，但按原型直接施工
> 会被结构判定拦下——先改 `app-structure.json`（守卫会要求确认），再建页面。
