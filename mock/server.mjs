/**
 * Local mock of the Hualong API, for developing the teacher client before the
 * real service exists.
 *
 * This is NOT a stub that returns whatever is convenient. It implements the
 * parts of API-CONTRACT.md v0.5 that the client depends on, so that code written
 * against it is code that will work against the real instance:
 *
 *   §1.4  X-Request-Id echoed on every response; Retry-After on 429/503
 *   §2.1  resources at the top level; collections as { items, next_cursor }
 *   §2.2  one error shape, with details carrying field+rule and never a value
 *   §2.3  the status-code split, including scope-miss -> 404 not 403
 *   §3.1  cursor pagination; no offset, no page, no total
 *   §3.3  opaque cursors bound to a filter fingerprint
 *   §3.5  roster-shaped collections return whole, ordered by child_id ASC
 *   §4    Idempotency-Key: replay returns the original status and body
 *   §6.2  the two-stage login, including the 409 that triggers stage two
 *
 * Run:  node mock/server.mjs
 *       node mock/server.mjs --unbound     start with no openid bound, to
 *                                          exercise the stage-2 phone flow
 *       node mock/server.mjs --no-term     current_term = null (holiday)
 *
 * Secrets: none live here. The mock never calls WeChat. `code2session` and
 * `getRealtimePhoneNumber` are simulated, which is the whole reason a sandbox
 * AppID is enough to develop against it.
 */

import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROLE_BY_SURFACE, authorizeRole, RoleResolutionError } from './authz.mjs';
import { loadRoutes } from './spec-routes.mjs';

// 3000 and 3100 are already taken by another local service on this workstation,
// so the default is moved out of the common range. Override with PORT=.
const PORT = Number(process.env.PORT || 3820);
const BASE = '/api/v1';
const ARGV = new Set(process.argv.slice(2));
const OPTS = {
  startUnbound: ARGV.has('--unbound'),
  noTerm: ARGV.has('--no-term'),
};

// ── Fixture data ───────────────────────────────────────────────────────────

const TEACHER = {
  teacher_id: 12,
  teacher_name: '陈静',
  teacher_status: 's1',
};

const SCOPE = { school_id: 1, class_id: 3, class_name: '中二班' };

const TERM = {
  term_id: '2026-2027-1',
  term_name: '2026学年第一学期',
  start_date: '2026-09-01',
  end_date: '2027-01-15',
};

const NOTICE_TITLES = [
  '关于秋季开学第一周作息安排的通知',
  '资源库新增「番禺水乡」主题资源包',
  '本学期教研培训计划与研修安排',
  '关于成长册园所设置发布的说明',
  '幼儿健康档案信息核对提醒',
  '食堂食谱公示与过敏原登记',
];

const NOTICE_BODY = [
  '各位老师：',
  '',
  '请于本周五下班前完成相关信息核对，并在平台内确认。若有疑问，请联系保教主任或信息员。',
  '',
  '化龙镇中心幼儿园',
].join('\n');

// 26 notices, so cursor paging actually pages. Newest first, matching the
// contract's "business time DESC + primary key DESC" ordering.
const NOTICES = Array.from({ length: 26 }, (_, i) => {
  const id = 26 - i;
  const day = String(20 - (i % 20)).padStart(2, '0');
  return {
    notice_id: id,
    notice_title: NOTICE_TITLES[i % NOTICE_TITLES.length],
    notice_body: NOTICE_BODY,
    published_at: `2026-08-${day}T09:${String(10 + (i % 45)).padStart(2, '0')}:00+08:00`,
  };
});

// db_home_case — 教师端首页推荐案例. Curated by an administrator in the PC
// backend (APP-STRUCTURE 首页推荐课程案例管理),同年级按 updated_at DESC 取前三.
// It is a curated shelf, not a per-teacher recommendation: no profile, no
// ranking signal, nothing derived from what this teacher read (ADR-0011).
const HOME_CASES = [
  { case_id: 71, case_name: '祠堂里的故事', case_field: 'f3', case_grade: 'k2' },
  { case_id: 68, case_name: '龙舟竞渡', case_field: 'f1', case_grade: 'k2' },
  // A field code this client build does not know, same purpose as the todo
  // below: the shelf must still render (§1.1).
  { case_id: 64, case_name: '醒狮从哪里来', case_field: 'f9_future_field', case_grade: 'k2' },
];

// db_task + db_task_assign。教师看到的是**自己那一行** assign（契约 §7.3：
// teacher_id 派生），同事的执行状态不回。
// 15 条，够翻页；状态覆盖 a1/a2/a3 与 t1/t2/t3/t4，另含一个本客户端不认识的
// 状态码，用来验证枚举降级（§1.1）。
const TASK_TITLES = [
  '衣食住行艺课程资源包共建',
  '社区建筑观察活动材料提交',
  '课程游戏化研修反馈汇总',
  '班级主题墙秋季素材征集',
  '幼儿一日生活流程优化建议',
];

const TASK_INTRO = '围绕五类生活经验收集班级实践材料，形成可进入资源库和案例库的素材包。';
const TASK_DIVISION = '各班收集不少于 10 张实践照片与 1 份教师转化说明，于截止日前提交。';

const TASKS = Array.from({ length: 15 }, (_, i) => {
  const id = 15 - i;
  // 前 5 条进行中，中间 5 条待接收，其余已完成；第 13 条已取消。
  const assignStatus = i < 5 ? 'a2' : i < 10 ? 'a1' : 'a3';
  let taskStatus = i < 5 ? 't2' : i < 10 ? 't1' : 't3';
  if (id === 3) taskStatus = 't4';
  // 一个未来版本才有的状态码：客户端必须照常显示，不得崩、不得留空。
  if (id === 7) taskStatus = 'z9_future_status';
  return {
    task_id: id,
    task_title: TASK_TITLES[i % TASK_TITLES.length],
    task_intro: TASK_INTRO,
    task_division: TASK_DIVISION,
    due_at: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T18:00:00+08:00`,
    task_status: taskStatus,
    creator_type: i % 3 === 0 ? 'c2' : 'c1',
    assign: {
      assign_id: 500 + id,
      task_id: id,
      teacher_id: 12,
      assign_status: assignStatus,
      accepted_at: assignStatus === 'a1' ? null : '2026-08-20T09:00:00+08:00',
      completed_at: assignStatus === 'a3' ? '2026-08-22T16:30:00+08:00' : null,
      feedback: null,
    },
  };
});

// db_party_study —— 党建学习资料。契约 §4 规则 19：按 published_at DESC, study_id
// DESC 作游标分页，**不搜索、不筛选** —— `study_type` 只显示，不做成筛选项（F7），
// 所以本端点除分页对之外不收任何参数。
// 23 条，够翻页（limit 缺省 20）；第 7 条带一个本客户端不认识的类型码，用来验证枚举
// 降级（§1.1）；第 4 条没有发布部门，用来验证可空列不把界面撑塌。
const STUDY_TITLES = [
  '新时代幼儿园党建工作要点',
  '师德师风专题学习材料',
  '校园安全责任清单学习',
  '支部会议记录规范',
  '党员学习档案整理要求',
];

const STUDY_DEPARTMENTS = ['办公室', '党支部', '综合组'];

const STUDY_CONTENT = [
  '一、指导思想',
  '',
  '围绕党建引领幼儿园高质量发展，明确支部学习、党员示范岗、课程建设协同和家园社共育服务四项重点，把学习成果落到班级一日生活里。',
  '',
  '二、学习要求',
  '',
  '各年级组每月组织一次集中学习，教师在平台内读完全文并完成学习记录。本文件同时用于园内归档。',
].join('\n');

const PARTY_STUDIES = Array.from({ length: 23 }, (_, i) => {
  const id = 23 - i;
  const day = String(20 - (i % 20)).padStart(2, '0');
  return {
    study_id: id,
    study_title: STUDY_TITLES[i % STUDY_TITLES.length],
    study_type: id === 7 ? 'z9_future_type' : ['t1', 't2', 't3'][i % 3],
    study_content: STUDY_CONTENT,
    publisher_department: id === 4 ? null : STUDY_DEPARTMENTS[i % 3],
    published_at: `2026-06-${day}T09:${String(10 + (i % 45)).padStart(2, '0')}:00+08:00`,
    // 本模块只产生 s3（直发）与 s5（下线）；列表与详情的可见范围都是 s3。
    study_status: 's3',
    // 外部影片，不上传到本后端、不由小程序内嵌播放（F7）。第 4 条为 null，因为契约
    // 允许该列为空，客户端不得把 null 当成数组。
    video_links: id === 4 ? null : [
      { title: '党建引领教育高质量发展', url: 'https://www.12371.cn/special/xxzd/' },
      { title: '师德师风专题学习', url: 'https://www.xuexi.cn/' },
    ],
    // 契约要求至少一份 usage_key='main_file'（F7），所以每条都有；配图只有部分条目有。
    file_refs: [
      { file_id: 7000 + id, usage_key: 'main_file', file_name: `${STUDY_TITLES[i % STUDY_TITLES.length]}.pdf`, file_size: 2483712 },
      ...(id % 4 === 0 ? [] : [
        { file_id: 7500 + id, usage_key: 'inline_media', file_name: '学习现场照片.jpg', file_size: 384210 },
      ]),
    ],
  };
});

/** 列表卡片：`excerpt` 由 `study_content` 前 100 字派生，**不落摘要列**（F7）。 */
function toStudyCard(study) {
  return {
    study_id: study.study_id,
    study_title: study.study_title,
    study_type: study.study_type,
    publisher_department: study.publisher_department,
    published_at: study.published_at,
    excerpt: study.study_content.slice(0, 100),
  };
}

// db_party_activity —— 党建活动。契约 §4 规则 19 同学习资料：不搜索、不筛选，业务日期
// 是 `activity_at`（含时刻），按 `activity_at DESC, activity_id DESC` 作游标分页。
// F7 已移除原型的「主办部门／参与对象」两列，所以这里也没有。
// 21 条，够翻页；第 9 条带一个本客户端不认识的状态码，第 5 条没有地点，用来验证可空列。
const ACTIVITY_TITLES = [
  '“红色故事进课堂”主题党日',
  '党员教师社区志愿服务',
  '青年教师理论读书会',
  '红色教育基地参访',
  '党员示范课观摩',
];

const ACTIVITY_LOCATIONS = ['多功能室', '社区广场', '党建室', '区党群中心', '中三班'];

const ACTIVITY_CONTENT = [
  '一、活动安排',
  '',
  '党员教师围绕红色故事资源进行课程转化讨论，形成适合大班幼儿理解的故事讲述、角色扮演和美术表达活动。',
  '',
  '二、参与要求',
  '',
  '各班派一名教师参加，活动后在本页提交一条教学实践反思，由支部统一归档。',
].join('\n');

const PARTY_ACTIVITIES = Array.from({ length: 21 }, (_, i) => {
  const id = 21 - i;
  // 日期严格递减，`activity_at DESC, activity_id DESC` 的排序才真的成立。
  const day = String(21 - i).padStart(2, '0');
  return {
    activity_id: id,
    activity_title: ACTIVITY_TITLES[i % ACTIVITY_TITLES.length],
    activity_content: ACTIVITY_CONTENT,
    // 一天里的钟点各不相同，好让「字面量原样呈现」这条测试有具体的钟点可断言。
    activity_at: `2026-06-${day}T${['09:30', '10:00', '14:00', '15:00', '16:20'][i % 5]}:00+08:00`,
    activity_location: id === 5 ? null : ACTIVITY_LOCATIONS[i % ACTIVITY_LOCATIONS.length],
    // 本模块只产生 s3（直发）与 s5（下线）；第 9 条是未来版本才有的码。
    activity_status: id === 9 ? 'z9_future_status' : 's3',
    // 活动的附件可以全空（F7），所以第 12 条一份都没有。
    file_refs: id === 12 ? [] : [
      { file_id: 8000 + id, usage_key: 'main_file', file_name: `${ACTIVITY_TITLES[i % ACTIVITY_TITLES.length]}活动方案.docx`, file_size: 184320 },
      ...(id % 3 === 0 ? [] : [
        { file_id: 8500 + id, usage_key: 'inline_media', file_name: '活动现场图.jpg', file_size: 421887 },
      ]),
    ],
  };
});

// db_party_brand —— 品牌建设。按 `published_at DESC, brand_id DESC` 作游标分页。
// 22 条；第 6 条 `brand_tag` 为 null（契约允许该列为空），第 13 条带一个未知状态码。
const BRAND_TITLES = [
  '科技启蒙：小小工程师项目',
  '醒狮文化：岭南艺术体验',
  '自然花园：劳动教育实践',
  '书香班级：亲子阅读共建',
];

const BRAND_TAGS = [
  ['科学', '项目化学习', '党建引领'],
  ['艺术', '岭南文化', '节庆活动'],
  ['自然', '劳动', '班级共建'],
  ['语言', '阅读', '家园社共育'],
];

const BRAND_CONTENT = [
  '一、主题由来',
  '',
  '围绕幼儿对搭建、测量和机械结构的兴趣，教师设计桥梁、滑道、风车等探究任务，让儿童在操作中形成初步工程思维。',
  '',
  '二、课程转化',
  '',
  '每学期沉淀一份主题课程包，含环境创设要点、材料清单与幼儿作品记录，供各班取用。',
].join('\n');

const PARTY_BRANDS = Array.from({ length: 22 }, (_, i) => {
  const id = 22 - i;
  const day = String(22 - i).padStart(2, '0');
  return {
    brand_id: id,
    brand_title: BRAND_TITLES[i % BRAND_TITLES.length],
    brand_content: BRAND_CONTENT,
    brand_tag: id === 6 ? null : BRAND_TAGS[i % BRAND_TAGS.length],
    published_at: `2026-05-${day}T${['08:45', '11:15', '13:40', '17:05'][i % 4]}:00+08:00`,
    brand_status: id === 13 ? 'z9_future_status' : 's3',
    file_refs: [
      { file_id: 8800 + id, usage_key: 'main_file', file_name: `${BRAND_TITLES[i % BRAND_TITLES.length]}课程包.pdf`, file_size: 1048576 },
      ...(id % 2 === 0 ? [] : [
        { file_id: 8900 + id, usage_key: 'inline_media', file_name: '主题环境图.jpg', file_size: 297431 },
      ]),
    ],
  };
});

// db_coord_document —— 综合协调文件。契约 §4 规则 20：全部 active 正式教师可见本园
// `document_status='s3'`，合作园不得进入；按 `published_at DESC, document_id DESC`
// 作游标分页。`coord_category` 是**必填的分类页切换**，值域固定 c1—c7，未知值回 400。
//
// 七类各 22 条（共 154 条），每类都够翻页（limit 缺省 20）。类目在数组里交错排列，
// 所以一个只会切片、不会真的按类目过滤的实现在第一条测试上就会露馅。
const COORD_CATEGORIES = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'];

// 只有 c1／c4／c5 可以填生效日期，其余类目必须为 NULL（表约束 ck_cd_effective）。
const EFFECTIVE_CATEGORIES = ['c1', 'c4', 'c5'];

const COORD_TITLES = {
  c1: ['幼儿园保教质量评估指南摘编', '学前教育法学习要点', '园内安全责任制度修订稿'],
  c2: ['六月园务例会通知', '期末资料归档工作提醒', '班级物资申领时间调整通知'],
  c3: ['综合协调部岗位职责表', '园级管理小组分工图', '年级组长工作职责说明'],
  c4: ['每日安全巡检记录表', '户外活动安全提示单', '防汛防台应急预案'],
  c5: ['班级晨午检记录表', '夏季传染病防控提醒', '活动室消毒流程卡'],
  c6: ['教师职业行为准则学习材料', '师德承诺书模板', '师德师风月度自查表'],
  c7: ['跟岗教师一周安排表', '外出学习反馈模板', '结对教师交流记录'],
};

const COORD_DEPARTMENTS = ['办公室', '后勤组', '人事组'];

const COORD_CONTENT = [
  '一、适用范围',
  '',
  '本文件适用于全园教职工，各年级组、班级与后勤岗位按各自职责执行，遇到本文件未覆盖的情形逐级上报，不自行处置。',
  '',
  '二、执行要求',
  '',
  '各部门在收到本文件后一周内完成一次对照自查，把发现的问题与整改结果报综合协调部备案。本文件同时用于园内归档。',
].join('\n');

const COORD_DOCUMENTS = Array.from({ length: 154 }, (_, i) => {
  const id = 154 - i;
  const category = COORD_CATEGORIES[i % 7];
  const titles = COORD_TITLES[category];
  // 日期严格递减，`published_at DESC, document_id DESC` 的排序才真的成立：同一天里
  // 七个类目各占一个钟点，下一天再从头开始。
  const day = String(22 - Math.floor(i / 7)).padStart(2, '0');
  const hour = String(23 - (i % 7) * 3).padStart(2, '0');
  return {
    document_id: id,
    coord_category: category,
    document_title: titles[Math.floor(i / 7) % titles.length],
    document_content: COORD_CONTENT,
    // 可空列。第 100 条没有发布部门，用来验证界面不被一个 null 撑塌。
    publisher_department: id === 100 ? null : COORD_DEPARTMENTS[i % 3],
    published_at: `2026-06-${day}T${hour}:00:00+08:00`,
    // 只有可填的三类里、每三条中的一条真的填了，其余为 null —— 两种情形都要能显示。
    effective_date: EFFECTIVE_CATEGORIES.indexOf(category) !== -1 && id % 3 === 0
      ? `2026-07-${day}`
      : null,
    // 列表与详情的可见范围都是 s3，所以夹具里能被读到的只有 s3。
    document_status: 's3',
    // F8：恰有一份 usage_key='main_file'；配图与附件可选。
    file_refs: [
      { file_id: 9000 + id, usage_key: 'main_file', file_name: `${titles[Math.floor(i / 7) % titles.length]}.pdf`, file_size: 731136 },
      ...(id % 4 === 0 ? [
        { file_id: 9200 + id, usage_key: 'inline_media', file_name: '现场照片.jpg', file_size: 318204 },
      ] : []),
      // 第 154 条挂一份微信打不开的格式，用来验证客户端说明而不是留白。
      ...(id === 154 ? [
        { file_id: 9400 + id, usage_key: 'download', file_name: '原始记录.zip', file_size: 2097152 },
      ] : []),
    ],
  };
});

/** 列表卡片：`excerpt` 由 `document_content` 前 100 字派生，**不落摘要列**（F8）。 */
function toCoordCard(doc) {
  return {
    document_id: doc.document_id,
    coord_category: doc.coord_category,
    document_title: doc.document_title,
    publisher_department: doc.publisher_department,
    published_at: doc.published_at,
    effective_date: doc.effective_date,
    excerpt: doc.document_content.slice(0, 100),
  };
}

// db_resource —— 课程资源。契约 §10：teacher 的可见范围是
// `school_id = $ctx_school AND (resource_status = 's3' OR created_by = $ctx_teacher)`，
// 按 `updated_at DESC, resource_id DESC` 作游标分页。筛选参数只有 resource_tag 与
// grade（外加 admin 才用得上的 resource_status／class_id）—— **五大领域与活动形式
// 不是资源的列**，它们只筛案例，所以这里也没有。
//
// 32 条，够翻页；**每个分类各 6 到 7 条，limit=5 时筛完仍有多页**，否则「换筛选丢弃
// 旧游标」验证不了。第 9 条带一个本客户端不认识的分类码，第 14 条 `grade` 为 null，
// 用来验证未知枚举与可空列都不把界面撑塌。
const RESOURCE_NAMES = [
  '香云纱纹样', '双皮奶', '沙湾留耕堂 · 何氏宗祠', '龙舟竞渡', '醒狮纹样',
  '广绣小包', '荔枝蜜', '沙湾古镇', '安全过街', '粤语童谣',
  '陶艺纹饰',
];

const RESOURCE_EXPLAIN = '从空间、材料与族群记忆切入，帮助幼儿理解社区生活经验与公共文化。';
const RESOURCE_ACCESS = '教师可实地走访拍摄，或由园所统一整理安全可用的参观照片、讲解词与观察表。';
const RESOURCE_TRANS = '可转化为观察、拓印、建构与口述故事活动，引导幼儿从看见到表达。';

// 分类走 5 周期、年级走 4 周期，最小公倍数 20 > 32 条的一半 —— 两个维度因此**不相关**。
// 若两者同周期，「按分类筛」与「按分类加年级筛」会得到同一批行，组合筛选的测试就什么
// 也证明不了。
const RESOURCE_TAGS = ['g1', 'g2', 'g3', 'g4', 'g5'];
const RESOURCE_GRADES = [['k1'], ['k2'], ['k3'], ['k2', 'k3']];

const RESOURCES = Array.from({ length: 32 }, (_, i) => {
  const id = 32 - i;
  return {
    resource_id: id,
    resource_type: ['r1', 'r5', 'r3', 'r4'][i % 4],
    resource_name: RESOURCE_NAMES[i % RESOURCE_NAMES.length],
    // 一个未来版本才有的分类码：客户端必须照常显示，不得崩、不得留空。
    resource_tag: id === 9 ? 'z9_future_tag' : RESOURCE_TAGS[i % 5],
    // 可空的数组列。第 14 条为 null，客户端不得把 null 当成数组。
    grade: id === 14 ? null : RESOURCE_GRADES[i % 4],
    resource_explain: RESOURCE_EXPLAIN,
    resource_access: RESOURCE_ACCESS,
    resource_trans: RESOURCE_TRANS,
    cover_file_id: null,
    // 第 12 条没有 Word 详案：没有附件的资源照常显示，只是少一个下载入口。
    word_file_id: id === 12 ? null : 6000 + id,
    created_by: TEACHER.teacher_id,
    // 可见范围的两半都要有夹具：绝大多数是本园已发布的 s3，另有三条是这位教师
    // **自己写的**非 s3（草稿、待审、被驳回）—— 这是资源与党建三类最大的差别，
    // 那三类只看得到 s3，这里看得到自己的全部。
    resource_status: id === 3 ? 's1' : id === 5 ? 's2' : id === 7 ? 's4' : 's3',
    required_count: 5,
    completed_count: 5,
    complete: 'c1',
    submitted_at: id === 3 ? null : '2026-07-10T09:00:00+08:00',
    // 严格递减，`updated_at DESC, resource_id DESC` 的排序才真的成立：一天里两条，
    // 先 18:00 后 09:00，下一天再从头开始。
    updated_at: `2026-07-${String(16 - Math.floor(i / 2)).padStart(2, '0')}T${['18', '09'][i % 2]}:00:00+08:00`,
  };
});

/**
 * 「这个资源被哪些案例用了」由**服务端**答。方向要看清楚：`db_case.resource_ids`
 * 记着案例引用了哪些资源，`db_resource` 上没有反向列，而契约的 `/library/cases`
 * 也没有 `resource_id` 这个筛选参数。所以客户端既拉不到、也不该拼这份清单。
 *
 * 该字段与 `/home/cases` 同类：只在本地契约服务上成立，接真服务时必须重对。
 */
const RELATED_CASES = {
  71: { case_id: 71, case_name: '祠堂里的故事', case_field: 'f3', case_grade: 'k3' },
  68: { case_id: 68, case_name: '龙舟竞渡', case_field: 'f1', case_grade: 'k3' },
  64: { case_id: 64, case_name: '砖雕纹样拓印', case_field: 'f5', case_grade: 'k3' },
};

function relatedCasesFor(resourceId) {
  // 第 30 条（留耕堂）挂两条，第 29 条挂一条，其余为空 —— 有与没有都要能显示。
  if (resourceId === 30) return [RELATED_CASES[71], RELATED_CASES[64]];
  if (resourceId === 29) return [RELATED_CASES[68]];
  return [];
}

// db_case —— 课程案例。契约 §10 的 `/library/cases` 只写了一行 summary
// 「案例列表（predicate 与资源同构）」，**没有 description，也没有 x-hualong-scope**，
// 所以逐字 predicate 在契约里不存在。这里按「与资源同构」实现：
// `school_id = $ctx_school AND (case_status = 's3' OR created_by = $ctx_teacher)`，
// 按 `updated_at DESC, case_id DESC` 作游标分页。这是转述，不是抄录（见
// services/library.js 头注与交接的契约缺口）。
//
// 筛选参数三个：case_grade、case_field、case_area（外加 admin 才用得上的
// case_status）。**衣食住行艺分类不是案例的列**，所以这里也没有。
//
// 120 条，且**任一单维筛选后仍多于一页**（默认 limit=20）：年级各 40 条、领域各 24
// 条、活动形式各 45 条。少于这个数，「换筛选丢弃旧游标」之后新筛选集就只剩一页，
// 「新游标是新筛选集签发的」这半条就验证不了。
const CASE_NAMES = [
  '祠堂里的故事', '龙舟竞渡', '番禺美食地图', '粤语童谣共唱', '砖雕纹样拓印',
  '桥有多长', '我会安全过街', '社区小店的一天', '采访老街坊', '香云纱的颜色',
  '双皮奶是怎么来的', '醒狮从哪里来',
];

const CASE_INTRO = '以身边的本土资源为载体，引导幼儿观察、讲述并动手表达，形成对家乡的初步认同。';
const CASE_TRANS = '从具象到抽象：先看一看摸一摸，再搭一搭做一做，最后说一说，把经验接回幼儿自己的生活。';

// 年级走 3 周期、领域走 5 周期、活动形式走 8 周期 —— 三者两两互质，所以三个维度
// **互不相关**。若其中两个同周期，「按领域筛」与「按领域加年级筛」会得到同一批行，
// 组合筛选的测试就什么也证明不了。
const CASE_GRADES = ['k1', 'k2', 'k3'];
const CASE_FIELDS = ['f1', 'f2', 'f3', 'f4', 'f5'];
// 多选数组列。8 个组合，a1—a5 每个都出现在 3 个组合里，所以单筛任一活动形式都是 45
// 条，稳稳多于一页。
const CASE_AREAS = [
  ['a1'], ['a2'], ['a3', 'a5'], ['a4', 'a5'],
  ['a1', 'a3'], ['a2', 'a4'], ['a3', 'a4', 'a5'], ['a1', 'a2'],
];

const CASES = Array.from({ length: 120 }, (_, i) => {
  const id = 120 - i;
  return {
    case_id: id,
    case_name: CASE_NAMES[i % CASE_NAMES.length],
    case_grade: CASE_GRADES[i % 3],
    // 一个未来版本才有的领域码：客户端必须照常显示，不得崩、不得留空。
    case_field: id === 91 ? 'f9_future_field' : CASE_FIELDS[i % 5],
    // 第 88 条的数组里混一个未知码：未知项被丢掉，同一行里已知的那几项照常显示。
    case_area: id === 88 ? ['a3', 'z9_future_area'] : CASE_AREAS[i % 8],
    case_intro: CASE_INTRO,
    case_trans: CASE_TRANS,
    // 可空列。第 84 条没有关联资源，详情页照常显示，只是那一节是空态。
    resource_ids: id === 84 ? null : [30, 29],
    cover_file_id: null,
    // 第 82 条没有 Word 详案：没有附件的案例照常显示，只是少一个下载入口。
    word_file_id: id === 82 ? null : 7000 + id,
    created_by: TEACHER.teacher_id,
    // 可见范围的两半都要有夹具：绝大多数是本园已发布的 s3，另有三条是这位教师
    // **自己写的**非 s3（草稿、待审、被驳回）。
    case_status: id === 4 ? 's1' : id === 6 ? 's2' : id === 8 ? 's4' : 's3',
    submitted_at: id === 4 ? null : '2026-07-10T09:00:00+08:00',
    // 严格递减，`updated_at DESC, case_id DESC` 的排序才真的成立：一天里八条，
    // 从 20:00 每两小时退一档到 06:00，下一天再从头开始。
    updated_at: `2026-07-${String(16 - Math.floor(i / 8)).padStart(2, '0')}`
      + `T${String(20 - (i % 8) * 2).padStart(2, '0')}:00:00+08:00`,
  };
});

/**
 * 「这个案例引用了哪些资源」由**服务端展开**。`db_case.resource_ids` 只有整数 ID，
 * 契约的 `Case` schema 也只回 ID，客户端拿不到名称；逐个去拉资源详情是 N+1 次请求，
 * 且任一条不在可见范围时会拿到 404 把整页拖垮。
 *
 * 该字段与 `related_cases`、`/home/cases` 同类：只在本地契约服务上成立，接真服务时
 * 必须重对。
 */
function relatedResourcesFor(kase) {
  return (kase.resource_ids || [])
    .map((rid) => RESOURCES.find((r) => r.resource_id === rid))
    .filter(Boolean)
    .map((r) => ({
      resource_id: r.resource_id,
      resource_name: r.resource_name,
      resource_tag: r.resource_tag,
      grade: r.grade,
    }));
}

// db_training —— 研修活动。契约 §4 规则 21 / F9：全部 active 正式教师可读本园
// `training_status='s1'` 的研修，合作园不得进入；按 `start_at DESC, training_id DESC`
// 作游标分页，**不搜索、不筛选**。`phase` 只是「最新／历史」两区的切分，不是自由筛选。
//
// `training_phase` 契约说是**按园所时区派生、不落列**的值：真服务按 NOW 现算。本 mock
// 把它写死在夹具里，因为一个跟着时钟漂的夹具会让「翻到底就停」这类断言在某个月的某一天
// 忽然换答案。派生的一方仍是服务端，客户端照收照显 —— 这一点两边一致。
//
// 46 条，**两区各多于一页**（默认 limit=20）：最新 23 条、历史 21 条。少于这个数，
// 「换分区丢弃旧游标、新分区自己签一枚」就验证不了。
// 第 6 条带一个本客户端不认识的阶段码（§1.1 枚举降级）；第 20 条已撤回（s5：列表读不到、
// 详情读得到一个壳）；第 44 条没有地点（纯线上）；第 40 条没有主讲；第 38 条没有结束
// 时间（`effective_end_at` 要退回当日结束）；第 34 条一份材料也没有（F9：研修材料全部
// 可选，不强制 main_file）。
const TRAINING_TITLES = [
  '幼儿园课程游戏化的理论与实践',
  '岭南文化融入幼儿园课程专题研修',
  '幼儿行为观察与记录方法',
  '家园沟通技巧与案例分享',
  '衣食住行艺课程资源开发工作坊',
  '幼儿园一日生活流程优化研讨',
];

const TRAINING_LOCATIONS = ['多功能厅', '会议室二', '区教师发展中心', '党建室', '中三班'];
const TRAINING_SPEAKERS = ['陈园长', '李老师', '王主任', '外聘专家'];

const TRAINING_CONTENT = [
  '一、研修目标',
  '',
  '围绕课程实施中的真实问题展开研讨，形成可以直接带回班级的观察工具与活动设计思路。',
  '',
  '二、参与要求',
  '',
  '请参训教师提前阅读研修材料，带上本班近两周的活动照片与教师转化说明，现场按年级组分组研讨。',
].join('\n');

const TRAINING_START_HOURS = ['09:30', '10:00', '14:00', '15:00', '16:20'];
const TRAINING_END_HOURS = ['11:30', '12:00', '16:00', '17:00', '18:20'];

const TRAININGS = Array.from({ length: 46 }, (_, i) => {
  const id = 46 - i;
  // 日期严格递减，`start_at DESC, training_id DESC` 的排序才真的成立：十月排 23 天，
  // 六月再排 23 天，一天一场，开场钟点在五个值里轮转。
  const month = i < 23 ? '10' : '06';
  const day = String(23 - (i % 23)).padStart(2, '0');
  const title = TRAINING_TITLES[i % TRAINING_TITLES.length];
  // 前 21 条即将开始、随后 2 条进行中、其余历史。两区因此各多于一页。
  const phase = i < 21 ? 'upcoming' : i < 23 ? 'ongoing' : 'history';
  // 纯线上的那一场没有地点，只有会议入口；混合活动两者都有（F9）。
  const online = id === 46 || id === 44;
  return {
    training_id: id,
    training_title: title,
    training_content: TRAINING_CONTENT,
    // §1.2：偏移量是字面量，服务端写什么客户端就显示什么。
    start_at: `2026-${month}-${day}T${TRAINING_START_HOURS[i % 5]}:00+08:00`,
    end_at: id === 38 ? null : `2026-${month}-${day}T${TRAINING_END_HOURS[i % 5]}:00+08:00`,
    location: id === 44 ? null : TRAINING_LOCATIONS[i % 5],
    speaker: id === 40 ? null : TRAINING_SPEAKERS[i % 4],
    training_status: id === 20 ? 's5' : 's1',
    // 一个未来版本才有的派生阶段码：客户端必须照常显示，不得崩、不得留空。
    training_phase: id === 6 ? 'z9_future_phase' : phase,
    meeting_link_title: online ? `腾讯会议：${title}` : null,
    meeting_url: online ? 'https://meeting.tencent.com/dm/hualong-example' : null,
    // 契约声明了这两列，所以夹具照给。票据 14 只做浏览，客户端本轮不读它们；
    // 省掉它们会让下一张票以为服务端从来不回这两个字段。
    my_participation_status: id % 4 === 0 ? 's1' : null,
    feedback_count: phase === 'history' ? 3 + (i % 7) : 0,
    // usage_key 只有 main_file／inline_media／download 三个值（契约 ContentFileRef）。
    // 三类材料：PDF 讲义、演示文稿、以及一份微信打不开的录像包。
    file_refs: id === 34 ? [] : [
      { file_id: 7100 + id, usage_key: 'main_file', file_name: `${title}讲义.pdf`, file_size: 1843200 },
      ...(id % 2 === 0 ? [
        { file_id: 7300 + id, usage_key: 'download', file_name: `${title}演示文稿.pptx`, file_size: 3145728 },
      ] : []),
      ...(id === 46 ? [
        { file_id: 7500 + id, usage_key: 'download', file_name: '研修现场录像包.zip', file_size: 20971520 },
      ] : []),
    ],
  };
});

/** 列表卡片：`excerpt` 由 `training_content` 前 100 字派生，**不落摘要列**（F9）。 */
function toTrainingCard(training) {
  return {
    training_id: training.training_id,
    training_title: training.training_title,
    start_at: training.start_at,
    end_at: training.end_at,
    location: training.location,
    speaker: training.speaker,
    training_status: training.training_status,
    training_phase: training.training_phase,
    excerpt: training.training_content.slice(0, 100),
    my_participation_status: training.my_participation_status,
  };
}

/**
 * 办园理念与课程体系的图文。
 *
 * **契约里没有这条路径，`db/01_schema.sql` 里也没有对应的表。** 与 `/notices`、
 * `/home/todos` 那几条不同——那几条至少有 `db_notification`／`db_home_case` 撑着，只是
 * 没有登记操作；这一页连表都没有。教师端 spec 的第 36 条用户故事要它，`openapi.yaml`
 * 的 126 条路径里搜不到 course／curriculum／理念／课程体系任何一个词。
 *
 * 这是一个**契约缺口**，只在本地契约服务上成立，接真服务时必须重对。夹具的图文抄自
 * 原型 `screens/course-building.html`。
 *
 * 原型那一页底部还有三份附件（课程体系总图等）。**这里不给附件**：取档要走
 * `GET /media/files/{file_id}/url`，而它的第一个参数是 `owner_object`（`db_file_ref`
 * 挂在哪张业务表上）——没有表就填不出这个参数，凭空编一个表名等于把缺口藏起来。
 */
const COURSE_INTRO = {
  intro_title: '课程体系建设',
  intro_summary: '以幼儿真实生活经验为起点，围绕衣、食、住、行、艺五个范畴组织园本课程。',
  intro_lead: '课程建设从「儿童在本地如何生活」出发，把社区资源、家庭经验和幼儿园活动整合为连续的'
    + '学习线索。教师围绕五类主题组织观察、探究、表达和创作，让儿童在真实情境中发展健康、语言、社会、'
    + '科学与艺术经验。',
  sections: [
    {
      section_key: 'philosophy',
      section_title: '办园理念',
      section_body: '图文内容用于呈现幼儿园课程从生活情境进入活动设计的路径。',
      items: [
        { item_title: '真实生活', item_body: '课程的起点是幼儿此刻正在过的日子，不是成人预设的主题。' },
        { item_title: '本土资源', item_body: '祠堂、街巷、市集与非遗技艺都是可进入课程的材料。' },
        { item_title: '儿童经验', item_body: '看得见、摸得着、说得出，经验才算真的发生。' },
        { item_title: '课程转化', item_body: '资源要落成活动，活动要落回幼儿的下一次生活。' },
      ],
    },
    {
      section_key: 'framework',
      section_title: '课程体系架构',
      section_body: '课程体系采用「生活范畴 → 主题资源 → 活动案例 → 儿童经验」的组织方式，'
        + '避免把资源停留在展示层面。',
      items: [
        { item_title: '生活范畴', item_body: '衣、食、住、行、艺五类。' },
        { item_title: '主题资源', item_body: '社区建筑、地方饮食、非遗技艺、出行经验。' },
        { item_title: '活动案例', item_body: '小中大班分层活动与五大领域转化。' },
        { item_title: '儿童经验', item_body: '观察、表达、探究、合作、审美与创造。' },
      ],
    },
    {
      section_key: 'domains',
      section_title: '五个课程范畴',
      section_body: '',
      items: [
        { item_title: '衣：材料、纹样与审美表达', item_body: '从香云纱、广绣纹样、服饰材料出发，连接审美表达与材料探究。' },
        { item_title: '食：地方饮食与家庭经验', item_body: '围绕双皮奶、节气饮食、厨房工具，生成测量、记录和家庭访谈活动。' },
        { item_title: '住：建筑空间与社区关系', item_body: '以留耕堂、宗祠、街巷空间为线索，引导幼儿观察建筑和社区关系。' },
        { item_title: '行：出行规则与空间经验', item_body: '从龙舟、步行路线、安全过街切入，发展规则意识和空间经验。' },
        { item_title: '艺：表演、节奏与创作', item_body: '结合醒狮、粤语童谣、民间工艺，支持儿童表演、节奏和创作表达。' },
      ],
    },
  ],
};

// POST /library/resources/{id}/download-link 签发的短链。link_id -> { resource_id }。
// §8.4：短链指向**我们的** /dl/{link_id}，不是对象存储；在那里逐次复核内容状态后
// 才 302 到真正的地址。所以这张表存的是内容归属，不是一个已经签好的对象存储地址。
const downloadLinks = new Map();

const TODOS = [
  { todo_id: 1, todo_kind: 'upload', todo_title: '上传「祠堂里的故事」课程案例', due_at: '2026-08-25T18:00:00+08:00' },
  { todo_id: 2, todo_kind: 'task', todo_title: '完成共建任务：秋季主题墙素材征集', due_at: '2026-08-28T18:00:00+08:00' },
  { todo_id: 3, todo_kind: 'evaluation', todo_title: '填写 8 月月度评价（还差 6 名幼儿）', due_at: '2026-08-31T18:00:00+08:00' },
  // An intentionally unknown kind: the client must degrade to a neutral pill
  // rather than crash (§1.1's tolerate-unknown-enums rule).
  { todo_id: 4, todo_kind: 'z9_future_kind', todo_title: '未来版本新增的待办类型', due_at: null },
];

// ── Mutable state ──────────────────────────────────────────────────────────

// Per-request logging is wanted at the CLI and unwanted inside a test run.
const runtime = { quiet: false };
const rlog = (...a) => { if (!runtime.quiet) console.log(...a); };

const state = {
  openidBound: !OPTS.startUnbound,
  sessions: new Map(),          // token -> { claim_id, issued_at }
  revoked: new Set(),
  idempotency: new Map(),       // key -> { status, body, bodyHash }
  nextTaskId: 900,              // POST /parent-tasks assigns from here
  // db_content_access_event —— 服务端在签发短链的同一个事务里写的那一笔。放在这里
  // 是为了让「客户端不自行拼装记录请求」可断言：记录数只随 download-link 增长。
  accessEvents: [],
};

// §3.5 — a roster-shaped collection: one row per child, whole, child_id ASC.
// Deliberately NOT paginated; "is anyone incomplete?" must be one read.
const ROSTER = Object.freeze([
  { child_id: 101, child_name: '陈一诺', submission_status: 'p2' },
  { child_id: 102, child_name: '黄铭轩', submission_status: 'p1' },
  { child_id: 103, child_name: '梁子墨', submission_status: 'p2' },
  { child_id: 104, child_name: '罗芷晴', submission_status: 'p1' },
  { child_id: 105, child_name: '吴悦然', submission_status: 'p2' },
  { child_id: 106, child_name: '郑皓宇', submission_status: 'p1' },
]);

// ── Contract helpers ───────────────────────────────────────────────────────

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = body === null ? '' : JSON.stringify(body);
  res.writeHead(status, {
    // §1.1: one content type, both directions.
    'content-type': 'application/json; charset=utf-8',
    // §1.4: no-store on anything that could carry minors' data or a signed URL.
    // Blanket here rather than per-route, because getting the list wrong is a
    // red-line-4 leak and the cost of over-applying it is zero.
    'cache-control': 'no-store',
    'x-request-id': res.__requestId,
    // §5.3: rate-limit headers are always present, even well under the limit.
    'x-ratelimit-limit': '3000',
    'x-ratelimit-remaining': '2999',
    'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
    // CORS for the DevTools simulator, which issues real cross-origin requests.
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type,authorization,idempotency-key,x-request-id',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    ...extraHeaders,
  });
  res.end(payload);

  // §4.2: record the first outcome so a replay can return the original status
  // and body. 5xx is deliberately not recorded — replaying "our bug" would pin
  // a transient failure to the key for its whole lifetime.
  if (res.__idem && status < 500) {
    state.idempotency.set(res.__idem.key, {
      status,
      body,
      bodyHash: res.__idem.bodyHash,
    });
  }
}

/** §2.2 — the one error shape. `details` never carries a value. */
function fail(res, status, code, message, details) {
  const body = { code, message, request_id: res.__requestId };
  if (details) body.details = details;
  const extra = (status === 429 || status === 503) ? { 'retry-after': '2' } : {};
  sendJson(res, status, body, extra);
}

/** §3.3 — an opaque cursor carrying the sort key and a filter fingerprint. */
function fingerprint(filters) {
  return createHash('sha256')
    .update(JSON.stringify(filters || {}))
    .digest('hex')
    .slice(0, 12);
}

function encodeCursor(lastId, filters) {
  return Buffer.from(JSON.stringify({ k: lastId, f: fingerprint(filters) })).toString('base64url');
}

function decodeCursor(cursor, filters) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch (e) {
    return { error: 'cursor_invalid' };
  }
  if (typeof parsed.k !== 'number' || typeof parsed.f !== 'string') {
    return { error: 'cursor_invalid' };
  }
  // §3.3: changing the filter but keeping the cursor is a 400, never a silent
  // wrong answer. Silent is the hardest kind to find.
  if (parsed.f !== fingerprint(filters)) return { error: 'cursor_filter_mismatch' };
  return { key: parsed.k };
}

/** §6.3 — bearer token, revocable, carrying claim_id and issue time. */
function requireSession(req, res) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || !state.sessions.has(token)) {
    fail(res, 401, 'unauthenticated', '未登录或登录凭证无效');
    return null;
  }
  if (state.revoked.has(token)) {
    fail(res, 401, 'session_revoked', '登录状态已失效，请重新登录');
    return null;
  }
  return state.sessions.get(token);
}

async function readRaw(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw;
}

function parseJson(raw) {
  if (!raw) return {};
  return JSON.parse(raw);
}

// ── Routes ─────────────────────────────────────────────────────────────────

/** §6.2 — POST /auth/session, both stages. */
function postAuthSession(res, body) {
  // §6.1 — the surface IS the role. One client, one role, fixed for the session.
  // Surfaces other than `teacher` exist here so that RBAC tests have an identity
  // to be refused with; G1 blocks parent and admin-pc in production.
  const role = ROLE_BY_SURFACE[body.surface];
  if (!role) {
    return fail(res, 422, 'validation_failed', '字段校验失败',
      { field: 'surface', rule: 'unknown_surface' });
  }
  if (!body.js_code) {
    return fail(res, 400, 'malformed_request', '缺少 js_code');
  }

  // Stage 1: code2session -> openid -> look up the current db_phone_claim.
  if (!state.openidBound) {
    if (!body.phone_code) {
      // The 409 that tells the client to reveal the phone button.
      return fail(res, 409, 'identity_binding_required', '需要验证手机号以完成首次绑定');
    }
    // Stage 2: getRealtimePhoneNumber -> normalise -> match the roster.
    // These three sentinels exist so the hard-stop UI can be exercised. F17 §二
    // offers no fallback for any of them, by design.
    if (body.phone_code === 'QUOTA') {
      return fail(res, 503, 'wechat_phone_quota_exhausted',
        '手机号验证暂时不可用，请稍后重试或联系园方');
    }
    if (body.phone_code === 'NOTONROSTER') {
      return fail(res, 403, 'identity_not_on_roster', '该手机号不在园所名册内');
    }
    if (body.phone_code === 'CONFLICT') {
      return fail(res, 409, 'identity_binding_conflict', '该手机号已绑定其他微信');
    }
    state.openidBound = true;
  }

  const token = randomUUID();
  state.sessions.set(token, { claim_id: 41, issued_at: Date.now(), role, surface: body.surface });
  return sendJson(res, 200, {
    session_token: token,
    expires_at: '2026-08-21T22:00:00+08:00',
  });
}

/** §6.4 — the whole downstream context in one call. */
function getAuthSession(req, res) {
  const session = requireSession(req, res);
  if (!session) return;
  sendJson(res, 200, {
    surface: session.surface,
    role: session.role,
    subject: TEACHER,
    scope: SCOPE,
    permissions: [],
    current_term: OPTS.noTerm ? null : TERM,
    expires_at: '2026-08-21T22:00:00+08:00',
  });
}

/**
 * §6.3 — logout. Revocation is real here rather than a generated 204, because
 * "a revoked token still works" is precisely the bug the revocation list exists
 * to prevent, and a generated route would report green while proving nothing.
 */
function deleteAuthSession(req, res) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || !state.sessions.has(token)) {
    return fail(res, 401, 'unauthenticated', '未登录或登录凭证无效');
  }
  state.revoked.add(token);
  return sendJson(res, 204, null);
}

/** §3.1 — a cursor-paginated time stream. */
function getNotices(req, res, url) {
  if (!requireSession(req, res)) return;

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 20 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return fail(res, 422, 'validation_failed', '分页参数不合法',
      { field: 'limit', rule: 'between_1_and_100' });
  }

  // No filters on this endpoint yet, but the fingerprint is computed over
  // whatever the filter set is, so adding one later cannot silently break
  // in-flight cursors.
  const filters = {};
  let startIndex = 0;
  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    const decoded = decodeCursor(cursor, filters);
    if (decoded.error) {
      return fail(res, 400, decoded.error,
        decoded.error === 'cursor_invalid' ? '翻页游标不可解' : '筛选条件已变，游标失效');
    }
    startIndex = NOTICES.findIndex((n) => n.notice_id === decoded.key) + 1;
    if (startIndex <= 0) return fail(res, 400, 'cursor_invalid', '翻页游标不可解');
  }

  const slice = NOTICES.slice(startIndex, startIndex + limit);
  const last = slice[slice.length - 1];
  const hasMore = startIndex + limit < NOTICES.length;

  // §2.1: one cursor envelope. No total — §3.1 explains that a count would need
  // a separate scan and would disagree with the pages actually walked.
  sendJson(res, 200, {
    items: slice,
    next_cursor: hasMore && last ? encodeCursor(last.notice_id, filters) : null,
  });
}

function getNotice(req, res, id) {
  if (!requireSession(req, res)) return;
  const notice = NOTICES.find((n) => n.notice_id === Number(id));
  // §2.3: absent and out-of-scope are the same 404. Returning 403 would confirm
  // the id exists, which is a leak — and worse for minors' data.
  if (!notice) return fail(res, 404, 'not_found', '通知不存在或不在可见范围内');
  sendJson(res, 200, notice);
}

/**
 * §3.1 — 党建学习列表。
 *
 * 契约 §4 规则 19 说这个集合**不搜索、不筛选**，所以筛选集恒为空，端点不收
 * `study_type`。指纹仍然算在这个空集合上：将来真加了筛选，在飞的旧游标会当场失效，
 * 而不是悄悄给出错答案（§3.3）。
 */
function getPartyStudies(req, res, url) {
  if (!requireSession(req, res)) return;

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 20 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return fail(res, 422, 'validation_failed', '分页参数不合法',
      { field: 'limit', rule: 'between_1_and_100' });
  }

  const filters = {};
  let startIndex = 0;
  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    const decoded = decodeCursor(cursor, filters);
    if (decoded.error) {
      return fail(res, 400, decoded.error,
        decoded.error === 'cursor_invalid' ? '翻页游标不可解' : '筛选条件已变，游标失效');
    }
    startIndex = PARTY_STUDIES.findIndex((s) => s.study_id === decoded.key) + 1;
    if (startIndex <= 0) return fail(res, 400, 'cursor_invalid', '翻页游标不可解');
  }

  const slice = PARTY_STUDIES.slice(startIndex, startIndex + limit);
  const last = slice[slice.length - 1];
  const hasMore = startIndex + limit < PARTY_STUDIES.length;
  sendJson(res, 200, {
    items: slice.map(toStudyCard),
    next_cursor: hasMore && last ? encodeCursor(last.study_id, filters) : null,
  });
}

function getPartyStudy(req, res, id) {
  if (!requireSession(req, res)) return;
  const study = PARTY_STUDIES.find((s) => s.study_id === Number(id));
  // §2.3: 不存在与不在可见范围内是同一个 404。回 403 会确认这个 id 存在。
  if (!study) return fail(res, 404, 'not_found', '学习资料不存在或不在可见范围内');
  sendJson(res, 200, study);
}

/**
 * §3.1 — 党建活动列表。
 *
 * 与学习资料同型：不搜索、不筛选，筛选集恒为空，指纹仍算在这个空集合上（§3.3）。
 * 契约的列表回的是完整 `PartyActivity`，没有另立一个卡片形状，所以这里原样回夹具。
 */
function getPartyActivities(req, res, url) {
  if (!requireSession(req, res)) return;

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 20 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return fail(res, 422, 'validation_failed', '分页参数不合法',
      { field: 'limit', rule: 'between_1_and_100' });
  }

  const filters = {};
  let startIndex = 0;
  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    const decoded = decodeCursor(cursor, filters);
    if (decoded.error) {
      return fail(res, 400, decoded.error,
        decoded.error === 'cursor_invalid' ? '翻页游标不可解' : '筛选条件已变，游标失效');
    }
    startIndex = PARTY_ACTIVITIES.findIndex((a) => a.activity_id === decoded.key) + 1;
    if (startIndex <= 0) return fail(res, 400, 'cursor_invalid', '翻页游标不可解');
  }

  const slice = PARTY_ACTIVITIES.slice(startIndex, startIndex + limit);
  const last = slice[slice.length - 1];
  const hasMore = startIndex + limit < PARTY_ACTIVITIES.length;
  sendJson(res, 200, {
    items: slice,
    next_cursor: hasMore && last ? encodeCursor(last.activity_id, filters) : null,
  });
}

function getPartyActivity(req, res, id) {
  if (!requireSession(req, res)) return;
  const activity = PARTY_ACTIVITIES.find((a) => a.activity_id === Number(id));
  // §2.3: 不存在与不在可见范围内是同一个 404。
  if (!activity) return fail(res, 404, 'not_found', '活动不存在或不在可见范围内');
  sendJson(res, 200, activity);
}

/** §3.1 — 品牌建设列表。业务日期是 `published_at`。 */
function getPartyBrands(req, res, url) {
  if (!requireSession(req, res)) return;

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 20 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return fail(res, 422, 'validation_failed', '分页参数不合法',
      { field: 'limit', rule: 'between_1_and_100' });
  }

  const filters = {};
  let startIndex = 0;
  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    const decoded = decodeCursor(cursor, filters);
    if (decoded.error) {
      return fail(res, 400, decoded.error,
        decoded.error === 'cursor_invalid' ? '翻页游标不可解' : '筛选条件已变，游标失效');
    }
    startIndex = PARTY_BRANDS.findIndex((b) => b.brand_id === decoded.key) + 1;
    if (startIndex <= 0) return fail(res, 400, 'cursor_invalid', '翻页游标不可解');
  }

  const slice = PARTY_BRANDS.slice(startIndex, startIndex + limit);
  const last = slice[slice.length - 1];
  const hasMore = startIndex + limit < PARTY_BRANDS.length;
  sendJson(res, 200, {
    items: slice,
    next_cursor: hasMore && last ? encodeCursor(last.brand_id, filters) : null,
  });
}

function getPartyBrand(req, res, id) {
  if (!requireSession(req, res)) return;
  const brand = PARTY_BRANDS.find((b) => b.brand_id === Number(id));
  if (!brand) return fail(res, 404, 'not_found', '品牌建设资料不存在或不在可见范围内');
  sendJson(res, 200, brand);
}

/**
 * §3.1 — 综合协调文件列表。
 *
 * 与党建三类不同的地方只有一处，但它是本模块的全部难点：`coord_category` **必填**，
 * 值域固定 c1—c7，未知值回 400（契约 §4 规则 20）。生成路由不校验查询参数，所以缺
 * 参数与未知值这两条只有手写处理器拦得住 —— 少了它们，客户端会以为服务端很宽容，
 * 到真实例上才发现不是。
 *
 * 类目是筛选集的一部分，所以它进指纹：换了类目还拿着旧游标，回
 * `cursor_filter_mismatch`，不是悄悄给出错答案（§3.3）。
 */
function getCoordDocuments(req, res, url) {
  if (!requireSession(req, res)) return;

  const category = url.searchParams.get('coord_category');
  if (category === null) {
    return fail(res, 400, 'malformed_request', '缺少必填参数 coord_category',
      { field: 'coord_category', rule: 'required' });
  }
  if (COORD_CATEGORIES.indexOf(category) === -1) {
    return fail(res, 400, 'malformed_request', '资料分类不在可选范围内',
      { field: 'coord_category', rule: 'enum_c1_to_c7' });
  }

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 20 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return fail(res, 422, 'validation_failed', '分页参数不合法',
      { field: 'limit', rule: 'between_1_and_100' });
  }

  const filters = { coord_category: category };
  const pool = COORD_DOCUMENTS.filter((d) => d.coord_category === category);
  let startIndex = 0;
  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    const decoded = decodeCursor(cursor, filters);
    if (decoded.error) {
      return fail(res, 400, decoded.error,
        decoded.error === 'cursor_invalid' ? '翻页游标不可解' : '筛选条件已变，游标失效');
    }
    startIndex = pool.findIndex((d) => d.document_id === decoded.key) + 1;
    if (startIndex <= 0) return fail(res, 400, 'cursor_invalid', '翻页游标不可解');
  }

  const slice = pool.slice(startIndex, startIndex + limit);
  const last = slice[slice.length - 1];
  const hasMore = startIndex + limit < pool.length;
  sendJson(res, 200, {
    items: slice.map(toCoordCard),
    next_cursor: hasMore && last ? encodeCursor(last.document_id, filters) : null,
  });
}

function getCoordDocument(req, res, id) {
  if (!requireSession(req, res)) return;
  const doc = COORD_DOCUMENTS.find((d) => d.document_id === Number(id));
  // §2.3: 不存在与不在可见范围内是同一个 404。
  if (!doc) return fail(res, 404, 'not_found', '资料不存在或不在可见范围内');
  sendJson(res, 200, doc);
}

/**
 * §3.1 — 资源列表。
 *
 * 两个筛选维度都可选，且**两者一起进指纹**（§3.3）：换掉任一维度还拿着旧游标，回
 * `cursor_filter_mismatch`，不是悄悄给出错答案。这是本 mock 里第一条带两个维度的
 * 列表 —— 单维度的实现「碰巧」也能通过组合筛选的测试，两维度不会。
 *
 * `grade` 是数组列，所以筛的是「包含」，不是「等于」。把它写成等于，带
 * `['k2','k3']` 的行会在筛 k2 时凭空消失。
 */
function getResources(req, res, url) {
  if (!requireSession(req, res)) return;

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 20 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return fail(res, 422, 'validation_failed', '分页参数不合法',
      { field: 'limit', rule: 'between_1_and_100' });
  }

  const tag = url.searchParams.get('resource_tag');
  if (tag !== null && RESOURCE_TAGS.indexOf(tag) === -1) {
    return fail(res, 400, 'malformed_request', '资源分类不在可选范围内',
      { field: 'resource_tag', rule: 'enum_g1_to_g5' });
  }
  const grade = url.searchParams.get('grade');
  if (grade !== null && ['k1', 'k2', 'k3'].indexOf(grade) === -1) {
    return fail(res, 400, 'malformed_request', '年级不在可选范围内',
      { field: 'grade', rule: 'enum_k1_to_k3' });
  }

  const filters = {};
  if (tag !== null) filters.resource_tag = tag;
  if (grade !== null) filters.grade = grade;

  const pool = RESOURCES.filter((r) => {
    if (tag !== null && r.resource_tag !== tag) return false;
    // 数组列筛的是包含。等于会让 ['k2','k3'] 在筛 k2 时消失。
    if (grade !== null && (r.grade || []).indexOf(grade) === -1) return false;
    return true;
  });

  let startIndex = 0;
  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    const decoded = decodeCursor(cursor, filters);
    if (decoded.error) {
      return fail(res, 400, decoded.error,
        decoded.error === 'cursor_invalid' ? '翻页游标不可解' : '筛选条件已变，游标失效');
    }
    startIndex = pool.findIndex((r) => r.resource_id === decoded.key) + 1;
    if (startIndex <= 0) return fail(res, 400, 'cursor_invalid', '翻页游标不可解');
  }

  const slice = pool.slice(startIndex, startIndex + limit);
  const last = slice[slice.length - 1];
  const hasMore = startIndex + limit < pool.length;
  sendJson(res, 200, {
    items: slice,
    next_cursor: hasMore && last ? encodeCursor(last.resource_id, filters) : null,
  });
}

function getResource(req, res, id) {
  if (!requireSession(req, res)) return;
  const resource = RESOURCES.find((r) => r.resource_id === Number(id));
  // §2.3: 不存在与不在可见范围内是同一个 404。
  if (!resource) return fail(res, 404, 'not_found', '资源不存在或不在可见范围内');
  sendJson(res, 200, { ...resource, related_cases: relatedCasesFor(resource.resource_id) });
}

/**
 * §3.1 — 案例列表。
 *
 * 三个筛选维度，**三者一起进指纹**（§3.3）：换掉任一维度还拿着旧游标，回
 * `cursor_filter_mismatch`，不是悄悄给出错答案。
 *
 * `case_area` 是数组列，所以筛的是「包含」，不是「等于」——契约的筛选参数本身是单值
 * enum，筛的却是一个多选列。把它写成等于，带 `['a3','a5']` 的行会在筛 a3 时凭空消失。
 */
function getCases(req, res, url) {
  if (!requireSession(req, res)) return;

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 20 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return fail(res, 422, 'validation_failed', '分页参数不合法',
      { field: 'limit', rule: 'between_1_and_100' });
  }

  const grade = url.searchParams.get('case_grade');
  if (grade !== null && ['k1', 'k2', 'k3'].indexOf(grade) === -1) {
    return fail(res, 400, 'malformed_request', '年级不在可选范围内',
      { field: 'case_grade', rule: 'enum_k1_to_k3' });
  }
  const field = url.searchParams.get('case_field');
  if (field !== null && CASE_FIELDS.indexOf(field) === -1) {
    return fail(res, 400, 'malformed_request', '领域不在可选范围内',
      { field: 'case_field', rule: 'enum_f1_to_f5' });
  }
  const area = url.searchParams.get('case_area');
  if (area !== null && ['a1', 'a2', 'a3', 'a4', 'a5'].indexOf(area) === -1) {
    return fail(res, 400, 'malformed_request', '活动形式不在可选范围内',
      { field: 'case_area', rule: 'enum_a1_to_a5' });
  }

  const filters = {};
  if (grade !== null) filters.case_grade = grade;
  if (field !== null) filters.case_field = field;
  if (area !== null) filters.case_area = area;

  const pool = CASES.filter((c) => {
    if (grade !== null && c.case_grade !== grade) return false;
    if (field !== null && c.case_field !== field) return false;
    // 数组列筛的是包含。等于会让 ['a3','a5'] 在筛 a3 时消失。
    if (area !== null && (c.case_area || []).indexOf(area) === -1) return false;
    return true;
  });

  let startIndex = 0;
  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    const decoded = decodeCursor(cursor, filters);
    if (decoded.error) {
      return fail(res, 400, decoded.error,
        decoded.error === 'cursor_invalid' ? '翻页游标不可解' : '筛选条件已变，游标失效');
    }
    startIndex = pool.findIndex((c) => c.case_id === decoded.key) + 1;
    if (startIndex <= 0) return fail(res, 400, 'cursor_invalid', '翻页游标不可解');
  }

  const slice = pool.slice(startIndex, startIndex + limit);
  const last = slice[slice.length - 1];
  const hasMore = startIndex + limit < pool.length;
  sendJson(res, 200, {
    items: slice,
    next_cursor: hasMore && last ? encodeCursor(last.case_id, filters) : null,
  });
}

function getCase(req, res, id) {
  if (!requireSession(req, res)) return;
  const kase = CASES.find((c) => c.case_id === Number(id));
  // §2.3: 不存在与不在可见范围内是同一个 404。
  if (!kase) return fail(res, 404, 'not_found', '案例不存在或不在可见范围内');
  sendJson(res, 200, { ...kase, related_resources: relatedResourcesFor(kase) });
}

/** `2026-10-23T09:30:00+08:00` -> `2026-10-23T23:59:59+08:00`。字符串上做，不建 Date。 */
function endOfDay(startAt) {
  return `${String(startAt).slice(0, 10)}T23:59:59+08:00`;
}

/**
 * §3.1 — 研修列表。
 *
 * `phase` 是**两区切分**，不是自由筛选：契约只认 `latest` 与 `history` 两个值，
 * 未知值回 400。生成路由不校验查询参数，所以这一条只有手写处理器拦得住。
 *
 * 分区进指纹（§3.3）：换了分区还拿着旧游标，回 `cursor_filter_mismatch`，不是悄悄
 * 给出错答案。
 *
 * 可见范围 `training_status = 's1'`：已撤回的 s5 读不到列表，只在详情读得到一个壳。
 */
function getTrainings(req, res, url) {
  if (!requireSession(req, res)) return;

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 20 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return fail(res, 422, 'validation_failed', '分页参数不合法',
      { field: 'limit', rule: 'between_1_and_100' });
  }

  const phase = url.searchParams.get('phase');
  if (phase !== null && phase !== 'latest' && phase !== 'history') {
    return fail(res, 400, 'malformed_request', '研修分区不在可选范围内',
      { field: 'phase', rule: 'latest_or_history' });
  }

  const filters = {};
  if (phase !== null) filters.phase = phase;

  const pool = TRAININGS.filter((t) => {
    if (t.training_status !== 's1') return false;
    if (phase === 'latest') return t.training_phase === 'upcoming' || t.training_phase === 'ongoing';
    // 未知的派生阶段码两区都不落：`history` 的定义是「已过有效结束时间」，把一个读不懂
    // 的码塞进历史区就是替服务端猜。不筛时它照常出现，客户端因此仍要能显示它。
    if (phase === 'history') return t.training_phase === 'history';
    return true;
  });

  let startIndex = 0;
  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    const decoded = decodeCursor(cursor, filters);
    if (decoded.error) {
      return fail(res, 400, decoded.error,
        decoded.error === 'cursor_invalid' ? '翻页游标不可解' : '筛选条件已变，游标失效');
    }
    startIndex = pool.findIndex((t) => t.training_id === decoded.key) + 1;
    if (startIndex <= 0) return fail(res, 400, 'cursor_invalid', '翻页游标不可解');
  }

  const slice = pool.slice(startIndex, startIndex + limit);
  const last = slice[slice.length - 1];
  const hasMore = startIndex + limit < pool.length;
  sendJson(res, 200, {
    items: slice.map(toTrainingCard),
    next_cursor: hasMore && last ? encodeCursor(last.training_id, filters) : null,
  });
}

/**
 * 研修详情。可见范围 `training_status IN ('s1','s5')`。
 *
 * **s5 已撤回的活动仍打得开，但只是壳**：回原标题与时间，`file_refs`／
 * `meeting_link_title`／`meeting_url`／公开回馈一律不返回（F9）。壳不写 viewed 事件，
 * 因为它不是内容供给。
 */
function getTraining(req, res, id) {
  if (!requireSession(req, res)) return;
  const training = TRAININGS.find((t) => t.training_id === Number(id));
  // §2.3: 不存在与不在可见范围内是同一个 404。
  if (!training) return fail(res, 404, 'not_found', '研修不存在或不在可见范围内');

  const effective_end_at = training.end_at || endOfDay(training.start_at);
  if (training.training_status === 's5') {
    return sendJson(res, 200, {
      training_id: training.training_id,
      training_title: training.training_title,
      training_content: training.training_content,
      start_at: training.start_at,
      end_at: training.end_at,
      effective_end_at,
      location: training.location,
      speaker: training.speaker,
      training_status: 's5',
      training_phase: training.training_phase,
      meeting_link_title: null,
      meeting_url: null,
      my_participation_status: training.my_participation_status,
      feedback_count: 0,
      file_refs: [],
    });
  }
  sendJson(res, 200, { ...training, effective_end_at });
}

/** 办园理念与课程体系的图文。契约里没有这条路径，见 COURSE_INTRO 的头注。 */
function getCourseIntro(req, res) {
  if (!requireSession(req, res)) return;
  sendJson(res, 200, COURSE_INTRO);
}

/**
 * §8.4 / F5 — 签发 30 分钟 bearer 下载短链。
 *
 * 同事务写 `db_content_access_event(link_issued)`：**记录是这一次调用的副作用**，
 * 客户端不再另发一个「我看过了」的请求。这里用一个计数器把那笔记录做成可断言的，
 * 否则「客户端不自行拼装记录请求」这条只能靠看代码，不能靠测试。
 *
 * 回的 `url` 指向我们自己的 `/dl/{link_id}`，不是对象存储。
 */
function postResourceDownloadLink(req, res, id) {
  if (!requireSession(req, res)) return;
  const resource = RESOURCES.find((r) => r.resource_id === Number(id));
  if (!resource) return fail(res, 404, 'not_found', '资源不存在或不在可见范围内');
  if (!resource.word_file_id) {
    return fail(res, 409, 'state_precondition_failed', '这条资源没有可下载的详案');
  }

  const linkId = randomUUID().replace(/-/g, '').slice(0, 24);
  downloadLinks.set(linkId, { resource_id: resource.resource_id });
  state.accessEvents.push({ link_id: linkId, resource_id: resource.resource_id, event: 'link_issued' });

  sendJson(res, 201, {
    link_id: linkId,
    url: `http://127.0.0.1:${server.address().port}/dl/${linkId}`,
    expires_at: '2026-07-16T18:30:00+08:00',
  }, { 'cache-control': 'no-store' });
}

/** 案例详案的短链。与资源那条同一份契约条文，只有前缀与目标表不同。 */
function postCaseDownloadLink(req, res, id) {
  if (!requireSession(req, res)) return;
  const kase = CASES.find((c) => c.case_id === Number(id));
  if (!kase) return fail(res, 404, 'not_found', '案例不存在或不在可见范围内');
  if (!kase.word_file_id) {
    return fail(res, 409, 'state_precondition_failed', '这条案例没有可下载的详案');
  }

  const linkId = randomUUID().replace(/-/g, '').slice(0, 24);
  downloadLinks.set(linkId, { case_id: kase.case_id });
  state.accessEvents.push({ link_id: linkId, case_id: kase.case_id, event: 'link_issued' });

  sendJson(res, 201, {
    link_id: linkId,
    url: `http://127.0.0.1:${server.address().port}/dl/${linkId}`,
    expires_at: '2026-07-16T18:30:00+08:00',
  }, { 'cache-control': 'no-store' });
}

/**
 * §8.4 — 取档服务。
 *
 * 不在 `/api/v1` 基址下，**不收 `Authorization`**：短链本身就是凭证，签发后不再验
 * session 或帐户启停。但内容状态每次都验 —— 从 s3 撤回会让已签发未到期的短链立刻
 * 失效，这正是「立刻停止新查看与下载」（F6）的落点。
 *
 * 一条短链只属于一张业务表（§8.4 的 `db_file_ref.owner_object`），所以这里按短链记的
 * 归属去查那一张表，不是两张表都试一遍。
 */
function getDownload(req, res, linkId) {
  const link = downloadLinks.get(linkId);
  if (!link) return fail(res, 404, 'not_found', '下载链接无效或已过期');

  const owner = link.case_id === undefined
    ? RESOURCES.find((r) => r.resource_id === link.resource_id)
    : CASES.find((c) => c.case_id === link.case_id);
  const status = owner && (link.case_id === undefined ? owner.resource_status : owner.case_status);
  // 逐次复核内容状态：撤回后短链当场失效，不等它自己到期。
  if (status !== 's3') {
    return fail(res, 404, 'not_found', '内容已下架，链接失效');
  }
  // 真服务在这里 302 到刚签好的短时对象存储地址；本 mock 直接把字节给出来。
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'cache-control': 'no-store',
    'x-request-id': res.__requestId,
  });
  res.end(`mock docx for ${link.case_id === undefined ? 'resource' : 'case'} ${link.case_id === undefined ? link.resource_id : link.case_id}`);
}

/** §3.5 — roster-shaped: whole, unpaginated. */
function getTodos(req, res) {
  if (!requireSession(req, res)) return;
  sendJson(res, 200, { items: TODOS });
}

/** §3.5 — the curated shelf is three rows by definition; it never pages. */
function getHomeCases(req, res) {
  if (!requireSession(req, res)) return;
  sendJson(res, 200, { items: HOME_CASES });
}

/**
 * §3.1 — 任务看板。游标分页，并带一个真实的筛选条件（`scope`），因为票据 10 要求
 * 「游标与筛选绑定，筛选变化时丢弃旧游标」——没有筛选就验证不了这条。
 *
 *   scope=current  未完成（assign_status a1/a2）
 *   scope=history  已完成（a3）
 *   缺省           全部
 */
function getTasks(req, res, url) {
  if (!requireSession(req, res)) return;

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 20 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return fail(res, 422, 'validation_failed', '分页参数不合法',
      { field: 'limit', rule: 'between_1_and_100' });
  }

  const scope = url.searchParams.get('scope') || '';
  if (scope && scope !== 'current' && scope !== 'history') {
    return fail(res, 422, 'validation_failed', '筛选条件不合法',
      { field: 'scope', rule: 'current_or_history' });
  }

  const filters = scope ? { scope } : {};
  const rows = TASKS.filter((t) => {
    if (scope === 'current') return t.assign.assign_status !== 'a3';
    if (scope === 'history') return t.assign.assign_status === 'a3';
    return true;
  });

  let startIndex = 0;
  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    const decoded = decodeCursor(cursor, filters);
    if (decoded.error) {
      return fail(res, 400, decoded.error,
        decoded.error === 'cursor_invalid' ? '翻页游标不可解' : '筛选条件已变，游标失效');
    }
    startIndex = rows.findIndex((t) => t.task_id === decoded.key) + 1;
    if (startIndex <= 0) return fail(res, 400, 'cursor_invalid', '翻页游标不可解');
  }

  const slice = rows.slice(startIndex, startIndex + limit);
  const last = slice[slice.length - 1];
  const hasMore = startIndex + limit < rows.length;
  sendJson(res, 200, {
    items: slice,
    next_cursor: hasMore && last ? encodeCursor(last.task_id, filters) : null,
  });
}

/**
 * GET /tasks/{task_id} — 契约里真实存在的端点。
 *
 * `assign` 只回调用者本人那一行；`progress` 由 assign 行实算（契约明确禁止使用
 * 原型里 52／12／6 那组常量）。§2.3：越出范围回 404，不回 403。
 */
function getTask(req, res, id) {
  if (!requireSession(req, res)) return;
  const task = TASKS.find((t) => t.task_id === Number(id));
  if (!task) return fail(res, 404, 'not_found', '任务不存在或不在可见范围内');

  const total = TASKS.length;
  const accepted = TASKS.filter((t) => t.assign.accepted_at !== null).length;
  const completed = TASKS.filter((t) => t.assign.assign_status === 'a3').length;

  sendJson(res, 200, {
    ...task,
    progress: {
      total_count: total,
      accepted_count: accepted,
      completed_count: completed,
      completion_rate: total === 0 ? 0 : Number((completed / total).toFixed(4)),
    },
    file_refs: [
      { file_id: 9001, usage_key: 'main_file', file_name: '班级实践照片打包.zip', file_size: 2483712 },
      { file_id: 9002, usage_key: 'attachment', file_name: '教师转化说明.docx', file_size: 38214 },
    ],
  });
}

/**
 * Roles for the hand-written routes, so the primitive covers them too.
 *
 * This table exists because the primitive was NOT covering them: until it was
 * added, GET /tasks/{task_id} answered 200 to a parent session. The handler
 * called requireSession and stopped there, which authenticates without
 * authorizing. That is the §7.2 failure mode written down in HANDOFF.md — a
 * rule repeated per endpoint until one endpoint forgets — and the answer is the
 * same one the contract gives: decide in one place, for every route.
 *
 * The first six entries are paths the CONTRACT DOES NOT DEFINE. The client
 * calls them and db_notification / db_home_case / db_task exist to back them,
 * but no operation was ever enumerated. They are declared teacher-only here so
 * the gate is not silently absent; the gap itself is a separate problem, filed
 * in HANDOFF.md → 契约缺口.
 */
const HAND_WRITTEN_ROLES = [
  [/^\/notices$/, ['teacher']],
  [/^\/notices\/\d+$/, ['teacher']],
  [/^\/home\/todos$/, ['teacher']],
  [/^\/home\/cases$/, ['teacher']],
  [/^\/tasks$/, ['teacher']],
  [/^\/parent-tasks$/, ['teacher']],
  [/^\/parent-tasks\/\d+\/progress$/, ['teacher']],
  // Declared by the contract; repeated here because the handler is hand-written.
  [/^\/tasks\/\d+$/, ['teacher']],
  [/^\/party\/studies$/, ['teacher']],
  [/^\/party\/studies\/\d+$/, ['teacher']],
  [/^\/party\/activities$/, ['teacher']],
  [/^\/party\/activities\/\d+$/, ['teacher']],
  [/^\/party\/brands$/, ['teacher']],
  [/^\/party\/brands\/\d+$/, ['teacher']],
  // §4 规则 20：合作园不得进入综合协调，所以 partner-account 在这里就被 403 挡下。
  [/^\/coordination\/documents$/, ['teacher']],
  [/^\/coordination\/documents\/\d+$/, ['teacher']],
  // 契约给资源三条路都写了 partner-account，但**本 mock 只服务教师端**，且合作园的
  // predicate 另有一条「规则版本未撤销」的约束，这里没有实现。所以登记为 teacher，
  // 宁可比契约严：漏登记才是安全缺陷，多登记只是这个 mock 覆盖面窄。
  [/^\/library\/resources$/, ['teacher']],
  [/^\/library\/resources\/\d+$/, ['teacher']],
  [/^\/library\/resources\/\d+\/download-link$/, ['teacher']],
  // 案例三条同理。契约给列表与详情写了 partner-account 与 admin-pc，给 download-link
  // 写了 partner-account —— 本 mock 只服务教师端，宁可比契约严：漏登记才是安全缺陷，
  // 多登记只是这个 mock 覆盖面窄。
  [/^\/library\/cases$/, ['teacher']],
  [/^\/library\/cases\/\d+$/, ['teacher']],
  [/^\/library\/cases\/\d+\/download-link$/, ['teacher']],
  // §4 规则 21：合作园不得进入教研培训，所以 partner-account 在这里就被 403 挡下。
  [/^\/trainings$/, ['teacher']],
  [/^\/trainings\/\d+$/, ['teacher']],
  // 契约**没有**这条路径，连表都没有（见 COURSE_INTRO 的头注）。登记在这里是为了让门
  // 不至于悄悄缺席 —— 缺口本身是另一个问题，记在交接里。
  [/^\/training\/course-intro$/, ['teacher']],
  [/^\/auth\/session$/, ['teacher', 'parent', 'admin-pc', 'partner-account']],
];

/**
 * The one gate every request passes, before any handler runs.
 *
 * POST /auth/session is the single exception, because it is where identity is
 * created; it is `security: []` in the contract for the same reason.
 *
 * @returns {boolean} true when the request was refused and already answered
 */
function refuseUnauthorized(req, res, path) {
  if (req.method === 'POST' && path === '/auth/session') return false;

  const entry = HAND_WRITTEN_ROLES.find(([re]) => re.test(path));
  if (!entry) return false;          // contract routes gate themselves below

  const session = requireSession(req, res);
  if (!session) return true;         // 401 already sent

  const denial = authorizeRole(session, entry[1]);
  if (denial) {
    fail(res, denial.status, denial.code, denial.message);
    return true;
  }
  return false;
}

/**
 * Everything the contract declares and no hand-written handler covers.
 *
 * Order matters and is the contract's, not convenience:
 *   1. no route matches         -> false, the caller answers 404 unknown endpoint
 *   2. the route is pre-session -> serve it (only POST /auth/session is)
 *   3. no valid session         -> 401
 *   4. role not in x-hualong-roles -> 404, never 403 (§2.3)
 *   5. otherwise                -> the declared success code and a shaped body
 *
 * Step 4 must come after step 3, or an anonymous caller would get a 404 that
 * says "no such endpoint" when the truth is "you are not logged in". Those two
 * answers must stay distinguishable to the developer even though 404 is
 * deliberately ambiguous between "absent" and "out of scope".
 *
 * @returns {Promise<boolean>} true when this function answered the request
 */
async function serveFromContract(req, res, path) {
  const { routes } = await loadRoutes();
  const route = routes.find((r) => r.method === req.method && r.regex.test(path));
  if (!route) return false;

  if (!route.isPublic) {
    const session = requireSession(req, res);
    if (!session) return true;                       // 401 already sent
    let denial;
    try {
      denial = authorizeRole(session, route.roles);
    } catch (err) {
      if (err instanceof RoleResolutionError) {
        // §7.2: fatal, never an empty rule set. 500 is honest here — the server
        // cannot decide, and deciding "allow" would be the bug this prevents.
        fail(res, 500, 'internal_error', '服务出错');
        return true;
      }
      throw err;
    }
    if (denial) {
      fail(res, denial.status, denial.code, denial.message);
      return true;
    }
  }

  sendJson(res, route.status, route.body);
  return true;
}

// ── Dispatch ───────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  res.__requestId = req.headers['x-request-id'] || `mock-${randomUUID().slice(0, 8)}`;

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, null);
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // §8.4 的取档服务**不在 `/api/v1` 基址下**，所以它必须在基址判定之前接住，否则
  // 会被下面那句当成未知路径。它也不在 HAND_WRITTEN_ROLES 里，而且不能在 ——
  // 那张表做的是「按会话查角色」，而短链签发后按契约就不再验 session 了。
  const dl = /^\/dl\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
  if (req.method === 'GET' && dl) {
    getDownload(req, res, dl[1]);
    rlog(`  ${req.method} ${url.pathname} -> ${res.statusCode}`);
    return;
  }

  const path = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : null;

  if (path === null) {
    fail(res, 404, 'not_found', `未知路径，API 基址为 ${BASE}`);
    rlog(`  ${req.method} ${url.pathname} -> ${res.statusCode}`);
    return;
  }

  try {
    // The body is read once, here, because §4's replay check needs to hash it
    // before any handler consumes the stream.
    const needsBody = req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT';
    const raw = needsBody ? await readRaw(req) : '';

    const idemKey = req.headers['idempotency-key'];
    if (idemKey && req.method === 'POST') {
      const seen = state.idempotency.get(idemKey);
      if (seen) {
        const hash = createHash('sha256').update(raw || '{}').digest('hex');
        if (hash !== seen.bodyHash) {
          // §4.3: same key, different body is almost always a client bug. Saying
          // so beats silently replaying the first result.
          fail(res, 422, 'idempotency_key_reused', '同一幂等键收到了不同的请求体');
          rlog(`  ${req.method} ${url.pathname} -> 422 (idempotency replay mismatch)`);
          return;
        }
        // §4.2: replay returns the original status and body, no side effects.
        sendJson(res, seen.status, seen.body);
        rlog(`  ${req.method} ${url.pathname} -> ${seen.status} (idempotent replay)`);
        return;
      }
      // First use of this key: mark the response so sendJson records the outcome.
      res.__idem = {
        key: idemKey,
        bodyHash: createHash('sha256').update(raw || '{}').digest('hex'),
      };
    }

    let body = {};
    if (needsBody) {
      try {
        body = parseJson(raw);
      } catch (e) {
        fail(res, 400, 'malformed_request', '请求体不是合法 JSON');
        rlog(`  ${req.method} ${url.pathname} -> 400`);
        return;
      }
    }

    if (refuseUnauthorized(req, res, path)) {
      rlog(`  ${req.method} ${url.pathname} -> ${res.statusCode}`);
      return;
    }

    if (req.method === 'POST' && path === '/auth/session') {
      postAuthSession(res, body);
    } else if (req.method === 'GET' && path === '/auth/session') {
      getAuthSession(req, res);
    } else if (req.method === 'DELETE' && path === '/auth/session') {
      deleteAuthSession(req, res);
    } else if (req.method === 'GET' && path === '/notices') {
      getNotices(req, res, url);
    } else if (req.method === 'GET' && /^\/notices\/\d+$/.test(path)) {
      getNotice(req, res, path.split('/')[2]);
    } else if (req.method === 'GET' && path === '/home/todos') {
      getTodos(req, res);
    } else if (req.method === 'GET' && path === '/home/cases') {
      getHomeCases(req, res);
    } else if (req.method === 'GET' && path === '/tasks') {
      getTasks(req, res, url);
    } else if (req.method === 'GET' && /^\/tasks\/\d+$/.test(path)) {
      getTask(req, res, path.split('/')[2]);
    } else if (req.method === 'GET' && path === '/party/studies') {
      getPartyStudies(req, res, url);
    } else if (req.method === 'GET' && /^\/party\/studies\/\d+$/.test(path)) {
      getPartyStudy(req, res, path.split('/')[3]);
    } else if (req.method === 'GET' && path === '/party/activities') {
      getPartyActivities(req, res, url);
    } else if (req.method === 'GET' && /^\/party\/activities\/\d+$/.test(path)) {
      getPartyActivity(req, res, path.split('/')[3]);
    } else if (req.method === 'GET' && path === '/party/brands') {
      getPartyBrands(req, res, url);
    } else if (req.method === 'GET' && /^\/party\/brands\/\d+$/.test(path)) {
      getPartyBrand(req, res, path.split('/')[3]);
    } else if (req.method === 'GET' && path === '/library/resources') {
      getResources(req, res, url);
    } else if (req.method === 'GET' && /^\/library\/resources\/\d+$/.test(path)) {
      getResource(req, res, path.split('/')[3]);
    } else if (req.method === 'POST' && /^\/library\/resources\/\d+\/download-link$/.test(path)) {
      postResourceDownloadLink(req, res, path.split('/')[3]);
    } else if (req.method === 'GET' && path === '/library/cases') {
      getCases(req, res, url);
    } else if (req.method === 'GET' && /^\/library\/cases\/\d+$/.test(path)) {
      getCase(req, res, path.split('/')[3]);
    } else if (req.method === 'POST' && /^\/library\/cases\/\d+\/download-link$/.test(path)) {
      postCaseDownloadLink(req, res, path.split('/')[3]);
    } else if (req.method === 'GET' && path === '/trainings') {
      getTrainings(req, res, url);
    } else if (req.method === 'GET' && /^\/trainings\/\d+$/.test(path)) {
      getTraining(req, res, path.split('/')[2]);
    } else if (req.method === 'GET' && path === '/training/course-intro') {
      getCourseIntro(req, res);
    } else if (req.method === 'GET' && path === '/coordination/documents') {
      getCoordDocuments(req, res, url);
    } else if (req.method === 'GET' && /^\/coordination\/documents\/\d+$/.test(path)) {
      getCoordDocument(req, res, path.split('/')[3]);
    } else if (req.method === 'POST' && path === '/parent-tasks') {
      postParentTask(req, res, body);
    } else if (req.method === 'GET' && /^\/parent-tasks\/\d+\/progress$/.test(path)) {
      getParentTaskProgress(req, res);
    } else if (!await serveFromContract(req, res, path)) {
      fail(res, 404, 'not_found', `未实现的端点：${req.method} ${path}`);
    }
  } catch (err) {
    // §2.4: internal_error's message must not carry a stack or SQL.
    console.error('  mock handler threw:', err);
    if (!res.headersSent) fail(res, 500, 'internal_error', '服务出错');
  }

  rlog(`  ${req.method} ${url.pathname} -> ${res.statusCode}`);
});

/**
 * Programmatic start, for the test seam. One call per process — the module
 * holds a single server instance.
 *
 * @param {object}  [o]
 * @param {number}  [o.port=0]      0 = an OS-assigned free port, so parallel
 *                                  test processes never collide
 * @param {boolean} [o.unbound]     start with no openid bound (stage-2 flow)
 * @param {boolean} [o.noTerm]      current_term = null (holiday)
 * @param {boolean} [o.quiet=true]  suppress per-request logging
 * @returns {Promise<{port:number, baseUrl:string, close:() => Promise<void>}>}
 */
export function start({ port = 0, unbound = false, noTerm = false, quiet = true } = {}) {
  OPTS.startUnbound = unbound;
  OPTS.noTerm = noTerm;
  runtime.quiet = quiet;
  state.openidBound = !unbound;
  state.sessions.clear();
  state.revoked.clear();
  state.idempotency.clear();
  state.accessEvents.length = 0;
  downloadLinks.clear();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      resolve({
        port: actual,
        baseUrl: `http://127.0.0.1:${actual}${BASE}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

// §1.2 — the exact wire format for a client-submitted scheduled time. The
// offset is a LITERAL: `Z` or any other offset is a 422 with no conversion.
const WIRE_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/;

/**
 * POST /parent-tasks — the write endpoint the contract-regression tests need:
 * a scheduled-time whitelist member (db_parent_task.start_at / due_at) plus
 * the derived-tier rule made observable.
 */
function postParentTask(req, res, body) {
  if (!requireSession(req, res)) return;
  if (!body.task_title) {
    return fail(res, 422, 'validation_failed', '填写内容不符合要求',
      { field: 'task_title', rule: 'required' });
  }
  // §1.2: whitelisted scheduled times must carry +08:00 exactly.
  for (const field of ['start_at', 'due_at']) {
    if (body[field] !== undefined && !WIRE_AT.test(body[field])) {
      return fail(res, 422, 'timestamp_not_accepted', '时间格式不被接受',
        { field, rule: 'offset_must_be_plus0800_literal' });
    }
  }
  // §7.3: derived columns are server-set; a submitted value is silently
  // ignored, never echoed. The response proves the server's own value won.
  const task = {
    parent_task_id: state.nextTaskId++,
    task_title: body.task_title,
    start_at: body.start_at || null,
    due_at: body.due_at || null,
    teacher_id: TEACHER.teacher_id,   // always the session's teacher, never the body's
    class_id: SCOPE.class_id,
  };
  return sendJson(res, 201, task);
}

/** GET /parent-tasks/:id/progress — §3.5 roster shape: whole, child_id ASC. */
function getParentTaskProgress(req, res) {
  if (!requireSession(req, res)) return;
  return sendJson(res, 200, { items: ROSTER });
}

/**
 * Test hook: flip the term live, so "the term resumes and the same page's
 * write entries come back WITHOUT a re-login" is testable against the real
 * service instead of hand-assembled state.
 */
export function setNoTerm(value) {
  OPTS.noTerm = Boolean(value);
}

/**
 * Test hook: the access events the server wrote for itself (§8.4).
 *
 * 「详案的查看或下载动作触发服务端记录，客户端不自行拼装记录请求」只有对着这份记录
 * 才断言得了：数一数它涨了几笔，再数一数客户端发了几个请求。
 */
export function accessEvents() {
  return state.accessEvents.slice();
}

// CLI behaviour, unchanged: `node mock/server.mjs [--unbound] [--no-term]`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start({
    port: PORT,
    unbound: OPTS.startUnbound,
    noTerm: OPTS.noTerm,
    quiet: false,
  }).then(({ port }) => {
    console.log(`Hualong mock API  ->  http://localhost:${port}${BASE}`);
    console.log(`  openid bound at start : ${state.openidBound}`);
    console.log(`  current_term          : ${OPTS.noTerm ? 'null (holiday)' : TERM.term_id}`);
    console.log('');
    console.log('  Send these as phone_code to exercise the login failure branches:');
    console.log('    QUOTA        -> 503 wechat_phone_quota_exhausted');
    console.log('    NOTONROSTER  -> 403 identity_not_on_roster');
    console.log('    CONFLICT     -> 409 identity_binding_conflict');
  });
}
