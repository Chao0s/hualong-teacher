TRAINING_CENTER_BACKEND_OBJECT_SPEC

scope (范围) = screens/training-center.html
source_page (参考页面) = training-center.html
static_node_count (固定可点击节点数) = 10
dynamic_featured_recommendation_count (动态顶部推荐数) = 0:3
dynamic_resource_card_count (动态资源卡片数) = 0:3
dynamic_case_card_count (动态案例卡片数) = 0:3
runtime_clickable_node_count (运行时可点击节点数) = 10:19
field_format (字段格式) = field_key (中文字段名), cardinality, type|enum, ui
id_rule (ID规则) = integer, database_auto_generated
null_rule (空值规则) = 0:1
list_rule (列表规则) = 0:k | 1:k


[SHARED_OBJECT_RULE]

shared_object_source (共享对象来源) = home-spec.md
shared_objects (共享对象) = db_teacher, db_school, db_class, db_teacher_class, db_admin, db_training, db_training_participation, db_training_feedback, db_training_recommendation, db_resource, db_case, db_file, db_file_ref, db_content_access_event, db_notification
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
audience_rule (受众规则) = 全部 teacher_status=s1 的化龙正式教师；partner_account 一律拒绝本模块 route


[DATA_INITIALIZATION_RULE]

prototype_content (原型内容) = HTML 中的祠堂、龙舟、醒狮案例及三条推荐资源均为 demo|test Mock
static_ui_content (保留的静态界面内容) = 页面标题、快捷入口、推荐资源与推荐案例的栏目标题；课程建设正文与附件为 repo 内版本化产品内容
production_seed (生产环境业务种子数据) = NONE
production_initial_db_training (培训初始状态) = EMPTY
production_initial_db_training_participation (研修参与初始状态) = EMPTY
production_initial_db_resource (资源初始状态) = EMPTY
production_initial_db_case (案例初始状态) = EMPTY
production_initial_db_training_recommendation (教研推荐初始状态) = EMPTY
production_featured_response (无顶部推荐时返回) = []
production_resource_response (无推荐资源时返回) = []
production_case_response (无推荐案例时返回) = []
base_identity_data (基础身份数据) = db_school|db_teacher|db_class|db_teacher_class 由部署或园所管理员初始化，不属于 Mock 业务内容
hardcoded_content_id (固定资源或案例ID) = FORBIDDEN
environment_isolation (环境隔离) = demo|test 数据不得复制到 production


[STATIC_BUTTON_NODE_INDEX]

| n | button_name_cn | button_name_en | node_key | object | input | jump |
|---:|---|---|---|---|---|---|
| 1 | 课程建设 | Course Building | btn_course_building | nav_course_building | school_id | training-center.html > course-building.html |
| 2 | 课程资源 | Course Resources | btn_training_resource_center | db_resource + db_case | school_id, class_id | training-center.html > resource-center.html |
| 3 | 教研培训 | Teaching Research and Training | btn_training_list | db_training | school_id, teacher_id | training-center.html > training-list.html |
| 4 | 推荐资源全部 | All Recommended Resources | btn_training_resource_all | db_resource | school_id | training-center.html > resource-library.html |
| 5 | 推荐案例全部 | All Recommended Cases | btn_training_case_all | db_case | school_id | training-center.html > case-library.html |
| 6 | 首页 | Home | nav_home | nav_home | NULL | home.html |
| 7 | 党建管理 | Party Affairs | nav_party | nav_party | NULL | school-affairs.html |
| 8 | 综合协调 | Comprehensive Coordination | nav_coord | nav_coord | NULL | comprehensive-coordination.html |
| 9 | 教研培训 | Training Center | nav_training | nav_training | NULL | training-center.html |
| 10 | 家园共育 | Home-School Coeducation | nav_home_school | nav_home_school | NULL | home-school.html |


[DYNAMIC_CONTENT_NODE]

| node_name_cn | node_name_en | node_key | object | input | cardinality | jump |
|---|---|---|---|---|---|---|
| 顶部推荐内容 | Featured Recommendation | training_featured_recommendation | db_training_recommendation + db_resource|db_case | content_type + resource_id|case_id (runtime) | 0:3 | training-center.html > matching resource/case detail |
| 推荐资源卡片 | Recommended Resource Card | training_resource_card | db_training_recommendation + db_resource | resource_id (runtime) | 0:3 | training-center.html > resource-detail.html?resource_id={resource_id} |
| 推荐案例卡片 | Recommended Case Card | training_case_card | db_training_recommendation + db_case | case_id (runtime) | 0:3 | training-center.html > case-detail.html?case_id={case_id} |

dynamic_rule (动态规则) = 标题、封面、摘要、标签和 object_id 必须来自接口返回，不得写死在前端或后端逻辑中


[PAGE_OBJECT]

教研培训首页 (Training Center Home / db_training_home)

training_home_id (教研培训首页ID), 1:1, integer, ui=training_home.page
teacher_id (当前教师ID), 1:1, integer, ui=context.hidden
school_id (当前园所ID), 1:1, integer, ui=context.hidden
class_id (当前班级ID), 1:1, integer, ui=context.hidden
training_recommendation_id (教研推荐ID), 0:k, integer, ui=training_home.banner|training_home.recommendation
training_id (培训ID), 0:k, integer, ui=training_home.quick.training
resource_id (资源ID), 0:k, integer, ui=training_home.featured|training_home.resource.list
case_id (案例ID), 0:k, integer, ui=training_home.featured|training_home.case.list

rel_count (关系数量) = 7
rel_db (关联表) = db_teacher, db_school, db_class, db_training_recommendation, db_training, db_resource, db_case
rel_map (关系字段) = db_training_home{teacher_id}<->db_teacher{teacher_id}; db_training_home{school_id}<->db_school{school_id}; db_training_home{class_id}<->db_class{class_id}; db_training_home{training_recommendation_id}<->db_training_recommendation{training_recommendation_id}; db_training_home{training_id}<->db_training{training_id}; db_training_home{resource_id}<->db_resource{resource_id}; db_training_home{case_id}<->db_case{case_id}
persist (是否持久化) = 0
object_type (对象类型) = aggregate


[RECOMMENDATION_OBJECT]

教研首页推荐 (Training Recommendation / db_training_recommendation)

training_recommendation_id (教研推荐ID), 1:1, integer, ui=training_home.recommendation.hidden
school_id (园所ID), 1:1, integer, ui=training_home.hidden
content_type (内容类型), 1:1, c1=resource(资源)|c2=case(案例), ui=training_home.recommendation.type
placement (展示位置), 1:1, p2=resource_list(推荐资源)|p3=case_list(推荐案例), ui=training_home.recommendation.placement
resource_id (资源ID), 0:1, integer, ui=training_home.recommendation.hidden
case_id (案例ID), 0:1, integer, ui=training_home.recommendation.hidden
is_visible (是否显示), 1:1, boolean, ui=training_home.recommendation.visible
created_by_admin_id (创建管理员ID), 1:1, integer, server-derived
created_at (创建时间), 1:1, datetime, ui=training_home.recommendation.hidden
updated_at (最近推荐时间), 1:1, datetime, server-managed

rel_count (关系数量) = 4
rel_db (关联表) = db_school, db_admin, db_resource, db_case
rel_map (关系字段) = db_training_recommendation{school_id}<->db_school{school_id}; db_training_recommendation{created_by_admin_id}<->db_admin{admin_id}; IF content_type=c1, db_training_recommendation{resource_id}<->db_resource{resource_id}; IF content_type=c2, db_training_recommendation{case_id}<->db_case{case_id}
check (校验) = content_type=c1 时 resource_id 必填且 case_id=NULL；content_type=c2 时 case_id 必填且 resource_id=NULL
placement_check (位置校验) = placement=p3 REQUIRE content_type=c2; placement=p2 REQUIRE content_type=c1；p1 待迁移删除
unique (唯一键) = school_id + placement + resource_id|case_id
producer_rule = only authorized admin may create or toggle；resource writes p2 only；case recommendation/cancellation atomically mirrors db_home_case and p3
lifecycle_rule = is_visible 是唯一当前二态；取消转 0，重推复用同一列转 1 并刷新 updated_at；无人工排序或排期

method (方法):
active = FILTER(school_id=current_school_id, is_visible=1)
featured = UNION(active p2 JOIN approved db_resource, active p3 JOIN approved db_case) ORDER BY updated_at DESC, training_recommendation_id DESC LIMIT 3；可混合型别且可与下方列表重复
resource_list = active JOIN db_resource FILTER(placement=p2, resource_status=s3) ORDER BY updated_at DESC, training_recommendation_id DESC LIMIT 3
case_list = active JOIN db_case FILTER(placement=p3, case_status=s3) ORDER BY updated_at DESC, training_recommendation_id DESC LIMIT 3
IF result_count=0, return []


[REUSED_OBJECT_USAGE]

db_training (教研培训) = REUSE home-spec.md; 不得创建其他同义 object；仅具 content.training.write 的管理员可建，正文迁移为 training_content max 2000，前 100 字派生摘要，材料可全空，不记录学时
db_resource (课程资源) = REUSE home-spec.md; 仅 resource_status=s3 可进入推荐
db_case (课程案例) = REUSE home-spec.md; 仅 case_status=s3 可进入推荐
db_file|db_file_ref (文件) = REUSE home-spec.md; 研修材料通过 db_file_ref 关联，无强制 main_file
db_training_feedback (研修反馈) = REUSE Admin review-spec.md; 只有本人 completed participation 且活动已结束可首次提交，每人每场最多一份 1000 字纯文字且不影响完成；不存 s1 草稿，提交直接建 s2；正文自提交起永久冻结。作者可从 s2／s3 撤回为 s5；s4 rejected／s5 withdrawn 均为终局。驳回理由必填并向作者显示；仅活动仍发布且 feedback_status=s3 时向全部 active 正式教师真名公开；回馈就是评论，不建第二实体
db_content_access_event (内容存取事件) = REUSE DATABASE_SPEC F9; 研修详情成功打开写 c7 training/e3 viewed，材料成功供给写 c7/e4 downloaded + training_id + file_id；重复成功重复写
db_training.meeting_link_title|meeting_url = 每场 0:1 组；标题最多 100 字、URL 必须 HTTPS，二者同空同非空；发布时 location 或完整会议入口至少一项，两者都有表示混合活动；教师点击后复制并提示到浏览器或会议 App 打开，不在小程序内嵌
db_notification = 活动撤回、改期、开始前关键参加资讯变化时向当时 registered 教师建 n5；管理员补报名／取消时向受影响教师建 n5；owner_object=db_training、owner_id=training_id；unchanged 不通知，正文／材料单独变化不通知


[PARTICIPATION_OBJECT]

逐教师研修参与 (Training Participation / db_training_participation)

training_participation_id (研修参与ID), 1:1, integer, ui=my_training.row.hidden
training_id (研修ID), 1:1, integer, ui=my_training.row.training
teacher_id (教师ID), 1:1, integer, ui=context.hidden
participation_status (参与状态), 1:1, s1=registered(已报名)|s2=cancelled(已取消)|s3=completed(已完成), ui=my_training.row.status
registered_at (最近报名时间), 1:1, datetime, ui=my_training.row.registered_at
cancelled_at (最近取消时间), 0:1, datetime, ui=my_training.row.cancelled_at
completed_at (自动完成时间), 0:1, datetime, ui=my_training.row.completed_at

rel_count (关系数量) = 2
rel_db (关联表) = db_training, db_teacher
rel_map (关系字段) = db_training_participation{training_id}<->db_training{training_id}; db_training_participation{teacher_id}<->db_teacher{teacher_id}
unique (唯一键) = training_id + teacher_id
signup_rule = NOW < activity_start 时教师可报名或取消；当前已是 s1 时重复报名幂等返回 unchanged；NOW >= activity_start 后教师不得自行报名或取消
admin_adjustment_rule = activity_start<=NOW<effective_end_at 时，具权限管理员可为从未参与者新增 s1、把既有 s2 恢复为 s1，或把 s1 转 s2；写 B2 通用操作日志；NOW>=effective_end_at 后任何参与状态都冻结
admin_adjustment_notice = 每次成功新增／恢复 s1 或转 s2 均向该教师建立 n5 通知；幂等 unchanged 不写日志、不建通知
completion_rule = effective_end_at=COALESCE(end_at,园所时区 start_at 当日结束)；到达时系统只把仍为 s1 的列自动转 s3 并写 completed_at，s2 不完成
capacity_rule = NONE；不设人数上限、候补或等待名单
reminder_rule = 仅调用装置本地日历／提醒能力，不保存 DB；目标平台不支持则不渲染按钮，任何情况下不得用 toast 伪装成功
reregister_rule = NOW<activity_start 且当前 s2 时可恢复同一列为 s1，registered_at 更新为本次成功报名时间并清 cancelled_at；完整动作序列只写 B2 通用操作日志
my_training_rule = 仅返回 teacher_id=current_teacher_id 的参与子集；准备参与／正在参与／已完成由本列与活动时间共同派生
withdrawal_rule = NOW<effective_end_at 撤回时，db_training 转 s5、仍为 s1 的参与列转 s2 并写 cancelled_at、以及建立 n5 通知须在同一交易；NOW>=effective_end_at 撤回保留 s3 completed 列，「我的研修」只显示活动已撤回的原题名／时间，不提供材料、会议入口或公开回馈
reschedule_rule = training_status=s1 AND NOW<当前 start_at 时，管理员可改 start_at/end_at；新 start_at 必须 >NOW，end_at 非空时必须 >=新 start_at。保留全部 participation 列，每次成功改期向当时 s1 registered 教师各建一笔 n5 通知，正文含新时间与“请删除旧本地日历并重新添加”；NOW>=当前 start_at 后时间冻结，只能撤回
published_edit_rule = NOW<当前 start_at 时可改标题、正文、地点、会议入口、主讲人及材料；开始后全部冻结。标题／地点／会议入口／主讲人变化通知 registered 教师，正文／材料变化不通知
withdrawn_terminal = s5 不得恢复或编辑；重新举办须建立新活动，旧 participation／notification／event 历史不搬移


[TRAINING_LIST_RULE]

all_training = 本园全部可见研修；最新研修与历史研修各先返回有限笔数，并分别提供“更多”入口
more = ORDER BY start_at DESC, training_id DESC USING stable cursor; search=NONE; filter=NONE
current_history_boundary = effective_end_at=COALESCE(end_at,园所时区 start_at 当日结束)；NOW<=effective_end_at 属最新，之后属历史
training_type_status_migration = 删除 training_type；活动状态仅 s0 draft|s1 published|s5 withdrawn；阶段全部派生
duplicate_recommendation_pages = training-center.html 与 resource-center.html 均保留推荐区（Q58-j=C）


[PUBLIC_FEEDBACK_RULE]

count = COUNT(db_training_feedback WHERE training_id=current_training_id AND feedback_status=s3 AND db_training.training_status=s1)
list = FILTER(feedback_status=s3, db_training.training_status=s1) ORDER BY published_at DESC, feedback_id DESC USING stable cursor
label = 只显示“反馈 N”；独立“评论”文案、计数与实体均 FORBIDDEN
withdrawn_training = return count=0, list=[]；历史列保留但不公开
feedback_submit_lock = 首次提交成功后立即禁用正文控件与提交按钮；pending／published／rejected／withdrawn 均不可编辑或再次提交
feedback_draft = NONE；未提交文字只留当前页面，离开即丢失；提交直接 INSERT s2 pending
feedback_withdraw = 本人 s2／s3 显示“撤回反馈”；成功后转 s5。s2 退出审核队列，s3 立即从公开流消失；s4／s5 不显示撤回
feedback_rejection = s4 向作者显示管理员必填的 decision_reason；不显示编辑或再次提交


[EMPTY_STATE]

IF featured_count=0, show_featured=0
IF resource_count=0, show_resource_empty=1, resource_empty_title=暂无推荐资源
IF case_count=0, show_case_empty=1, case_empty_title=暂无推荐案例
empty_description = 内容上传、审核通过并设置为推荐后，将显示在这里


[NON_DB_NAV_OBJECT]

课程建设入口 (Course Building Navigation / nav_course_building)
node_key (节点键) = btn_course_building
route (跳转地址) = course-building.html
persist (是否持久化) = 0
rel_count (关系数量) = 0
content_source (内容来源) = repo 内不可变版本正文与附件；不建业务表、不从生产 seed 读取、不提供管理端编辑


[JUMP_VALIDATION]

IF node_key=training_featured_recommendation, REQUIRE content_type AND matching resource_id|case_id FROM query_result
IF node_key=training_case_card, REQUIRE case_id FROM query_result
IF node_key=training_resource_card, REQUIRE resource_id FROM query_result
IF case_id|resource_id NOT_FOUND, return 404
IF case_status|resource_status IN(s1,s2,s4,rejected,deleted), return 403
IF node_key=btn_training_resource_all, return resource-library.html
IF node_key=btn_training_case_all, return case-library.html
