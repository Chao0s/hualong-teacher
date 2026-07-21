TRAINING_CENTER_BACKEND_OBJECT_SPEC

scope (范围) = screens/training-center.html
source_page (参考页面) = training-center.html
static_node_count (固定可点击节点数) = 10
dynamic_case_banner_count (动态案例轮播数) = 0:3
dynamic_resource_card_count (动态资源卡片数) = 0:3
dynamic_case_card_count (动态案例卡片数) = 0:3
runtime_clickable_node_count (运行时可点击节点数) = 10:19
field_format (字段格式) = field_key (中文字段名), cardinality, type|enum, ui
id_rule (ID规则) = integer, database_auto_generated
null_rule (空值规则) = 0:1
list_rule (列表规则) = 0:k | 1:k


[SHARED_OBJECT_RULE]

shared_object_source (共享对象来源) = home-spec.md
shared_objects (共享对象) = db_teacher, db_school, db_class, db_teacher_class, db_training, db_resource, db_case, db_file
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

prototype_content (原型内容) = HTML 中的祠堂、龙舟、醒狮案例及三条推荐资源均为 demo|test Mock
static_ui_content (保留的静态界面内容) = 页面标题、快捷入口、推荐资源与推荐案例的栏目标题
production_seed (生产环境业务种子数据) = NONE
production_initial_db_training (培训初始状态) = EMPTY
production_initial_db_resource (资源初始状态) = EMPTY
production_initial_db_case (案例初始状态) = EMPTY
production_initial_db_training_recommendation (教研推荐初始状态) = EMPTY
production_banner_response (无推荐轮播时返回) = []
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
| 推荐案例轮播 | Recommended Case Banner | training_case_banner | db_training_recommendation + db_case | case_id (runtime) | 0:3 | training-center.html > case-detail.html?case_id={case_id} |
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
resource_id (资源ID), 0:k, integer, ui=training_home.resource.list
case_id (案例ID), 0:k, integer, ui=training_home.case.banner|training_home.case.list

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
placement (展示位置), 1:1, p1=case_banner(案例轮播)|p2=resource_list(推荐资源)|p3=case_list(推荐案例), ui=training_home.recommendation.placement
resource_id (资源ID), 0:1, integer, ui=training_home.recommendation.hidden
case_id (案例ID), 0:1, integer, ui=training_home.recommendation.hidden
display_order (显示顺序), 1:1, integer, ui=training_home.recommendation.order
is_visible (是否显示), 1:1, boolean, ui=training_home.recommendation.visible
start_at (显示开始时间), 0:1, datetime, ui=training_home.recommendation.hidden
end_at (显示结束时间), 0:1, datetime, ui=training_home.recommendation.hidden
created_by (创建教师ID), 1:1, integer, ui=training_home.recommendation.hidden
created_at (创建时间), 1:1, datetime, ui=training_home.recommendation.hidden

rel_count (关系数量) = 4
rel_db (关联表) = db_school, db_teacher, db_resource, db_case
rel_map (关系字段) = db_training_recommendation{school_id}<->db_school{school_id}; db_training_recommendation{created_by}<->db_teacher{teacher_id}; IF content_type=c1, db_training_recommendation{resource_id}<->db_resource{resource_id}; IF content_type=c2, db_training_recommendation{case_id}<->db_case{case_id}
check (校验) = content_type=c1 时 resource_id 必填且 case_id=NULL；content_type=c2 时 case_id 必填且 resource_id=NULL
placement_check (位置校验) = placement=p1|p3 REQUIRE content_type=c2; placement=p2 REQUIRE content_type=c1
unique (唯一键) = school_id + placement + resource_id|case_id

method (方法):
active = FILTER(school_id=current_school_id, is_visible=1, (start_at IS NULL OR start_at<=NOW), (end_at IS NULL OR end_at>=NOW))
case_banner = active JOIN db_case FILTER(placement=p1, case_status=s3) ORDER BY display_order ASC LIMIT 3
resource_list = active JOIN db_resource FILTER(placement=p2, resource_status=s3) ORDER BY display_order ASC LIMIT 3
case_list = active JOIN db_case FILTER(placement=p3, case_status=s3) ORDER BY display_order ASC LIMIT 3
IF result_count=0, return []


[REUSED_OBJECT_USAGE]

db_training (教研培训) = REUSE home-spec.md; 不得创建其他同义 object
db_resource (课程资源) = REUSE home-spec.md; 仅 resource_status=s3 可进入推荐
db_case (课程案例) = REUSE home-spec.md; 仅 case_status=s3 可进入推荐
db_file (文件) = REUSE home-spec.md; 封面和附件继续通过 file_id 关联


[EMPTY_STATE]

IF case_banner_count=0, show_case_banner=0
IF resource_count=0, show_resource_empty=1, resource_empty_title=暂无推荐资源
IF case_count=0, show_case_empty=1, case_empty_title=暂无推荐案例
empty_description = 内容上传、审核通过并设置为推荐后，将显示在这里


[NON_DB_NAV_OBJECT]

课程建设入口 (Course Building Navigation / nav_course_building)
node_key (节点键) = btn_course_building
route (跳转地址) = course-building.html
persist (是否持久化) = 0
rel_count (关系数量) = 0


[JUMP_VALIDATION]

IF node_key=training_case_banner|training_case_card, REQUIRE case_id FROM query_result
IF node_key=training_resource_card, REQUIRE resource_id FROM query_result
IF case_id|resource_id NOT_FOUND, return 404
IF case_status|resource_status IN(s1,s2,s4,rejected,deleted), return 403
IF node_key=btn_training_resource_all, return resource-library.html
IF node_key=btn_training_case_all, return case-library.html
