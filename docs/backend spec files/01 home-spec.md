HOME_BACKEND_OBJECT_SPEC

scope (范围) = screens/home.html
static_node_count (固定按键数) = 13
dynamic_home_case_card_count (动态首页案例卡片数) = 0:3
runtime_node_count (运行时节点数) = 13:16
field_format (字段格式) = field_key (中文字段名), cardinality, type|enum, ui
id_rule (ID规则) = integer, 1:k
null_rule (空值规则) = 0:1
list_rule (列表规则) = 0:k | 1:k


[DATA_INITIALIZATION_RULE]

prototype_content (原型内容) = HTML 中的轮播、待办、评估、培训、在园时光、月度评价、资源、案例、数量和完成状态均为 demo|test Mock
demo_content_purpose (演示内容用途) = 仅用于展示用户后续创建或上传业务内容后的界面效果
demo_content_scope (演示内容适用环境) = demo|test
demo_content_names (演示案例名称) = 祠堂里的故事|龙舟竞渡|醒狮从哪里来
static_ui_content (保留的静态界面内容) = 页面标题、功能入口、栏目标题和空状态文案
production_seed (生产环境业务种子数据) = NONE
production_initial_db_upload (上传记录初始状态) = EMPTY
production_initial_db_task (待办任务初始状态) = EMPTY
production_initial_db_assessment (质量评估初始状态) = EMPTY
production_initial_db_training (培训初始状态) = EMPTY
production_initial_db_moment (在园时光初始状态) = EMPTY
production_initial_db_month_eval (月度评价初始状态) = EMPTY
production_initial_db_case (生产环境案例初始状态) = EMPTY
production_initial_db_home_case (生产环境首页推荐初始状态) = EMPTY
production_initial_db_resource (生产环境资源初始状态) = EMPTY
production_empty_response (生产环境无首页推荐时返回) = []
base_identity_data (基础身份数据) = db_school|db_teacher|db_class|db_teacher_class|db_child 由部署或园所管理员初始化，不属于 Mock 业务内容
mock_metric_rule (模拟统计规则) = HTML 中的数量、比例、徽标和完成状态不得写入 production
case_id_generation (案例ID生成规则) = database_auto_generated
hardcoded_case_id (固定案例ID) = FORBIDDEN
environment_isolation (环境隔离) = demo|test 数据不得复制到 production


[STATIC_BUTTON_NODE_INDEX]

| n | button_name_cn | button_name_en | node_key | object | input | jump |
|---:|---|---|---|---|---|---|
| 1 | 上传资源 | Upload Resource | btn_upload | db_upload | teacher_id, class_id | home.html > upload-resource.html |
| 2 | 待办任务 | Pending Tasks | btn_task | db_task | teacher_id | home.html > teacher-tasks.html > teacher-task-detail.html?task_id={task_id} |
| 3 | 质量评估 | Quality Assessment | btn_assessment | db_assessment | teacher_id, class_id, assessment_id | home.html > assessment-tool.html?assessment_id={assessment_id} |
| 4 | 教研培训 | Teaching Research and Training | btn_training | db_training | school_id, teacher_id | home.html > training-list.html > training-detail.html?training_id={training_id} |
| 5 | 在园时光 | Kindergarten Moments | btn_moment | db_moment | class_id, teacher_id | home.html > home-school-moments.html |
| 6 | 月度评价 | Monthly Evaluation | btn_month_eval | db_month_eval | teacher_id, class_id | home.html > teacher-monthly-form.html |
| 7 | 课程资源 | Course Resources | btn_resource | db_resource | school_id, class_id | home.html > resource-center.html |
| 8 | 全部案例 | All Cases | btn_case_all | db_case | case_id=all | home.html > case-library.html |
| 9 | 首页 | Home | nav_home | db_home | NULL | home.html |
| 10 | 党建管理 | Party Affairs | nav_party | nav_party | NULL | school-affairs.html |
| 11 | 综合协调 | Comprehensive Coordination | nav_coord | nav_coord | NULL | comprehensive-coordination.html |
| 12 | 教研培训 | Training Center | nav_training | nav_training | NULL | training-center.html |
| 13 | 家园共育 | Home-School Coeducation | nav_home_school | nav_home_school | NULL | home-school.html |


[DYNAMIC_HOME_CASE_NODE]

| node_name_cn | node_name_en | node_key | object | input | cardinality | jump |
|---|---|---|---|---|---|---|
| 首页推荐案例卡片 | Home Recommended Case Card | home_case_card | db_home_case + db_case | case_id (runtime) | 0:3 | home.html > case-detail.html?case_id={case_id} |

dynamic_rule (动态规则) = 案例名称、封面、标签和 case_id 必须来自接口返回，不得写死在前端或后端逻辑中


[PAGE_OBJECT]

首页 (Home / db_home)

home_id (首页ID), 1:1, integer, ui=home.page
teacher_id (当前教师ID), 1:1, integer, ui=context.hidden
school_id (当前园所ID), 1:1, integer, ui=context.hidden
class_id (当前班级ID), 1:1, integer, ui=context.hidden
upload_id (上传记录ID), 0:1, integer, ui=home.todo.upload
task_id (任务ID), 0:k, integer, ui=home.todo.task
assessment_id (评估ID), 0:1, integer, ui=home.todo.assessment
training_id (培训ID), 0:k, integer, ui=home.quick.training
moment_id (在园时光ID), 0:k, integer, ui=home.quick.moment
month_eval_id (月度评价ID), 0:k, integer, ui=home.quick.month_eval
resource_id (资源ID), 0:k, integer, ui=home.quick.resource
home_case_id (首页推荐案例ID), 0:k, integer, ui=home.case.list

rel_count (关系数量) = 11
rel_db (关联表) = db_teacher, db_school, db_class, db_upload, db_task, db_assessment, db_training, db_moment, db_month_eval, db_resource, db_home_case
rel_map (关系字段) = db_home{teacher_id}<->db_teacher{teacher_id}; db_home{school_id}<->db_school{school_id}; db_home{class_id}<->db_class{class_id}; db_home{*_id}<->rel_db{*_id}
persist (是否持久化) = 0
object_type (对象类型) = aggregate


[IDENTITY_OBJECTS]

园所 (School / db_school)

school_id (园所ID), 1:1, integer, ui=context.hidden
school_name (园所名称), 1:1, max_len=100, ui=school.name
school_status (园所状态), 1:1, s1=active(启用)|s2=inactive(停用), ui=school.hidden

rel_count (关系数量) = 0


教师 (Teacher / db_teacher)

teacher_id (教师ID), 1:1, integer, ui=context.hidden
school_id (园所ID), 1:1, integer, ui=context.hidden
teacher_name (教师姓名), 1:1, max_len=50, ui=teacher.name
teacher_status (教师状态), 1:1, s1=active(在职)|s2=leave(离职)|s3=suspended(暂停), ui=teacher.hidden

rel_count (关系数量) = 1
rel_db (关联表) = db_school
rel_map (关系字段) = db_teacher{school_id}<->db_school{school_id}


班级 (Class / db_class)

class_id (班级ID), 1:1, integer, ui=context.hidden|class.selector
school_id (园所ID), 1:1, integer, ui=context.hidden
class_name (班级名称), 1:1, max_len=50, ui=class.name|class.selector
grade (年级), 1:1, k1=small(小班)|k2=middle(中班)|k3=large(大班), ui=class.grade
class_status (班级状态), 1:1, s1=active(启用)|s2=archived(归档), ui=class.hidden

rel_count (关系数量) = 1
rel_db (关联表) = db_school
rel_map (关系字段) = db_class{school_id}<->db_school{school_id}


教师班级关系 (Teacher-Class Relation / db_teacher_class)

teacher_class_id (教师班级关系ID), 1:1, integer, ui=context.hidden
teacher_id (教师ID), 1:1, integer, ui=context.hidden
class_id (班级ID), 1:1, integer, ui=context.hidden
assignment_role (班级角色), 1:1, r1=lead(主班)|r2=assistant(配班)|r3=support(支援), ui=teacher_class.role
active (是否有效), 1:1, boolean, ui=teacher_class.hidden

rel_count (关系数量) = 2
rel_db (关联表) = db_teacher, db_class
rel_map (关系字段) = db_teacher_class{teacher_id}<->db_teacher{teacher_id}; db_teacher_class{class_id}<->db_class{class_id}
unique (唯一键) = teacher_id + class_id

context_method (上下文方法):
teacher_id = auth_session.teacher_id
school_id = db_teacher.school_id
allowed_class_id = db_teacher_class.class_id WHERE teacher_id=current_teacher_id AND active=1
current_class_id MUST IN allowed_class_id


[BUTTON_OBJECTS]

上传资源 (Upload Resource / db_upload)

upload_id (上传记录ID), 1:k, integer, ui=upload.hidden
upload_target (上传目标), 1:1, u1=resource(课程资源库)|u2=case(课程案例库), ui=upload.target_button
teacher_id (上传教师ID), 1:1, integer, ui=upload.teacher_select
class_id (上传班级ID), 1:1, integer, ui=upload.class_select
target_id (目标对象ID), 0:1, integer, ui=upload.hidden
upload_status (上传状态), 1:1, s1=draft(草稿)|s2=pending(待审核)|s3=approved(已通过)|s4=rejected(已驳回), ui=home.todo.upload.badge|upload.status
created_at (创建时间), 1:1, datetime, ui=upload.hidden
submitted_at (提交时间), 0:1, datetime, ui=upload.hidden

rel_count (关系数量) = 4
rel_db (关联表) = db_teacher, db_class, db_resource, db_case
rel_map (关系字段) = db_upload{teacher_id}<->db_teacher{teacher_id}; db_upload{class_id}<->db_class{class_id}; IF upload_target=u1, db_upload{target_id}<->db_resource{resource_id}; IF upload_target=u2, db_upload{target_id}<->db_case{case_id}

method (方法):
IF upload_target=u1, create db_resource, return resource_id
IF upload_target=u2, create db_case, return case_id
IF submit=0, upload_status=s1
IF submit=1, upload_status=s2


待办任务 (Pending Tasks / db_task)

task_id (任务ID), 1:k, integer, ui=task.card.hidden|task_detail.hidden
task_title (任务标题), 1:1, max_len=50, ui=home.todo.task|task.card.title|task_detail.title
task_intro (任务说明), 1:1, max_len=300, ui=task.card.summary|task_detail.intro
task_division (任务分工), 1:1, max_len=300, ui=task_detail.division
task_deadline (截止时间), 1:1, datetime, ui=task.card.deadline|task_detail.deadline
task_status (任务状态), 1:1, t1=wait_accept(待接收)|t2=in_progress(进行中)|t3=complete(已完成)|t4=cancelled(已取消), ui=home.todo.task.badge|task.card.status|task_detail.status
createdby (任务发起人ID), 1:1, teacher_id, ui=task.card.creator|task_detail.creator
file_id (任务附件ID), 0:k, integer, ui=task_detail.attachment

rel_count (关系数量) = 2
rel_db (关联表) = db_task_assign, db_file
rel_map (关系字段) = db_task{task_id}<->db_task_assign{task_id}; db_task{file_id}<->db_file{file_id}

method (方法):
current = task_status IN(t1,t2)
history = task_status IN(t3,t4)
click = return task_id


待办任务分配 (Task Assignment / db_task_assign)

assign_id (任务分配ID), 1:k, integer, ui=task.hidden
task_id (任务ID), 1:1, integer, ui=task.hidden
teacher_id (执行教师ID), 1:1, integer, ui=task_detail.assignee
assign_status (执行状态), 1:1, a1=wait_accept(待接收)|a2=in_progress(进行中)|a3=complete(已完成), ui=task.card.status|task_detail.status
accepted_at (接收时间), 0:1, datetime, ui=task_detail.accepted_at
completed_at (完成时间), 0:1, datetime, ui=task_detail.completed_at
feedback (任务反馈), 0:1, max_len=500, ui=task_detail.feedback

rel_count (关系数量) = 2
rel_db (关联表) = db_task, db_teacher
rel_map (关系字段) = db_task_assign{task_id}<->db_task{task_id}; db_task_assign{teacher_id}<->db_teacher{teacher_id}


质量评估 (Quality Assessment / db_assessment)

assessment_id (评估ID), 1:k, integer, ui=assessment.hidden
teacher_id (评估教师ID), 1:1, integer, ui=assessment.hidden
class_id (评估班级ID), 1:1, integer, ui=assessment.hidden
assessment_scope (评估范围), 1:1, a1=teacher(教师)|a2=class(班级)|a3=school(园所), ui=assessment.scope
assessment_period (评估周期), 1:1, YYYY-MM, ui=assessment.period
item_total (指标总数), 1:1, integer, ui=home.todo.assessment.badge.denominator|assessment.summary.total
item_done (已评数量), 1:1, integer, ui=home.todo.assessment.badge.numerator|assessment.summary.done
assessment_status (评估状态), 1:1, s1=not_started(未开始)|s2=in_progress(进行中)|s3=complete(已完成), ui=assessment.summary.status
created_at (创建时间), 1:1, datetime, ui=assessment.hidden
submitted_at (提交时间), 0:1, datetime, ui=assessment.hidden

rel_count (关系数量) = 3
rel_db (关联表) = db_teacher, db_class, db_assessment_item
rel_map (关系字段) = db_assessment{teacher_id}<->db_teacher{teacher_id}; db_assessment{class_id}<->db_class{class_id}; db_assessment{assessment_id}<->db_assessment_item{assessment_id}

method (方法):
item_done = COUNT(db_assessment_item.score WHERE score=1:5)
item_total = COUNT(db_assessment_item.item_id WHERE active=1)
badge = item_done + '/' + item_total
IF item_done=0, assessment_status=s1
IF item_done>0 AND item_done<item_total, assessment_status=s2
IF item_done=item_total, assessment_status=s3


质量评估项 (Assessment Item / db_assessment_item)

item_id (评估指标ID), 1:k, integer, ui=assessment.item.hidden
assessment_id (评估ID), 1:1, integer, ui=assessment.hidden
section_id (一级指标ID), 1:1, integer, ui=assessment.section
subsection_id (二级指标ID), 1:1, integer, ui=assessment.subsection
item_text (指标内容), 1:1, text, ui=assessment.item.title
score (指标得分), 0:1, 1:5, ui=assessment.item.score_button
note (评价记录), 0:1, max_len=300, ui=assessment.item.note
file_id (佐证材料ID), 0:k, integer, ui=assessment.item.evidence
active (是否启用), 1:1, boolean, ui=assessment.hidden

rel_count (关系数量) = 2
rel_db (关联表) = db_assessment, db_file
rel_map (关系字段) = db_assessment_item{assessment_id}<->db_assessment{assessment_id}; db_assessment_item{file_id}<->db_file{file_id}


教研培训 (Teaching Research and Training / db_training)

training_id (培训ID), 1:k, integer, ui=training.card.hidden|training_detail.hidden
school_id (园所ID), 1:1, integer, ui=training.hidden
training_type (培训类型), 1:1, t1=current(最新研修)|t2=history(历史研修), ui=training.section
training_title (培训标题), 1:1, max_len=100, ui=training.card.title|training_detail.title
training_intro (培训简介), 0:1, max_len=300, ui=training.card.summary|training_detail.intro
start_at (开始时间), 1:1, datetime, ui=training.card.time|training_detail.time
end_at (结束时间), 0:1, datetime, ui=training_detail.time
location (培训地点), 0:1, max_len=100, ui=training.card.location|training_detail.location
meeting_url (会议链接), 0:1, url, ui=training_detail.meeting_button
speaker (主讲人), 0:1, max_len=50, ui=training.card.speaker|training_detail.speaker
training_status (培训状态), 1:1, s1=open(开放报名)|s2=registered(已报名)|s3=in_progress(进行中)|s4=complete(已完成), ui=training.card.badge|training_detail.status
createdby (创建教师ID), 1:1, teacher_id, ui=training.hidden
file_id (研修材料ID), 0:k, integer, ui=training.card.material_count|training_detail.material

rel_count (关系数量) = 3
rel_db (关联表) = db_school, db_teacher, db_file
rel_map (关系字段) = db_training{school_id}<->db_school{school_id}; db_training{createdby}<->db_teacher{teacher_id}; db_training{file_id}<->db_file{file_id}

method (方法):
list = FILTER(school_id, training_type)
click = return training_id


在园时光 (Kindergarten Moments / db_moment)

moment_id (在园时光ID), 1:k, integer, ui=moment.card.hidden|moment_detail.hidden
school_id (园所ID), 1:1, integer, ui=moment.hidden
class_id (班级ID), 1:1, integer, ui=moment.class
teacher_id (发布教师ID), 1:1, integer, ui=moment.publisher
moment_title (活动名称), 1:1, max_len=50, ui=moment.card.title|moment_publish.title
moment_date (活动日期), 1:1, date, ui=moment.card.date|moment_publish.date
moment_location (活动地点), 0:1, max_len=100, ui=moment_publish.location
moment_observe (观察实录), 0:1, max_len=300, ui=moment_publish.observe|moment_detail.observe
moment_analysis (活动分析), 0:1, max_len=300, ui=moment_publish.analysis|moment_detail.analysis
file_id (活动图片ID), 0:k, integer, ui=moment.card.image|moment_publish.image
publish_status (发布状态), 1:1, p1=draft(草稿)|p2=published(已发布), ui=moment.status

rel_count (关系数量) = 5
rel_db (关联表) = db_school, db_class, db_teacher, db_moment_upload, db_file
rel_map (关系字段) = db_moment{school_id}<->db_school{school_id}; db_moment{class_id}<->db_class{class_id}; db_moment{teacher_id}<->db_teacher{teacher_id}; db_moment{moment_id}<->db_moment_upload{moment_id}; db_moment{file_id}<->db_file{file_id}


在园时光上传 (Moment Upload / db_moment_upload)

moment_upload_id (在园时光上传ID), 1:k, integer, ui=moment.progress.hidden
moment_id (在园时光ID), 1:1, integer, ui=moment.progress.hidden
child_id (幼儿ID), 1:1, integer, ui=moment.progress.child_name
week_key (评估周), 1:1, ISO-YYYY-Www, ui=moment.progress.week
upload_seq (每周评估次序), 1:1, q1=first(第1次)|q2=second(第2次), ui=moment.progress.first|moment.progress.second
evaluation_status (单次评估状态), 1:1, c1=complete(已完成)|c2=incomplete(未完成), ui=moment.progress.status
file_id (上传图片ID), 0:k, integer, ui=moment.progress.image
uploaded_at (上传时间), 0:1, datetime, ui=moment.hidden

rel_count (关系数量) = 3
rel_db (关联表) = db_moment, db_child, db_file
rel_map (关系字段) = db_moment_upload{moment_id}<->db_moment{moment_id}; db_moment_upload{child_id}<->db_child{child_id}; db_moment_upload{file_id}<->db_file{file_id}
unique (唯一键) = child_id + week_key + upload_seq

method (方法):
weekly_complete_count = COUNT(evaluation_status=c1 WHERE child_id AND week_key)
weekly_incomplete_count = 2 - weekly_complete_count
单次详情只返回 evaluation_status=c1|c2；周汇总和主页状态由 db_home_school_progress 计算


月度评价 (Monthly Evaluation / db_month_eval)

month_eval_id (月度评价ID), 1:k, integer, ui=month_eval.hidden
teacher_id (评价教师ID), 1:1, integer, ui=month_eval.hidden
class_id (班级ID), 1:1, integer, ui=month_eval.hidden
child_id (评价幼儿ID), 1:1, integer, ui=month_eval.child_select
eval_month (评价月份), 1:1, YYYY-MM, ui=month_eval.month_select
eval_text (评价内容), 1:1, max_len=500, ui=month_eval.textarea
moment_id (关联在园时光ID), 0:k, integer, ui=month_eval.photo_list
eval_status (评价状态), 1:1, e1=draft(草稿)|e2=saved(已保存)|e3=published(已发布), ui=month_eval.status
saved_at (保存时间), 0:1, datetime, ui=month_eval.hidden

rel_count (关系数量) = 4
rel_db (关联表) = db_teacher, db_class, db_child, db_moment
rel_map (关系字段) = db_month_eval{teacher_id}<->db_teacher{teacher_id}; db_month_eval{class_id}<->db_class{class_id}; db_month_eval{child_id}<->db_child{child_id}; db_month_eval{moment_id}<->db_moment{moment_id}
unique (唯一键) = teacher_id + child_id + eval_month


课程资源 (Course Resources / db_resource)

resource_id (资源ID), 1:k, integer, ui=resource.card.hidden|resource_detail.hidden
resource_type (资源文件类型), 1:1, r1=docx|r2=xlsx|r3=jpg|r4=html|r5=pdf|r6=wiki, ui=resource.card.type|resource_detail.type
resource_name (资源名称), 1:1, max_len=20, ui=resource.card.title|resource_detail.title|upload.resource_name
resource_tag (资源标签), 1:1, g1=clothing(衣)|g2=food(食)|g3=housing(住)|g4=mobility(行)|g5=art(艺), ui=resource.card.tag|resource_detail.tag|upload.resource_tag
school_id (园所ID), 1:1, integer, ui=resource.hidden
class_id (班级ID), 0:1, integer, ui=upload.class_select
grade (适用年级), 0:k, k1=small(小班)|k2=middle(中班)|k3=large(大班), ui=resource.card.grade|resource_detail.grade
resource_explain (资源解读), 1:1, max_len=200, ui=resource_detail.explain|upload.resource_explain
resource_access (资源获取), 1:1, max_len=300, ui=resource_detail.access|upload.resource_access
resource_trans (资源转化), 1:1, max_len=200, ui=resource_detail.trans|upload.resource_trans
cover_file_id (封面图片ID), 1:1, integer, ui=resource.card.cover|upload.cover
word_file_id (Word附件ID), 0:1, integer, ui=resource_detail.word|upload.word
createdby (创建教师ID), 1:1, teacher_id, ui=resource_detail.creator
created_at (创建时间), 1:1, datetime, ui=resource_detail.created_at
resource_status (资源状态), 1:1, s1=draft(草稿)|s2=pending(待审核)|s3=approved(已通过)|s4=rejected(已驳回), ui=resource.status
required_count (必填项数量), 1:1, integer, ui=resource.hidden
done_count (已完成项数量), 1:1, integer, ui=resource.progress
complete (完成状态), 1:1, c1=complete(完成)|c2=pending(待完善)|c3=incomplete(未完成), ui=resource.progress.status

rel_count (关系数量) = 5
rel_db (关联表) = db_school, db_class, db_teacher, db_resource_case, db_file
rel_map (关系字段) = db_resource{school_id}<->db_school{school_id}; db_resource{class_id}<->db_class{class_id}; db_resource{createdby}<->db_teacher{teacher_id}; db_resource{resource_id}<->db_resource_case{resource_id}; db_resource{*_file_id}<->db_file{file_id}

method (方法):
IF done_count=required_count, complete=c1
IF done_count>0 AND done_count<required_count, complete=c2
IF done_count=0, complete=c3
click = return resource_id


课程案例库 (Course Case Library / db_case)

case_id (案例ID), 1:k, integer, ui=home.case_card.hidden|case_list.card.hidden|case_detail.hidden
case_name (案例名称), 1:1, max_len=20, ui=home.case_card.title|case_list.card.title|case_detail.title|upload.case_name
case_type (案例类型), 1:1, composite(case_grade,case_field,case_area), ui=case_list.filter|case_detail.type
case_grade (案例年级), 1:1, k1=small(小班)|k2=middle(中班)|k3=large(大班), ui=case_card.grade|case_list.grade_filter|upload.case_grade
case_field (案例领域), 1:1, f1=health(健康)|f2=language(语言)|f3=social(社会)|f4=art(艺术)|f5=science(科学), ui=home.case_card.field|case_list.field_filter|upload.case_field
case_area (案例区域), 1:k, a1=group_teaching(集体教学)|a2=learning_area(区域)|a3=theme_inquiry(主题探究)|a4=home_school(家园共育)|a5=digital(数字化), ui=case_list.area_filter|case_detail.area
case_intro (活动简介), 1:1, max_len=100, ui=case_detail.intro|upload.case_intro
case_trans (活动转化), 1:1, max_len=100, ui=case_detail.trans|upload.case_trans
card_tag (卡片资源标签), 0:1, derived(db_resource.resource_tag), ui=home.case_card.tag
school_id (园所ID), 1:1, integer, ui=case.hidden
class_id (班级ID), 0:1, integer, ui=upload.class_select
cover_file_id (案例封面ID), 1:1, integer, ui=case_card.cover|upload.cover
word_file_id (Word详案ID), 0:1, integer, ui=case_detail.word|upload.word
resource_id (关联资源ID), 0:k, integer, ui=case_detail.related_resource|upload.related_resource
createdby (创建教师ID), 1:1, teacher_id, ui=case_detail.creator
created_at (创建时间), 1:1, datetime, ui=case_detail.created_at
case_status (案例状态), 1:1, s1=draft(草稿)|s2=pending(待审核)|s3=approved(已通过)|s4=rejected(已驳回), ui=case.status

rel_count (关系数量) = 6
rel_db (关联表) = db_school, db_class, db_teacher, db_resource_case, db_home_case, db_file
rel_map (关系字段) = db_case{school_id}<->db_school{school_id}; db_case{class_id}<->db_class{class_id}; db_case{createdby}<->db_teacher{teacher_id}; db_case{case_id}<->db_resource_case{case_id}; db_case{case_id}<->db_home_case{case_id}; db_case{*_file_id}<->db_file{file_id}

filter (筛选):
list = FILTER(case_status=s3, school_id=current_school_id)
grade = case_grade
field = case_field
area = case_area
click = return case_id

mock (仅供 demo|test 环境展示，不是生产种子数据):
mock_key=demo_case_1, case_name=祠堂里的故事, case_grade=k3, case_field=f3, case_area=a1|a3, card_tag=g3
mock_key=demo_case_2, case_name=龙舟竞渡, case_grade=k3, case_field=f1, case_area=a1|a2, card_tag=g4
mock_key=demo_case_3, case_name=醒狮从哪里来, case_grade=k2, case_field=f2, case_area=a1, card_tag=g5
mock_rule = mock_key 不是 case_id；若 demo|test 环境导入数据库，case_id 仍由数据库自动生成

publish_flow (发布流程):
teacher_upload -> create db_case -> case_status=s1|s2
review_approved -> case_status=s3 -> visible_in_case_library
set_home_recommendation -> create db_home_case -> visible_on_home
upload_or_approval_only -> NOT automatically visible_on_home


首页推荐案例 (Home Case Recommendation / db_home_case)

home_case_id (首页推荐案例ID), 1:k, integer, ui=home.case_card.hidden
case_id (案例ID), 1:1, integer, ui=home.case_card.hidden
home_order (首页排序), 1:k, integer, ui=home.case_card.order
visible (是否显示), 1:1, boolean, ui=home.case_card.visible
start_at (显示开始时间), 0:1, datetime, ui=home_case.hidden
end_at (显示结束时间), 0:1, datetime, ui=home_case.hidden

rel_count (关系数量) = 1
rel_db (关联表) = db_case
rel_map (关系字段) = db_home_case{case_id}<->db_case{case_id}

method (方法):
list = db_home_case JOIN db_case ON db_home_case.case_id=db_case.case_id
list = FILTER(visible=1, case_status=s3, school_id=current_school_id, (start_at IS NULL OR start_at<=NOW), (end_at IS NULL OR end_at>=NOW)) ORDER BY home_order ASC LIMIT 3
IF list_count=0, return []
click = return case_id

empty_state (空状态):
IF list_count=0, show_empty_state=1
empty_title = 暂无推荐案例
empty_description = 案例上传并审核通过后，可在这里展示
empty_action = 查看全部案例
empty_action_node = btn_case_all


[SUPPORT_OBJECTS]

资源案例关系 (Resource-Case Relation / db_resource_case)

resource_case_id (资源案例关系ID), 1:k, integer, ui=hidden
resource_id (资源ID), 1:1, integer, ui=resource.related_case
case_id (案例ID), 1:1, integer, ui=case.related_resource

rel_count (关系数量) = 2
rel_db (关联表) = db_resource, db_case
rel_map (关系字段) = db_resource_case{resource_id}<->db_resource{resource_id}; db_resource_case{case_id}<->db_case{case_id}
unique (唯一键) = resource_id + case_id


文件 (File / db_file)

file_id (文件ID), 1:k, integer, ui=file.hidden
file_type (文件类型), 1:1, f1=image(图像)|f2=docx|f3=xlsx|f4=pdf|f5=video(视频)|f6=other(其他), ui=file.type
file_name (文件名称), 1:1, text, ui=file.name
file_url (文件地址), 1:1, url, ui=file.preview|file.download
file_size (文件大小), 1:1, integer, ui=file.size
file_hash (文件哈希), 1:1, text, ui=file.hidden
uploadedby (上传教师ID), 1:1, teacher_id, ui=file.uploader
uploaded_at (上传时间), 1:1, datetime, ui=file.uploaded_at

rel_count (关系数量) = 1
rel_db (关联表) = db_teacher
rel_map (关系字段) = db_file{uploadedby}<->db_teacher{teacher_id}


[NAV_OBJECTS]

首页 (Home / nav_home)
node_key (节点键) = nav_home
button_name_cn (按键中文名) = 首页
button_name_en (按键英文名) = Home
object_ref (对象引用) = db_home
route (跳转地址) = home.html
rel_count (关系数量) = 0

党建管理 (Party Affairs / nav_party)
node_key (节点键) = nav_party
button_name_cn (按键中文名) = 党建管理
button_name_en (按键英文名) = Party Affairs
object_ref (对象引用) = db_party_home
route (跳转地址) = school-affairs.html
rel_count (关系数量) = 0

综合协调 (Comprehensive Coordination / nav_coord)
node_key (节点键) = nav_coord
button_name_cn (按键中文名) = 综合协调
button_name_en (按键英文名) = Comprehensive Coordination
object_ref (对象引用) = db_coord_home
route (跳转地址) = comprehensive-coordination.html
rel_count (关系数量) = 0

教研培训 (Training Center / nav_training)
node_key (节点键) = nav_training
button_name_cn (按键中文名) = 教研培训
button_name_en (按键英文名) = Training Center
object_ref (对象引用) = db_training_home
route (跳转地址) = training-center.html
rel_count (关系数量) = 0

家园共育 (Home-School Coeducation / nav_home_school)
node_key (节点键) = nav_home_school
button_name_cn (按键中文名) = 家园共育
button_name_en (按键英文名) = Home-School Coeducation
object_ref (对象引用) = db_home_school
route (跳转地址) = home-school.html
rel_count (关系数量) = 0


[NON_CLICK_NODE]

轮播图 (Banner / banner)
node_name_cn (节点中文名) = 轮播图
node_name_en (节点英文名) = Banner
clickable (是否可点击) = 0
slide_count (轮播数量) = 3
auto_interval_ms (自动切换间隔) = 3500
swipe_threshold_px (滑动阈值) = 40

轮播圆点 (Banner Dot / banner_dot)
node_name_cn (节点中文名) = 轮播圆点
node_name_en (节点英文名) = Banner Dot
clickable (是否可点击) = 0
count (数量) = 3


[JUMP_VALIDATION]

IF object IN(db_case,db_resource,db_task,db_training), REQUIRE object_id
IF object_id NOT_FOUND, return 404
IF object_status IN(rejected,deleted), return 403
IF node_key=btn_case_all, object_id=NULL, return list
IF node_key=home_case_card, REQUIRE case_id FROM query_result, return detail
