PARTY_AFFAIRS_BACKEND_OBJECT_SPEC

scope (范围) = screens/school-affairs.html
source_page (参考页面) = school-affairs.html
static_node_count (固定可点击节点数) = 8
dynamic_content_card_count (动态内容卡片数) = 0:9
dynamic_banner_count (动态轮播数) = 0:3
runtime_clickable_node_count (运行时可点击节点数) = 8:17
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

prototype_content (原型内容) = 当前 HTML 中的文件、活动、品牌和轮播文案均为 demo|test 展示内容
production_seed (生产环境内容种子数据) = NONE
production_initial_db_party_study (党建学习初始状态) = EMPTY
production_initial_db_party_activity (党建活动初始状态) = EMPTY
production_initial_db_party_brand (品牌建设初始状态) = EMPTY
production_initial_db_party_feature (轮播推荐初始状态) = EMPTY
base_identity_data (基础身份数据) = db_school|db_teacher 由部署或园所管理员初始化，不属于 Mock 业务内容
mock_metric_rule (模拟统计规则) = HTML 中的标题、日期、部门、地点、标签和文件状态不得写入 production
content_id_generation (内容ID生成规则) = database_auto_generated
hardcoded_content_id (固定内容ID) = FORBIDDEN
environment_isolation (环境隔离) = demo|test 数据不得复制到 production


[STATIC_BUTTON_NODE_INDEX]

| n | button_name_cn | button_name_en | node_key | object | input | jump |
|---:|---|---|---|---|---|---|
| 1 | 党建学习全部 | All Party Studies | btn_party_study_all | db_party_study | school_id | school-affairs.html > party-study-list.html |
| 2 | 党建活动全部 | All Party Activities | btn_party_activity_all | db_party_activity | school_id | school-affairs.html > party-activity-list.html |
| 3 | 品牌建设全部 | All Party Brands | btn_party_brand_all | db_party_brand | school_id | school-affairs.html > party-brand-list.html |
| 4 | 首页 | Home | nav_home | nav_home | NULL | home.html |
| 5 | 党建管理 | Party Affairs | nav_party | nav_party | NULL | school-affairs.html |
| 6 | 综合协调 | Comprehensive Coordination | nav_coord | nav_coord | NULL | comprehensive-coordination.html |
| 7 | 教研培训 | Training Center | nav_training | nav_training | NULL | training-center.html |
| 8 | 家园共育 | Home-School Coeducation | nav_home_school | nav_home_school | NULL | home-school.html |


[DYNAMIC_CONTENT_NODE]

| node_name_cn | node_name_en | node_key | object | input | cardinality | jump |
|---|---|---|---|---|---|---|
| 党建学习卡片 | Party Study Card | party_study_card | db_party_study | study_id (runtime) | 0:3 | school-affairs.html > party-study-detail.html?study_id={study_id} |
| 党建活动卡片 | Party Activity Card | party_activity_card | db_party_activity | activity_id (runtime) | 0:3 | school-affairs.html > party-activity-detail.html?activity_id={activity_id} |
| 品牌建设卡片 | Party Brand Card | party_brand_card | db_party_brand | brand_id (runtime) | 0:3 | school-affairs.html > party-brand-detail.html?brand_id={brand_id} |

dynamic_rule (动态规则) = 标题、日期、部门、地点、标签和 object_id 必须来自接口返回，不得写死在前端或后端逻辑中


[PAGE_OBJECT]

党建管理首页 (Party Affairs Home / db_party_home)

party_home_id (党建首页ID), 1:1, integer, ui=party.page
teacher_id (当前教师ID), 1:1, integer, ui=context.hidden
school_id (当前园所ID), 1:1, integer, ui=context.hidden
party_feature_id (轮播推荐ID), 0:k, integer, ui=party.banner
study_id (党建学习ID), 0:k, integer, ui=party.study.list
activity_id (党建活动ID), 0:k, integer, ui=party.activity.list
brand_id (品牌建设ID), 0:k, integer, ui=party.brand.list

rel_count (关系数量) = 6
rel_db (关联表) = db_teacher, db_school, db_party_feature, db_party_study, db_party_activity, db_party_brand
rel_map (关系字段) = db_party_home{teacher_id}<->db_teacher{teacher_id}; db_party_home{school_id}<->db_school{school_id}; db_party_home{party_feature_id}<->db_party_feature{party_feature_id}; db_party_home{study_id}<->db_party_study{study_id}; db_party_home{activity_id}<->db_party_activity{activity_id}; db_party_home{brand_id}<->db_party_brand{brand_id}
persist (是否持久化) = 0
object_type (对象类型) = aggregate


[CONTENT_OBJECTS]

党建学习 (Party Study / db_party_study)

study_id (党建学习ID), 1:1, integer, ui=party.study.hidden|party_study_detail.hidden
school_id (园所ID), 1:1, integer, ui=party.hidden
study_title (学习标题), 1:1, max_len=100, ui=party.study.title|party_study_detail.title
study_type (学习类型), 1:1, t1=policy(政策文件)|t2=learning(学习材料)|t3=system(制度文件), ui=party.study.type|party_study_list.filter
study_summary (内容摘要), 0:1, max_len=300, ui=party_study_detail.summary
publisher_department (发布部门), 0:1, max_len=50, ui=party.study.department|party_study_detail.department
published_at (发布日期), 1:1, datetime, ui=party.study.date|party_study_detail.date
file_id (学习文件ID), 1:k, integer, ui=party.study.preview|party.study.download|party_study_detail.file
video_url (相关视频地址), 0:k, url, ui=party_study_detail.video
study_status (学习内容状态), 1:1, s1=draft(草稿)|s2=pending(待审核)|s3=approved(已通过)|s4=rejected(已驳回), ui=party_study.hidden

rel_count (关系数量) = 2
rel_db (关联表) = db_school, db_file
rel_map (关系字段) = db_party_study{school_id}<->db_school{school_id}; db_party_study{file_id}<->db_file{file_id}

method (方法):
list = FILTER(school_id=current_school_id, study_status=s3) ORDER BY published_at DESC
home_list = list LIMIT 3
click = return study_id


党建活动 (Party Activity / db_party_activity)

activity_id (党建活动ID), 1:1, integer, ui=party.activity.hidden|party_activity_detail.hidden
school_id (园所ID), 1:1, integer, ui=party.hidden
activity_title (活动标题), 1:1, max_len=100, ui=party.activity.title|party_activity_detail.title
activity_intro (活动介绍), 0:1, max_len=500, ui=party_activity_detail.intro
activity_at (活动时间), 1:1, datetime, ui=party.activity.date|party_activity_detail.date
activity_location (活动地点), 0:1, max_len=100, ui=party.activity.location|party_activity_detail.location
file_id (活动图文或附件ID), 0:k, integer, ui=party_activity_detail.content|party_activity_detail.download
activity_status (活动状态), 1:1, s1=draft(草稿)|s2=pending(待审核)|s3=approved(已通过)|s4=rejected(已驳回), ui=party_activity.hidden

rel_count (关系数量) = 2
rel_db (关联表) = db_school, db_file
rel_map (关系字段) = db_party_activity{school_id}<->db_school{school_id}; db_party_activity{file_id}<->db_file{file_id}

method (方法):
list = FILTER(school_id=current_school_id, activity_status=s3) ORDER BY activity_at DESC
home_list = list LIMIT 3
click = return activity_id


品牌建设 (Party Brand / db_party_brand)

brand_id (品牌建设ID), 1:1, integer, ui=party.brand.hidden|party_brand_detail.hidden
school_id (园所ID), 1:1, integer, ui=party.hidden
brand_title (品牌标题), 1:1, max_len=100, ui=party.brand.title|party_brand_detail.title
brand_summary (品牌摘要), 0:1, max_len=300, ui=party_brand_detail.summary
brand_tag (品牌标签), 0:k, max_len=30, ui=party.brand.tag|party_brand_detail.tag
published_at (发布日期), 1:1, datetime, ui=party_brand_detail.date
file_id (品牌图文文件ID), 0:k, integer, ui=party_brand_detail.content
brand_status (品牌内容状态), 1:1, s1=draft(草稿)|s2=pending(待审核)|s3=approved(已通过)|s4=rejected(已驳回), ui=party_brand.hidden

rel_count (关系数量) = 2
rel_db (关联表) = db_school, db_file
rel_map (关系字段) = db_party_brand{school_id}<->db_school{school_id}; db_party_brand{file_id}<->db_file{file_id}

method (方法):
list = FILTER(school_id=current_school_id, brand_status=s3) ORDER BY published_at DESC
home_list = list LIMIT 3
click = return brand_id


党建轮播推荐 (Party Feature / db_party_feature)

party_feature_id (轮播推荐ID), 1:1, integer, ui=party.banner.hidden
school_id (园所ID), 1:1, integer, ui=party.hidden
feature_type (推荐类型), 1:1, f1=study(党建学习)|f2=activity(党建活动)|f3=brand(品牌建设), ui=party.banner.type
study_id (党建学习ID), 0:1, integer, ui=party.banner.hidden
activity_id (党建活动ID), 0:1, integer, ui=party.banner.hidden
brand_id (品牌建设ID), 0:1, integer, ui=party.banner.hidden
feature_title (轮播标题), 1:1, max_len=50, ui=party.banner.title
feature_subtitle (轮播副标题), 0:1, max_len=150, ui=party.banner.subtitle
display_order (轮播顺序), 1:1, integer, ui=party.banner.order
is_visible (是否显示), 1:1, boolean, ui=party.banner.visible
start_at (显示开始时间), 0:1, datetime, ui=party.banner.hidden
end_at (显示结束时间), 0:1, datetime, ui=party.banner.hidden

rel_count (关系数量) = 4
rel_db (关联表) = db_school, db_party_study, db_party_activity, db_party_brand
rel_map (关系字段) = db_party_feature{school_id}<->db_school{school_id}; IF feature_type=f1, db_party_feature{study_id}<->db_party_study{study_id}; IF feature_type=f2, db_party_feature{activity_id}<->db_party_activity{activity_id}; IF feature_type=f3, db_party_feature{brand_id}<->db_party_brand{brand_id}
check (校验) = feature_type 对应的一个目标ID必须有值，其他目标ID必须为 NULL

method (方法):
list = FILTER(school_id=current_school_id, is_visible=1, (start_at IS NULL OR start_at<=NOW), (end_at IS NULL OR end_at>=NOW)) ORDER BY display_order ASC LIMIT 3
IF list_count=0, return []


[EMPTY_STATE]

IF party_feature_count=0, show_banner=0
IF study_count=0, show_study_empty=1, study_empty_title=暂无党建学习内容
IF activity_count=0, show_activity_empty=1, activity_empty_title=暂无党建活动
IF brand_count=0, show_brand_empty=1, brand_empty_title=暂无品牌建设内容


[JUMP_VALIDATION]

IF node_key IN(party_study_card,party_activity_card,party_brand_card), REQUIRE object_id FROM query_result
IF object_id NOT_FOUND, return 404
IF object_status IN(s1,s2,s4,rejected,deleted), return 403
IF node_key=btn_party_study_all, return party-study-list.html
IF node_key=btn_party_activity_all, return party-activity-list.html
IF node_key=btn_party_brand_all, return party-brand-list.html
