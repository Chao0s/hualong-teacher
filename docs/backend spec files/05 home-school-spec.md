HOME_SCHOOL_BACKEND_OBJECT_SPEC

scope (范围) = screens/home-school.html
source_page (参考页面) = home-school.html
source_page_correction (原型纠正规则) = home-school.html 当前示例中的“缺第2次|进行中|可生成|缺评语|待补图|不可生成”等主页状态标注已失效；后台与后续前端实现以本 specification 的主页二元状态为准
revision_source (本次改版依据) = DECISIONS.md E1-E7 及其下 W1-W21（来源为 hualong-teacher decision.md 10 条 + commit e524e75 的前端改版回冲，2026-08-01）
authority_order (权威顺序) = DECISIONS.md > db/01_schema.sql > db/DATABASE_SPEC.md > 本 specification；本文与 DECISIONS.md 冲突处一律以 DECISIONS.md 为准
ddl_lag_notice (DDL 滞后说明) = 已定新表与新增列均尚未落到 db/01_schema.sql；本 specification 先行记录，已登记项由 db/tools/extract-ui-binding.mjs 标为 PENDING DDL，不算无法解释的缺列
f17_current_override (现行成长册契约 / 2026-08-12) = DECISIONS.md F17 与 USER-JOURNEY Q63—Q86 已取消成长册 PDF／图片档、下载分享、生成／重导任务、generated file 与 render lease；状态只用 b1=preparing／b2=published，b2 永久锁定并仅在 App 内开放。本文后方残留的 g0／g1／g2、生成、导出、PDF、软页数与字体双端一致度文字只保留为决策演进记录，不得实作
static_node_count (固定可点击节点数) = 9
dynamic_progress_row_count (动态进度行数) = 0:k
runtime_clickable_node_count (运行时可点击节点数) = 9
field_format (字段格式) = field_key (中文字段名), cardinality, type|enum, ui
id_rule (ID规则) = integer, database_auto_generated
null_rule (空值规则) = 0:1
list_rule (列表规则) = 0:k | 1:k


[SHARED_OBJECT_RULE]

shared_object_source (共享对象来源) = home-spec.md
shared_objects (共享对象) = db_teacher, db_school, db_school_term, db_class, db_teacher_class, db_moment, db_moment_upload, db_month_eval, db_file
shared_nav_objects (共享导航对象) = nav_home, nav_party, nav_coord, nav_training, nav_home_school
rename_shared_object (重命名共享对象) = FORBIDDEN
duplicate_shared_object_definition (重复定义共享对象) = FORBIDDEN
new_canonical_objects (本次新增业务对象) = db_term_eval, db_child_assessment, db_teacher_message, db_scale_item, db_child_assessment_item, db_growth_book_template, db_growth_book_section, db_book_widget, db_growth_material
new_object_source (新增业务对象依据) = db_teacher_message 来自 E1; db_scale_item 与 db_child_assessment_item 来自 E2; db_growth_book_template|db_growth_book_section|db_book_widget|db_growth_material 来自 E3(W11-W19)
external_identity_object (跨端身份对象) = db_parent; 由家长端统一定义并由教师端引用
external_business_object (跨端业务对象) = db_parent_evaluation, db_book_material_submission; 前者由家长端 home-spec.md 统一定义(canonical)，后者由家长端 growth-book-spec.md 统一定义(canonical)；教师端仅引用，不得另建同义表


[CONTEXT_RULE]

teacher_id_source (教师ID来源) = auth_session.teacher_id
school_id_source (园所ID来源) = db_teacher.school_id
class_id_source (班级ID来源) = current_class_context.class_id
teacher_id_client_editable (教师ID前端可编辑) = 0
school_id_client_editable (园所ID前端可编辑) = 0
class_id_client_editable (班级ID前端可编辑) = 0; 仅允许通过已授权班级切换器改变 current_class_context
ui_context_rule (上下文字段界面规则) = context.hidden 表示不显示原始ID，由后台根据登录上下文取得并校验


[DATA_INITIALIZATION_RULE]

prototype_content (原型内容) = HTML 中的“大一班”、六名幼儿、28人、84%、6人待提醒及全部完成状态均为 demo|test Mock
static_ui_content (保留的静态界面内容) = 页面标题、说明文案、四个快捷入口、完成度表头和主页二元状态图例(已完成|未完成)
production_seed (生产环境业务种子数据) = NONE
production_initial_db_moment (在园时光初始状态) = EMPTY
production_initial_db_moment_upload (在园时光单次评估初始状态) = EMPTY
production_initial_db_parent_task (亲子任务初始状态) = EMPTY
production_initial_db_parent_task_submission (亲子任务提交初始状态) = EMPTY
production_initial_db_month_eval (教师月评初始状态) = EMPTY
production_initial_db_parent_evaluation (家长评价初始状态) = EMPTY
production_initial_db_term_eval (教师学期评估初始状态) = EMPTY
production_initial_db_child_assessment (幼儿综合评估初始状态) = EMPTY
production_initial_db_growth_record (成长档案初始状态) = EMPTY
production_initial_db_growth_book (成长册初始状态) = EMPTY
production_initial_db_teacher_message (教师寄语初始状态) = EMPTY
production_initial_db_child_assessment_item (综合评估题项分初始状态) = EMPTY
production_initial_db_growth_book_template (成长册模版初始状态) = EMPTY
production_initial_db_growth_book_section (成长册新增栏目初始状态) = EMPTY
production_initial_db_book_widget (成长册组件初始状态) = EMPTY
production_initial_db_book_material_submission (成长册素材提交初始状态) = EMPTY
production_initial_db_growth_material (成长资料初始状态) = EMPTY
production_initial_db_scale_item (量表题库初始状态) = 非空；按量表版本导入(scale_code=guide, scale_version=1.0, 124 题项)，属参考数据不属业务种子数据，来源 hualong-teacher/data/guide-scale.json
page_layout_library (页版式库) = 不入库；预设 6 个栏目的页面版式为仓库内的版本化 JSON，地位比照 db/rubric/，随代码部署（W13）
base_identity_data (基础身份数据) = db_school|db_teacher|db_class|db_teacher_class|db_child 由部署或园所管理员导入，不属于 Mock 业务内容
initial_progress_rule (初始进度规则) = 有真实幼儿名册但无业务记录时，主页四项状态统一为 incomplete(未完成)，不得显示已完成或虚构百分比
no_child_rule (无幼儿名册规则) = return [] and child_count=0
hardcoded_child_or_metric (固定幼儿或统计值) = FORBIDDEN
environment_isolation (环境隔离) = demo|test 数据不得复制到 production


[STATIC_BUTTON_NODE_INDEX]

| n | button_name_cn | button_name_en | node_key | object | input | jump |
|---:|---|---|---|---|---|---|
| 1 | 在园时光 | Kindergarten Moments | btn_home_school_moment | db_moment | school_id, class_id, teacher_id | home-school.html > home-school-moments.html |
| 2 | 亲子任务 | Parent-Child Tasks | btn_parent_task | db_parent_task | school_id, class_id, teacher_id | home-school.html > parent-tasks.html |
| 3 | 成长档案 | Growth Record | btn_growth_record | db_growth_record | school_id, class_id, teacher_id | home-school.html > growth-record.html |
| 4 | 社区共育 | Community Coeducation | btn_community_coeducation | db_parent_task + db_parent_task_submission | school_id, class_id, parent_task_type=t2 | home-school.html > community-coeducation.html |
| 5 | 首页 | Home | nav_home | nav_home | NULL | home.html |
| 6 | 党建管理 | Party Affairs | nav_party | nav_party | NULL | school-affairs.html |
| 7 | 综合协调 | Comprehensive Coordination | nav_coord | nav_coord | NULL | comprehensive-coordination.html |
| 8 | 教研培训 | Training Center | nav_training | nav_training | NULL | training-center.html |
| 9 | 家园共育 | Home-School Coeducation | nav_home_school | nav_home_school | NULL | home-school.html |


[PAGE_OBJECT]

家园共育首页 (Home-School Coeducation Home / db_home_school)

home_school_id (家园共育首页ID), 1:1, integer, ui=home_school.page
teacher_id (当前教师ID), 1:1, integer, ui=context.hidden
school_id (当前园所ID), 1:1, integer, ui=context.hidden
class_id (当前班级ID), 1:1, integer, ui=context.hidden
child_id (幼儿ID), 0:k, integer, ui=home_school.progress.child
home_school_progress_id (进度汇总ID), 0:k, integer, ui=home_school.progress.row
moment_id (在园时光ID), 0:k, integer, ui=home_school.quick.moment
parent_task_id (亲子任务ID), 0:k, integer, ui=home_school.quick.parent_task
growth_record_id (成长档案ID), 0:k, integer, ui=home_school.quick.growth_record
growth_book_id (成长册ID), 0:k, integer, ui=home_school.progress.growth_book
child_count (班级幼儿数), 1:1, integer, derived(db_child), ui=home_school.metric.child_count
average_completion (平均完成率), 1:1, percent, derived(db_home_school_progress), ui=home_school.metric.average_completion
reminder_count (待提醒幼儿数), 1:1, integer, derived(db_home_school_progress), ui=home_school.metric.reminder_count

rel_count (关系数量) = 9
rel_db (关联表) = db_teacher, db_school, db_class, db_child, db_home_school_progress, db_moment, db_parent_task, db_growth_record, db_growth_book
rel_map (关系字段) = db_home_school{teacher_id}<->db_teacher{teacher_id}; db_home_school{school_id}<->db_school{school_id}; db_home_school{class_id}<->db_class{class_id}; db_home_school{child_id}<->db_child{child_id}; db_home_school{home_school_progress_id}<->db_home_school_progress{home_school_progress_id}; db_home_school{moment_id}<->db_moment{moment_id}; db_home_school{parent_task_id}<->db_parent_task{parent_task_id}; db_home_school{growth_record_id}<->db_growth_record{growth_record_id}; db_home_school{growth_book_id}<->db_growth_book{growth_book_id}
persist (是否持久化) = 0
object_type (对象类型) = aggregate

method (方法):
child_count = COUNT(db_child WHERE class_id=current_class_id AND enrollment_status=e1)
average_completion = AVG(db_home_school_progress.row_completion_rate)
IF required_count=0, average_completion=0
reminder_count = COUNT(DISTINCT child_id WHERE reminder_required=1)
IF child_count=0, progress_rows=[]


[IDENTITY_OBJECT]

幼儿 (Child / db_child)

child_id (幼儿ID), 1:1, integer, ui=child.hidden
school_id (园所ID), 1:1, integer, ui=child.hidden
class_id (班级ID), 1:1, integer, ui=child.class
child_name (幼儿姓名), 1:1, max_len=50, ui=home_school.progress.child_name|child.profile.name
enrollment_status (在园状态), 1:1, e1=active(在园)|e2=leave(离园)|e3=suspended(暂停), ui=child.hidden
enrolled_date (入园日期), 0:1, date, ui=child.profile.enrolled_at

rel_count (关系数量) = 2
rel_db (关联表) = db_school, db_class
rel_map (关系字段) = db_child{school_id}<->db_school{school_id}; db_child{class_id}<->db_class{class_id}


[PROGRESS_AGGREGATE]

家园共育进度 (Home-School Progress / db_home_school_progress)

home_school_progress_id (进度汇总ID), 1:1, integer, ui=home_school.progress.hidden
class_id (班级ID), 1:1, integer, ui=home_school.progress.hidden
child_id (幼儿ID), 1:1, integer, ui=home_school.progress.child_name
week_key (当前统计周), 1:1, ISO-YYYY-Www, ui=home_school.progress.hidden
month_key (当前统计月), 1:1, YYYY-MM, ui=home_school.progress.hidden
term_id (当前学期ID), 1:1, school_term, ui=home_school.progress.hidden
moment_weekly_complete_count (本周在园时光完成次数), 1:1, integer(0:2), ui=moment.detail.weekly_count
moment_detail_week_status (在园时光详细页周状态), 1:1, d1=complete(已完成)|d2=missing_second(缺第2次)|d3=incomplete(未完成), ui=moment.detail.weekly_status
moment_status (主页在园时光状态), 1:1, h1=complete(已完成)|h2=incomplete(未完成), ui=home_school.progress.moment
latest_parent_task_id (最新一期亲子任务ID), 0:1, integer, ui=home_school.progress.hidden
parent_task_status (主页亲子任务状态), 1:1, h1=complete(已完成)|h2=incomplete(未完成), ui=home_school.progress.parent_task
growth_record_status (主页成长档案状态), 1:1, h1=complete(已完成)|h2=incomplete(未完成), ui=home_school.progress.growth_record
growth_book_status (主页成长册状态), 1:1, h1=complete(已完成)|h2=incomplete(未完成), ui=home_school.progress.growth_book
required_count (应完成项目数), 1:1, integer, ui=home_school.progress.hidden
completed_count (已完成项目数), 1:1, integer, ui=home_school.progress.hidden
row_completion_rate (幼儿完成率), 1:1, percent, ui=home_school.progress.hidden
reminder_required (是否需要提醒), 1:1, boolean, ui=home_school.progress.reminder

rel_count (关系数量) = 8
rel_db (关联表) = db_school_term, db_class, db_child, db_moment, db_moment_upload, db_parent_task_submission, db_growth_record, db_growth_book
rel_map (关系字段) = db_home_school_progress{term_id}<->db_school_term{term_id}; db_home_school_progress{class_id}<->db_class{class_id}; db_home_school_progress{child_id}<->db_child{child_id}; db_home_school_progress{week_key}<->db_moment{week_key}; db_home_school_progress{child_id}<->db_moment_upload{child_id}; db_home_school_progress{child_id}<->db_parent_task_submission{child_id}; db_home_school_progress{child_id}<->db_growth_record{child_id}; db_home_school_progress{child_id}<->db_growth_book{child_id}
persist (是否持久化) = 0
object_type (对象类型) = aggregate_view
unique (唯一键) = class_id + child_id + week_key + month_key + term_id

method (方法):
moment_weekly_complete_count = COUNT(DISTINCT db_moment.moment_seq FROM db_moment_upload JOIN db_moment ON moment_id WHERE db_moment_upload.child_id=current_child_id AND db_moment.week_key=current_week_key AND db_moment.publish_status=s2 AND evaluation_status=c1)
IF moment_weekly_complete_count>=2, moment_detail_week_status=d1, moment_status=h1
IF moment_weekly_complete_count=1, moment_detail_week_status=d2, moment_status=h2
IF moment_weekly_complete_count=0, moment_detail_week_status=d3, moment_status=h2
latest_parent_task_id = SELECT parent_task_id FROM db_parent_task WHERE class_id=current_class_id AND publish_status IN(s2,s3) AND published_at<=NOW ORDER BY published_at DESC LIMIT 1
IF latest_parent_task_id EXISTS AND db_parent_task_submission{latest_parent_task_id,current_child_id}.submission_status=c1, parent_task_status=h1
ELSE parent_task_status=h2
growth_record_status = MAP(db_growth_record.record_status: c1->h1, c2|NULL->h2)
growth_book_status = MAP(db_growth_book.book_status: b2->h1, b1|NULL->h2)
book_eval_status 已由 DECISIONS.md F17 拔掉不落列；能否定稿由 can_finalize_rule 实时派生
required_count = 4
completed_count = COUNT(moment_status=h1, parent_task_status=h1, growth_record_status=h1, growth_book_status=h1)
row_completion_rate = completed_count/4*100
reminder_required = 1 IF ANY(moment_status,parent_task_status,growth_record_status,growth_book_status)=h2 ELSE 0

summary_rule (主页简化规则):
主页四项只允许 h1=已完成 或 h2=未完成，不显示“缺第2次”“进行中”“可生成”“待补图”等详细状态
任何一项所需内容未全部完成时，该项主页状态必须为 h2
在园时光只完成第1次时，详细页显示 d2=缺第2次，主页仍显示 h2=未完成


[TEACHER_EVALUATION_AGGREGATE]

依据 (source) = DECISIONS.md E1 + E4
source_page (参考页面) = teacher-evaluation.html
navigation (导航) = 成长档案 growth-record.html > 教师评价 teacher-evaluation.html > 月度评价|学期评价|综合评估|教师寄语
entry_reduction (入口收敛) = 成长档案首页的儿童评价入口由 5 个并为 3 个：发布家长评价 | 教师评价 | 成长册
write_control_count (本页写入控件数) = 0; teacher-evaluation.html 只做导航与只读进度展示，不产生任何 ui= 写入标注

教师评价聚合 (Teacher Evaluation Aggregate / db_teacher_eval_home)

teacher_eval_home_id (教师评价聚合ID), 1:1, derived(page_context), ui=teacher_eval.page
teacher_id (当前教师ID), 1:1, derived(auth_session), ui=context.hidden
school_id (当前园所ID), 1:1, derived(db_teacher), ui=context.hidden
class_id (当前班级ID), 1:1, derived(current_class_context), ui=context.hidden
child_id (幼儿ID), 0:k, derived(db_child), ui=teacher_eval.progress.child_name
month_eval_status (本月评价状态), 1:1, derived(db_month_eval), ui=teacher_eval.progress.month
term_eval_status (学期评估状态), 1:1, derived(db_term_eval), ui=teacher_eval.progress.term
comprehensive_status (综合评估状态), 1:1, derived(db_child_assessment), ui=teacher_eval.progress.comprehensive
message_status (教师寄语状态), 1:1, derived(db_teacher_message), ui=teacher_eval.progress.message

rel_count (关系数量) = 5
rel_db (关联表) = db_child, db_month_eval, db_term_eval, db_child_assessment, db_teacher_message
rel_map (关系字段) = db_teacher_eval_home{child_id}<->db_child{child_id}; db_teacher_eval_home{child_id}<->db_month_eval{child_id}; db_teacher_eval_home{child_id}<->db_term_eval{child_id}; db_teacher_eval_home{child_id}<->db_child_assessment{child_id}; db_teacher_eval_home{child_id}<->db_teacher_message{child_id}
persist (是否持久化) = 0
object_type (对象类型) = aggregate

method (方法):
接口按幼儿返回 4 项（本月评价 / 学期评估 / 综合评估 / 教师寄语）的完成状态
current_month = 由后端依当前日期推定；前端不得写死月份
current_term_id = SELECT term_id FROM db_school_term WHERE school_id=current_school_id AND CURRENT_DATE BETWEEN start_date AND end_date；无命中时的默认行为见 USER-JOURNEY Q55-d1
month_options = 当前 db_school_term.start_date/end_date 覆盖的月份；前端不得自行假设 2—7 月或 9—1 月
四项状态在本聚合页一律二元：h1=已完成 | h2=未完成，草稿折算为未完成

month_matrix_rule (月度评价完成情况规则):
月度评价的“完成情况”为 幼儿 × 月份 矩阵
月份栏由“已存在评价记录的月份”动态生成，不写死月份清单
圆点本身即入口：已完成 -> 只读详情；未完成 -> 填写页
删除“最近更新”栏，因此 db_month_eval 不需要对外暴露 updated_at

term_scope_rule (学期评价范围规则):
学期评价只展示当前学期，不做历史学期回看

progress_semantics (进度口径 / DECISIONS.md E4):

| 位置 | 状态数 | 口径 |
|---|---|---|
| 综合评估自己的进度页 growth-comprehensive-assessment.html | 三态 | 已评=124 -> 已完成；1-123 -> 草稿；0 -> 未完成（等价无记录，可不落库，由花名册左连接得出） |
| 月度评价 / 学期评价自己的页 | 二元对外 | 草稿态仍在 db_month_eval.month_eval_status 内部保留(e1/e2/e3)，只是不对外显示 |
| 教师评价聚合页、成长档案首页、成长册生成检查表 | 二元 | 草稿一律折算为未完成 |

“进行中 / 草稿 / 待补”不再对外展示
status 由题数派生，不手工维护
导出报告允许导出草稿态的部分数据，并在报告中标注未完成


[BUSINESS_OBJECTS]

亲子任务 (Parent-Child Task / db_parent_task)

parent_task_id (亲子任务ID), 1:1, integer, ui=parent_task.card.hidden|parent_task_detail.hidden
school_id (园所ID), 1:1, integer, ui=parent_task.hidden
class_id (班级ID), 1:1, integer, ui=parent_task.class
teacher_id (发布教师ID), 1:1, integer, ui=parent_task.publisher
parent_task_type (任务类型), 1:1, t1=daily(日常任务)|t2=community(社区任务), ui=parent_task.type
parent_task_title (任务标题), 1:1, max_len=100, ui=parent_task.card.title|parent_task_detail.title
task_background (任务背景), 0:1, max_len=500, ui=parent_task_detail.background
task_detail (任务详情), 1:1, max_len=1000, ui=parent_task_detail.content
start_at (开始时间), 1:1, datetime, ui=parent_task.card.time
due_at (截止时间), 0:1, datetime, ui=parent_task.card.due_at
publish_status (发布状态), 1:1, s1=draft(草稿)|s2=published(已发布)|s3=closed(已结束), ui=parent_task.status
published_at (发布时间), 0:1, datetime, ui=parent_task.hidden

rel_count (关系数量) = 4
rel_db (关联表) = db_school, db_class, db_teacher, db_parent_task_submission
rel_map (关系字段) = db_parent_task{school_id}<->db_school{school_id}; db_parent_task{class_id}<->db_class{class_id}; db_parent_task{teacher_id}<->db_teacher{teacher_id}; db_parent_task{parent_task_id}<->db_parent_task_submission{parent_task_id}


亲子任务提交 (Parent Task Submission / db_parent_task_submission)

parent_task_submission_id (亲子任务提交ID), 1:1, integer, ui=parent_task.submission.hidden
parent_task_id (亲子任务ID), 1:1, integer, ui=parent_task.submission.hidden
child_id (幼儿ID), 1:1, integer, ui=parent_task.submission.child
submission_text (提交文字), 0:1, max_len=1000, ui=parent_task.submission.text
file_id (提交图片ID), 0:k, integer, ui=parent_task.submission.media
submission_status (提交状态), 1:1, c1=complete(已完成)|c2=incomplete(未完成), ui=parent_task.submission.status
submitted_at (提交时间), 0:1, datetime, ui=parent_task.submission.time
active_check_batch_key (家庭内容检查批次), 0:1, batch_key, ui=parent_task.submission.review_status
parent_book_included (家长分支进册), 1:1, boolean, ui=context.hidden
teacher_book_included (教师分支进册), 1:1, boolean, ui=growth_book.task.teacher_included

rel_count (关系数量) = 3
rel_db (关联表) = db_parent_task, db_child, db_file
rel_map (关系字段) = db_parent_task_submission{parent_task_id}<->db_parent_task{parent_task_id}; db_parent_task_submission{child_id}<->db_child{child_id}; db_parent_task_submission{file_id}<->db_file{file_id}
unique (唯一键) = parent_task_id + child_id

method (方法):
最新一期任务只从 publish_status=s2|s3 且 published_at<=NOW 的记录中按 published_at DESC 选取
草稿任务不得成为最新一期任务，也不得影响主页亲子任务状态
IF latest_parent_task has child submission_status=c1, homepage parent_task_status=h1
ELSE homepage parent_task_status=h2


家长评价 (Parent Evaluation / db_parent_evaluation) [REUSE]

reuse_source (复用来源) = Parent App home-spec.md (canonical definition)
引用字段 = parent_evaluation_id, school_id, class_id, child_id, parent_id, requested_by_teacher_id, evaluation_type, evaluation_period, evaluation_status, submitted_at
evaluation_type (评价类型) = t1=monthly(月度)|t2=term(学期)
evaluation_period (评价周期) = YYYY-MM|school_term
evaluation_status (评价状态) = p0=not_started(未开始)|p1=in_progress(进行中)|p2=complete(已完成)|p3=overdue(逾期未完成)
unique (唯一键) = child_id + evaluation_type + evaluation_period
cross_app_rule (跨端规则) = db_parent 与 db_parent_evaluation 均为家长端 canonical object；教师端不得创建同义家长表或家长评价表(如 db_parent_eval)
completion_map (完成状态映射) = evaluation_status=p2 -> c1(已完成); p0|p1|p3|NULL -> c2(未完成)


教师学期评估 (Teacher Term Evaluation / db_term_eval)

term_eval_id (教师学期评估ID), 1:1, integer, ui=term_eval.hidden
school_id (园所ID), 1:1, integer, ui=term_eval.hidden
class_id (班级ID), 1:1, integer, ui=term_eval.class
child_id (幼儿ID), 1:1, integer, ui=term_eval.child
teacher_id (评价教师ID), 1:1, integer, ui=context.hidden
term_id (学期ID), 1:1, school_term, ui=term_eval.period
eval_text (学期综合评语), 1:1, max_len=500, ui=term_eval.textarea
file_id (学期评价照片ID), 0:k, integer, ui=term_eval.photo_list
term_eval_status (完成状态), 1:1, c1=complete(已完成)|c2=incomplete(未完成), ui=term_eval.status
submitted_at (提交时间), 0:1, datetime, ui=term_eval.submitted_at

rel_count (关系数量) = 5
rel_db (关联表) = db_school, db_class, db_child, db_teacher, db_file
rel_map (关系字段) = db_term_eval{school_id}<->db_school{school_id}; db_term_eval{class_id}<->db_class{class_id}; db_term_eval{child_id}<->db_child{child_id}; db_term_eval{teacher_id}<->db_teacher{teacher_id}; db_term_eval{file_id}<->db_file{file_id}
unique (唯一键) = teacher_id + child_id + term_id

content_rule (内容字段规则 / DECISIONS.md E6 + F17):
db_term_eval 原本一个内容列都没有，只记“做了没有”；本次只补一栏 eval_text，命名与语意对齐 db_month_eval.eval_text
teacher-term-form.html 的「五大领域评价」textarea 删除。理由：E2 之后五大领域已由 124 题量表逐题打分、领域分即时聚合，再用文字写一遍是重复劳动，且两份说法可能互相矛盾（文字写“语言发展良好”而量表语言领域均分 2.3）
量表给分数，寄语给温度，中间这一层没有位置
eval_text 字数上限 = 500，与月度评价一致；成长册 bound widget 必须容纳该上限

photo_rule (照片规则 / DECISIONS.md E7):
照片引用粒度为 file 级，走 db_file_ref(owner_object='db_term_eval')，不是 moment 级
来源相册为该幼儿过往各月月度评价中的照片；导入是引用复制（复制 file_id 关联），不复制文件本体
相册的构成定义见 [CHILD_PHOTO_ALBUM_RULE]


[CHILD_PHOTO_ALBUM_RULE]

依据 (source) = DECISIONS.md E7 + GAPS.md G28
适用范围 (scope) = db_month_eval 与 db_term_eval 的照片选择

no_photo_level_tagging (不做照片级标注) = 照片层级的幼儿标注不存在，也不新建。逐张标人一学期是几千次点击且对教师无直接回报，而 db_moment_upload 已要求标过一次 moment 级名单
album_definition (该幼儿专属相册的定义) = 该幼儿被 db_moment_upload 嵌套过的那些 moment 的全部照片；靠 db_moment_upload 筛出 moment，再列出这些 moment 经 db_file_ref(owner_object='db_moment') 关联的照片供教师挑选
album_grouping (相册分组) = 按 db_moment.week_key 分周次
reference_granularity (引用粒度) = file 级；db_file_ref(owner_object='db_month_eval') 与 db_file_ref(owner_object='db_term_eval')
moment_ids_removed (moment 级关联作废) = DECISIONS.md B3 原定 db_month_eval_moment -> db_month_eval.moment_ids JSON，E7 之后连 moment_ids 都不需要；周次仍可经 file_id -> db_file_ref(owner_object='db_moment') -> db_moment.week_key 反查
import_semantics (导入语意) = 引用复制。复制的是 file_id 关联，不产生新文件、不复制文件本体
portrait_exposure (肖像曝光) = 无新增曝光。B6 已定在园时光可见性归班级，全班家长本来就看得到所有动态照片；合照进入某幼儿的月评不构成新的曝光。本条与 GAPS.md G4 无关
upstream_sync (上游同步状态) = 已同步。01 home-spec.md 的 db_month_eval.moment_id (0:k) 已改为 file_id (0:k, ui=month_eval.photo_list)，rel_db 的 db_moment 换成 db_file，并就地补了同一条 photo_rule


幼儿综合评估 (Child Comprehensive Assessment / db_child_assessment)

child_assessment_id (幼儿综合评估ID), 1:1, integer, ui=child_assessment.hidden
school_id (园所ID), 1:1, integer, ui=child_assessment.hidden
class_id (班级ID), 1:1, integer, ui=child_assessment.class
child_id (幼儿ID), 1:1, integer, ui=child_assessment.child
teacher_id (评价教师ID), 1:1, integer, ui=context.hidden
term_id (学期ID), 1:1, school_term, ui=child_assessment.period
scale_code (量表编码), 1:1, max_len=20, ui=child_assessment.hidden
scale_version (量表版本), 1:1, max_len=20, ui=child_assessment.hidden
required_count (应评题项数), 1:1, integer, ui=child_assessment.hidden
completed_count (已评题项数), 1:1, integer, ui=child_assessment.progress
child_assessment_status (完成状态), 1:1, c1=complete(已完成)|c2=incomplete(未完成), ui=child_assessment.status
submitted_at (提交时间), 0:1, datetime, ui=child_assessment.submitted_at

rel_count (关系数量) = 6
rel_db (关联表) = db_school, db_class, db_child, db_teacher, db_scale_item, db_child_assessment_item
rel_map (关系字段) = db_child_assessment{school_id}<->db_school{school_id}; db_child_assessment{class_id}<->db_class{class_id}; db_child_assessment{child_id}<->db_child{child_id}; db_child_assessment{teacher_id}<->db_teacher{teacher_id}; db_child_assessment{scale_code,scale_version}<->db_scale_item{scale_code,scale_version}; db_child_assessment{child_assessment_id}<->db_child_assessment_item{child_assessment_id}
unique (唯一键) = child_id + term_id

method (方法):
required_count = 由量表版本决定，现为 124（scale_code=guide, scale_version=1.0）
completed_count = COUNT(db_child_assessment_item WHERE child_assessment_id=current_child_assessment_id)
IF completed_count=required_count, child_assessment_status=c1
ELSE child_assessment_status=c2
状态纯由已评题数派生，不手工维护，也不附加其他条件（DECISIONS.md E4）；submitted_at 只记时间点，不参与判定
本页自身的三态见 [TEACHER_EVALUATION_AGGREGATE] 的 progress_semantics；向上聚合时草稿一律折算为 c2

instrument_rule (量表规则 / DECISIONS.md E2):
量表实体 = 《3-6岁儿童学习与发展指南》（教育部，2012 年 9 月）教师评定量表 v1.0，来源 hualong-teacher/data/guide-scale.json
四层层级：domain 领域 5（H 健康 / L 语言 / S 社会 / K 科学 / A 艺术）> aspect 维度 11 > goal 目标 32 > item 题项 124（likert 123 + measurement 1）
id 规则逐级截断即得上级 id：H > H1 > H1-2 > H1-2-3。因此四层不需要四张表，一张题项表足够，上级靠字符串前缀聚合
领域分不再是输入而是输出：教师评的是 124 个题项分，领域分由题项分求均值得出
domain_scores 不落列（比照 DATABASE_SPEC §1.3 persist=0），改由题项分即时聚合
聚合口径照 guide-scale.json 的 instrument.scoring_rules：goal / aspect / domain / total 一律取其下所有题项得分的均值（题项级均值，非下级均值的均值 —— 题项数不等会造成加权失真）
班级报告同理：取全班已提交幼儿在该领域的所有题项分求均值，不可用各幼儿领域均分再平均
题库入库而非前端内嵌：原型由 assessment-store.js 内嵌渲染，正式版由接口下发，前端只渲染与提交

version_binding_rule (量表版本绑定规则):
量表必须版本化，且历史评估绑定填写时所用的版本（scale_code + scale_version 落在评估行上）
升版不得回头把旧记录判成草稿；required_count 随该行绑定的版本解释，不随最新版本变动
注意本条与成长册模版相反：成长册模版不做版本化、不做快照（E3 第 3 点 + W16），量表必须版本化

incremental_save_rule (逐题增量保存规则):
教师每点一题即落库
主记录在首次评分时建立，不是提交时才建立
中途退出可续填：按 child_id + 当前评估周期读回全部已评题项
未评 = 该题无列，不是 0 分。领域均分只按已评题项计算；整个领域都没评时接口回“该领域尚无评分”，不得回 0
表单默认值由 4 改为“未评”。原型每题预设 4 分会让完成度失去意义

report_rule (报告页规则):
个人与班级报告都删掉文字分析（强弱项描述、综合评语），只保留五领域雷达图 + 逐题明细 tab
接口不再需要 analysis_text / assessment_summary 之类字段
班级报告只统计已完成的评估，草稿不计入；无已完成评估时回明确空结果，供前端区分“均分 0”与“尚无数据”

naming_note (命名对照，DDL 落地时须择一):
DECISIONS.md E4 写的 rated_count / total_count 与本表既有的 completed_count / required_count 是同一对数值
两套名字不得并存；择一为准的决定尚未拍板，登记于此


量表题项 (Scale Item / db_scale_item)

scale_item_id (量表题项ID), 1:1, integer, ui=child_assessment.item.hidden
scale_code (量表编码), 1:1, max_len=20, ui=child_assessment.item.hidden
scale_version (量表版本), 1:1, max_len=20, ui=child_assessment.item.hidden
item_id (题项编号), 1:1, max_len=16, ui=child_assessment.item.hidden
item_name (题项名称), 1:1, max_len=100, ui=child_assessment.item.title
question (题项问题), 1:1, text, ui=child_assessment.item.question
anchors (行为锚点), 1:1, json, ui=child_assessment.item.anchor
item_type (题项类型), 1:1, likert|measurement, ui=child_assessment.item.hidden
anchored_levels (有锚点的分级), 0:1, json, ui=child_assessment.item.hidden
inferred_levels (推断的分级), 0:1, json, ui=child_assessment.item.hidden

rel_count (关系数量) = 1
rel_db (关联表) = db_child_assessment_item
rel_map (关系字段) = db_scale_item{item_id}<->db_child_assessment_item{item_id}
unique (唯一键) = scale_code + scale_version + item_id
object_type (对象类型) = reference_data
data_source (数据来源) = hualong-teacher/data/guide-scale.json；注意 version 与 scoring_rules 都在 instrument 之下，不是顶层键

domain_code_note (领域编码两套并存 / GAPS.md G15):
量表用 H/L/S/K/A，schema 的 db_assessment_item.assessment_domain 用 f1..f5，顺序一致（健康/语言/社会/科学/艺术）
须定一套为权威、另一套为映射 —— 尚未拍板，不得在此擅自选定

h1_1_1_deviation (H1-1-1 身高体重题的明示偏离 / DECISIONS.md E2 + GAPS.md G27):
量表原文 measurement_note 写明本题不由教师主观评定，须按实测身高 cm / 体重 kg / 性别对照参考表换算
我们改由教师照参考表主观评定，参考表降级为判断辅助。理由：三个前端 71 个页面没有任何一处收身高体重；参考范围大幅重叠（男孩 3~4 岁身高 94.9-111.7、4~5 岁 100.7-119.2、5~6 岁 106.1-125.8，108cm 同时落在三段），评分规则本身欠缺定义，实作就得自己发明一套消歧规则；身高体重属 PIPL 第二十八条明列的医疗健康敏感个人信息
必须记录在案的代价：本实作不是《指南》原典的忠实实作。H1-1-1 在我们这里实质上是一道 likert 题
item_type 仍存 measurement（忠于原始 JSON），偏离须写在 db/rubric/ 的说明文件里，避免日后有人拿我们的数据与《指南》对照时误以为是实测换算
required_count 维持 124；db_child.birth_date 与 gender 不参与此题计分
正面副作用：完全不采集身高体重，没有医疗健康敏感数据进入系统


幼儿综合评估题项分 (Child Assessment Item Score / db_child_assessment_item)

child_assessment_item_id (题项得分ID), 1:1, integer, ui=child_assessment.item.hidden
child_assessment_id (幼儿综合评估ID), 1:1, integer, ui=child_assessment.item.hidden
item_id (题项编号), 1:1, max_len=16, ui=child_assessment.item.hidden
score (题项得分), 1:1, 1:5, ui=child_assessment.item.score_button

rel_count (关系数量) = 2
rel_db (关联表) = db_child_assessment, db_scale_item
rel_map (关系字段) = db_child_assessment_item{child_assessment_id}<->db_child_assessment{child_assessment_id}; db_child_assessment_item{item_id}<->db_scale_item{item_id}
unique (唯一键) = child_assessment_id + item_id
row_rule (行规则) = 每次评估最多 124 列，一题一列；未评的题不产生列（未评 != 0 分）
pk_note (主键说明) = DECISIONS.md E2 的 DDL 草图只列了 child_assessment_id / item_id / score 与唯一键，未给代理主键；此处按本文件 id_rule 补 child_assessment_item_id，DDL 落地时须确认


教师寄语 (Teacher Message / db_teacher_message)

source_page (参考页面) = teacher-message.html, teacher-message-detail.html

message_id (教师寄语ID), 1:1, integer, ui=teacher_message.hidden
school_id (园所ID), 1:1, integer, ui=teacher_message.hidden
class_id (班级ID), 1:1, integer, ui=teacher_message.hidden
child_id (幼儿ID), 1:1, integer, ui=teacher_message.child_select
teacher_id (撰写教师ID), 1:1, integer, ui=context.hidden
term_id (学期ID), 1:1, school_term, ui=teacher_message.period
content (寄语内容), 1:1, max_len=300, ui=teacher_message.textarea|teacher_message_detail.textarea
published_at (提交时间), 0:1, datetime, ui=teacher_message_detail.time
created_at (创建时间), 1:1, datetime, ui=teacher_message.hidden
updated_at (更新时间), 0:1, datetime, ui=teacher_message.hidden

rel_count (关系数量) = 4
rel_db (关联表) = db_school, db_class, db_child, db_teacher
rel_map (关系字段) = db_teacher_message{school_id}<->db_school{school_id}; db_teacher_message{class_id}<->db_class{class_id}; db_teacher_message{child_id}<->db_child{child_id}; db_teacher_message{teacher_id}<->db_teacher{teacher_id}
unique (唯一键) = child_id + term_id

content_rule (内容规则):
content 为纯文字，上限 300 字，不支持任何附件
不调微信内容安全 API，不建待审／复核状态或人工队列，不存 publish_status
个别首次提交与全班补缺在写入前都必须向操作教师展示完整最终正文，由教师明确确认提交，以此完成人工把关
成功 INSERT 的单行立即是家长及成长册可读且永久只读的 canonical；无行才是未完成

write_semantics (写入语意 = 扇出，不是批次实体):
「添加到」是单选下拉，不是多选
选「全体幼儿」-> 班内每名幼儿各生成一条 db_teacher_message，内容相同
选某一名幼儿 -> 只生成一条
扇出发生在服务端；班级成员取自 class_id（derived），请求体不得携带幼儿清单
当期缺行幼儿 INSERT；任何已有行无论 class_id 是否当前班都 skip，不覆盖、不接管
「全体幼儿」必须锁定并重算提交时的 current-class e1 名册，在一个数据库事务里完成全部 INSERT／skip；任一幼儿写入失败则整批回滚，成功响应返回新增／已存在跳过两类实际数量
确认页返回 current-class e1 名册数量与 fingerprint；正式事务锁定重算，漂移则 409、回刷新后的新增／已存在跳过预计数并要求重新确认，零写入。同一幂等键重放原结果，新键才使用最新名册
与 B12 的批次寄语同构，但 B12 存在 db_growth_book.book_message 上；E3 之后成长册的寄语栏目改读本表，book_message 不再需要

edit_rule (F16 提交锁定规则):
teacher-message-detail.html 只读取正文、首次提交教师与 published_at，不提供编辑器或保存动作
无行时才在 teacher-message.html 显示填写与完整预览；不分服务端草稿态，半成品只留当前页面
两名教师并发首次提交时，数据库 UNIQUE(child_id,term_id) 只允许第一笔 INSERT，后一笔回 409 并刷新为只读；不发生 LWW 覆盖
同学期转班不改既有行；旧班已提交则新班只读，尚无行时新班当前教师可完成唯一一次 INSERT。系统日志不得记正文或幼儿姓名

scope_rule (作用域规则):
school_id / class_id / teacher_id = derived，服务端设值，忽略请求体里的同名字段
child_id = scoped，客户端可选，服务端必须把「该幼儿属于本教师的班级」内联成 predicate 重新验证，不可先查再做

progress_rule (完成情况规则):
teacher-message.html 下半部的完成情况表为 幼儿 × 教师寄语 二元表
已完成 -> 跳 teacher-message-detail.html 只读；未完成 -> 定位到上方填写区并预选该幼儿


成长档案 (Growth Record / db_growth_record)

growth_record_id (成长档案ID), 1:1, integer, ui=growth_record.hidden
school_id (园所ID), 1:1, integer, ui=growth_record.hidden
class_id (班级ID), 1:1, integer, ui=growth_record.class
child_id (幼儿ID), 1:1, integer, ui=growth_record.child
term_id (档案学期ID), 1:1, school_term, ui=growth_record.period
required_month_count (本学期截至当前应完成月数), 1:1, integer, ui=growth_record.hidden
teacher_month_complete_count (教师月评已完成月数), 1:1, integer, ui=growth_record.progress.teacher_month
parent_month_complete_count (家长月评已完成月数), 1:1, integer, ui=growth_record.progress.parent_month
teacher_term_status (教师学期评估状态), 1:1, c1=complete(已完成)|c2=incomplete(未完成), ui=growth_record.progress.teacher_term
parent_term_status (家长学期评估状态), 1:1, c1=complete(已完成)|c2=incomplete(未完成), ui=growth_record.progress.parent_term
comprehensive_assessment_status (幼儿综合评估状态), 1:1, c1=complete(已完成)|c2=incomplete(未完成), ui=growth_record.progress.comprehensive
is_term_end (是否进入学期末阶段), 1:1, boolean, ui=growth_record.hidden
record_status (成长档案完成状态), 1:1, c1=complete(已完成)|c2=incomplete(未完成), ui=growth_record.status
updated_at (更新时间), 0:1, datetime, ui=growth_record.updated_at

rel_count (关系数量) = 7
rel_db (关联表) = db_school, db_class, db_child, db_month_eval, db_parent_evaluation, db_term_eval, db_child_assessment
rel_map (关系字段) = db_growth_record{school_id}<->db_school{school_id}; db_growth_record{class_id}<->db_class{class_id}; db_growth_record{child_id}<->db_child{child_id}; db_growth_record{child_id}<->db_month_eval{child_id}; db_growth_record{child_id}<->db_parent_evaluation{child_id}; db_growth_record{child_id}<->db_term_eval{child_id}; db_growth_record{child_id}<->db_child_assessment{child_id}
unique (唯一键) = child_id + term_id

method (方法):
required_month_count = COUNT(months elapsed from term_start_month through MIN(current_month,term_end_month))
teacher_month_complete_count = COUNT(DISTINCT eval_month FROM db_month_eval WHERE child_id=current_child_id AND eval_month IN current_term AND month_eval_status=e3)
parent_month_complete_count = COUNT(DISTINCT evaluation_period FROM db_parent_evaluation WHERE child_id=current_child_id AND evaluation_type=t1 AND evaluation_period IN current_term AND evaluation_status=p2)
monthly_complete = teacher_month_complete_count=required_month_count AND parent_month_complete_count=required_month_count
teacher_term_status = db_term_eval.term_eval_status WHERE child_id=current_child_id AND term_id=current_term_id; NULL maps to c2
parent_term_status = MAP(db_parent_evaluation.evaluation_status WHERE child_id=current_child_id AND evaluation_type=t2 AND evaluation_period=current_term_id: p2->c1, p0|p1|p3|NULL->c2)
comprehensive_assessment_status = db_child_assessment.child_assessment_status WHERE child_id=current_child_id AND term_id=current_term_id; NULL maps to c2
IF is_term_end=0, record_status = c1 ONLY IF monthly_complete ELSE c2
IF is_term_end=1, record_status = c1 ONLY IF monthly_complete AND teacher_term_status=c1 AND parent_term_status=c1 AND comprehensive_assessment_status=c1 ELSE c2

completion_rule (完成规则):
成长档案每名幼儿每学期只有一份
平时必须完成本学期截至当前月份的全部教师月评和家长月评
进入学期末后，还必须同时完成教师学期评估、家长学期评估和幼儿综合评估
任一必需评估缺失或未完成，主页成长档案状态均为 h2=未完成


社区共育 Feed (Community Coeducation Feed / derived)

source_rule = db_parent_task.parent_task_type=t2 JOIN db_parent_task_submission；`db_community_submission` 已由 B11 删除，不得恢复或复制
visibility_rule = 教师只读本人班级 c1 完成提交；c2 家庭草稿与进行中的微信检查不得返回


[GROWTH_BOOK]

依据 (source) = DECISIONS.md E3 及其下 W1-W21；本节整体推翻 B12 的「模板重新解读为汇出页、v1 不需要 template_code」
source_page (参考页面) = growth-book.html, growth-book-edit.html, growth-book-section-edit.html, growth-book-sample.html, growth-book-view.html
model (模型) = 模版是实打实的版式配置对象，比 template_code 更重 —— 是 widget 网格上的自由布局
export_page_removed (作废页面) = export-growth-book.html。F17 已取消所有成长册文件导出；growth-book.html 底部弹层只做整班定稿并开放

section_order (内容组成 6 项，固定顺序):

| n | section_key | 名称 | 粒度 | 数据来源 |
|---:|---|---|---|---|
| 1 | intro | 园所介绍 | 班级级（园所统一） | db_school.school_intro |
| 2 | time | 在园时光 | 班级级＋幼儿级 | 教师 db_growth_material＋家长 db_file_ref(book_parent) 联集 |
| 3 | task | 亲子活动 | 幼儿级 | db_parent_task + db_parent_task_submission |
| 4 | term | 期末评估 | 幼儿级 | db_term_eval.eval_text |
| 5 | comp | 综合评估 | 幼儿级 | db_child_assessment_item（雷达图即时算） |
| 6 | message | 教师寄语 | 幼儿级 | db_teacher_message.content |

section_order_note (相对 B12 的变动) = 删 parent 家长动态；eval 发展评估拆成 term + comp；comment 幼儿评语更名 message 教师寄语并改读 db_teacher_message；砍体检数据维持不变
no_manual_sort (不做整体拖拽排序) = 预设 6 项顺序固定。曾试「勾选 + 拖动排序」，2026-08-01 评审回退（纵向排序清单在手机上太笨重），故模版不需要 sort_order
cover_ownership (封面归属 / W19) = 封面归园所，存 db_school.book_cover JSON {layout_id, image_file_id, title_text}，一园一份，只有 admin 能改，school_id derived；教师端不提供封面写入控件，故本 specification 不为封面出 ui= 标注
cover_conflict_note (待上游澄清) = W13 把「选封面」列为教师可配置的三件事之一，W19 则把封面收归 admin。两条并存于 DECISIONS.md，本 specification 依 W19 处理并登记此冲突，不自行改判
border_ownership (美术边框归属 / W1b + W19) = 边框是设计不是内容，放页版式库 JSON，不提供上传；边框必须跟着 App 内书页渲染
teacher_configurable (教师可配置的范围 / W13) = 开关栏目、新增栏目（含其版面）两件事；预设 6 个栏目的页面由我们（developer）预先设计，教师完全不能改，因此没有 override 表、没有班班版面分歧
teacher_configurable_addendum (F16 + F17) = 上述两件事之外，教师还配置「内容进不进册」：亲子活动与逐幼儿在园时光选片在该幼儿 b2 时冻结；在园时光班级成长资料在首本 b2 后永久冻结。两者都不改版面


成长册 (Growth Book / db_growth_book)

growth_book_id (成长册ID), 1:1, integer, ui=growth_book.hidden
school_id (园所ID), 1:1, integer, ui=growth_book.hidden
class_id (班级ID), 1:1, integer, ui=growth_book.class
child_id (幼儿ID), 1:1, integer, ui=growth_book.child
teacher_id (评价教师ID), 1:1, integer, ui=context.hidden
term_id (学期ID), 1:1, school_term, ui=growth_book.period
layout_seed (版式随机种子), 1:1, integer, ui=growth_book.hidden
can_finalize (是否可定稿), 1:1, derived(can_finalize_rule), persist=0, ui=growth_book.status
book_status (成长册状态), 1:1, b1=preparing(准备中)|b2=published(已定稿开放), ui=growth_book.book_status
published_at (定稿开放时间), 0:1, datetime, ui=growth_book.published_at

rel_count (关系数量) = 4
rel_db (关联表) = db_school, db_class, db_child, db_teacher
rel_map (关系字段) = db_growth_book{school_id}<->db_school{school_id}; db_growth_book{class_id}<->db_class{class_id}; db_growth_book{child_id}<->db_child{child_id}; db_growth_book{teacher_id}<->db_teacher{teacher_id}
unique (唯一键) = child_id + term_id

method (方法):
成长册每名幼儿每学期只有一份
book_eval_status 已拔掉不落列，改为实时派生的布尔 can_finalize（DECISIONS.md F17）
IF book_status=b2, homepage growth_book_status=h1
IF book_status=b1 OR record NOT_FOUND, homepage growth_book_status=h2
主页不得显示逐项缺失；定稿前检查页负责呈现问题幼儿及具体缺项
school_id 为本次补列，见 GAPS.md G14

included_sections_removed (Q62-j39) = B12 曾列于 db_growth_book 的 included_sections 已正式作废，不落 DDL、不保留 hidden ui，也不改为逐册快照。预设栏目统一读取 db_growth_book_template.enabled_sections；新增栏目按冻结 template／section 解析。B12 同批的 book_message 亦已由 E1 作废，寄语改读 db_teacher_message

layout_seed_rule (版式种子规则 / W14):
不定长内容（task 亲子活动、time 在园时光）用「重复页样板池 + 随机挑选」：我们为该栏目设计 3-4 个页版式（各自宣告容量），渲染时挑版式、重复铺，直到盖完实际件数
随机必须可重现，保证 App 内预览与 b2 定稿后查看的页序一致
挑选序列 = PRNG(layout_seed, section_key, page_index)
layout_seed 首次渲染时产生，之后永不变；同一本册子重复渲染多少次都是同一个版面，不同幼儿因种子不同而版面不同

can_finalize_rule (可定稿判定 / E3 第 9 点 + W15 + F17):
can_finalize = 班级级栏目就绪 AND 该幼儿的因人而异栏目齐备 AND 每个征集型 widget 均已有该幼儿的提交 AND 预估总页数 <= 200
班级级就绪：intro 取 db_school.school_intro 非空
幼儿级齐备：time 取教师班级素材或该幼儿家长选片至少一项；task / term / comp / message 按各自完成状态；新增栏目按 collected 槽位全满
整班定稿前检查接口回每名幼儿缺项、总页数与各栏目页数，供教师提前处理；正式请求必须按当前指纹重新计算，不能复用过期检查结果
默认处理完全部问题后整班定稿；教师可明确勾选跳过异常幼儿。选中且通过者在同一请求中各自原子 b1→b2，跳过者保持 b1
每名幼儿 b2 时同一事务向每位当前 caretaker 各写一则 n5 App 内通知；v1 不接微信订阅消息

checklist_rule (定稿检查表规则 / E3 第 8 点 + F17):
检查表只把纯班级级的园所介绍移到表上方；在园时光因 F17 加入家长逐幼儿选片，必须留在幼儿列
表内为在园时光、亲子活动、期末评估、综合评估、教师寄语 + N 个新增栏目
接口对园所介绍回班级级状态；在园时光逐幼儿回教师班级素材与家长选片联集后的状态


成长册模版 (Growth Book Template / db_growth_book_template)

template_id (成长册模版ID), 1:1, integer, ui=growth_book_template.hidden
school_id (园所ID), 1:1, integer, ui=growth_book_template.hidden
class_id (班级ID), 1:1, integer, ui=growth_book_template.hidden
enabled_sections (启用栏目), 1:1, json, ui=growth_book_template.section_toggle
template_status (模版状态), 1:1, d1=draft(草稿)|d2=published(已定稿), ui=growth_book_template.status
updated_at (更新时间), 1:1, datetime, ui=growth_book_template.hidden

rel_count (关系数量) = 3
rel_db (关联表) = db_school, db_class, db_growth_book_section
rel_map (关系字段) = db_growth_book_template{school_id}<->db_school{school_id}; db_growth_book_template{class_id}<->db_class{class_id}; db_growth_book_template{template_id}<->db_growth_book_section{template_id}
unique (唯一键) = class_id
object_scope (归属层级 / W19) = 纯班级级。封面已移到 db_school.book_cover，本表不含封面字段
enabled_sections_value (取值) = 预设 6 项的开关，如 ["intro","time","task","term","comp","message"]

version_rule (版本化规则 / E3 第 3 点 + W16):
不做模版版本化、不做快照。故本表无 version，已定稿册不绑模版快照
W16 的草稿/定稿两态把 E3 第 3 点从使用假设变成系统约束：定稿后模版冻结，全班拿到同一个版面，因此仍然不需要版本化与快照
注意本条与 E2 的量表处理相反：量表必须版本化，成长册模版不必

draft_rule (草稿匣规则 / W16):
教师把栏目设计完之后不是立刻向家庭开放。中间有草稿阶段：可回头重编、可预览整本册子的实际呈现，确认无误才点「发布班级模板」定稿
d1=draft 可编、可预览；d2=published 永久冻结，幼儿册依此定稿
发布之前是草稿；F16 后发布为 d2 即永久唯读，不得撤回成 d1 再改，也不提供「发布了再偷偷改」的中间态


成长册新增栏目 (Growth Book Custom Section / db_growth_book_section)

section_id (新增栏目ID), 1:1, integer, ui=growth_book_section.hidden
template_id (成长册模版ID), 1:1, integer, ui=growth_book_section.hidden
name (栏目名称), 1:1, max_len=10, ui=growth_book_section.name_input
anchor_after (插入位置), 1:1, cover|section_key, ui=growth_book_section.anchor_select
created_by (创建教师ID), 1:1, integer, ui=growth_book_section.hidden
collection_status (征集状态), 1:1, c1=inactive(未征集)|c2=collecting(征集中), ui=growth_book_section.collection_status
created_at (创建时间), 1:1, datetime, ui=growth_book_section.hidden

rel_count (关系数量) = 3
rel_db (关联表) = db_growth_book_template, db_teacher, db_book_widget
rel_map (关系字段) = db_growth_book_section{template_id}<->db_growth_book_template{template_id}; db_growth_book_section{created_by}<->db_teacher{teacher_id}; db_growth_book_section{section_id}<->db_book_widget{section_id}
row_scope (落列范围 / W13) = 只存「新增栏目」。预设 6 项不落列，退回成 db_growth_book_template.enabled_sections 的开关
anchor_after_rule (插入位置规则) = 取 'cover' 或某个预设 section_key，决定新增栏目插在哪。W13 确认 anchor_after 仍需要 —— 新增栏目要能插在预设项之间

anchor_after_extension (锚点扩充到新增栏目 / 2026-08-02 前端评审，放宽本节原规则):
anchor_after 的取值扩充为 cover | 预设 section_key | **另一个新增栏目的 section_id** —— 原规则下两个新增栏目无法连排（想把「毕业典礼」放在「入学第一天」之后就做不到，只能各自锚到预设项）
落列影响：anchor_after 成为对本表的自我参照，DDL 落地时需能区分「预设 key」与「section_id」两类值（建议加一个 anchor_type，或把预设 key 与整数 id 分列，本 specification 不自行改判）
成环必须挡住：A 锚在 B 之后、B 又锚在 A 之后会形成环。前端的做法是在下拉选项中排除自己与所有（递回）锚定到自己的栏目；**服务端必须重做一次校验**，前端 UI 不是完整性边界（同 W6 的一般原则）
孤儿处理：删除某新增栏目时，锚在它之后的栏目改锚到它原本的锚点。若资料仍出现无法解析的锚点（锚点已不存在或成环），渲染端一律落到册尾，不得让该栏目消失
渲染端连带：落位不能再一轮扫完 —— 锚点本身可能尚未落位，须重复扫描直到全部安置（前端 placeCustoms()）
no_limit (数量上限) = 新增栏目不设上限，前后端都不做数量校验（E3 第 5 点）
name_len_note (栏目名称长度) = max_len=10 取自原型 growth-book-edit.html 的 maxlength，未经决议确认
note_text_removed (栏目说明作废 / W11) = db_growth_book_section.note_text 已砍掉。有了 widget 之后多余 —— 教师放一个 literal 文字 widget 打同一段话即可，还能自选位置与大小。原型 growth-book-edit.html 的「栏目说明」textarea 需随之删除，本 specification 不为它出 ui= 标注


成长册组件 (Growth Book Widget / db_book_widget)

widget_id (组件ID), 1:1, integer, ui=book_widget.hidden
section_id (所属栏目ID), 1:1, integer, ui=book_widget.hidden
page_index (页序), 1:1, integer, ui=book_widget.page_index
grid_x (格子横坐标), 1:1, integer(0:14), ui=book_widget.grid_x
grid_y (格子纵坐标), 1:1, integer(0:23), ui=book_widget.grid_y
grid_w (占用横格数), 1:1, integer(2:15), ui=book_widget.grid_w
grid_h (占用纵格数), 1:1, integer(2:24), ui=book_widget.grid_h
widget_type (组件型别), 1:1, image|text, ui=book_widget.type_select
binding_key (内容来源键), 1:1, literal|collected|school.intro|class.material|child.message|child.term_eval|child.task|child.assessment, ui=book_widget.binding_select
content (字面内容), 0:1, text, ui=book_widget.text_input
config (呈现配置), 0:1, json, ui=book_widget.style_panel

rel_count (关系数量) = 2
rel_db (关联表) = db_growth_book_section, db_book_material_submission
rel_map (关系字段) = db_book_widget{section_id}<->db_growth_book_section{section_id}; db_book_widget{widget_id}<->db_book_material_submission{widget_id}
row_scope (落列范围 / W13) = 只存「新增栏目」的 widget；预设页的 widget 在仓库的页版式库 JSON 里
storage_form (储存形态 / W5) = 一个 widget 一列，不存 JSON 数组。此处刻意不套用 B3 的「瘦关联表改 JSON」偏好 —— widget 有真实生命周期（新增/移动/缩放/删除）、要被逐一查询，而且素材提交必须外键指向它；布局存 JSON 则 widget_id 是数组元素、无法被外键指向，删 widget 会留下孤儿提交
config_value (config 取值) = 文字：字级 / 对齐（置中|靠左|靠右）；图片：fill|cover|crop。进阶控制放抽屉，不占介面（W8）

rich_text_rule (literal 文字的逐段样式 / 2026-08-02 前端评审，扩充 W8):
literal 文字 widget 支援逐段套用「加粗 / 斜体 / 颜色」，content 由纯文字改存 run 阵列 [{t, b, i, c}]；无样式的段落只有 t，等价于原本的纯文字
字级与对齐维持整个 widget 一个值（config.size / config.align），不逐段可改 —— 这是保住 W18 的条件：CJK 字符在常规体与粗体下同为定宽，粗/斜/色不改变换行，容量仍可由 grid_w × grid_h × 字级推导；字级若逐段可改，maxlength 就算不出来
拉丁字母与数字在粗体下的进阶宽度确实会变，本次接受此误差（幼儿园文案以中文为主），登记为已知偏差
颜色不给自由取色，只给园所调色板 6 色（#1a1916 / #189b91 / #067e76 / #f6762f / #3388fc / #868686），避免整本册子的视觉一致性被个别教师配色破坏
后端连带成本（需确认）：① db_book_widget.content 的型别由 text 改为 json；② W20 的两端 canvas 渲染须实作 run 级绘制（逐段换字重、字形、颜色），95% 一致度的验收对象因此变复杂；③ 字体档从 1 个变 3 个（Regular / Bold / Italic，或 Bold + 合成斜体），CJK 子集化后各 5-15MB，授权须涵盖三者的服务器端嵌入与再散布 —— 直接加重 GAPS.md G29(b)

fit_scope (fill/cover/crop 的适用范围 / 2026-08-02 前端评审，登记 W9 与 W10+W17 的冲突):
W9 写「家长上传时不强制符合该比例；显示方式由教师在网格端决定 Fill / Cover / 自动裁切」，但 W10 + W17 定的是家长端裁剪框吃 grid_w:grid_h、家长裁好才上传、服务器只存裁切后的成品
两者并存时，binding_key=collected 的图片进册时必定已与框同比例，fill / cover / crop 三者结果完全相同 —— 该控件在这条路径上是死控件
本次前端按后者处理：collected 图片不出显示方式控件，改出「征集比例」快捷值（1:1 / 4:3 / 3:4 / 3:2 / 2:3，均为整数格数）；显示方式只留给 class.material 与 child.task 这类不经成长册裁剪工具、比例不定的来源；child.assessment 是即时绘制的向量图，同样不出该控件
若后端认为 W9 那句仍应对 collected 生效（例如家长可跳过裁剪直接传原图），须回头改 W10 / W17，本 specification 不自行改判
editor_status (空白网格线上编辑器 / W4) = 编范本本身用的编辑器由我们使用，与教师端的栏目编辑器同一套渲染、不同权限；列为独立工项，尚未排期
editor_scope_note (两个编辑器不可混为一谈 / 2026-08-02 更正) = W4 未排期的只有「我们用来编页版式库的范本编辑器」。**教师端的新增栏目版面编辑器不在延后之列** —— W13 明写「新增栏目仍可自由排版」，且 db_book_widget 九列全部带 ui=book_widget.* 标注。该编辑器已于 2026-08-02 落成 growth-book-section-edit.html

grid_rule (网格规则 / W1 · W1a · W1b · W2 · W6 · W7 · W9):
版面单位是实体 A4 页（210 × 297mm 直式），不是连续画布；widget 不得跨页，每个 widget 完整归属于单一页面
网格 15 × 24，格子 10mm 精确正方，不接受近似：左右边距 30mm -> 内容宽 150mm ÷ 15 = 10.0mm；上下边距 28.5mm -> 内容高 240mm ÷ 24 = 10.0mm；余数 0
上下取 28.5 而非 30 的理由：150 : 237 约分为 50 : 79，79 是质数，四边都恰好 30mm 的唯一整除解是 50 × 79（格 3mm，过细）；上下松动 1.5mm 后 297 − 57 = 240，因数立刻好切
边距是先扣掉的、有功能的区域（放美术边框），不是铺格剩下的余数；widget 不得放进边距，grid_x ∈ 0..14、grid_y ∈ 0..23
widget 长宽比 = 占格数之比，必须逐像素成立。保证做法是先算格子边长、两轴共用同一个整数像素值：cell = floor(content_width_px / 15)，rows = floor(content_height_px / cell)，余数并入页边距
widget 最小尺寸 2 × 2 格（20 × 20mm），否则四角缩放把手的触控热区互相重叠；后端存档校验 grid_w >= 2 AND grid_h >= 2
一个栏目可含多页，页数由教师新增，非固定 1 页
网格适用全册，不只新增栏目；预设 6 个栏目的页面同样是网格版面，差别只在由范本预先排好
重叠一律拒绝放置，不做弹开推挤：放手时若与既有 widget 重叠，该 widget 标红 + 提示移走 + 关闭存档按钮；坐标重叠时拒绝存档整个栏目
重叠校验服务端必须重做一次 —— 前端 UI 永远不是完整性边界
widget 只有图片、文字两型，不做视频；不为同功能不同尺寸各开一个模板，一律是可自由缩放的通用 widget
图片比例由格子坐标反推；家长上传时不强制符合该比例，显示方式由教师在网格端决定 fill / cover / crop

zoom_rule (手机端缩放规则 / W1c):
取消「手机端不允许横向滑动」，改为允许 zoom。手机宽 390pt best-fit 时每格仅 18.6pt，低于 iOS 建议的 44pt，需放大 2.37 倍才达标
连带的互动规格（前端待定，但必须有答案）：平移手势与拖曳 widget 的手势必须能区分；拖曳到视窗外时需边缘自动卷动；任何触控舒适的缩放倍率下画面永远只看得到约 9 格

text_limit_rule (文字上限规则 / W18):
不定全域字数上限。前端依 grid_w × grid_h 与当前字级即时算出 maxlength，打满就打不下去，溢出从根本上不存在
反方向同时成立：bound 型 widget（child.message、child.term_eval、child.task）的框必须大于等于来源的字数上限，编辑器挡掉太小的框
教师打完字再把字级调大导致超出时，必须挡住存档并提示，不可默默截断
bound 型的来源上限必须在动手排版式库之前先定死：child.message 为 300；db_parent_task_submission.submission_text 为 1000；db_term_eval.eval_text 为 500（F17）

binding_key_registry (内容来源登记表 / W11):

| binding_key | 粒度 | 内容存在哪 | 型别 | 入齐备判定 |
|---|---|---|---|---|
| literal | widget | db_book_widget 这一列自己（content） | image, text | 否 |
| collected | child | db_book_material_submission（家长上传，触发征集） | image, text | 是 |
| school.intro | school | db_school.school_intro | text | 否 |
| class.material | class | db_growth_material（成长资料） | image, text | 班级级前置 |
| child.message | child | db_teacher_message.content | text | 是 |
| child.term_eval | child | db_term_eval.eval_text | text | 是 |
| child.task | child | db_parent_task_submission | image, text | 是 |
| child.assessment | child | 不存，即时算 | image | 是 |

registry_rule (登记表规则) = 只用一栏 binding_key，不开 content_source 第二栏。粒度（school / class / section / child / widget）、谁填、要不要入齐备判定、能配哪种型别，全部是绑定目标的固有属性，查登记表即可，不该在每一列上复写
literal_rule = literal 是唯一内容真的存在 widget 列上的一种；其余都是指标
collected_text_rule = collected 也吃文字，不只照片。家长打的字是 UGC，必须与照片走同一条内容把关（CLAUDE.md 红线 3、GAPS.md G2）
dropped_bindings (砍掉的两个绑定目标) = section.note（db_growth_book_section.note_text，widget 化后多余）与 class.intro（B12 加的 db_class.class_intro，无使用场景，B12 该项作废；db_school.school_intro 保留）
radar_rule (雷达图 / W12 + F17) = 不存任何文件、不存 base64、不落任何字段。五领域均分完全由 db_child_assessment_item 的题项分推导，App 内 canvas 即时画。同一条逻辑适用所有 bound widget：它们在 db_book_widget 上什么都不存，一律即时读


成长册素材提交 (Growth Book Material Submission / db_book_material_submission) [REUSE]

reuse_source (复用来源) = Parent App growth-book-spec.md (canonical definition)
引用字段 = book_material_submission_id, widget_id, child_id, submission_text, file_id, submitted_by, submitted_at, active_check_batch_key
unique (唯一键) = widget_id + child_id
row_meaning (一列的含义) = 一个槽位一名幼儿
submitted_by (提交来源) = parent(家长提交)|teacher(教师代传)
cross_app_rule (跨端规则) = 家长端为 canonical，教师端仅引用，不得重复定义或另建同义表；教师代传写同一张表，只有 submitted_by 不同
teacher_write_surface (教师端写入面) = growth-book-edit.html「提交情况」弹层的代传按钮，写 file_id / submission_text，沿用家长端的 ui=book_material.submission.upload 与 ui=book_material.submission.text，本 specification 不另立名字
submitted_by_rule (代传规则 / E3 第 6 点) = 该值由服务端依登录身份设定，请求体不得指定
no_request_table (不建征集请求表) = db_book_material_request 不建表。一个 binding_key=collected 的 widget 存在本身就是一次征集，状态由提交记录的有无派生
crop_note (裁切框形态) = NONE。Q62-j6 已删除 crop；只存裁切后的处理 JPEG，以实际像素比例复验
pk_naming_conflict (主键命名待统一) = DECISIONS.md E3 的 DDL 草图写 submission_id，家长端 canonical 写 book_material_submission_id；两者指同一列，DDL 落地时须择一，此处依 canonical 引用

collection_lifecycle (素材征集生命周期 / W15 + W16):
以「栏目」为单位发起，不按 widget 发（家长会一次收到六个通知，而它们其实是同一件事）、也不按页发（「页」是排版概念，家长不知道册子怎么分页）
一个新增栏目 = 家长端一则待办，点进去列出该栏目所有页上的全部 collected 槽位，一次交完
齐备判定 = 该栏目全部槽位都有东西，不是「至少交一件」
不接受「可以不交」：允许缺件等于把压力与责任转嫁给教师，且缺件必然产生留白，排出来的东西违反教师设计时的原意
已知代价：教师多摆两个槽位就可能卡住全班出册。这与「新增栏目不设上限」「征集不设时限」叠加，是三条已定决策共同造成的风险，缓解手段只有教师代传
征集不设时限：无 due_date、无逾期状态、无提醒任务；栏目永久跨学期共用，不以学期结束自动关闭
征集启停由 db_growth_book_section.collection_status 独立控制；template d2 只冻结版面，不自动发布或撤回征集
撤回的语意是删除不是保留：该栏目已收的提交一并删除，不留孤儿档，重新发布时家长要重交。理由是裁切比例已失效（W17 只存成品无原图），且符合 PIPL 第六条最小必要
can_finalize 对该幼儿逐栏目比对「该栏目的 collected widget 数」与「该幼儿在这些 widget 上的提交数」

photo_storage_rule (照片储存规则 / W17):
上传当下统一转 JPEG（MozJPEG 编码，q82-85）、长边 2000px，只存裁切后的成品，不留原图
统一 JPEG 是现行 App 内渲染与存储契约；F17 已取消以 PDF 编码支持作为格式理由
长边 2000px 是 App／电子 150 DPI 渲染下的存储上限，不是纸本印刷目标；实际最低像素只按 1240 × 1754 renderer 中对应槽位估算，小图不为 hardcopy 放大
输入端照单全收：客户端传 HEIC / WebP / PNG 都接，服务器统一转，转码发生在上传当下一次，不在渲染时
家长端附裁剪工具（W10）：上传时预览最终显示比例，可拖拽调位，避免「头被切掉」才发现
unverified_item (待查证) = 微信 chooseMedia 在 iOS 上回 HEIC 还是已转 JPEG、WebP 在两端 image 组件的显示支援 —— 只影响上传端要不要自己转，不影响储存格式结论


成长资料 (Growth Material / db_growth_material)

material_id (成长资料ID), 1:1, integer, ui=growth_material.hidden
class_id (班级ID), 1:1, integer, ui=growth_material.hidden
source_type (来源类型), 1:1, r1=moment(在园时光)|r2=community(社区共育), ui=growth_material.hidden
moment_id (在园时光ID), 0:1, integer, ui=growth_material.hidden
title (活动名称), 1:1, max_len=50, ui=growth_material.title
description (活动文字), 0:1, text, ui=growth_material.description
file_id (收录照片ID), 0:k, integer, ui=growth_material.photo_select
sort_order (排序), 1:1, integer, ui=growth_material.sort_button
created_at (创建时间), 1:1, datetime, ui=growth_material.hidden

rel_count (关系数量) = 3
rel_db (关联表) = db_class, db_moment, db_file
rel_map (关系字段) = db_growth_material{class_id}<->db_class{class_id}; db_growth_material{moment_id}<->db_moment{moment_id}; db_growth_material{file_id}<->db_file{file_id}
rel_note (关系补充) = source_type=r2 时 moment_id 为空，社区来源的外键待 B11 落地后补，见下方 source_change

channel_rule (成长资料通道规则 / E3 第 7 点 + W11 + F17):
成长资料是班级级素材。在园时光的每则动态可「加入成长册」，教师勾选其中若干张照片（10 张挑 3 张），活动文字全量收录
方向是「从动态里挑出来放进成长册」，不是相反
收录后全班每本册子的在园时光栏目内容相同，不按 child_id 存
加入入口：动态卡片右下角的「+ 加入成长册」按钮，与「涉及 m/n 人 · k 位家长已查看」同一行；已收录的按钮显示「✓ 已加入（N 张）」
管理入口在 growth-book-edit.html 的「在园时光 · 管理」弹层：可上移、可移除
素材件数不另设硬上限；成长册整本含固定页的硬上限为 200 页，超过时阻止定稿并由教师移出部分进册选择，不删除源动态
该班首本册 b2 前可加入、调整、排序或移出；首本 b2 后永久唯读。来源撤回／下架／依法删除仍只解除该来源通道与引用，恢复不自动重建


家长在园时光选片 (Parent Moment Book Selection / db_file_ref)

file_id (家长已选在园时光照片ID), 1:1, integer, ui=moment_book.teacher_exclude
reuse_source (复用来源) = db_file_ref canonical；owner_object 固定 db_moment_upload，owner_id 为经 scope 验证的 moment_upload_id，usage_key 固定 book_parent

parent_moment_rule (家长选片规则 / F17) = 家长只可在 s3 已发布且 db_moment_upload 明确关联当前幼儿的 moment 中勾选既有照片；不得上传、编辑动态或自行声明幼儿参与。勾选至少一图时标题与完整 moment_content 在该册只收一次
union_rule (联集规则) = 与教师班级级 db_growth_material 按来源／file_id 联集去重；教师在逐册最终预览可删除对应 book_parent 引用，只从该册排除，不删照片或动态、不通知家长
freeze_rule (冻结规则) = 该幼儿 b1 时家长可调整，b2 后永久只读

source_change (来源收敛 / Q62-d):
db_growth_material 只承载教师发布的班级级在园时光素材。任何家庭的日常／社区亲子任务提交都保持幼儿级，不能塞进本通道后扩散到全班
社区任务同样是 db_parent_task(parent_task_type=t2) + db_parent_task_submission，教师在对应幼儿提交上操作 teacher 分支

task_selection_rule (亲子活动收录筛选 / Q62-d—d4):
收录粒度是一笔 c1 db_parent_task_submission，不是班级任务。家长与教师分别写 parent_book_included／teacher_book_included，任一为真即入册；两分支照片用 db_file_ref usage_key=book_parent|book_teacher，取 file_id 联集并去重
教师只能操作本人班级幼儿的 teacher 分支，不能覆盖家长分支；家长端不显示教师选择。选择不随 template d2 冻结，而在该幼儿 b2 时冻结


[GROWTH_BOOK_RENDERING]

依据 (source) = DECISIONS.md F17（覆盖 E3 第 10/11 点、W20、W21 的 PDF 分支）

architecture (现行渲染架构) = 只在 Teacher／Parent App 内用同一套书页绘图码做样本预览、逐册预览与 b2 查看；不生成 PDF／图片册，不下载、不分享文件，不启用服务器 node-canvas、导出任务、generated file 或 render lease
page_limit (页数规则) = 没有下限；启用的固定栏目必须有实际素材，自定义 collected 槽仍全满。整本含封面、园所介绍、园长寄语、各栏目与封底硬上限 200 页；超过即阻止定稿
last_page_rule (末页规则) = 实际件数不足版式容量时，未使用槽位隐藏、留白或用版式装饰填充，不要求为每个余数另造版式
precheck_rule (预检查) = 显示每名幼儿总页数、各栏目页数与缺项；教师移出的只是本册收录选择，绝不删除源记录
screen_capture_rule (截屏录屏边界) = 产品不提供下载／分享能力；系统级截屏或录屏无法可靠阻止，不加水印，也不承诺控制脱离 App 后的用户行为


[NEW_SCREEN_WRITE_CONTROL_INDEX]

依据 (source) = CLAUDE.md「UI 改版不得破坏数据映射」；本表列出六个新页面上真正的写入控件与其 ui= 标注
derived_rule (派生列不得出现) = value_source=derived 的列（教师端为 school_id / class_id / created_by / uploaded_by / requested_by_teacher_id）一律标 hidden，不得出现在写入控件上；机器可读形式见 db/spec/scope-rules.json
scoped_rule (scoped 列的责任) = child_id / teacher_id 为 scoped，客户端可选但服务端必须把范围内联成 predicate 重新验证

| 页面 | 控件 | ui= 标注 | 落列 |
|---|---|---|---|
| teacher-evaluation.html | 无写入控件（仅导航 + 只读进度） | —— | —— |
| teacher-message.html | 添加到（单选下拉） | teacher_message.child_select | db_teacher_message.child_id |
| teacher-message.html | 寄语正文 | teacher_message.textarea | db_teacher_message.content |
| teacher-message-detail.html | 无写入控件（正文只读） | —— | —— |
| growth-book-edit.html | 成长册内容 6 项勾选 | growth_book_template.section_toggle | db_growth_book_template.enabled_sections |
| growth-book-edit.html | 亲子活动 · 收录勾选 | growth_book_template.task_select | db_growth_book_template（落列待定，见 task_selection_rule） |
| growth-book-edit.html | 发布班级模板（d2 后永久只读） | growth_book_template.status | db_growth_book_template.template_status |
| growth-book-edit.html | 新增栏目 · 栏目名称 | growth_book_section.name_input | db_growth_book_section.name |
| growth-book-edit.html | 新增栏目 · 插入位置 | growth_book_section.anchor_select | db_growth_book_section.anchor_after |
| growth-book-section-edit.html | 页管理（+ 页 / 删页） | book_widget.page_index | db_book_widget.page_index |
| growth-book-section-edit.html | 组件拖曳定位 | book_widget.grid_x / book_widget.grid_y | db_book_widget.grid_x, grid_y |
| growth-book-section-edit.html | 组件缩放（把手 / 进阶步进） | book_widget.grid_w / book_widget.grid_h | db_book_widget.grid_w, grid_h |
| growth-book-section-edit.html | + 图片 / + 文字 | book_widget.type_select | db_book_widget.widget_type |
| growth-book-section-edit.html | 内容来源下拉 | book_widget.binding_select | db_book_widget.binding_key |
| growth-book-section-edit.html | literal 文字输入 | book_widget.text_input | db_book_widget.content |
| growth-book-section-edit.html | 字级 / 对齐 / 图片显示方式 | book_widget.style_panel | db_book_widget.config |
| growth-book-edit.html | 在园时光 · 上移 | growth_material.sort_button | db_growth_material.sort_order |
| growth-book-edit.html | 在园时光 · 移除 | growth_material.photo_select | db_growth_material（删列） |
| growth-book-edit.html | 提交情况 · 教师代传 | book_material.submission.upload（家长端 canonical，教师端沿用不另立） | db_book_material_submission.file_id |
| growth-book-sample.html | 无写入控件（只读样本预览） | —— | —— |
| growth-book-view.html | 排除家长在园时光选片（只删进册引用） | moment_book.teacher_exclude | db_file_ref.file_id |

not_annotated (刻意不标注的原型控件):
growth-book-edit.html 的「封面版式 / 封面图片 / 标题文字」 —— 封面归园所、只有 admin 能改（W19），教师端不应有此控件；2026-08-02 前端已按此删除该整块
growth-book-edit.html 的「栏目说明」 —— note_text 已由 W11 砍掉，改用 literal 文字 widget；2026-08-02 前端已删除该 textarea
slot_count_derived = 「征集槽位数」不是可写控件，也不落列：它等于该栏目 binding_key=collected 的 widget 数，由 db_book_widget 即时算。2026-08-02 曾在 growth-book-edit.html 放过一个「素材槽位数」下拉当占位，已随版面编辑器落地删除
growth-book.html 全班定稿弹层的幼儿勾选 —— 选的是本次 b1→b2 的范围，不单独写业务列；跳过的异常幼儿保持 b1
widget 网格编辑器的 ui=book_widget.* 标注已于 2026-08-02 在 growth-book-section-edit.html 落地，不再是 PENDING（原记「界面尚未出现（W4 未排期）」是把范本编辑器与教师端栏目编辑器混为一谈，见 editor_scope_note）
原型未做的三件（W1c 的连带互动规格，前端待定但必须有答案）：缩放后的单指平移目前交给容器原生卷动、拖曳到视窗外的边缘自动卷动未做、双指缩放手势以 +/− 按钮代替
字体选型不出控件：教师只配字级与对齐（W8）。F17 取消跨环境 PDF 像素一致度要求，字体授权不再卡住 App 内成长册


[ACCEPTANCE_EXAMPLES]

| scenario | detail_result | homepage_result |
|---|---|---|
| 本周在园时光完成2次 | 已完成 | 在园时光=已完成 |
| 本周在园时光只完成第1次 | 缺第2次 | 在园时光=未完成 |
| 本周在园时光完成0次 | 未完成 | 在园时光=未完成 |
| 有较新的亲子任务草稿，但最近已发布任务已完成 | 草稿不参与“最新一期”判断 | 亲子任务=已完成 |
| 最新已发布亲子任务没有完成提交 | 未完成 | 亲子任务=未完成 |
| 截至当前月份有任一教师月评或家长月评未完成 | 对应月评=未完成 | 成长档案=未完成 |
| 学期末月评全部完成，但任一教师/家长学期评估或综合评估未完成 | 对应评估=未完成 | 成长档案=未完成 |
| 学期末成长册 book_status=b1 | 准备中；定稿前检查回缺项与页数 | 成长册=未完成 |
| 学期末成长册 book_status=b2 | 已定稿并在 App 内开放 | 成长册=已完成 |
| 综合评估已评 60 / 124 题 | 综合评估自己的页显示草稿 | 教师评价聚合页 / 成长档案 / 生成检查表一律显示未完成 |
| 综合评估某领域一题未评 | 该领域回“尚无评分”，不得回 0 | 综合评估=未完成 |
| 教师寄语选「全体幼儿」提交 | 班内每名幼儿各生成一条 db_teacher_message，内容相同 | 教师寄语=已完成（全班） |
| 新增栏目有 3 个 collected 槽位，某幼儿只交 2 件 | 该栏目未齐备 | 该幼儿 can_finalize=0 |
| 教师撤回某新增栏目的素材征集 | 该栏目已收的提交一并删除，版面解冻回草稿 | 相关幼儿 can_finalize=0 |
| 某幼儿预估 201 页 | 显示各栏目页数并要求移出部分进册内容 | 该幼儿 can_finalize=0 |


[EMPTY_STATE]

IF child_count=0, show_empty_state=1, empty_title=暂无幼儿信息, empty_description=班级幼儿名册导入后将在这里显示
IF child_count>0 AND no business record exists, render each real child with four h2=incomplete statuses, average_completion=0, reminder_count=child_count
homepage_status_enum (主页状态枚举) = h1=complete(已完成)|h2=incomplete(未完成)
Mock child_name|child_count|percentage|status MUST NOT be returned in production


[JUMP_VALIDATION]

IF node_key=btn_home_school_moment, REQUIRE school_id AND class_id FROM context
IF node_key=btn_parent_task, REQUIRE school_id AND class_id FROM context
IF node_key=btn_growth_record, REQUIRE school_id AND class_id FROM context
IF node_key=btn_community_coeducation, REQUIRE school_id AND class_id FROM context
IF class_id NOT_AUTHORIZED_FOR teacher_id, return 403
IF child_id NOT_IN current_class_id, return 403
IF page=teacher-message.html AND target=all, fan out over db_child WHERE class_id=current_class_id AND enrollment_status=e1
IF page=teacher-message.html AND target=all, lock/recompute active roster AND write all INSERT/skip rows in one transaction; any failure rolls back all; success returns inserted/skipped counts
IF page=teacher-message.html AND target=all AND roster fingerprint drifted, return 409 with refreshed two counts; no write; same idempotency key returns original result
IF page=teacher-message.html AND UNIQUE(child_id,term_id) already exists, return 409 AND refresh readonly canonical
IF page=teacher-message.html AND child_id NOT_IN current_class_id, return 403
IF role=parent AND page=growth-book-view.html AND book_status!=b2, return 404
IF role=teacher AND page=growth-book-view.html AND child_id NOT_IN current_or_original_authorized_class, return 403
IF page=growth-book-edit.html AND template_status=d2, 模板全部内容永久冻结，任何模板写入／撤回请求 return 409
IF 写入 db_school.book_cover AND role!=admin, return 403


[F10_F17_JOURNEY_OVERRIDE_2026_08_12]

moment_publish = s1 草稿服务端自动保存；标题 1—50 字，至少一名同班幼儿，trim 后 1—600 字评语或至少 1 张图片；最多 9 张。教师在当前页面完整预览并点发布即为人工把关，不送微信 API
moment_edit = F16 覆写：s3 正文、日期、图片与幼儿名单永久唯读；修正须由有权教师撤回后另建 s1。恢复只恢复同一内容；家长 feed 只读 s3
image_pipeline = 教师／家长统一：输入单档最多 10 MB，只接受 JPEG|PNG|WebP|HEIC，校正方向、移除 metadata、长边超过 2000px 才缩小，统一 MozJPEG q82—85，只存处理后 JPEG
task_book_branch = 教师只能改 c1 提交的 teacher_book_included 与 book_teacher 引用；与家长分支 OR 合并，照片联集去重。该幼儿 b2 后永久冻结，不能因 template d2 提前冻结
finalize_transition = 正式请求按当前数据指纹重新验证模板 d2、启用固定栏目素材、collected 全满与总页数不超过 200；通过者各自原子 b1→b2，之后永久锁定。教师可显式跳过问题幼儿，未选者保持 b1
collection_toggle = 每个新增 section 以 collection_status c1↔c2 独立启停；template d2 只冻结版面。c2 才接受家庭草稿与教师代传；撤回同交易删检查列、全部 submission 与引用。相关幼儿任一 b2 后永久禁撤回
transfer_history = growth-book.html 另列不混入 active roster 的「历史成册」，按 growth_book.class_id=current teacher class AND b2 查询，包含已转班／e2 幼儿；当前 active 原班教师仍可 App 内查看。列表回 book id、幼儿显示资料、学期、published_at 与只读状态
notification = 每名幼儿 b2 时在同一事务向每位当前 caretaker 各写一则 n5 db_notification；不接微信订阅消息
collection_toggle_lock_ui = c1 发布与 c2 撤回按钮在相关幼儿任一 b2 后保留永久禁用并提示已有定稿册；服务端按相同 predicate 重验
teacher_material = 教师接管家庭草稿并代传前完整预览、点一次确认，作为人工把关；不送微信、不建 review_action。active family batch 期间不得接管；任何来源一旦写 submitted_at 即永久唯读，不再允许教师更正
permanent_collection = template、section、widget 与 material submission 不带 term_id；同一份 collected 内容永久供往后学期共用
crop_removed = db_book_material_submission.crop 已删除，只存按 widget 比例处理后的 JPEG，服务端复验实际像素宽高
