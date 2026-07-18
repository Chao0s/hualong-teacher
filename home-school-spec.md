HOME_SCHOOL_BACKEND_OBJECT_SPEC

scope (范围) = screens/home-school.html
source_page (参考页面) = home-school.html
static_node_count (固定可点击节点数) = 9
dynamic_progress_row_count (动态进度行数) = 0:k
runtime_clickable_node_count (运行时可点击节点数) = 9
field_format (字段格式) = field_key (中文字段名), cardinality, type|enum, ui
id_rule (ID规则) = integer, database_auto_generated
null_rule (空值规则) = 0:1
list_rule (列表规则) = 0:k | 1:k


[SHARED_OBJECT_RULE]

shared_object_source (共享对象来源) = home-spec.md
shared_objects (共享对象) = db_teacher, db_school, db_class, db_teacher_class, db_moment, db_moment_upload, db_month_eval, db_assessment, db_file
shared_nav_objects (共享导航对象) = nav_home, nav_party, nav_coord, nav_training, nav_home_school
rename_shared_object (重命名共享对象) = FORBIDDEN
duplicate_shared_object_definition (重复定义共享对象) = FORBIDDEN


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
static_ui_content (保留的静态界面内容) = 页面标题、说明文案、四个快捷入口、完成度表头和状态图例
production_seed (生产环境业务种子数据) = NONE
production_initial_db_moment (在园时光初始状态) = EMPTY
production_initial_db_parent_task (亲子任务初始状态) = EMPTY
production_initial_db_parent_task_submission (亲子任务提交初始状态) = EMPTY
production_initial_db_growth_record (成长档案初始状态) = EMPTY
production_initial_db_growth_book (成长册初始状态) = EMPTY
production_initial_db_community_submission (社区共育提交初始状态) = EMPTY
base_identity_data (基础身份数据) = db_school|db_teacher|db_class|db_teacher_class|db_child 由部署或园所管理员导入，不属于 Mock 业务内容
initial_progress_rule (初始进度规则) = 有真实幼儿名册但无业务记录时，状态统一为 not_started，不得显示已完成、进行中或虚构百分比
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
IF assigned_item_count=0, average_completion=0
reminder_count = COUNT(DISTINCT child_id WHERE reminder_required=1)
IF child_count=0, progress_rows=[]


[IDENTITY_OBJECT]

幼儿 (Child / db_child)

child_id (幼儿ID), 1:1, integer, ui=child.hidden
school_id (园所ID), 1:1, integer, ui=child.hidden
class_id (班级ID), 1:1, integer, ui=child.class
child_name (幼儿姓名), 1:1, max_len=50, ui=home_school.progress.child_name|child.profile.name
enrollment_status (在园状态), 1:1, e1=active(在园)|e2=leave(离园)|e3=suspended(暂停), ui=child.hidden
enrolled_at (入园日期), 0:1, date, ui=child.profile.enrolled_at

rel_count (关系数量) = 2
rel_db (关联表) = db_school, db_class
rel_map (关系字段) = db_child{school_id}<->db_school{school_id}; db_child{class_id}<->db_class{class_id}


[PROGRESS_AGGREGATE]

家园共育进度 (Home-School Progress / db_home_school_progress)

home_school_progress_id (进度汇总ID), 1:1, integer, ui=home_school.progress.hidden
class_id (班级ID), 1:1, integer, ui=home_school.progress.hidden
child_id (幼儿ID), 1:1, integer, ui=home_school.progress.child_name
period_start (统计开始日期), 1:1, date, ui=home_school.progress.hidden
period_end (统计结束日期), 1:1, date, ui=home_school.progress.hidden
moment_status (在园时光状态), 1:1, p0=not_started(未开始)|p1=in_progress(进行中)|p2=complete(已完成)|p3=overdue(逾期未完成), ui=home_school.progress.moment
parent_task_status (亲子任务状态), 1:1, p0=not_started(未开始)|p1=in_progress(进行中)|p2=complete(已完成)|p3=overdue(逾期未完成), ui=home_school.progress.parent_task
growth_record_status (成长档案状态), 1:1, p0=not_started(未开始)|p1=in_progress(进行中)|p2=complete(已完成)|p3=overdue(逾期未完成), ui=home_school.progress.growth_record
growth_book_status (成长册状态), 1:1, b0=not_started(未开始)|b1=ready(可生成)|b2=missing_comment(缺评语)|b3=missing_image(待补图)|b4=unavailable(不可生成)|b5=generated(已生成), ui=home_school.progress.growth_book
assigned_item_count (应完成项目数), 1:1, integer, ui=home_school.progress.hidden
completed_item_count (已完成项目数), 1:1, integer, ui=home_school.progress.hidden
row_completion_rate (幼儿完成率), 1:1, percent, ui=home_school.progress.hidden
reminder_required (是否需要提醒), 1:1, boolean, ui=home_school.progress.reminder

rel_count (关系数量) = 6
rel_db (关联表) = db_class, db_child, db_moment_upload, db_parent_task_submission, db_growth_record, db_growth_book
rel_map (关系字段) = db_home_school_progress{class_id}<->db_class{class_id}; db_home_school_progress{child_id}<->db_child{child_id}; db_home_school_progress{child_id}<->db_moment_upload{child_id}; db_home_school_progress{child_id}<->db_parent_task_submission{child_id}; db_home_school_progress{child_id}<->db_growth_record{child_id}; db_home_school_progress{child_id}<->db_growth_book{child_id}
persist (是否持久化) = 0
object_type (对象类型) = aggregate_view
unique (唯一键) = class_id + child_id + period_start + period_end

method (方法):
assigned_item_count = COUNT(required business items in period)
completed_item_count = COUNT(required business items with complete status)
IF assigned_item_count=0, row_completion_rate=0
IF assigned_item_count>0, row_completion_rate=completed_item_count/assigned_item_count*100
IF no matching business record, corresponding status=p0
reminder_required = 1 ONLY IF required item is overdue or explicitly marked missing


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

rel_count (关系数量) = 4
rel_db (关联表) = db_school, db_class, db_teacher, db_parent_task_submission
rel_map (关系字段) = db_parent_task{school_id}<->db_school{school_id}; db_parent_task{class_id}<->db_class{class_id}; db_parent_task{teacher_id}<->db_teacher{teacher_id}; db_parent_task{parent_task_id}<->db_parent_task_submission{parent_task_id}


亲子任务提交 (Parent Task Submission / db_parent_task_submission)

parent_task_submission_id (亲子任务提交ID), 1:1, integer, ui=parent_task.submission.hidden
parent_task_id (亲子任务ID), 1:1, integer, ui=parent_task.submission.hidden
child_id (幼儿ID), 1:1, integer, ui=parent_task.submission.child
submission_text (提交文字), 0:1, max_len=1000, ui=parent_task.submission.text
file_id (提交图片或视频ID), 0:k, integer, ui=parent_task.submission.media
submission_status (提交状态), 1:1, p0=not_started(未提交)|p1=in_progress(进行中)|p2=complete(已完成)|p3=overdue(逾期未提交), ui=parent_task.submission.status
submitted_at (提交时间), 0:1, datetime, ui=parent_task.submission.time

rel_count (关系数量) = 3
rel_db (关联表) = db_parent_task, db_child, db_file
rel_map (关系字段) = db_parent_task_submission{parent_task_id}<->db_parent_task{parent_task_id}; db_parent_task_submission{child_id}<->db_child{child_id}; db_parent_task_submission{file_id}<->db_file{file_id}
unique (唯一键) = parent_task_id + child_id


成长档案 (Growth Record / db_growth_record)

growth_record_id (成长档案ID), 1:1, integer, ui=growth_record.hidden
school_id (园所ID), 1:1, integer, ui=growth_record.hidden
class_id (班级ID), 1:1, integer, ui=growth_record.class
child_id (幼儿ID), 1:1, integer, ui=growth_record.child
record_period (档案周期), 1:1, YYYY-MM|school_term, ui=growth_record.period
record_status (档案状态), 1:1, p0=not_started(未开始)|p1=in_progress(进行中)|p2=complete(已完成)|p3=overdue(逾期未完成), ui=growth_record.status
updated_at (更新时间), 0:1, datetime, ui=growth_record.updated_at

rel_count (关系数量) = 5
rel_db (关联表) = db_school, db_class, db_child, db_month_eval, db_assessment
rel_map (关系字段) = db_growth_record{school_id}<->db_school{school_id}; db_growth_record{class_id}<->db_class{class_id}; db_growth_record{child_id}<->db_child{child_id}; db_growth_record{child_id}<->db_month_eval{child_id}; db_growth_record{class_id}<->db_assessment{class_id}
unique (唯一键) = child_id + record_period


成长册 (Growth Book / db_growth_book)

growth_book_id (成长册ID), 1:1, integer, ui=growth_book.hidden
class_id (班级ID), 1:1, integer, ui=growth_book.class
child_id (幼儿ID), 1:1, integer, ui=growth_book.child
book_period (成长册周期), 1:1, school_term, ui=growth_book.period
growth_book_status (成长册状态), 1:1, b0=not_started(未开始)|b1=ready(可生成)|b2=missing_comment(缺评语)|b3=missing_image(待补图)|b4=unavailable(不可生成)|b5=generated(已生成), ui=growth_book.status
generated_file_id (成长册文件ID), 0:1, integer, ui=growth_book.preview|growth_book.download
generated_at (生成时间), 0:1, datetime, ui=growth_book.generated_at

rel_count (关系数量) = 3
rel_db (关联表) = db_class, db_child, db_file
rel_map (关系字段) = db_growth_book{class_id}<->db_class{class_id}; db_growth_book{child_id}<->db_child{child_id}; db_growth_book{generated_file_id}<->db_file{file_id}
unique (唯一键) = child_id + book_period


社区共育提交 (Community Coeducation Submission / db_community_submission)

community_submission_id (社区共育提交ID), 1:1, integer, ui=community.card.hidden
school_id (园所ID), 1:1, integer, ui=community.hidden
class_id (班级ID), 1:1, integer, ui=community.class
child_id (幼儿ID), 1:1, integer, ui=community.child
task_label (任务标签), 0:1, max_len=100, ui=community.card.task_label
submission_text (提交内容), 0:1, max_len=1000, ui=community.card.text
file_id (图片或视频ID), 0:k, integer, ui=community.card.media
submission_status (提交状态), 1:1, s1=draft(草稿)|s2=published(已发布), ui=community.status
published_at (发布时间), 0:1, datetime, ui=community.card.time

rel_count (关系数量) = 4
rel_db (关联表) = db_school, db_class, db_child, db_file
rel_map (关系字段) = db_community_submission{school_id}<->db_school{school_id}; db_community_submission{class_id}<->db_class{class_id}; db_community_submission{child_id}<->db_child{child_id}; db_community_submission{file_id}<->db_file{file_id}


[EMPTY_STATE]

IF child_count=0, show_empty_state=1, empty_title=暂无幼儿信息, empty_description=班级幼儿名册导入后将在这里显示
IF child_count>0 AND assigned_item_count=0, show_zero_state=1, zero_title=暂无待完成内容, average_completion=0, reminder_count=0
Mock child_name|child_count|percentage|status MUST NOT be returned in production


[JUMP_VALIDATION]

IF node_key=btn_home_school_moment, REQUIRE school_id AND class_id FROM context
IF node_key=btn_parent_task, REQUIRE school_id AND class_id FROM context
IF node_key=btn_growth_record, REQUIRE school_id AND class_id FROM context
IF node_key=btn_community_coeducation, REQUIRE school_id AND class_id FROM context
IF class_id NOT_AUTHORIZED_FOR teacher_id, return 403
IF child_id NOT_IN current_class_id, return 403
