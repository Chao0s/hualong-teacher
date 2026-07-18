COMPREHENSIVE_COORDINATION_BACKEND_OBJECT_SPEC

scope (范围) = screens/comprehensive-coordination.html
source_page (参考页面) = comprehensive-coordination.html
static_node_count (固定可点击节点数) = 12
dynamic_content_node_count (动态内容节点数) = 0
runtime_clickable_node_count (运行时可点击节点数) = 12
field_format (字段格式) = field_key (中文字段名), cardinality, type|enum, ui
id_rule (ID规则) = integer, database_auto_generated
null_rule (空值规则) = 0:1
list_rule (列表规则) = 0:k | 1:k


[SHARED_OBJECT_RULE]

shared_object_source (共享对象来源) = home-spec.md
shared_objects (共享对象) = db_teacher, db_school, db_file
shared_nav_objects (共享导航对象) = nav_home, nav_party, nav_coord, nav_training, nav_home_school
rename_shared_object (重命名共享对象) = FORBIDDEN


[CONTEXT_RULE]

teacher_id_source (教师ID来源) = auth_session.teacher_id
school_id_source (园所ID来源) = db_teacher.school_id
teacher_id_client_editable (教师ID前端可编辑) = 0
school_id_client_editable (园所ID前端可编辑) = 0
ui_context_rule (上下文字段界面规则) = context.hidden 表示不显示原始ID，由后台根据登录上下文取得并校验


[DATA_INITIALIZATION_RULE]

prototype_content (原型内容) = HTML 中呈现的文件数量、文件标题、日期、部门和推荐内容均视为 demo|test Mock
static_ui_content (保留的静态界面内容) = 页面标题、说明文案和七个分类入口
production_seed (生产环境业务种子数据) = NONE
production_initial_db_coord_document (综合协调文档初始状态) = EMPTY
production_list_response (生产环境无文档时返回) = []
base_identity_data (基础身份数据) = db_school|db_teacher 由部署或园所管理员初始化，不属于 Mock 业务内容
document_id_generation (文档ID生成规则) = database_auto_generated
hardcoded_document_id (固定文档ID) = FORBIDDEN
environment_isolation (环境隔离) = demo|test 数据不得复制到 production


[STATIC_BUTTON_NODE_INDEX]

| n | button_name_cn | button_name_en | node_key | object | input | jump |
|---:|---|---|---|---|---|---|
| 1 | 政策法规 | Policies and Regulations | btn_coord_policy | db_coord_document | coord_category=c1 | comprehensive-coordination.html > coordination-file-list.html?type=policy |
| 2 | 通知文件 | Notices | btn_coord_notice | db_coord_document | coord_category=c2 | comprehensive-coordination.html > coordination-file-list.html?type=notice |
| 3 | 组织架构 | Organization Structure | btn_coord_org | db_coord_document | coord_category=c3 | comprehensive-coordination.html > coordination-file-list.html?type=org |
| 4 | 安全管理 | Safety Management | btn_coord_safety | db_coord_document | coord_category=c4 | comprehensive-coordination.html > coordination-file-list.html?type=safety |
| 5 | 卫生保健 | Health Care | btn_coord_health | db_coord_document | coord_category=c5 | comprehensive-coordination.html > coordination-file-list.html?type=health |
| 6 | 师德师风 | Teacher Ethics | btn_coord_ethics | db_coord_document | coord_category=c6 | comprehensive-coordination.html > coordination-file-list.html?type=ethics |
| 7 | 跟岗交流 | Job-shadowing Exchange | btn_coord_exchange | db_coord_document | coord_category=c7 | comprehensive-coordination.html > coordination-file-list.html?type=exchange |
| 8 | 首页 | Home | nav_home | nav_home | NULL | home.html |
| 9 | 党建管理 | Party Affairs | nav_party | nav_party | NULL | school-affairs.html |
| 10 | 综合协调 | Comprehensive Coordination | nav_coord | nav_coord | NULL | comprehensive-coordination.html |
| 11 | 教研培训 | Training Center | nav_training | nav_training | NULL | training-center.html |
| 12 | 家园共育 | Home-School Coeducation | nav_home_school | nav_home_school | NULL | home-school.html |


[CATEGORY_MAP]

| category_code | query_value | category_name_cn | section |
|---|---|---|---|
| c1 | policy | 政策法规 | 行政统筹 |
| c2 | notice | 通知文件 | 行政统筹 |
| c3 | org | 组织架构 | 行政统筹 |
| c4 | safety | 安全管理 | 通勤保障 |
| c5 | health | 卫生保健 | 通勤保障 |
| c6 | ethics | 师德师风 | 人事管理 |
| c7 | exchange | 跟岗交流 | 人事管理 |

category_rule (分类规则) = query_value 仅用于 URL；数据库必须存储 coord_category 枚举值 c1:c7


[PAGE_OBJECT]

综合协调首页 (Comprehensive Coordination Home / db_coord_home)

coord_home_id (综合协调首页ID), 1:1, integer, ui=coord.page
teacher_id (当前教师ID), 1:1, integer, ui=context.hidden
school_id (当前园所ID), 1:1, integer, ui=context.hidden
document_id (综合协调文档ID), 0:k, integer, ui=coord.category.count

rel_count (关系数量) = 3
rel_db (关联表) = db_teacher, db_school, db_coord_document
rel_map (关系字段) = db_coord_home{teacher_id}<->db_teacher{teacher_id}; db_coord_home{school_id}<->db_school{school_id}; db_coord_home{document_id}<->db_coord_document{document_id}
persist (是否持久化) = 0
object_type (对象类型) = aggregate


[CONTENT_OBJECT]

综合协调文档 (Coordination Document / db_coord_document)

document_id (文档ID), 1:1, integer, ui=coord_file.card.hidden|coord_file_detail.hidden
school_id (园所ID), 1:1, integer, ui=coord_file.hidden
coord_category (文档分类), 1:1, c1=policy(政策法规)|c2=notice(通知文件)|c3=org(组织架构)|c4=safety(安全管理)|c5=health(卫生保健)|c6=ethics(师德师风)|c7=exchange(跟岗交流), ui=coord_file.filter|coord_file.card.category
document_title (文档标题), 1:1, max_len=150, ui=coord_file.card.title|coord_file_detail.title
document_summary (文档摘要), 0:1, max_len=300, ui=coord_file.card.summary|coord_file_detail.summary
publisher_department (发布部门), 0:1, max_len=50, ui=coord_file.card.department|coord_file_detail.department
published_at (发布日期), 1:1, datetime, ui=coord_file.card.date|coord_file_detail.date
effective_at (生效日期), 0:1, date, ui=coord_file_detail.effective_date
file_id (文件ID), 1:k, integer, ui=coord_file.preview|coord_file.download
allow_preview (允许预览), 1:1, boolean, ui=coord_file.preview
allow_download (允许下载), 1:1, boolean, ui=coord_file.download
document_status (文档状态), 1:1, s1=draft(草稿)|s2=pending(待审核)|s3=approved(已通过)|s4=rejected(已驳回), ui=coord_file.hidden
createdby (创建教师ID), 1:1, integer, ui=coord_file.hidden
created_at (创建时间), 1:1, datetime, ui=coord_file.hidden

rel_count (关系数量) = 3
rel_db (关联表) = db_school, db_teacher, db_file
rel_map (关系字段) = db_coord_document{school_id}<->db_school{school_id}; db_coord_document{createdby}<->db_teacher{teacher_id}; db_coord_document{file_id}<->db_file{file_id}

method (方法):
list = FILTER(school_id=current_school_id, coord_category, document_status=s3) ORDER BY published_at DESC
IF list_count=0, return []
preview = REQUIRE allow_preview=1 AND file_id EXISTS
download = REQUIRE allow_download=1 AND file_id EXISTS
click = return document_id


[EMPTY_STATE]

IF category_document_count=0, show_empty_state=1
empty_title = 暂无相关文件
empty_description = 文件发布并审核通过后，将显示在这里
empty_action = NONE


[NON_CLICK_NODE]

综合协调说明横幅 (Coordination Intro Banner / coord_intro_banner)
node_name_cn (节点中文名) = 园务协同支持
node_name_en (节点英文名) = Coordination Support Introduction
clickable (是否可点击) = 0
data_source (数据来源) = static_ui_content


[JUMP_VALIDATION]

IF node_key IN(btn_coord_policy,btn_coord_notice,btn_coord_org,btn_coord_safety,btn_coord_health,btn_coord_ethics,btn_coord_exchange), REQUIRE coord_category IN(c1,c2,c3,c4,c5,c6,c7)
IF query_value NOT_IN(policy,notice,org,safety,health,ethics,exchange), return 400
IF document_id NOT_FOUND, return 404
IF document_status IN(s1,s2,s4,rejected,deleted), return 403
