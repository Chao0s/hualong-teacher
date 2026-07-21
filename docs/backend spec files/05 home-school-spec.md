HOME_SCHOOL_BACKEND_OBJECT_SPEC

scope (范围) = screens/home-school.html
source_page (参考页面) = home-school.html
source_page_correction (原型纠正规则) = home-school.html 当前示例中的“缺第2次|进行中|可生成|缺评语|待补图|不可生成”等主页状态标注已失效；后台与后续前端实现以本 specification 的主页二元状态为准
static_node_count (固定可点击节点数) = 9
dynamic_progress_row_count (动态进度行数) = 0:k
runtime_clickable_node_count (运行时可点击节点数) = 9
field_format (字段格式) = field_key (中文字段名), cardinality, type|enum, ui
id_rule (ID规则) = integer, database_auto_generated
null_rule (空值规则) = 0:1
list_rule (列表规则) = 0:k | 1:k


[SHARED_OBJECT_RULE]

shared_object_source (共享对象来源) = home-spec.md
shared_objects (共享对象) = db_teacher, db_school, db_class, db_teacher_class, db_moment, db_moment_upload, db_month_eval, db_file
shared_nav_objects (共享导航对象) = nav_home, nav_party, nav_coord, nav_training, nav_home_school
rename_shared_object (重命名共享对象) = FORBIDDEN
duplicate_shared_object_definition (重复定义共享对象) = FORBIDDEN
new_canonical_objects (本次新增业务对象) = db_term_eval, db_child_assessment
external_identity_object (跨端身份对象) = db_parent; 由家长端统一定义并由教师端引用
external_business_object (跨端业务对象) = db_parent_evaluation; 由家长端 home-spec.md 统一定义(canonical)，教师端仅引用，不得另建同义表


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
production_initial_db_community_submission (社区共育提交初始状态) = EMPTY
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
| 4 | 社区共育 | Community Coeducation | btn_community_coeducation | db_community_submission | school_id, class_id | home-school.html > community-coeducation.html |
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
community_submission_id (社区共育提交ID), 0:k, integer, ui=home_school.quick.community
child_count (班级幼儿数), 1:1, integer, derived(db_child), ui=home_school.metric.child_count
average_completion (平均完成率), 1:1, percent, derived(db_home_school_progress), ui=home_school.metric.average_completion
reminder_count (待提醒幼儿数), 1:1, integer, derived(db_home_school_progress), ui=home_school.metric.reminder_count

rel_count (关系数量) = 10
rel_db (关联表) = db_teacher, db_school, db_class, db_child, db_home_school_progress, db_moment, db_parent_task, db_growth_record, db_growth_book, db_community_submission
rel_map (关系字段) = db_home_school{teacher_id}<->db_teacher{teacher_id}; db_home_school{school_id}<->db_school{school_id}; db_home_school{class_id}<->db_class{class_id}; db_home_school{child_id}<->db_child{child_id}; db_home_school{home_school_progress_id}<->db_home_school_progress{home_school_progress_id}; db_home_school{moment_id}<->db_moment{moment_id}; db_home_school{parent_task_id}<->db_parent_task{parent_task_id}; db_home_school{growth_record_id}<->db_growth_record{growth_record_id}; db_home_school{growth_book_id}<->db_growth_book{growth_book_id}; db_home_school{community_submission_id}<->db_community_submission{community_submission_id}
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

rel_count (关系数量) = 7
rel_db (关联表) = db_class, db_child, db_moment, db_moment_upload, db_parent_task_submission, db_growth_record, db_growth_book
rel_map (关系字段) = db_home_school_progress{class_id}<->db_class{class_id}; db_home_school_progress{child_id}<->db_child{child_id}; db_home_school_progress{week_key}<->db_moment{week_key}; db_home_school_progress{child_id}<->db_moment_upload{child_id}; db_home_school_progress{child_id}<->db_parent_task_submission{child_id}; db_home_school_progress{child_id}<->db_growth_record{child_id}; db_home_school_progress{child_id}<->db_growth_book{child_id}
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
growth_book_status = MAP(db_growth_book.book_eval_status: c1->h1, c2|NULL->h2)
required_count = 4
completed_count = COUNT(moment_status=h1, parent_task_status=h1, growth_record_status=h1, growth_book_status=h1)
row_completion_rate = completed_count/4*100
reminder_required = 1 IF ANY(moment_status,parent_task_status,growth_record_status,growth_book_status)=h2 ELSE 0

summary_rule (主页简化规则):
主页四项只允许 h1=已完成 或 h2=未完成，不显示“缺第2次”“进行中”“可生成”“待补图”等详细状态
任何一项所需内容未全部完成时，该项主页状态必须为 h2
在园时光只完成第1次时，详细页显示 d2=缺第2次，主页仍显示 h2=未完成


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
file_id (提交图片或视频ID), 0:k, integer, ui=parent_task.submission.media
submission_status (提交状态), 1:1, c1=complete(已完成)|c2=incomplete(未完成), ui=parent_task.submission.status
submitted_at (提交时间), 0:1, datetime, ui=parent_task.submission.time

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
term_eval_status (完成状态), 1:1, c1=complete(已完成)|c2=incomplete(未完成), ui=term_eval.status
submitted_at (提交时间), 0:1, datetime, ui=term_eval.submitted_at

rel_count (关系数量) = 4
rel_db (关联表) = db_school, db_class, db_child, db_teacher
rel_map (关系字段) = db_term_eval{school_id}<->db_school{school_id}; db_term_eval{class_id}<->db_class{class_id}; db_term_eval{child_id}<->db_child{child_id}; db_term_eval{teacher_id}<->db_teacher{teacher_id}
unique (唯一键) = teacher_id + child_id + term_id


幼儿综合评估 (Child Comprehensive Assessment / db_child_assessment)

child_assessment_id (幼儿综合评估ID), 1:1, integer, ui=child_assessment.hidden
school_id (园所ID), 1:1, integer, ui=child_assessment.hidden
class_id (班级ID), 1:1, integer, ui=child_assessment.class
child_id (幼儿ID), 1:1, integer, ui=child_assessment.child
teacher_id (评价教师ID), 1:1, integer, ui=context.hidden
term_id (学期ID), 1:1, school_term, ui=child_assessment.period
required_count (应评指标数), 1:1, integer, ui=child_assessment.hidden
completed_count (已评指标数), 1:1, integer, ui=child_assessment.progress
child_assessment_status (完成状态), 1:1, c1=complete(已完成)|c2=incomplete(未完成), ui=child_assessment.status
submitted_at (提交时间), 0:1, datetime, ui=child_assessment.submitted_at

rel_count (关系数量) = 4
rel_db (关联表) = db_school, db_class, db_child, db_teacher
rel_map (关系字段) = db_child_assessment{school_id}<->db_school{school_id}; db_child_assessment{class_id}<->db_class{class_id}; db_child_assessment{child_id}<->db_child{child_id}; db_child_assessment{teacher_id}<->db_teacher{teacher_id}
unique (唯一键) = child_id + term_id

method (方法):
IF completed_count=required_count AND submitted_at IS NOT NULL, child_assessment_status=c1
ELSE child_assessment_status=c2


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


成长册 (Growth Book / db_growth_book)

growth_book_id (成长册ID), 1:1, integer, ui=growth_book.hidden
class_id (班级ID), 1:1, integer, ui=growth_book.class
child_id (幼儿ID), 1:1, integer, ui=growth_book.child
teacher_id (评价教师ID), 1:1, integer, ui=context.hidden
term_id (学期ID), 1:1, school_term, ui=growth_book.period
book_eval_status (成长册评估状态), 1:1, c1=complete(已完成)|c2=incomplete(未完成), ui=growth_book.status
generation_status (成长册生成状态), 1:1, g1=not_generated(未生成)|g2=generated(已生成), ui=growth_book.generation_status
generated_file_id (成长册文件ID), 0:1, integer, ui=growth_book.preview|growth_book.download
generated_at (生成时间), 0:1, datetime, ui=growth_book.generated_at

rel_count (关系数量) = 4
rel_db (关联表) = db_class, db_child, db_teacher, db_file
rel_map (关系字段) = db_growth_book{class_id}<->db_class{class_id}; db_growth_book{child_id}<->db_child{child_id}; db_growth_book{teacher_id}<->db_teacher{teacher_id}; db_growth_book{generated_file_id}<->db_file{file_id}
unique (唯一键) = child_id + term_id

method (方法):
成长册每名幼儿每学期只有一份，成长册评估在学期末由教师完成
IF book_eval_status=c1, homepage growth_book_status=h1
IF book_eval_status=c2 OR record NOT_FOUND, homepage growth_book_status=h2
generation_status 不改变主页二元完成状态；主页不得显示“可生成”“待补图”“不可生成”等详细生成状态


社区共育提交 (Community Coeducation Submission / db_community_submission)

community_submission_id (社区共育提交ID), 1:1, integer, ui=community.card.hidden
school_id (园所ID), 1:1, integer, ui=community.hidden
class_id (班级ID), 1:1, integer, ui=community.class
child_id (幼儿ID), 1:1, integer, ui=community.child
task_label (任务标签), 0:1, max_len=100, ui=community.card.task_label
submission_text (提交内容), 0:1, max_len=1000, ui=community.card.text
file_id (图片或视频ID), 0:k, integer, ui=community.card.media
publish_status (发布状态), 1:1, s1=draft(草稿)|s2=published(已发布), ui=community.status
published_at (发布时间), 0:1, datetime, ui=community.card.time

rel_count (关系数量) = 4
rel_db (关联表) = db_school, db_class, db_child, db_file
rel_map (关系字段) = db_community_submission{school_id}<->db_school{school_id}; db_community_submission{class_id}<->db_class{class_id}; db_community_submission{child_id}<->db_child{child_id}; db_community_submission{file_id}<->db_file{file_id}


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
| 学期末成长册评估未完成 | 未完成 | 成长册=未完成 |
| 学期末成长册评估已完成 | 已完成 | 成长册=已完成 |


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
