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
import { readFileSync } from 'node:fs';
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
  // 版式包发布了没有。**默认 false，因为事实就是一份也没发布**（ADR-0015 Follow-ups，
  // 0／12）。`--layout-pack` 与 `setLayoutPack(true)` 打开一份夹具包，用来验证「有 pack
  // 时预览排得出来」；关着它验证「没 pack 时诚实降级」。
  layoutPack: ARGV.has('--layout-pack'),
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
// `read_at` is db_notification's own column; the newest three are unread, so
// the 首页 quick-entry badge (unread_notice_count on GET /home/todos) has a
// non-zero fixture to count.
const NOTICES = Array.from({ length: 26 }, (_, i) => {
  const id = 26 - i;
  const day = String(20 - (i % 20)).padStart(2, '0');
  return {
    notice_id: id,
    notice_title: NOTICE_TITLES[i % NOTICE_TITLES.length],
    notice_body: NOTICE_BODY,
    published_at: `2026-08-${day}T09:${String(10 + (i % 45)).padStart(2, '0')}:00+08:00`,
    read_at: i < 3 ? null : `2026-08-${day}T12:00:00+08:00`,
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

// 票据 11 的写入面会真的改上面这些 assign 行，所以开服时要还原 —— 否则一个测试
// 文件里的提交会渗进下一个，两边都是对的却一起变红。
const TASK_ASSIGN_SNAPSHOT = TASKS.map((t) => ({ ...t.assign }));

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
    // 驳回原因。`db_review_action.decision_reason` 是它真正的家（F6：驳回原因可空），
    // 而契约的 `Resource` schema **没有**这一列，也没有任何端点把它交给作者。
    // 这是一个契约缺口：票据 15 要求「驳回时看到原因」，契约给不出。这里按缺口实现，
    // 与 `related_cases`／`/home/cases` 同类 —— **只在本地契约服务上成立，接真服务时
    // 必须重对**。列名照抄 DDL，好让接线的人一眼看出它该从哪张表来。
    decision_reason: id === 7 ? '资源解读缺少幼儿经验的落点，请补充一段可观察的活动线索后重新提交。' : null,
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
    // 驳回原因，与资源同一个契约缺口，见 RESOURCES 里那一段。
    decision_reason: id === 8 ? '活动转化只写了流程，没有写幼儿在其中获得了什么经验，请补充后重新提交。' : null,
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

// 票据 15 的写入面会真的改上面这两批行，并且会往后追加新建的草稿，所以开服时要还原
// —— 与 TASK_ASSIGN_SNAPSHOT 同一个理由：一个测试文件里的提交渗进下一个，两边都是对的
// 却一起变红。数组是 const，所以还原改的是内容与长度，不是绑定。
const RESOURCE_SNAPSHOT = RESOURCES.map((r) => ({ ...r }));
const CASE_SNAPSHOT = CASES.map((c) => ({ ...c }));

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
    // `db_training_participation.participation_status`：s1=已报名｜s2=已取消｜
    // s3=已完成。**提交研修反馈的前置条件是 s3 加上研修已结束**（契约的
    // `submitTrainingFeedback` scope 逐字：`participation_status='s3' AND
    // $now > effective_end_at`），所以夹具必须把四种组合都摆出来，否则票据 16 的
    // 拒绝分支一条也验证不了：
    //   已结束 ＋ s3   -> 可以提交（偶数号：22／20／18／16／…，其中 20 号另已撤回）
    //   已结束 ＋ s2   -> 取消过报名，不能提交（21／17／13／9／5）
    //   未结束 ＋ s1   -> 报了名但还没结束，不能提交（44／40／36／32／28／24）
    //   其余           -> 没报名，不能提交
    //
    // 可提交的那一档给了十条以上，不是三四条：`UNIQUE(training_id, teacher_id)` 是
    // 一人一场一份，每个会真的提交的测试用例都得占掉一号，共用一号的第二个用例会撞
    // 409 而不是测到它想测的东西。
    my_participation_status: phase === 'history'
      ? (id % 2 === 0 ? 's3' : (id % 4 === 1 ? 's2' : null))
      : (id % 4 === 0 ? 's1' : null),
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

// db_training_feedback —— 研修反馈。**公开流只收 `feedback_status='s3'`，且只在活动
// `training_status='s1'` 时公开**（契约的 `listTrainingFeedback` scope 逐字如此）。
// 夹具给 16 号与 12 号各挂几条已公开的同事反馈，好让「意见有明确的去处」在页面上看得
// 见；教师自己新提交的那一条是 s2 待审核，**按契约不进这个流**，也没有任何端点查得到
// 它的状态（F9 的 Q58-ap1）。
//
// 真名公开：`teacher_name` 由服务端从 `teacher_id` 即时读，不另存姓名快照（F9）。
const FEEDBACK_TEXTS = [
  '课程游戏化的三个案例都能直接搬回班级，特别是材料投放那一段，回去就试了。',
  '希望下一次多留一些分组研讨的时间，前面的讲授可以再压缩一点。',
  '观察记录的表格很好用，但对新教师来说条目还是偏多，建议先给一个简版。',
  '把本班上周的活动照片带来对照着讨论，收获比单纯听讲大很多。',
];

const TRAINING_FEEDBACKS = [
  { feedback_id: 301, training_id: 16, teacher_id: 21, teacher_name: '李慧', feedback_status: 's3', feedback_text: FEEDBACK_TEXTS[0], published_at: '2026-06-18T10:20:00+08:00' },
  { feedback_id: 302, training_id: 16, teacher_id: 34, teacher_name: '梁美玲', feedback_status: 's3', feedback_text: FEEDBACK_TEXTS[1], published_at: '2026-06-17T16:05:00+08:00' },
  { feedback_id: 303, training_id: 16, teacher_id: 45, teacher_name: '周敏', feedback_status: 's3', feedback_text: FEEDBACK_TEXTS[2], published_at: '2026-06-17T09:40:00+08:00' },
  { feedback_id: 304, training_id: 12, teacher_id: 21, teacher_name: '李慧', feedback_status: 's3', feedback_text: FEEDBACK_TEXTS[3], published_at: '2026-06-14T11:00:00+08:00' },
  // 一条待审核的：它属于另一位教师，**不得**出现在公开流里。少了它，「只收 s3」这条
  // 断言在一个只回全部行的实现上也会通过。
  { feedback_id: 305, training_id: 16, teacher_id: 58, teacher_name: '何静怡', feedback_status: 's2', feedback_text: '这一条还在待审核，不该出现在公开流里。', published_at: null },
  // 20 号研修已撤回：即使回馈列还在，公开流也回 `[]`、计数 0（F9）。
  { feedback_id: 306, training_id: 20, teacher_id: 21, teacher_name: '李慧', feedback_status: 's3', feedback_text: '这一条挂在已撤回的研修上，公开流必须当它不存在。', published_at: '2026-06-10T15:30:00+08:00' },
];

const TRAINING_FEEDBACK_SNAPSHOT = TRAINING_FEEDBACKS.map((f) => ({ ...f }));

// 报名／取消报名会改 `my_participation_status`，与任务那边同一个理由：一个测试文件里的
// 报名渗进下一个，两边都是对的却一起变红。
const TRAINING_PARTICIPATION_SNAPSHOT = TRAININGS.map((t) => t.my_participation_status);

// db_teacher_profile ＋ db_teacher_credential —— 教师专业档案（G45 已拍板：申请制）。
// 逐格照 screens/teacher-profile.html 的取值，只是编码化：原型写「一级」「本科」「主班」。
const TEACHER_PROFILE = {
  teacher_id: 12,
  professional_title: '一级',
  education_level: 'e3',
  job_role: 'j1',
  career_summary: null,
  // 契约把这两列标了 x-hualong-blocked-on: G45 —— 原型的「教龄 8 年」「在园 5 年」
  // 在任何一张表里都没有列。服务端回 null，客户端按 null 不画那两行。
  first_taught_at: null,
  joined_school_at: null,
};

const TEACHER_CREDENTIALS = [
  { credential_id: 601, credential_type: 'c1', credential_name: '本科学历证书 · 心理学',
    credential_level: null, file_id: 9601, file_name: '本科学历证书 · 心理学.pdf' },
  { credential_id: 602, credential_type: 'c1', credential_name: '硕士学历证书 · 学前教育学',
    credential_level: null, file_id: 9602, file_name: '硕士学历证书 · 学前教育学.pdf' },
  { credential_id: 603, credential_type: 'c2', credential_name: '幼儿园教师资格证',
    credential_level: null, file_id: 9603, file_name: '幼儿园教师资格证.pdf' },
  { credential_id: 604, credential_type: 'c2', credential_name: '普通话水平测试二级甲等证书',
    credential_level: null, file_id: 9604, file_name: '普通话水平测试二级甲等证书.pdf' },
  { credential_id: 605, credential_type: 'c3', credential_name: '区级课程案例一等奖',
    credential_level: 'l2', file_id: 9605, file_name: '区级课程案例一等奖.pdf' },
  { credential_id: 606, credential_type: 'c3', credential_name: '园本课程资源共建优秀教师',
    credential_level: 'l1', file_id: 9606, file_name: '园本课程资源共建优秀教师.pdf' },
];

// 修改申请。开服时是空的：夹具里没有待审申请，页面因此不显示那一行提示。
const PROFILE_CHANGES = [];

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

// db_upload_action (01 home-spec.md, persist=0) — the latest upload record's
// status, mirrored from db_resource/db_case. One hand-written value: the 首页
// 传 card shows the mapped label, never this code.
const HOME_UPLOAD_STATUS = 's2';

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
  nextFileId: 8800,             // POST /media/files assigns from here
  nextResourceId: 900,          // POST /library/resources assigns from here
  nextCaseId: 900,              // POST /library/cases assigns from here
  nextFeedbackId: 900,          // POST /trainings/{id}/feedback assigns from here
  nextMomentId: 900,            // POST /moments assigns from here
  nextParentTaskId: 600,        // POST /home-school/parent-tasks assigns from here
  nextChildAssessmentId: 700,   // 首次评分建主记录时从这里取号
  // 每一次真正执行的逐题作答。与 taskCompletions 同一个理由：幂等重放在分发层就
  // 返回了，处理器根本没跑，所以「重复提交只产生一次」要数服务端做了几次。
  assessmentScores: [],
  nextTeacherMessageId: 950,    // POST /home-school/teacher-messages 取号
  nextParentEvaluationRoundId: 750, // POST /home-school/parent-evaluations 取号
  // 每一次真正执行的寄语写入与家长评价发起。与 taskCompletions 同一个理由：幂等重放
  // 在分发层就返回了，处理器根本没跑，所以「重复点击只产生一份」要数服务端做了几次。
  teacherMessageWrites: [],
  parentEvaluationPublications: [],
  nextMonthEvalId: 700,         // PUT /home-school/month-evals 首次 upsert 时取号
  nextTermEvalId: 800,          // PUT /children/{id}/term-evaluation 取号
  nextCompilationId: 300,       // POST /teacher/growth-book/compilation 取号
  nextSectionId: 400,           // POST /teacher/growth-book/sections 取号
  nextWidgetId: 5000,           // PUT …/sections/{id}/widgets 给新增 widget 取号
  nextGrowthBookId: 200,        // POST /teacher/growth-book/books 取号
  // 每一次真正执行的 e1|e2 -> e3、NONE -> c1 与 b1 -> b2。与 taskCompletions 同一个理由：
  // 幂等重放在分发层就返回了，处理器根本没跑，所以「重复点击只产生一份」要数服务端做了
  // 几次，不能数客户端发了几个请求。
  monthEvalPublications: [],
  termEvalWrites: [],
  bookPublications: [],
  // child_id -> 一份综合评估。**草稿要真的存得住**：教师填一半退出再进来，读回来的
  // 必须是刚才那些题。所以它活在这里，而不是每次请求现造。
  childAssessments: new Map(),
  // 每一次真正执行的 c2 -> c1。与 taskCompletions 同一个理由：幂等重放在分发层就返回
  // 了，处理器根本没跑，所以「重复提交只产生一份」要数服务端做了几次。
  childAssessmentCompletions: [],
  uploadTickets: new Map(),     // upload_ticket -> { usage_key, content_type, byte_size }
  // 每一次真正执行的 a2 -> a3。幂等重放不进这张表，所以「重复点击只产生一条提交」
  // 数得出来 —— 与 accessEvents 同一个理由：断言要对着服务端自己的记录，不是对着
  // 客户端发了几个请求。
  taskCompletions: [],
  // 每一次真正执行的 s1 -> s2（资源与案例各记一条）。与 taskCompletions 同一个理由：
  // 幂等重放在分发层就返回了，处理器根本没跑，所以数客户端发了几个请求答不了
  // 「重复点击有没有产生两条待审核记录」，数服务端做了几次才行。
  librarySubmissions: [],
  // 每一次真正执行的研修反馈提交。同上。
  trainingFeedbackWrites: [],
  // 每一次真正执行的 s1 -> s3 发布（在园时光）与 s1 -> s2 发布（亲子任务）。
  // 与 taskCompletions 同一个理由：幂等重放在分发层就返回了，处理器根本没跑，所以
  // 「重复点击只产生一条」要数服务端做了几次，不能数客户端发了几个请求。
  momentPublications: [],
  parentTaskPublications: [],
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

// 入口页三个分区各取几条。契约只说「三类各回最新若干条」，没有定数；三是原型的
// 张数，也是轮播的上限，两处用同一个数就不会有一处先变。
const PARTY_HOME_LIMIT = 3;

/**
 * §4 规则 19 — 党建管理入口页的聚合读取（`db_party_home`，persist=0）。
 *
 * 生成路由本来就答这条路径，但它按模式造样本，四个数组各回一条 `"sample"`，
 * 拼不出一张卡片。所以这里手写，从三个集合的夹具派生。
 *
 * **轮播是派生结果，不是可管理的推荐清单。** F7 拔掉的是 `db_party_feature`
 * 那张挑选表，轮播本身留着：查本园 `study_status='s3'`，按
 * `published_at DESC, study_id DESC` 取 3，不足就回实际笔数 —— 所以这里是
 * 一次 slice，没有手工排序、排期或跨类型混排。
 *
 * 三个集合的夹具已经按各自的业务日期降序排好（列表端点也直接切片它们），
 * 所以取最新几条就是取开头几条。
 *
 * 本端点不写 `db_content_access_event`：事件只在成功打开详情时插入（规则 19）。
 */
function getPartyHome(req, res) {
  if (!requireSession(req, res)) return;
  sendJson(res, 200, {
    carousel: PARTY_STUDIES.slice(0, PARTY_HOME_LIMIT).map(toStudyCard),
    latest_studies: PARTY_STUDIES.slice(0, PARTY_HOME_LIMIT).map(toStudyCard),
    // 契约的活动与品牌都没有另立卡片形状，回的就是完整对象，所以这里原样切片。
    latest_activities: PARTY_ACTIVITIES.slice(0, PARTY_HOME_LIMIT),
    latest_brands: PARTY_BRANDS.slice(0, PARTY_HOME_LIMIT),
  });
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
 * GET /training/home —— 教研培训入口页的聚合读取（`db_training_home`，persist=0）。
 *
 * **契约里没有这条路径**，与 `/party/home` 不同：那一条契约有，只是从没人调。这一条
 * 是缺口，只在本地契约服务上成立，接真服务时必须重对。字段名照 04 training-center-spec.md
 * 的 method 段落取（`featured`／`resource_list`／`case_list`），好让接线的人对得上。
 *
 * 推荐清单是**管理员挑的**（`db_training_recommendation`，p2 只放资源、p3 只放案例），
 * 不是按教师算的（ADR-0011：没有画像、没有排序信号）。这里用固定的推荐行模拟那张表，
 * 再 JOIN 资源与案例的夹具——JOIN 的结果就是把两边的列并到一行，所以这里也这么回。
 *
 * spec 的三条 method 逐条照做：
 *   featured      = p2 与 p3 的并集，按 updated_at DESC 取 3，**可混型别、可与下面重复**
 *   resource_list = p2 JOIN 已发布资源（s3），取 3
 *   case_list     = p3 JOIN 已发布案例（s3），取 3
 * 三者为空时各回 `[]`（spec 的 production_*_response）。
 */
const TRAINING_RECOMMENDATIONS = [
  { training_recommendation_id: 401, content_type: 'c1', placement: 'p2', resource_id: 30, case_id: null, updated_at: '2026-07-16T20:00:00+08:00' },
  { training_recommendation_id: 402, content_type: 'c2', placement: 'p3', resource_id: null, case_id: 120, updated_at: '2026-07-16T18:00:00+08:00' },
  { training_recommendation_id: 403, content_type: 'c1', placement: 'p2', resource_id: 29, case_id: null, updated_at: '2026-07-16T16:00:00+08:00' },
  { training_recommendation_id: 404, content_type: 'c2', placement: 'p3', resource_id: null, case_id: 119, updated_at: '2026-07-16T14:00:00+08:00' },
  { training_recommendation_id: 405, content_type: 'c1', placement: 'p2', resource_id: 28, case_id: null, updated_at: '2026-07-16T12:00:00+08:00' },
  { training_recommendation_id: 406, content_type: 'c2', placement: 'p3', resource_id: null, case_id: 118, updated_at: '2026-07-16T10:00:00+08:00' },
  // 指向一条**未发布**的资源：`resource_status=s1`（草稿）。三条 method 都要求
  // JOIN 已通过的内容，所以它一条也不该出现——少了它，「只收 s3」在一个不过滤的
  // 实现上也会通过。
  { training_recommendation_id: 407, content_type: 'c1', placement: 'p2', resource_id: 3, case_id: null, updated_at: '2026-07-16T08:00:00+08:00' },
  // is_visible=0：管理员取消了推荐。同理，一条也不该出现。
  { training_recommendation_id: 408, content_type: 'c2', placement: 'p3', resource_id: null, case_id: 117, updated_at: '2026-07-16T06:00:00+08:00', is_visible: false },
];

const TRAINING_HOME_LIMIT = 3;

function joinRecommendation(rec) {
  if (rec.is_visible === false) return null;
  if (rec.content_type === 'c1') {
    const resource = RESOURCES.find((r) => r.resource_id === rec.resource_id);
    if (!resource || resource.resource_status !== 's3') return null;
    return { training_recommendation_id: rec.training_recommendation_id, content_type: 'c1', ...resource };
  }
  const kase = CASES.find((c) => c.case_id === rec.case_id);
  if (!kase || kase.case_status !== 's3') return null;
  return { training_recommendation_id: rec.training_recommendation_id, content_type: 'c2', ...kase };
}

function getTrainingHome(req, res) {
  if (!requireSession(req, res)) return;
  const active = TRAINING_RECOMMENDATIONS.filter((r) => r.is_visible !== false);
  const joined = (rows) => rows.map(joinRecommendation).filter(Boolean).slice(0, TRAINING_HOME_LIMIT);
  sendJson(res, 200, {
    featured: joined(active),
    resource_list: joined(active.filter((r) => r.placement === 'p2')),
    case_list: joined(active.filter((r) => r.placement === 'p3')),
  });
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
/**
 * GET /home/todos — the db_home aggregate (01 home-spec.md, persist=0). Since
 * the 2026-08-26 redesign the 首页 renders three stat cards, so this returns
 * the counts behind them rather than a row list:
 *
 *   upload_status        传 — latest upload record status (db_upload_action)
 *   pending_task_count   办 — COUNT assign_status IN (a1,a2), spec line 89
 *   completed_count /    评 — children whose comprehensive assessment is done,
 *   required_count            over the class roster
 *   unread_notice_count  通知入口角标 — COUNT db_notification.read_at IS NULL
 *
 * Computed from the live fixtures, so a task completion or an assessment
 * submission moves the numbers the way the real aggregate would.
 */
function getTodos(req, res) {
  if (!requireSession(req, res)) return;
  sendJson(res, 200, {
    upload_status: HOME_UPLOAD_STATUS,
    pending_task_count: TASKS.filter((t) => ['a1', 'a2'].includes(t.assign.assign_status)).length,
    // 评 = **办园质量评估**（`db_assessment`，120 题），不是幼儿综合评估。首页那张卡
    // 指的一直是它（spec 的 `home.todo.assessment.badge.denominator`）。
    assessment_completed_count: assessmentCompletedCount(ASSESSMENTS[0].assessment_id),
    assessment_required_count: QUALITY_REQUIRED_COUNT,
    // 那张卡是**带着既有 assessment_id 跳转的**（契约原话），所以聚合里给出编号。
    // 契约没有创建端点，客户端也就不该在没有编号时自己开一份。
    assessment_id: ASSESSMENTS[0].assessment_id,
    unread_notice_count: NOTICES.filter((n) => !n.read_at).length,
  });
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
  // 票据 17 的在园时光。契约给这六条写的都是 teacher（列表是 teacher｜parent｜
  // admin-pc，但本 mock 只服务教师端，宁可比契约严：漏登记才是安全缺陷）。
  [/^\/moments$/, ['teacher']],
  [/^\/moments\/weekly-coverage$/, ['teacher']],
  [/^\/moments\/\d+$/, ['teacher']],
  [/^\/moments\/\d+\/publication$/, ['teacher']],
  [/^\/moments\/\d+\/withdrawal$/, ['teacher']],
  [/^\/moments\/\d+\/restoration$/, ['teacher']],
  // 票据 19 的亲子任务。契约给这五条写的就是 teacher。
  [/^\/home-school\/parent-tasks$/, ['teacher']],
  [/^\/home-school\/parent-tasks\/\d+$/, ['teacher']],
  [/^\/home-school\/parent-tasks\/\d+\/publication$/, ['teacher']],
  [/^\/home-school\/parent-tasks\/\d+\/closure$/, ['teacher']],
  [/^\/home-school\/parent-tasks\/\d+\/submissions$/, ['teacher']],
  // 契约**没有**这条路径（教师端名册端点缺席，见 getClassRoster 头注）。登记在这里
  // 是为了让门不至于悄悄缺席 —— 缺口本身是另一个问题，记在交接里。
  [/^\/org\/class-roster$/, ['teacher']],
  // Declared by the contract; repeated here because the handler is hand-written.
  [/^\/tasks\/\d+$/, ['teacher']],
  // 票据 11 的写入面。契约给这两条写的就是 teacher。
  [/^\/tasks\/\d+\/acceptance$/, ['teacher']],
  [/^\/tasks\/\d+\/completion$/, ['teacher']],
  // 契约给媒体两条路写的是 teacher｜parent｜admin-pc，但**本 mock 只服务教师端**。
  // 登记为 teacher，宁可比契约严：漏登记才是安全缺陷，多登记只是覆盖面窄。
  [/^\/media\/upload-credentials$/, ['teacher']],
  [/^\/media\/files$/, ['teacher']],
  [/^\/party\/home$/, ['teacher']],
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
  // 票据 15 的写入面。契约给这四条写的就是 teacher（新建、改草稿、提交审核、撤回）。
  [/^\/library\/resources\/\d+\/submission$/, ['teacher']],
  [/^\/library\/resources\/\d+\/withdrawal$/, ['teacher']],
  // 案例三条同理。契约给列表与详情写了 partner-account 与 admin-pc，给 download-link
  // 写了 partner-account —— 本 mock 只服务教师端，宁可比契约严：漏登记才是安全缺陷，
  // 多登记只是这个 mock 覆盖面窄。
  [/^\/library\/cases$/, ['teacher']],
  [/^\/library\/cases\/\d+$/, ['teacher']],
  [/^\/library\/cases\/\d+\/download-link$/, ['teacher']],
  [/^\/library\/cases\/\d+\/submission$/, ['teacher']],
  [/^\/library\/cases\/\d+\/withdrawal$/, ['teacher']],
  // §4 规则 21：合作园不得进入教研培训，所以 partner-account 在这里就被 403 挡下。
  [/^\/trainings$/, ['teacher']],
  [/^\/trainings\/\d+$/, ['teacher']],
  // 票据 16 的写入面与它的公开回馈流。契约给这两条写的都是 teacher。
  // 2026-08-27 按原型补建的报名入口。契约给这两条写的就是 teacher。
  [/^\/teacher\/growth-book\/sections$/, ['teacher']],
  [/^\/teacher-profile$/, ['teacher']],
  [/^\/teacher-profile\/changes$/, ['teacher']],
  [/^\/training-participations$/, ['teacher']],
  [/^\/trainings\/\d+\/registration$/, ['teacher']],
  [/^\/trainings\/\d+\/registration-cancellation$/, ['teacher']],
  [/^\/trainings\/\d+\/feedback$/, ['teacher']],
  // 契约**没有**这两条路径。`course-intro` 连表都没有（见 COURSE_INTRO 的头注）；
  // `home` 有 spec 04 的 `db_training_home` 撑着，只是没有登记操作。登记在这里是为了
  // 让门不至于悄悄缺席 —— 缺口本身是另一个问题，记在交接里。
  [/^\/training\/course-intro$/, ['teacher']],
  [/^\/training\/home$/, ['teacher']],
  // 票据 18 的五大领域量表与综合评估。契约给这六条写的都是 teacher。
  // `/scales/...` 的正则收全部量表版本，不只收现役那一版：门要覆盖整条路径，处理器
  // 才按版本挑。漏登记是安全缺陷，多登记只是覆盖面窄。
  [/^\/scales\/[^/]+\/[^/]+$/, ['teacher']],
  [/^\/child-assessments$/, ['teacher']],
  [/^\/child-assessments\/class-report$/, ['teacher']],
  [/^\/children\/\d+\/child-assessment$/, ['teacher']],
  [/^\/children\/\d+\/child-assessment\/items\/[^/]+$/, ['teacher']],
  [/^\/children\/\d+\/child-assessment\/report$/, ['teacher']],
  // 票据 20 的月度评价、学期评价与成长档案。契约给这六条写的都是 teacher。
  [/^\/home-school\/month-evals$/, ['teacher']],
  [/^\/home-school\/month-evals\/\d+\/publication$/, ['teacher']],
  [/^\/term-evaluations$/, ['teacher']],
  [/^\/children\/\d+\/term-evaluation$/, ['teacher']],
  [/^\/growth-records$/, ['teacher']],
  [/^\/children\/\d+\/growth-record$/, ['teacher']],
  // 成长档案这条链（2026-08-26 按原型建）。**契约里一条也没有** —— 对象定义在
  // spec 05 里，`openapi.yaml` 的 149 个操作里搜不到。登记在这里是为了让门不至于
  // 悄悄缺席；缺口本身逐条记在交接里。
  // 办园质量评估。**契约里有这三条**（listAssessments／getAssessment／
  // scoreAssessmentItem），手写是因为生成路由回的样本拼不出一份评估。
  [/^\/assessments$/, ['teacher']],
  [/^\/assessments\/\d+$/, ['teacher']],
  [/^\/assessments\/\d+\/items\/[^/]+$/, ['teacher']],
  [/^\/home-school\/home$/, ['teacher']],
  [/^\/home-school\/teacher-eval$/, ['teacher']],
  [/^\/home-school\/teacher-messages$/, ['teacher']],
  [/^\/home-school\/teacher-messages\/\d+$/, ['teacher']],
  [/^\/home-school\/parent-evaluations$/, ['teacher']],
  [/^\/home-school\/parent-evaluations\/\d+$/, ['teacher']],
  [/^\/home-school\/community-feed$/, ['teacher']],
  // 票据 21 的成长册。前八条契约写的就是 teacher；**后两条契约写的是 teacher｜parent**
  // （预览与家长查看共用同一条路径），但本 mock 只服务教师端，登记为 teacher —— 宁可比
  // 契约严：漏登记才是安全缺陷，多登记只是这个 mock 覆盖面窄。
  [/^\/teacher\/growth-book\/compilation$/, ['teacher']],
  [/^\/teacher\/growth-book\/compilation\/\d+$/, ['teacher']],
  [/^\/teacher\/growth-book\/compilation\/\d+\/lock$/, ['teacher']],
  [/^\/teacher\/growth-book\/sections$/, ['teacher']],
  [/^\/teacher\/growth-book\/sections\/\d+$/, ['teacher']],
  [/^\/teacher\/growth-book\/sections\/\d+\/widgets$/, ['teacher']],
  [/^\/teacher\/growth-book\/books$/, ['teacher']],
  [/^\/teacher\/growth-book\/books\/\d+\/publication$/, ['teacher']],
  [/^\/teacher\/growth-book\/precheck$/, ['teacher']],
  [/^\/growth-book\/books\/\d+\/manifest$/, ['teacher']],
  [/^\/growth-book\/books\/\d+\/pages\/\d+$/, ['teacher']],
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
    // Private Network Access: a page served from https://chao0s.github.io asking
    // 127.0.0.1 is a public-to-private request, and Chrome holds the preflight
    // until the target opts in. Without this header the published Swagger UI's
    // Try-it-out hangs -- not blocked, not refused, just never answered.
    sendJson(res, 204, null, { 'access-control-allow-private-network': 'true' });
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

  // §8.1 的对象存储同样**不在 `/api/v1` 基址下**，理由与短链一样：字节不经过 API
  // 实例，所以它连基址都不共享。也不进 HAND_WRITTEN_ROLES —— 客户端拿的是凭证，
  // 不是会话。
  if (req.method === 'POST' && url.pathname === '/cos/') {
    postCosObject(req, res, await readRaw(req));
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

    // §4.1 的幂等键不是 POST 专属：`PUT …/child-assessment/items/{item_id}` 在契约上
    // 也声明了 `Idempotency-Key` 参数，而末题那一次 PUT 就是提交。只认 POST 会让
    // 「重复提交按幂等键回原始状态码与原始响应体」在这条路径上根本不成立。
    const idemKey = req.headers['idempotency-key'];
    if (idemKey && (req.method === 'POST' || req.method === 'PUT')) {
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
    } else if (req.method === 'POST' && /^\/tasks\/\d+\/acceptance$/.test(path)) {
      postTaskAcceptance(req, res, path.split('/')[2]);
    } else if (req.method === 'POST' && /^\/tasks\/\d+\/completion$/.test(path)) {
      postTaskCompletion(req, res, path.split('/')[2], body);
    } else if (req.method === 'POST' && path === '/media/upload-credentials') {
      postUploadCredentials(req, res, body);
    } else if (req.method === 'POST' && path === '/media/files') {
      postMediaFile(req, res, body);
    } else if (req.method === 'GET' && path === '/party/home') {
      getPartyHome(req, res);
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
    } else if (req.method === 'POST' && path === '/library/resources') {
      postLibraryDraft(req, res, 'resource', body);
    } else if (req.method === 'PATCH' && /^\/library\/resources\/\d+$/.test(path)) {
      patchLibraryDraft(req, res, 'resource', path.split('/')[3], body);
    } else if (req.method === 'POST' && /^\/library\/resources\/\d+\/submission$/.test(path)) {
      postLibrarySubmission(req, res, 'resource', path.split('/')[3]);
    } else if (req.method === 'POST' && /^\/library\/resources\/\d+\/withdrawal$/.test(path)) {
      postLibraryWithdrawal(req, res, 'resource', path.split('/')[3]);
    } else if (req.method === 'GET' && path === '/library/cases') {
      getCases(req, res, url);
    } else if (req.method === 'GET' && /^\/library\/cases\/\d+$/.test(path)) {
      getCase(req, res, path.split('/')[3]);
    } else if (req.method === 'POST' && /^\/library\/cases\/\d+\/download-link$/.test(path)) {
      postCaseDownloadLink(req, res, path.split('/')[3]);
    } else if (req.method === 'POST' && path === '/library/cases') {
      postLibraryDraft(req, res, 'case', body);
    } else if (req.method === 'PATCH' && /^\/library\/cases\/\d+$/.test(path)) {
      patchLibraryDraft(req, res, 'case', path.split('/')[3], body);
    } else if (req.method === 'POST' && /^\/library\/cases\/\d+\/submission$/.test(path)) {
      postLibrarySubmission(req, res, 'case', path.split('/')[3]);
    } else if (req.method === 'POST' && /^\/library\/cases\/\d+\/withdrawal$/.test(path)) {
      postLibraryWithdrawal(req, res, 'case', path.split('/')[3]);
    } else if (req.method === 'GET' && path === '/teacher-profile') {
      getTeacherProfile(req, res);
    } else if (req.method === 'GET' && path === '/teacher-profile/changes') {
      getProfileChanges(req, res, url);
    } else if (req.method === 'POST' && path === '/teacher-profile/changes') {
      postProfileChange(req, res, body);
    } else if (req.method === 'GET' && path === '/training-participations') {
      getMyParticipations(req, res, url);
    } else if (req.method === 'GET' && path === '/trainings') {
      getTrainings(req, res, url);
    } else if (req.method === 'GET' && /^\/trainings\/\d+$/.test(path)) {
      getTraining(req, res, path.split('/')[2]);
    } else if (req.method === 'POST' && /^\/trainings\/\d+\/registration$/.test(path)) {
      postTrainingRegistration(req, res, path.split('/')[2]);
    } else if (req.method === 'POST' && /^\/trainings\/\d+\/registration-cancellation$/.test(path)) {
      postTrainingCancellation(req, res, path.split('/')[2]);
    } else if (req.method === 'POST' && /^\/trainings\/\d+\/feedback$/.test(path)) {
      postTrainingFeedback(req, res, path.split('/')[2], body);
    } else if (req.method === 'GET' && /^\/trainings\/\d+\/feedback$/.test(path)) {
      getTrainingFeedback(req, res, path.split('/')[2], url);
    } else if (req.method === 'GET' && path === '/training/home') {
      getTrainingHome(req, res);
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
    } else if (req.method === 'GET' && path === '/org/class-roster') {
      getClassRoster(req, res);
    } else if (req.method === 'GET' && path === '/moments/weekly-coverage') {
      // 这一条必须排在 `/moments/{id}` 之前：`weekly-coverage` 不是一个 moment_id，
      // 但按顺序分发时先匹配到哪一条，靠的是这里的次序，不是正则的精确度。
      getMomentWeeklyCoverage(req, res, url);
    } else if (req.method === 'GET' && path === '/moments') {
      getMoments(req, res, url);
    } else if (req.method === 'POST' && path === '/moments') {
      postMoment(req, res, body);
    } else if (req.method === 'PATCH' && /^\/moments\/\d+$/.test(path)) {
      patchMoment(req, res, path.split('/')[2], body);
    } else if (req.method === 'POST' && /^\/moments\/\d+\/publication$/.test(path)) {
      postMomentPublication(req, res, path.split('/')[2]);
    } else if (req.method === 'POST' && /^\/moments\/\d+\/withdrawal$/.test(path)) {
      postMomentWithdrawal(req, res, path.split('/')[2]);
    } else if (req.method === 'POST' && /^\/moments\/\d+\/restoration$/.test(path)) {
      postMomentRestoration(req, res, path.split('/')[2]);
    } else if (req.method === 'GET' && path === '/home-school/parent-tasks') {
      getHomeSchoolParentTasks(req, res, url);
    } else if (req.method === 'POST' && path === '/home-school/parent-tasks') {
      postHomeSchoolParentTask(req, res, body);
    } else if (req.method === 'GET' && /^\/home-school\/parent-tasks\/\d+$/.test(path)) {
      getHomeSchoolParentTask(req, res, path.split('/')[3]);
    } else if (req.method === 'PATCH' && /^\/home-school\/parent-tasks\/\d+$/.test(path)) {
      patchHomeSchoolParentTask(req, res, path.split('/')[3], body);
    } else if (req.method === 'POST' && /^\/home-school\/parent-tasks\/\d+\/publication$/.test(path)) {
      postParentTaskPublication(req, res, path.split('/')[3]);
    } else if (req.method === 'POST' && /^\/home-school\/parent-tasks\/\d+\/closure$/.test(path)) {
      postParentTaskClosure(req, res, path.split('/')[3]);
    } else if (req.method === 'GET' && /^\/home-school\/parent-tasks\/\d+\/submissions$/.test(path)) {
      getParentTaskSubmissions(req, res, path.split('/')[3]);
    } else if (req.method === 'GET' && path === `/scales/${SCALE_CODE}/${SCALE_VERSION}`) {
      // 只答现役那一版；别的版本落到契约生成的路由上（见 getScale 头注）。
      getScale(req, res);
    } else if (req.method === 'GET' && path === '/child-assessments/class-report') {
      // 这一条必须排在 `/child-assessments` 之前 —— 两条都是精确字符串，次序在这里
      // 不是必需的，但把它写在前面，加一条前缀匹配时就不必再想一次。
      getChildAssessmentClassReport(req, res);
    } else if (req.method === 'GET' && path === '/child-assessments') {
      getChildAssessments(req, res);
    } else if (req.method === 'GET' && /^\/children\/\d+\/child-assessment$/.test(path)) {
      getChildAssessment(req, res, path.split('/')[2]);
    } else if (req.method === 'GET' && /^\/children\/\d+\/child-assessment\/report$/.test(path)) {
      getChildAssessmentReport(req, res, path.split('/')[2]);
    } else if (req.method === 'PUT' && /^\/children\/\d+\/child-assessment\/items\/[^/]+$/.test(path)) {
      putChildAssessmentItem(req, res, path.split('/')[2], path.split('/')[5], body);
    } else if (req.method === 'GET' && path === '/home-school/month-evals') {
      getMonthEvals(req, res, url);
    } else if (req.method === 'PUT' && path === '/home-school/month-evals') {
      putMonthEval(req, res, body);
    } else if (req.method === 'POST' && /^\/home-school\/month-evals\/\d+\/publication$/.test(path)) {
      postMonthEvalPublication(req, res, path.split('/')[3]);
    } else if (req.method === 'GET' && path === '/term-evaluations') {
      getTermEvaluations(req, res);
    } else if (req.method === 'GET' && /^\/children\/\d+\/term-evaluation$/.test(path)) {
      getTermEvaluation(req, res, path.split('/')[2]);
    } else if (req.method === 'PUT' && /^\/children\/\d+\/term-evaluation$/.test(path)) {
      putTermEvaluation(req, res, path.split('/')[2], body);
    } else if (req.method === 'GET' && path === '/assessments') {
      getAssessments(req, res);
    } else if (req.method === 'GET' && /^\/assessments\/\d+$/.test(path)) {
      getAssessment(req, res, path.split('/')[2]);
    } else if (req.method === 'PUT' && /^\/assessments\/\d+\/items\/[^/]+$/.test(path)) {
      putAssessmentItem(req, res, path.split('/')[2], path.split('/')[4], body);
    } else if (req.method === 'GET' && path === '/home-school/home') {
      getHomeSchoolHome(req, res);
    } else if (req.method === 'GET' && path === '/home-school/teacher-eval') {
      getTeacherEvalHome(req, res);
    } else if (req.method === 'GET' && path === '/home-school/teacher-messages') {
      getTeacherMessages(req, res);
    } else if (req.method === 'POST' && path === '/home-school/teacher-messages') {
      postTeacherMessage(req, res, body);
    } else if (req.method === 'GET' && /^\/home-school\/teacher-messages\/\d+$/.test(path)) {
      getTeacherMessage(req, res, path.split('/')[3]);
    } else if (req.method === 'GET' && path === '/home-school/parent-evaluations') {
      getParentEvaluations(req, res);
    } else if (req.method === 'POST' && path === '/home-school/parent-evaluations') {
      postParentEvaluation(req, res, body);
    } else if (req.method === 'GET' && /^\/home-school\/parent-evaluations\/\d+$/.test(path)) {
      getParentEvaluation(req, res, path.split('/')[3]);
    } else if (req.method === 'GET' && path === '/home-school/community-feed') {
      getCommunityFeed(req, res, url);
    } else if (req.method === 'GET' && path === '/growth-records') {
      getGrowthRecords(req, res);
    } else if (req.method === 'GET' && /^\/children\/\d+\/growth-record$/.test(path)) {
      getGrowthRecord(req, res, path.split('/')[2]);
    } else if (req.method === 'POST' && path === '/teacher/growth-book/compilation') {
      postCompilation(req, res);
    } else if (req.method === 'POST' && /^\/teacher\/growth-book\/compilation\/\d+\/lock$/.test(path)) {
      // 这一条必须排在 `/compilation/{id}` 之前：两条正则都匹配得上带编号的路径，
      // 分发靠的是这里的次序。
      postCompilationLock(req, res, path.split('/')[4], body);
    } else if (req.method === 'PATCH' && /^\/teacher\/growth-book\/compilation\/\d+$/.test(path)) {
      patchCompilation(req, res, path.split('/')[4], body);
    } else if (req.method === 'GET' && path === '/teacher/growth-book/sections') {
      getBookSections(req, res);
    } else if (req.method === 'POST' && path === '/teacher/growth-book/sections') {
      postBookSection(req, res, body);
    } else if (req.method === 'PUT' && /^\/teacher\/growth-book\/sections\/\d+\/widgets$/.test(path)) {
      putBookWidgets(req, res, path.split('/')[4], body);
    } else if (req.method === 'PATCH' && /^\/teacher\/growth-book\/sections\/\d+$/.test(path)) {
      patchBookSection(req, res, path.split('/')[4], body);
    } else if (req.method === 'GET' && path === '/teacher/growth-book/precheck') {
      getPrecheck(req, res);
    } else if (req.method === 'POST' && path === '/teacher/growth-book/books') {
      postGrowthBook(req, res, body);
    } else if (req.method === 'POST' && /^\/teacher\/growth-book\/books\/\d+\/publication$/.test(path)) {
      postGrowthBookPublication(req, res, path.split('/')[4], body);
    } else if (req.method === 'GET' && /^\/growth-book\/books\/\d+\/manifest$/.test(path)) {
      getBookManifest(req, res, path.split('/')[3]);
    } else if (req.method === 'GET' && /^\/growth-book\/books\/\d+\/pages\/\d+$/.test(path)) {
      getBookPage(req, res, path.split('/')[3], path.split('/')[5], url);
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
 * @param {boolean} [o.layoutPack]  发布一份夹具版式包（默认 false —— 事实是 0／12）
 * @returns {Promise<{port:number, baseUrl:string, close:() => Promise<void>}>}
 */
export function start({
  port = 0, unbound = false, noTerm = false, quiet = true, layoutPack = false,
} = {}) {
  OPTS.startUnbound = unbound;
  OPTS.noTerm = noTerm;
  runtime.quiet = quiet;
  state.openidBound = !unbound;
  state.sessions.clear();
  state.revoked.clear();
  state.idempotency.clear();
  state.accessEvents.length = 0;
  state.taskCompletions.length = 0;
  state.librarySubmissions.length = 0;
  state.trainingFeedbackWrites.length = 0;
  state.childAssessments.clear();
  state.childAssessmentCompletions.length = 0;
  state.nextChildAssessmentId = 700;
  state.uploadTickets.clear();
  state.nextFileId = 8800;
  state.nextResourceId = 900;
  state.nextCaseId = 900;
  state.nextFeedbackId = 900;
  TASKS.forEach((t, i) => { t.assign = { ...TASK_ASSIGN_SNAPSHOT[i] }; });
  // 长度先收回夹具的条数，再逐条还原内容：票据 15 的写入面既改行也追加行。
  RESOURCES.length = RESOURCE_SNAPSHOT.length;
  RESOURCE_SNAPSHOT.forEach((row, i) => { RESOURCES[i] = { ...row }; });
  CASES.length = CASE_SNAPSHOT.length;
  CASE_SNAPSHOT.forEach((row, i) => { CASES[i] = { ...row }; });
  TRAINING_FEEDBACKS.length = TRAINING_FEEDBACK_SNAPSHOT.length;
  TRAINING_FEEDBACK_SNAPSHOT.forEach((row, i) => { TRAINING_FEEDBACKS[i] = { ...row }; });
  TRAININGS.forEach((t, i) => { t.my_participation_status = TRAINING_PARTICIPATION_SNAPSHOT[i]; });
  PROFILE_CHANGES.length = 0;
  resetHomeSchool();
  resetEvaluation();
  resetGrowthRecordChain();
  resetQuality();
  resetGrowthBook();
  // resetGrowthBook 把它关回默认（一份也没发布），所以显式的启动选项排在它之后。
  OPTS.layoutPack = layoutPack;
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

// ── 任务写入面（票据 11） ────────────────────────────────────────────────────

// §7.3 的三层：服务端在 schema 校验**之前**剥掉派生列，所以提交它们既不生效也不
// 报错。顺序是关键 —— 反过来的话 additionalProperties: false 会把契约说该接受的
// 请求 422 掉。§1.2 的事件时间戳同属这一族。
const DERIVED_KEYS = new Set([
  'school_id', 'class_id', 'created_by', 'uploaded_by',
  'requested_by_teacher_id', 'teacher_id',
  'created_at', 'submitted_at', 'published_at', 'reviewed_at', 'uploaded_at',
  'locked_at', 'applied_at', 'accepted_at', 'completed_at', 'cancelled_at',
  // `db_month_eval.saved_at`（票据 20）。§1.2：白名单以外的每一个 `*_at` 都是事件时间戳，
  // 服务端设值、客户端提交被静默忽略。
  'saved_at',
]);

function stripDerived(body) {
  const out = {};
  Object.keys(body || {}).forEach((k) => { if (!DERIVED_KEYS.has(k)) out[k] = body[k]; });
  return out;
}

/**
 * §5.4 / §6.4：任何依赖当前学期的写入，在派生不到进行中学期时回 409，绝不猜一个
 * 学期。客户端可以预先禁用入口，但那是体贴，不是边界 —— 服务端独立拒绝。
 */
function refuseWithoutTerm(res) {
  if (!OPTS.noTerm) return false;
  fail(res, 409, 'no_active_term', '当前没有进行中的学期');
  return true;
}

/**
 * POST /tasks/{task_id}/acceptance — a1 → a2，服务端写 accepted_at。
 *
 * 契约的 scope 是 `WHERE task_id=$1 AND teacher_id=$ctx AND assign_status='a1'
 * RETURNING`：零行即 404／409。任务不存在是 404，状态不对是 409。
 * **本端点无请求体。**
 */
function postTaskAcceptance(req, res, id) {
  if (refuseWithoutTerm(res)) return;
  const task = TASKS.find((t) => t.task_id === Number(id));
  if (!task) return fail(res, 404, 'not_found', '任务不存在或不在可见范围内');
  if (task.assign.assign_status !== 'a1') {
    return fail(res, 409, 'state_precondition_failed', '任务不在待接收状态');
  }
  task.assign.assign_status = 'a2';
  task.assign.accepted_at = '2026-08-26T09:30:00+08:00';
  return sendJson(res, 200, task.assign);
}

/**
 * POST /tasks/{task_id}/completion — a2 → a3，写 completed_at 与可选 feedback。
 *
 * `a1` 未接受直接完成回 409：转移图上没有 a1 → a3 这条边，幂等键也替代不了状态机
 * （§4.4）。请求体是 `TaskCompletionWrite`：`additionalProperties: false`，
 * 只有 `feedback`（maxLength 500）。
 *
 * 只改 `db_task_assign`，**不改 `db_task.task_status`** —— `db_task` 是状态机还是
 * 投影，G62 未决，猜一个会让教师端读到一个没有权威的状态。
 */
function postTaskCompletion(req, res, id, rawBody) {
  if (refuseWithoutTerm(res)) return;
  const task = TASKS.find((t) => t.task_id === Number(id));
  if (!task) return fail(res, 404, 'not_found', '任务不存在或不在可见范围内');
  if (task.assign.assign_status !== 'a2') {
    return fail(res, 409, 'state_precondition_failed', '任务不在进行中状态');
  }

  const body = stripDerived(rawBody);
  const extra = Object.keys(body).find((k) => k !== 'feedback');
  if (extra) {
    return fail(res, 422, 'validation_failed', '填写内容不符合要求',
      { field: extra, rule: 'additional_properties_not_allowed' });
  }
  const feedback = body.feedback === undefined ? null : body.feedback;
  if (feedback !== null && (typeof feedback !== 'string' || feedback.length > 500)) {
    return fail(res, 422, 'validation_failed', '填写内容不符合要求',
      { field: 'feedback', rule: 'max_length_500' });
  }

  task.assign.assign_status = 'a3';
  task.assign.completed_at = '2026-08-26T16:40:00+08:00';
  task.assign.feedback = feedback;
  state.taskCompletions.push({ task_id: task.task_id, teacher_id: TEACHER.teacher_id });
  return sendJson(res, 200, task.assign);
}

// ── 资源与案例的写入面（票据 15） ───────────────────────────────────────────
//
// 状态机（`ContentStatus` s1—s5，资源与案例同一个值域）：
//
//   NONE --create--> s1 草稿 --submission--> s2 待审核 --管理端--> s3 已发布 / s4 已驳回
//   s2｜s3｜s4 --withdrawal--> s1 草稿          （F6：作者撤回目标是 s1，不是 s5）
//   s1 --patch--> s1                            （F6：pending 期间内容冻结）
//
// **s4 对资源／案例不是终局**，与 `db_training_feedback` 的 s4 不同 —— 契约的
// `withdrawResourceToDraft` 特意写了这一句，因为把研修反馈的规则套过来是最容易犯的错。
// 「已下架」是 s5，只有管理端做得到，本 mock 不提供，教师端也不该有那个按钮。
//
// 必填以 `db/01_schema.sql` 的 NOT NULL 为准，**不以 `ResourceWrite` 为准**：契约的写入
// schema 把 `resource_explain`／`resource_access`／`resource_trans` 标成
// `[string,'null']`，DDL 三列都是 NOT NULL。AGENTS.md 规则 1 说 DDL 是唯一的字段级权威，
// 所以这里按 NOT NULL 收，并把这条不一致记进交接。

const RESOURCE_WRITE_FIELDS = [
  { key: 'resource_type', required: true, kind: 'enum', values: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'] },
  { key: 'resource_name', required: true, kind: 'text', max: 20 },
  { key: 'resource_tag', required: true, kind: 'enum', values: ['g1', 'g2', 'g3', 'g4', 'g5'] },
  { key: 'grade', required: false, kind: 'enum_array', values: ['k1', 'k2', 'k3'] },
  { key: 'resource_explain', required: true, kind: 'text', max: 200 },
  { key: 'resource_access', required: true, kind: 'text', max: 300 },
  { key: 'resource_trans', required: true, kind: 'text', max: 200 },
  { key: 'cover_file_id', required: false, kind: 'int' },
  { key: 'word_file_id', required: false, kind: 'int' },
];

const CASE_WRITE_FIELDS = [
  { key: 'case_name', required: true, kind: 'text', max: 20 },
  { key: 'case_grade', required: true, kind: 'enum', values: ['k1', 'k2', 'k3'] },
  { key: 'case_field', required: true, kind: 'enum', values: ['f1', 'f2', 'f3', 'f4', 'f5'] },
  { key: 'case_area', required: true, kind: 'enum_array', values: ['a1', 'a2', 'a3', 'a4', 'a5'], minItems: 1 },
  { key: 'case_intro', required: true, kind: 'text', max: 100 },
  { key: 'case_trans', required: true, kind: 'text', max: 100 },
  { key: 'resource_ids', required: false, kind: 'int_array' },
  { key: 'cover_file_id', required: false, kind: 'int' },
  { key: 'word_file_id', required: false, kind: 'int' },
];

/**
 * `additionalProperties: false` 加逐字段校验，一处写完两张表共用。
 *
 * `partial` 是 PATCH 的语义（§1.1：字段缺席＝不改，显式 `null`＝清空），所以它只关掉
 * 必填检查，不放松值域检查 —— 一个 PATCH 送来的非法枚举仍然是 422。
 *
 * @returns {object|null} 失败时返回 `{ field, rule }`，成功返回 null
 */
function validateWrite(body, fields, { partial = false } = {}) {
  const known = new Set(fields.map((f) => f.key));
  const extra = Object.keys(body).find((k) => !known.has(k));
  if (extra) return { field: extra, rule: 'additional_properties_not_allowed' };

  for (const field of fields) {
    const value = body[field.key];
    if (value === undefined) {
      if (field.required && !partial) return { field: field.key, rule: 'required' };
      continue;
    }
    if (value === null) {
      // NOT NULL 的列不接受显式清空，即使在 PATCH 里。
      if (field.required) return { field: field.key, rule: 'required' };
      continue;
    }
    if (field.kind === 'text') {
      if (typeof value !== 'string') return { field: field.key, rule: 'type_string' };
      if (field.required && value.trim() === '') return { field: field.key, rule: 'required' };
      if (value.length > field.max) return { field: field.key, rule: `max_length_${field.max}` };
    } else if (field.kind === 'enum') {
      if (field.values.indexOf(value) === -1) return { field: field.key, rule: 'enum' };
    } else if (field.kind === 'enum_array') {
      if (!Array.isArray(value)) return { field: field.key, rule: 'type_array' };
      if (field.minItems && value.length < field.minItems) {
        return { field: field.key, rule: `min_items_${field.minItems}` };
      }
      if (value.some((v) => field.values.indexOf(v) === -1)) return { field: field.key, rule: 'enum' };
      if (new Set(value).size !== value.length) return { field: field.key, rule: 'unique_items' };
    } else if (field.kind === 'int_array') {
      if (!Array.isArray(value)) return { field: field.key, rule: 'type_array' };
      if (value.some((v) => !Number.isInteger(v))) return { field: field.key, rule: 'type_integer' };
    } else if (field.kind === 'int') {
      if (!Number.isInteger(value)) return { field: field.key, rule: 'type_integer' };
    }
  }
  return null;
}

/** 只保留写入白名单里的键，再把它盖到目标行上。缺席＝不改。 */
function applyWrite(row, body, fields) {
  fields.forEach((field) => {
    if (body[field.key] !== undefined) row[field.key] = body[field.key];
  });
}

/**
 * 两张表的差别收敛成一张表，处理器因此只写一遍。
 *
 * 抄第二遍的代价不是行数：`withdrawal` 要清 `submitted_at` 与 `decision_reason` 这条
 * 规则会在两处各记一次，而其中一处迟早会漏。
 */
const LIBRARY_KINDS = {
  resource: {
    rows: RESOURCES, idKey: 'resource_id', statusKey: 'resource_status',
    fields: RESOURCE_WRITE_FIELDS, missing: '资源不存在或不在可见范围内',
    next: () => state.nextResourceId++,
    decorate: (row) => ({ ...row, related_cases: relatedCasesFor(row.resource_id) }),
    seed: {
      resource_type: 'r1', resource_name: '', resource_tag: 'g1', grade: null,
      resource_explain: '', resource_access: '', resource_trans: '',
      cover_file_id: null, word_file_id: null, required_count: 0, completed_count: 0,
      complete: 'c3',
    },
  },
  case: {
    rows: CASES, idKey: 'case_id', statusKey: 'case_status',
    fields: CASE_WRITE_FIELDS, missing: '案例不存在或不在可见范围内',
    next: () => state.nextCaseId++,
    decorate: (row) => ({ ...row, related_resources: relatedResourcesFor(row) }),
    seed: {
      case_name: '', case_grade: 'k1', case_field: 'f1', case_area: ['a1'],
      case_intro: '', case_trans: '', resource_ids: null,
      cover_file_id: null, word_file_id: null,
    },
  },
};

/** 新建草稿（NONE -> s1）。`created_by` 由服务端设值，请求体里的同名字段已被剥掉。 */
function postLibraryDraft(req, res, kindKey, rawBody) {
  if (refuseWithoutTerm(res)) return;
  const kind = LIBRARY_KINDS[kindKey];
  const body = stripDerived(rawBody);
  const bad = validateWrite(body, kind.fields);
  if (bad) return fail(res, 422, 'validation_failed', '填写内容不符合要求', bad);

  const row = {
    [kind.idKey]: kind.next(),
    ...kind.seed,
    created_by: TEACHER.teacher_id,
    [kind.statusKey]: 's1',
    decision_reason: null,
    submitted_at: null,
    updated_at: '2026-08-26T17:00:00+08:00',
  };
  applyWrite(row, body, kind.fields);
  // 最新的排在最前：列表按 `updated_at DESC, id DESC` 分页。
  kind.rows.unshift(row);
  return sendJson(res, 201, kind.decorate(row), {
    Location: `${BASE}/library/${kindKey === 'resource' ? 'resources' : 'cases'}/${row[kind.idKey]}`,
  });
}

/** 改草稿（仅 s1）。F6：pending 期间内容冻结，s3 不得直接编辑。 */
function patchLibraryDraft(req, res, kindKey, id, rawBody) {
  if (refuseWithoutTerm(res)) return;
  const kind = LIBRARY_KINDS[kindKey];
  const row = kind.rows.find((r) => r[kind.idKey] === Number(id));
  if (!row) return fail(res, 404, 'not_found', kind.missing);
  if (row[kind.statusKey] !== 's1') {
    return fail(res, 409, 'state_precondition_failed', '只有草稿可以修改，请先撤回到草稿');
  }
  const body = stripDerived(rawBody);
  const bad = validateWrite(body, kind.fields, { partial: true });
  if (bad) return fail(res, 422, 'validation_failed', '填写内容不符合要求', bad);

  applyWrite(row, body, kind.fields);
  row.updated_at = '2026-08-26T17:05:00+08:00';
  return sendJson(res, 200, kind.decorate(row));
}

/** 提交审核（s1 -> s2）。`submitted_at` 是服务端设值（B10 / §1.2）。 */
function postLibrarySubmission(req, res, kindKey, id) {
  if (refuseWithoutTerm(res)) return;
  const kind = LIBRARY_KINDS[kindKey];
  const row = kind.rows.find((r) => r[kind.idKey] === Number(id));
  if (!row) return fail(res, 404, 'not_found', kind.missing);
  if (row[kind.statusKey] !== 's1') {
    return fail(res, 409, 'state_precondition_failed', '只有草稿可以提交审核');
  }
  row[kind.statusKey] = 's2';
  row.submitted_at = '2026-08-26T17:10:00+08:00';
  row.updated_at = '2026-08-26T17:10:00+08:00';
  state.librarySubmissions.push({ kind: kindKey, id: row[kind.idKey] });
  return sendJson(res, 200, kind.decorate(row));
}

/**
 * 作者撤回成草稿（s2｜s3｜s4 -> s1）。
 *
 * 从 s3 撤回**立刻停止新查看与下载**（F6）：已签发未到期的短链在 `/dl/{link_id}` 那里
 * 逐次复核内容状态，因此当场失效 —— 那段代码不必改，这里改了状态就是全部。
 */
function postLibraryWithdrawal(req, res, kindKey, id) {
  if (refuseWithoutTerm(res)) return;
  const kind = LIBRARY_KINDS[kindKey];
  const row = kind.rows.find((r) => r[kind.idKey] === Number(id));
  if (!row) return fail(res, 404, 'not_found', kind.missing);
  if (['s2', 's3', 's4'].indexOf(row[kind.statusKey]) === -1) {
    return fail(res, 409, 'state_precondition_failed', '这一条已经在草稿里，不需要撤回');
  }
  row[kind.statusKey] = 's1';
  row.submitted_at = null;
  // 驳回原因属于上一轮审核。回到草稿就是那一轮结束了，留着它会让教师改完仍看见旧理由。
  row.decision_reason = null;
  row.updated_at = '2026-08-26T17:15:00+08:00';
  return sendJson(res, 200, kind.decorate(row));
}

// ── 研修反馈（票据 16） ─────────────────────────────────────────────────────

/**
 * GET /training-participations — 「我的研修」。
 *
 * §4 规则 21：只查本人 participation，**是活动列表的子集，不是第二份活动表**，所以每一行
 * 内嵌一整张 `TrainingCard`。夹具里参与过的就是 `my_participation_status` 非空的那些。
 */
function getMyParticipations(req, res, url) {
  if (!requireSession(req, res)) return;

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 20 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return fail(res, 422, 'validation_failed', '分页参数不合法',
      { field: 'limit', rule: 'between_1_and_100' });
  }

  const mine = TRAININGS.filter((t) => t.my_participation_status);
  const filters = {};
  let startIndex = 0;
  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    const decoded = decodeCursor(cursor, filters);
    if (decoded.error) {
      return fail(res, 400, decoded.error,
        decoded.error === 'cursor_invalid' ? '翻页游标不可解' : '筛选条件已变，游标失效');
    }
    startIndex = mine.findIndex((t) => t.training_id === decoded.key) + 1;
    if (startIndex <= 0) return fail(res, 400, 'cursor_invalid', '翻页游标不可解');
  }

  const slice = mine.slice(startIndex, startIndex + limit);
  const last = slice[slice.length - 1];
  const hasMore = startIndex + limit < mine.length;
  sendJson(res, 200, {
    items: slice.map((t) => ({
      training_participation_id: 8000 + t.training_id,
      training_id: t.training_id,
      participation_status: t.my_participation_status,
      registered_at: '2026-08-20T09:00:00+08:00',
      cancelled_at: t.my_participation_status === 's2' ? '2026-08-21T09:00:00+08:00' : null,
      completed_at: t.my_participation_status === 's3' ? '2026-08-22T18:00:00+08:00' : null,
      training: toTrainingCard(t),
    })),
    next_cursor: hasMore && last ? encodeCursor(last.training_id, filters) : null,
  });
}

/**
 * GET /teacher-profile — 本人专业档案与证书清单（G45：申请制，读得到、改不了）。
 *
 * 姓名与任教班级**不在这里** —— 它们随会话上下文下发，是名册权威持有的身份字段。
 */
function getTeacherProfile(req, res) {
  if (!requireSession(req, res)) return;
  const pending = PROFILE_CHANGES.find((c) => c.change_status === 's2') || null;
  sendJson(res, 200, {
    ...TEACHER_PROFILE,
    credentials: TEACHER_CREDENTIALS.map((c) => ({ ...c })),
    pending_change: pending ? { ...pending } : null,
  });
}

/** GET /teacher-profile/changes — 本人已提交的申请，最新在前。 */
function getProfileChanges(req, res, url) {
  if (!requireSession(req, res)) return;
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 20 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return fail(res, 422, 'validation_failed', '分页参数不合法',
      { field: 'limit', rule: 'between_1_and_100' });
  }
  const rows = PROFILE_CHANGES.slice().reverse().slice(0, limit);
  sendJson(res, 200, { items: rows.map((c) => ({ ...c })), next_cursor: null });
}

/**
 * POST /teacher-profile/changes — 提交修改申请（NONE -> s2）。
 *
 * **直接到 s2，不经 s1**：教师端不留草稿，一次提交即待审（契约 v0.6）。
 * 同一名教师同时最多一份 s2 —— 已有待审时回 409，不产生第二份。
 */
function postProfileChange(req, res, rawBody) {
  if (!requireSession(req, res)) return;
  if (refuseWithoutTerm(res)) return;
  if (PROFILE_CHANGES.some((c) => c.change_status === 's2')) {
    return fail(res, 409, 'state_precondition_failed', '上一份修改申请还在审核中，通过或驳回后才能再提交');
  }

  const body = stripDerived(rawBody);
  const extra = Object.keys(body).find((k) => k !== 'change_payload' && k !== 'credential_ids');
  if (extra) {
    return fail(res, 422, 'validation_failed', '填写内容不符合要求',
      { field: extra, rule: 'additional_properties_not_allowed' });
  }
  const payload = body.change_payload;
  if (!payload || typeof payload !== 'object') {
    return fail(res, 422, 'validation_failed', '填写内容不符合要求',
      { field: 'change_payload', rule: 'required' });
  }
  const allowed = ['professional_title', 'education_level', 'job_role', 'credentials'];
  const badKey = Object.keys(payload).find((k) => allowed.indexOf(k) === -1);
  if (badKey) {
    return fail(res, 422, 'validation_failed', '填写内容不符合要求',
      { field: `change_payload.${badKey}`, rule: 'additional_properties_not_allowed' });
  }
  for (const one of payload.credentials || []) {
    if (!one.credential_name || String(one.credential_name).trim() === '') {
      return fail(res, 422, 'validation_failed', '填写内容不符合要求',
        { field: 'credentials.credential_name', rule: 'required' });
    }
    if (String(one.credential_name).length > 150) {
      return fail(res, 422, 'validation_failed', '填写内容不符合要求',
        { field: 'credentials.credential_name', rule: 'max_length_150' });
    }
    if (!one.file_id) {
      return fail(res, 422, 'validation_failed', '填写内容不符合要求',
        { field: 'credentials.file_id', rule: 'required' });
    }
  }

  const row = {
    teacher_profile_change_id: 700 + PROFILE_CHANGES.length,
    change_status: 's2',
    change_payload: payload,
    credential_ids: body.credential_ids || null,
    submitted_at: '2026-08-27T10:00:00+08:00',
    applied_at: null,
  };
  PROFILE_CHANGES.push(row);
  return sendJson(res, 201, { ...row });
}

/**
 * POST /trainings/{training_id}/registration — 报名／恢复报名（→ s1）。
 *
 * 契约 §4 规则 21：**一个端点覆盖三种入口状态**，因为它们写的是同一列 ——
 * 无列则建列；s2 复用同列转 s1；s1 幂等，回 unchanged，不产生第二笔副作用。
 * 开始之后参与状态冻结，回 409。本端点**没有请求体**。
 */
function postTrainingRegistration(req, res, id) {
  const training = TRAININGS.find((t) => t.training_id === Number(id));
  if (!training) return fail(res, 404, 'not_found', '研修不存在或不在可见范围内');
  if (training.training_status !== 's1') {
    return fail(res, 409, 'state_precondition_failed', '这场研修已撤回，不再接收报名');
  }
  // 「开始了没有」由服务端派生的 training_phase 回答，不做时间算术。
  if (training.training_phase !== 'upcoming') {
    return fail(res, 409, 'state_precondition_failed', '研修已开始，参与状态不再变动');
  }
  const unchanged = training.my_participation_status === 's1';
  training.my_participation_status = 's1';
  return sendJson(res, 200, {
    training_participation_id: 8000 + training.training_id,
    training_id: training.training_id,
    participation_status: 's1',
    registered_at: '2026-08-27T09:00:00+08:00',
    cancelled_at: null,
    unchanged,
  });
}

/**
 * POST /trainings/{training_id}/registration-cancellation — 取消报名（s1 -> s2）。
 * 只在开始前成立。s2 **不完成**：有效结束时只有仍 s1 的列自动转 s3。
 */
function postTrainingCancellation(req, res, id) {
  const training = TRAININGS.find((t) => t.training_id === Number(id));
  if (!training) return fail(res, 404, 'not_found', '研修不存在或不在可见范围内');
  if (training.training_phase !== 'upcoming') {
    return fail(res, 409, 'state_precondition_failed', '研修已开始，参与状态不再变动');
  }
  if (training.my_participation_status !== 's1') {
    return fail(res, 409, 'state_precondition_failed', '这场研修你还没有报名');
  }
  training.my_participation_status = 's2';
  return sendJson(res, 200, {
    training_participation_id: 8000 + training.training_id,
    training_id: training.training_id,
    participation_status: 's2',
    registered_at: '2026-08-27T09:00:00+08:00',
    cancelled_at: '2026-08-27T10:00:00+08:00',
  });
}

/**
 * POST /trainings/{training_id}/feedback — NONE -> s2 待审核。
 *
 * 契约的 scope 逐字：`WHERE training_id=$1 AND teacher_id=$ctx_teacher AND
 * participation_status='s3' AND $now > effective_end_at`。三个条件各有各的拒绝，
 * 因为教师要知道**为什么**不能提交，而不只是不能。
 *
 * `UNIQUE(training_id, teacher_id)` 禁止另建一列绕过终局：一人一场一份，提交即冻结，
 * 不可编辑、不可撤回、不可查询状态、不可查看驳回理由（F9 的 Q58-ap1）。
 */
function postTrainingFeedback(req, res, id, rawBody) {
  if (refuseWithoutTerm(res)) return;
  const training = TRAININGS.find((t) => t.training_id === Number(id));
  if (!training) return fail(res, 404, 'not_found', '研修不存在或不在可见范围内');
  if (training.training_status !== 's1') {
    return fail(res, 409, 'state_precondition_failed', '这场研修已撤回，不再接收反馈');
  }
  // 先答「还没结束」再答「你没参加」，顺序是有意的：`participation_status` 只在到达有效
  // 结束时间时才由 s1 自动转 s3，所以一场没结束的研修上，报了名的教师也还是 s1。
  // 反过来问，他会被告知「你没参加」——那句话是错的，他明明报了名。
  // 「已结束」由服务端按园所时区派生成 `training_phase`，客户端与本 mock 都不做时间算术。
  if (training.training_phase !== 'history') {
    return fail(res, 409, 'state_precondition_failed', '研修还没有结束，结束后才能提交反馈');
  }
  if (training.my_participation_status !== 's3') {
    return fail(res, 409, 'state_precondition_failed', '只有参加过这场研修的教师可以提交反馈');
  }
  if (TRAINING_FEEDBACKS.some((f) => f.training_id === training.training_id
    && f.teacher_id === TEACHER.teacher_id)) {
    return fail(res, 409, 'state_precondition_failed', '这场研修你已经提交过反馈了');
  }

  const body = stripDerived(rawBody);
  const extra = Object.keys(body).find((k) => k !== 'feedback_text');
  if (extra) {
    return fail(res, 422, 'validation_failed', '填写内容不符合要求',
      { field: extra, rule: 'additional_properties_not_allowed' });
  }
  const text = body.feedback_text;
  if (typeof text !== 'string' || text.length < 1 || text.length > 1000) {
    return fail(res, 422, 'validation_failed', '填写内容不符合要求',
      { field: 'feedback_text', rule: 'length_1_to_1000' });
  }

  const feedbackId = state.nextFeedbackId++;
  TRAINING_FEEDBACKS.push({
    feedback_id: feedbackId,
    training_id: training.training_id,
    teacher_id: TEACHER.teacher_id,
    teacher_name: TEACHER.teacher_name,
    feedback_status: 's2',
    feedback_text: text,
    published_at: null,
  });
  state.trainingFeedbackWrites.push({ training_id: training.training_id, feedback_id: feedbackId });

  // `TrainingFeedbackOwn` —— **一次性回执，不是可查询的状态**。刻意不回
  // `feedback_status`，也没有对应的 GET 端点。
  return sendJson(res, 201, {
    feedback_id: feedbackId,
    training_id: training.training_id,
    submitted_at: '2026-08-26T17:20:00+08:00',
  }, { Location: `${BASE}/trainings/${training.training_id}/feedback` });
}

/** GET /trainings/{id}/feedback — 公开回馈流：只有 s3，且活动仍 s1。 */
function getTrainingFeedback(req, res, id, url) {
  const training = TRAININGS.find((t) => t.training_id === Number(id));
  if (!training) return fail(res, 404, 'not_found', '研修不存在或不在可见范围内');

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 20 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return fail(res, 422, 'validation_failed', '分页参数不合法',
      { field: 'limit', rule: 'between_1_and_100' });
  }

  // 活动撤回后即使回馈列仍在，公开流也回 `[]`、计数 0（F9）。
  const pool = training.training_status !== 's1' ? [] : TRAINING_FEEDBACKS
    .filter((f) => f.training_id === training.training_id && f.feedback_status === 's3')
    .sort((a, b) => (a.published_at < b.published_at ? 1 : -1));

  const filters = {};
  let startIndex = 0;
  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    const decoded = decodeCursor(cursor, filters);
    if (decoded.error) {
      return fail(res, 400, decoded.error,
        decoded.error === 'cursor_invalid' ? '翻页游标不可解' : '筛选条件已变，游标失效');
    }
    startIndex = pool.findIndex((f) => f.feedback_id === decoded.key) + 1;
    if (startIndex <= 0) return fail(res, 400, 'cursor_invalid', '翻页游标不可解');
  }

  const slice = pool.slice(startIndex, startIndex + limit);
  const last = slice[slice.length - 1];
  const hasMore = startIndex + limit < pool.length;
  sendJson(res, 200, {
    // `TrainingFeedback` 是公开流对象，只在 s3 时出现，因此**不带状态字段**。
    items: slice.map((f) => ({
      feedback_id: f.feedback_id,
      training_id: f.training_id,
      teacher_id: f.teacher_id,
      teacher_name: f.teacher_name,
      feedback_text: f.feedback_text,
      published_at: f.published_at,
    })),
    next_cursor: hasMore && last ? encodeCursor(last.feedback_id, filters) : null,
  });
}

// ── 媒体流（契约 §8） ───────────────────────────────────────────────────────

// CONTEXT.md §3：处理前单档上限 10 MB。这是我们的产品限制。
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const UPLOAD_CONTENT_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

/**
 * POST /media/upload-credentials — 签发 COS 表单上传（PostObject）凭证。
 *
 * §8.1 铁律：字节不经过 API 实例。所以签发的 `url` 指向**基址之外**的地方，
 * 本地由 `/cos/` 冒充对象存储 —— 它不在 `/api/v1` 下面，正是为了让「客户端把字节
 * 送去了别处」这件事在测试里断言得到。
 *
 * `wx.uploadFile` 发的是 multipart 的 POST，所以凭证放行的必须是 PostObject；
 * 只签 PutObject 会在真机上失败，而浏览器里用 PUT 自测看不出来。
 */
function postUploadCredentials(req, res, body) {
  const { usage_key: usageKey, content_type: contentType, byte_size: byteSize } = body;
  if (typeof usageKey !== 'string' || usageKey === '' || usageKey.length > 32) {
    return fail(res, 422, 'validation_failed', '填写内容不符合要求',
      { field: 'usage_key', rule: 'required_max_32' });
  }
  if (UPLOAD_CONTENT_TYPES.indexOf(contentType) === -1) {
    return fail(res, 422, 'validation_failed', '填写内容不符合要求',
      { field: 'content_type', rule: 'enum' });
  }
  if (!Number.isInteger(byteSize) || byteSize < 1 || byteSize > MAX_UPLOAD_BYTES) {
    return fail(res, 422, 'validation_failed', '填写内容不符合要求',
      { field: 'byte_size', rule: 'between_1_and_10485760' });
  }

  const ticket = randomUUID();
  const objectKey = `incoming/2026/08/26/${ticket}`;
  state.uploadTickets.set(ticket, { usageKey, contentType, byteSize, uploaded: false });
  return sendJson(res, 201, {
    upload_ticket: ticket,
    bucket: 'hualong-media-1464472146',
    region: 'ap-guangzhou',
    url: `http://127.0.0.1:${server.address().port}/cos/`,
    object_key: objectKey,
    // policy 把 key 绑死到单一 object_key，不签目录级或通配凭证。
    form_fields: {
      key: objectKey,
      policy: 'bW9jay1wb2xpY3k=',
      'q-sign-algorithm': 'sha1',
      'q-ak': 'AKIDMOCK',
      'q-key-time': '1787000000;1787000900',
      'q-signature': 'mocksignature',
      'Content-Type': contentType,
      success_action_status: '200',
    },
    field_order: ['key', 'policy', 'q-sign-algorithm', 'q-ak', 'q-key-time',
      'q-signature', 'Content-Type', 'success_action_status'],
    expires_at: '2026-08-26T14:15:00+08:00',
    max_bytes: MAX_UPLOAD_BYTES,
  });
}

/**
 * 冒充 COS 的表单上传端点。**不在 `/api/v1` 下**，因为真实的它也不在。
 * 只记下这个 object_key 的字节已经到位，好让 `POST /media/files` 有东西可核对。
 */
function postCosObject(req, res, raw) {
  const m = /incoming(?:\/|%2F)[^&\s"]+/i.exec(raw || '');
  if (m) {
    const key = decodeURIComponent(m[0]);
    const ticket = key.split('/').pop();
    const pending = state.uploadTickets.get(ticket);
    if (pending) pending.uploaded = true;
  }
  // success_action_status=200，且响应体不是 JSON —— COS 不说 JSON。
  res.writeHead(200, { 'content-type': 'application/xml' });
  res.end('<PostResponse/>');
}

/**
 * POST /media/files — 把已上传的对象落成 db_file。
 *
 * W17：只存处理后成品，`file_size` 记处理后大小，原件随即删除（这里就是丢掉 ticket
 * 与那条 pending 记录）。`file_id` 只在成品上产生，所以拿不到 ticket 就没有 file_id。
 */
function postMediaFile(req, res, body) {
  const ticket = body.upload_ticket;
  const pending = typeof ticket === 'string' ? state.uploadTickets.get(ticket) : null;
  if (!pending) {
    return fail(res, 422, 'validation_failed', '上传凭证无效或已使用',
      { field: 'upload_ticket', rule: 'valid_unused_ticket' });
  }
  if (!pending.uploaded) {
    return fail(res, 422, 'validation_failed', '对象尚未上传到对象存储',
      { field: 'upload_ticket', rule: 'object_present' });
  }
  state.uploadTickets.delete(ticket);

  const fileId = state.nextFileId++;
  return sendJson(res, 201, {
    file_id: fileId,
    file_type: 'f1',
    file_name: `${fileId}.jpg`,
    // 处理后：去 EXIF、长边缩到 2000、MozJPEG 重编码之后比原件小。
    file_size: Math.round(pending.byteSize * 0.6),
    uploaded_at: '2026-08-26T14:15:31+08:00',
  }, { Location: `${BASE}/media/files/${fileId}` });
}

// ══════════════════════════════════════════════════════════════════════════
// 家园社共育：在园时光与亲子任务（票据 17／19）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 本班名册。
 *
 * **契约里没有这条路径。** `openapi.yaml` 的幼儿名册只有 `/admin/org/children`
 * （`x-hualong-roles: [admin-pc]`），教师端一条也没有；而 `MomentDraftWrite.child_id`
 * 要教师从本班名册里挑人，`MomentWeeklyCoverageRow` 又只回 `child_id`、不回姓名。
 * 没有名册，教师端既选不了幼儿，进度矩阵也写不出姓名列。
 *
 * 登记在这里的做法与 `/training/course-intro` 相同：让门不至于悄悄缺席，缺口本身记进
 * 交接。接真服务前必须由后端补一条教师端名册端点。
 *
 * 名册型，**不分页**（§3.5）：一个班的幼儿数有界，语意就是「这一份，完整的」。
 */
const CHILD_NAMES = [
  '陈一诺', '黄铭轩', '梁子墨', '罗芷晴', '吴悦然', '郑皓宇', '何思琪', '周睿阳',
  '李雨萱', '张力轩', '王子涵', '赵佳怡', '刘浩然', '孙念祖', '徐嘉言', '朱可欣',
  '胡安然', '林亦辰', '高梓晴', '马书瑶', '谢明轩', '曾若曦', '彭子睿', '苏念安',
  '邓乐怡', '蔡承熙', '袁静姝', '汪允中',
];

const CHILDREN = Object.freeze(
  CHILD_NAMES.map((name, i) => Object.freeze({ child_id: 101 + i, child_name: name }))
);

/**
 * ISO 周键，`YYYY-Www`。
 *
 * 服务端派生列（契约 `Moment.week_key`：「由 moment_date 服务器派生，提交被忽略」）。
 * 全程走 `Date.UTC`，所以运行这台机器的时区改变不了结果 —— 时区在这套制度里从来
 * 不是输入（§1.2）。
 */
function isoWeekKey(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay() || 7;          // 1..7，周一为 1
  dt.setUTCDate(dt.getUTCDate() + 4 - dow); // 移到本周四：ISO 用它决定归属哪一年
  const yearStart = Date.UTC(dt.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((dt.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function shiftDays(dateStr, days) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
    + `-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// 这个 mock 世界的「园所今天」，与其余夹具（`accepted_at`／`completed_at`）同一天。
const MOMENT_TODAY = '2026-08-26';

// 进度汇总看的那一段时间：最近六周。六列在 390pt 屏上放不下，所以横向滚动是真的
// 会发生的事，不是一条测不到的分支。
const MOMENT_WEEK_DATES = [35, 28, 21, 14, 7, 0].map((back) => shiftDays(MOMENT_TODAY, -back));
const MOMENT_WEEK_KEYS = MOMENT_WEEK_DATES.map(isoWeekKey);

const MOMENT_TITLES = [
  '端午艾草手作', '沙池里的水渠', '秋天的叶子拓印', '小小值日生',
  '留耕堂门楼观察', '班级图书角整理', '中秋做灯笼', '晨间自主游戏',
];

/**
 * 在园时光夹具。
 *
 * 覆盖分布是**刻意设计**的，好让进度矩阵上三种情形都出现：达到参考频率（>=2）、
 * 只发了一次、一次也没有。最后一名幼儿谁也不覆盖 —— 契约特意说明新转入的幼儿在
 * 入班前的周次可能显示 0 次，矩阵必须显示得出这一格。
 */
// 编号从 1 起，与 TASKS／RESOURCES／CASES／TRAININGS 同一条约定：契约巡检
// （tests/api-coverage.test.mjs）用 `1` 代入每一个路径参数，夹具里没有 1 号就会把
// 「业务前置拒绝」变成一个看起来像门坏了的 404。
const MOMENTS = [];
let momentSeed = 1;
MOMENT_WEEK_DATES.forEach((date, w) => {
  const perWeek = 2 + (w % 2);
  for (let j = 0; j < perWeek; j += 1) {
    MOMENTS.push({
      moment_id: momentSeed++,
      school_id: SCOPE.school_id,
      class_id: SCOPE.class_id,
      teacher_id: TEACHER.teacher_id,
      moment_title: MOMENT_TITLES[(w * 3 + j) % MOMENT_TITLES.length],
      moment_content: '孩子们分组尝试、互相提醒，整体参与度较高。',
      moment_date: date,
      week_key: MOMENT_WEEK_KEYS[w],
      file_id: [8700 + w * 3 + j],
      child_id: CHILDREN
        .filter((c, idx) => idx !== CHILDREN.length - 1 && (idx + j) % 4 !== 0)
        .map((c) => c.child_id),
      publish_status: 's3',
      published_at: `${date}T17:20:00+08:00`,
      withdrawn_by_admin: false,
      created_at: `${date}T16:00:00+08:00`,
      updated_at: `${date}T17:20:00+08:00`,
    });
  }
});
// 一则草稿与一则已撤回，好让列表筛选、发布、撤回与恢复各有真实的落点。
// 两则都不进周覆盖计数 —— 计数只统计 s3（契约 Q59-c1）。
MOMENTS[0].publish_status = 's1';
MOMENTS[0].published_at = null;
MOMENTS[1].publish_status = 's5';
// 管理员下架的那一笔教师不得自行恢复（Q59-m1a）。这一则是教师自己撤的，可以恢复。
MOMENTS[1].withdrawn_by_admin = false;
MOMENTS.push({
  ...MOMENTS[2],
  moment_id: momentSeed++,
  moment_title: '被管理端下架的一则',
  publish_status: 's5',
  withdrawn_by_admin: true,
});
// 列表按 `moment_date DESC, moment_id DESC`：最新的排在最前。
MOMENTS.sort((a, b) => (a.moment_date === b.moment_date
  ? b.moment_id - a.moment_id
  : (a.moment_date < b.moment_date ? 1 : -1)));

const MOMENT_SNAPSHOT = MOMENTS.map((m) => ({ ...m, child_id: m.child_id.slice(), file_id: m.file_id.slice() }));

const PARENT_TASKS = [
  {
    parent_task_id: 2,
    school_id: SCOPE.school_id,
    class_id: SCOPE.class_id,
    teacher_id: TEACHER.teacher_id,
    term_id: TERM.term_id,
    parent_task_type: 't1',
    parent_task_title: '亲子观察：我的家',
    task_background: '孩子们正在讨论家中的物品、作息和家庭成员分工，适合请家长陪伴幼儿完成一次生活观察。',
    task_detail: '请家长陪同幼儿选择一个家中生活场景，拍摄 1-2 张照片，并用一句话记录孩子的发现。',
    start_at: '2026-08-24T08:00:00+08:00',
    due_at: '2026-08-30T18:00:00+08:00',
    publish_status: 's2',
    published_at: '2026-08-24T07:55:00+08:00',
    created_at: '2026-08-23T20:10:00+08:00',
    updated_at: '2026-08-24T07:55:00+08:00',
  },
  {
    parent_task_id: 3,
    school_id: SCOPE.school_id,
    class_id: SCOPE.class_id,
    teacher_id: TEACHER.teacher_id,
    term_id: TERM.term_id,
    parent_task_type: 't2',
    parent_task_title: '社区探访：留耕堂门前的石阶',
    task_background: '留耕堂保留了传统建筑门楼、石阶和灰塑装饰，幼儿可以从真实社区环境中观察公共空间。',
    task_detail: '请家长带幼儿在安全距离内观察留耕堂外观，拍摄一张照片，并请孩子说一说自己看到了什么。',
    start_at: '2026-08-20T09:00:00+08:00',
    due_at: null,
    publish_status: 's2',
    published_at: '2026-08-20T08:40:00+08:00',
    created_at: '2026-08-19T15:00:00+08:00',
    updated_at: '2026-08-20T08:40:00+08:00',
  },
  {
    parent_task_id: 1,
    school_id: SCOPE.school_id,
    class_id: SCOPE.class_id,
    teacher_id: TEACHER.teacher_id,
    // 草稿可以没有 term_id：它在发布时才由 start_at 派生（契约 §4 规则 2）。
    term_id: null,
    parent_task_type: 't1',
    parent_task_title: '亲子阅读打卡',
    task_background: null,
    task_detail: '每天与幼儿共读一本绘本，周末拍一张全家共读的照片。',
    // 落在园历区间内（TERM 从 2026-09-01 起），所以它发布得出去。落在区间外的那一支
    // 由 tests/parent-task.test.mjs 用一个刻意的值去撞，不靠夹具制造。
    start_at: '2026-09-05T08:00:00+08:00',
    due_at: '2026-09-12T20:00:00+08:00',
    publish_status: 's1',
    published_at: null,
    created_at: '2026-08-25T19:00:00+08:00',
    updated_at: '2026-08-25T19:00:00+08:00',
  },
  {
    parent_task_id: 4,
    school_id: SCOPE.school_id,
    class_id: SCOPE.class_id,
    teacher_id: TEACHER.teacher_id,
    term_id: TERM.term_id,
    parent_task_type: 't1',
    parent_task_title: '暑期生活小记',
    task_background: null,
    task_detail: '请家长记录幼儿一次自己完成的家务。',
    start_at: '2026-08-10T08:00:00+08:00',
    due_at: '2026-08-16T18:00:00+08:00',
    publish_status: 's3',
    published_at: '2026-08-10T07:50:00+08:00',
    created_at: '2026-08-09T10:00:00+08:00',
    updated_at: '2026-08-17T09:00:00+08:00',
  },
];

const PARENT_TASK_SNAPSHOT = PARENT_TASKS.map((t) => ({ ...t }));

/**
 * 家长提交行。**缺行等价 c2**（契约 §4 规则 2 的 `effective_submission_status`），
 * 所以这里只放真的交了的那些，看板按名册左连接补齐。
 */
const PARENT_TASK_SUBMISSIONS = [];
CHILDREN.forEach((child, idx) => {
  if (idx % 3 !== 0) {
    PARENT_TASK_SUBMISSIONS.push({
      parent_task_id: 2,
      child_id: child.child_id,
      submission_status: 'c1',
      // 一名幼儿的提交正在内容安全批次里。看板只回布尔化的「审核中」，不回批次键。
      under_content_check: idx === 4,
      submitted_at: '2026-08-25T20:11:00+08:00',
    });
  }
  if (idx < 5) {
    PARENT_TASK_SUBMISSIONS.push({
      parent_task_id: 3,
      child_id: child.child_id,
      submission_status: 'c1',
      under_content_check: false,
      submitted_at: '2026-08-22T19:30:00+08:00',
    });
  }
});

const PARENT_TASK_SUBMISSION_SNAPSHOT = PARENT_TASK_SUBMISSIONS.map((s) => ({ ...s }));

/** 把这两张票的可变夹具收回原样。`start()` 每次调用都跑它。 */
function resetHomeSchool() {
  MOMENTS.length = MOMENT_SNAPSHOT.length;
  MOMENT_SNAPSHOT.forEach((row, i) => {
    MOMENTS[i] = { ...row, child_id: row.child_id.slice(), file_id: row.file_id.slice() };
  });
  PARENT_TASKS.length = PARENT_TASK_SNAPSHOT.length;
  PARENT_TASK_SNAPSHOT.forEach((row, i) => { PARENT_TASKS[i] = { ...row }; });
  PARENT_TASK_SUBMISSIONS.length = PARENT_TASK_SUBMISSION_SNAPSHOT.length;
  PARENT_TASK_SUBMISSION_SNAPSHOT.forEach((row, i) => { PARENT_TASK_SUBMISSIONS[i] = { ...row }; });
  state.nextMomentId = 900;
  state.nextParentTaskId = 600;
  state.momentPublications.length = 0;
  state.parentTaskPublications.length = 0;
}

/** GET /org/class-roster —— 名册型，整取不分页。契约缺口，见上方头注。 */
function getClassRoster(req, res) {
  return sendJson(res, 200, {
    class_id: SCOPE.class_id,
    class_name: SCOPE.class_name,
    items: CHILDREN.map((c) => ({ ...c })),
  });
}

// ── 在园时光（票据 17） ─────────────────────────────────────────────────────
//
// 状态机只有三个值（契约 MomentStatus）：F10／Q59-k1 删掉了没有事实来源的 s2 待审 与
// s4 驳回 —— 教师确认内容符合规范后直接 s1 -> s3，**不存在等待管理端处理的中间态**。
//
//   NONE --POST /moments--> s1 --publication--> s3 --withdrawal--> s5 --restoration--> s3
//   s1 --PATCH--> s1
//
// s5 由两条路产生（教师自撤、管理员 d3 下架），状态值本身不区分；`withdrawn_by_admin`
// 才是判据，教师不得推翻管理员那一笔（Q59-m1a）。

const MOMENT_WRITE_FIELDS = [
  { key: 'moment_title', required: false, kind: 'text', max: 50 },
  { key: 'moment_content', required: false, kind: 'text', max: 600 },
  { key: 'moment_date', required: false, kind: 'date' },
  { key: 'child_id', required: false, kind: 'int_array' },
  { key: 'file_id', required: false, kind: 'int_array' },
];

// §1.2：写入端只收裸日期，无时间、无偏移。
const WIRE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 草稿写入校验。
 *
 * 草稿允许不完整（契约明写：标题可空、零幼儿、零图片），完整性只在发布时验，所以这里
 * 没有一个必填项。能在这一步拒绝的只有形状：未知键、超长、非法日期、越界幼儿、超九张图。
 */
function validateMomentWrite(body) {
  const bad = validateWrite(body, MOMENT_WRITE_FIELDS, { partial: true });
  if (bad) return { status: 422, code: 'validation_failed', details: bad };

  if (body.moment_date !== undefined && body.moment_date !== null
      && !WIRE_DATE.test(body.moment_date)) {
    return {
      status: 422,
      code: 'validation_failed',
      details: { field: 'moment_date', rule: 'bare_date_yyyy_mm_dd' },
    };
  }
  if (Array.isArray(body.file_id)) {
    if (body.file_id.length > 9) {
      return { status: 422, code: 'validation_failed', details: { field: 'file_id', rule: 'moment_image_limit' } };
    }
    if (new Set(body.file_id).size !== body.file_id.length) {
      return { status: 422, code: 'validation_failed', details: { field: 'file_id', rule: 'unique_items' } };
    }
  }
  if (Array.isArray(body.child_id)) {
    // teacher 端 `child_id` 是 scoped：服务端把 class_id=$ctx_class 内联进同一条
    // predicate 重验，越界回 422 scope_violation（契约 MomentDraftWrite）。
    const known = new Set(CHILDREN.map((c) => c.child_id));
    const stray = body.child_id.find((id) => !known.has(id));
    if (stray !== undefined) {
      return { status: 422, code: 'scope_violation', details: { field: 'child_id', rule: 'child_in_own_class' } };
    }
  }
  return null;
}

function momentBody(row) {
  return { ...row, child_id: row.child_id.slice(), file_id: row.file_id.slice() };
}

/** POST /moments —— 建草稿（NONE -> s1）。 */
function postMoment(req, res, rawBody) {
  if (refuseWithoutTerm(res)) return;
  // §7.3 / §1.2：派生列与事件时间戳在 schema 校验**之前**剥掉，所以提交它们既不生效
  // 也不报错。`week_key` 同属这一族 —— 它由 moment_date 派生，契约明写提交被忽略。
  const body = stripDerived(rawBody);
  delete body.week_key;

  const bad = validateMomentWrite(body);
  if (bad) return fail(res, bad.status, bad.code, '填写内容不符合要求', bad.details);

  const date = body.moment_date || MOMENT_TODAY;
  const row = {
    moment_id: state.nextMomentId++,
    school_id: SCOPE.school_id,
    class_id: SCOPE.class_id,
    teacher_id: TEACHER.teacher_id,
    moment_title: body.moment_title || null,
    moment_content: body.moment_content || null,
    moment_date: date,
    week_key: isoWeekKey(date),
    child_id: body.child_id ? body.child_id.slice() : [],
    file_id: body.file_id ? body.file_id.slice() : [],
    publish_status: 's1',
    published_at: null,
    withdrawn_by_admin: false,
    created_at: '2026-08-26T17:30:00+08:00',
    updated_at: '2026-08-26T17:30:00+08:00',
  };
  MOMENTS.unshift(row);
  return sendJson(res, 201, momentBody(row), { Location: `${BASE}/moments/${row.moment_id}` });
}

/**
 * PATCH /moments/{id} —— 草稿自动保存（s1 -> s1，整份 LWW）。
 *
 * **没有 revision，不做合并，不加锁**（契约 §5.1）：多装置并发保存是整份
 * last-write-wins，产品明确接受低概率内容遗失。s3／s5 一律 409：正文、日期、图片与
 * 幼儿名单在发布后永久唯读，修正须撤回后另建新草稿（F16）。
 */
function patchMoment(req, res, id, rawBody) {
  if (refuseWithoutTerm(res)) return;
  const row = MOMENTS.find((m) => m.moment_id === Number(id));
  if (!row) return fail(res, 404, 'not_found', '在园时光不存在或不在可见范围内');
  if (row.publish_status !== 's1') {
    return fail(res, 409, 'state_precondition_failed', '已发布的在园时光不能修改，请撤回后另建草稿',
      { from: row.publish_status, required: 's1' });
  }

  const body = stripDerived(rawBody);
  delete body.week_key;
  const bad = validateMomentWrite(body);
  if (bad) return fail(res, bad.status, bad.code, '填写内容不符合要求', bad.details);

  // `child_id` 与 `file_id` 是**整份替换**，不是追加（契约 `child_select_rule`）。
  MOMENT_WRITE_FIELDS.forEach((f) => {
    if (body[f.key] === undefined) return;
    row[f.key] = Array.isArray(body[f.key]) ? body[f.key].slice() : body[f.key];
  });
  if (body.moment_date !== undefined) row.week_key = isoWeekKey(row.moment_date);
  row.updated_at = '2026-08-26T17:35:00+08:00';
  return sendJson(res, 200, momentBody(row));
}

/**
 * POST /moments/{id}/publication —— 发布（s1 -> s3）。
 *
 * **这个按钮本身就是人工审核**（F10／Q59-h1）：不送微信内容安全 API、不进管理端待审
 * 队列、不写 db_review_action，也不新增任何合规声明或 `content_reviewed_at`。
 * 发布是 one-way，`published_at` 服务端设值，**不建立任何家长通知**（Q59-m4）。
 */
function postMomentPublication(req, res, id) {
  if (refuseWithoutTerm(res)) return;
  const row = MOMENTS.find((m) => m.moment_id === Number(id));
  if (!row) return fail(res, 404, 'not_found', '在园时光不存在或不在可见范围内');
  if (row.publish_status !== 's1') {
    return fail(res, 409, 'state_precondition_failed', '只有草稿可以发布',
      { from: row.publish_status, required: 's1' });
  }

  // 发布前置，四条，全部服务端复验（契约逐条抄录）。
  const title = (row.moment_title || '').trim();
  if (title.length < 1 || title.length > 50) {
    return fail(res, 422, 'validation_failed', '填写内容不符合要求',
      { field: 'moment_title', rule: 'length_1_50' });
  }
  if (!row.child_id.length) {
    return fail(res, 422, 'validation_failed', '填写内容不符合要求',
      { field: 'child_id', rule: 'at_least_one_child' });
  }
  const content = (row.moment_content || '').trim();
  if (content.length === 0 && row.file_id.length === 0) {
    return fail(res, 422, 'validation_failed', '填写内容不符合要求',
      { field: 'moment_content', rule: 'content_or_image_required' });
  }
  if (content.length > 600) {
    return fail(res, 422, 'validation_failed', '填写内容不符合要求',
      { field: 'moment_content', rule: 'max_length_600' });
  }
  if (row.file_id.length > 9) {
    return fail(res, 422, 'validation_failed', '填写内容不符合要求',
      { field: 'file_id', rule: 'moment_image_limit' });
  }

  row.publish_status = 's3';
  row.published_at = '2026-08-26T17:40:00+08:00';
  row.updated_at = row.published_at;
  state.momentPublications.push({ moment_id: row.moment_id, teacher_id: TEACHER.teacher_id });
  return sendJson(res, 200, momentBody(row));
}

/** POST /moments/{id}/withdrawal —— 教师自行撤回（s3 -> s5）。周覆盖计数随之退出。 */
function postMomentWithdrawal(req, res, id) {
  if (refuseWithoutTerm(res)) return;
  const row = MOMENTS.find((m) => m.moment_id === Number(id));
  if (!row) return fail(res, 404, 'not_found', '在园时光不存在或不在可见范围内');
  if (row.publish_status !== 's3') {
    return fail(res, 409, 'state_precondition_failed', '只有已发布的在园时光可以撤回',
      { from: row.publish_status, required: 's3' });
  }
  row.publish_status = 's5';
  row.withdrawn_by_admin = false;
  row.updated_at = '2026-08-26T17:45:00+08:00';
  return sendJson(res, 200, momentBody(row));
}

/**
 * POST /moments/{id}/restoration —— 教师自行恢复（s5 -> s3）。
 *
 * **教师不得推翻管理员撤回**（Q59-m1a）：管理员 d3 下架的那一笔回 409，只能由同园
 * 管理员以 d5 恢复。恢复只让 moment 本身重新公开，不重建已解除的下游引用。
 */
function postMomentRestoration(req, res, id) {
  if (refuseWithoutTerm(res)) return;
  const row = MOMENTS.find((m) => m.moment_id === Number(id));
  if (!row) return fail(res, 404, 'not_found', '在园时光不存在或不在可见范围内');
  if (row.publish_status !== 's5') {
    return fail(res, 409, 'state_precondition_failed', '只有已撤回的在园时光可以恢复',
      { from: row.publish_status, required: 's5' });
  }
  if (row.withdrawn_by_admin) {
    return fail(res, 409, 'state_precondition_failed', '这一则由管理端下架，只能由管理员恢复');
  }
  row.publish_status = 's3';
  row.updated_at = '2026-08-26T17:50:00+08:00';
  return sendJson(res, 200, momentBody(row));
}

/** GET /moments —— 游标分页，`moment_date DESC, moment_id DESC`。 */
function getMoments(req, res, url) {
  const filters = {
    week_key: url.searchParams.get('week_key') || '',
    publish_status: url.searchParams.get('publish_status') || '',
  };
  let rows = MOMENTS.slice();
  if (filters.week_key) rows = rows.filter((m) => m.week_key === filters.week_key);
  if (filters.publish_status) rows = rows.filter((m) => m.publish_status === filters.publish_status);

  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    const decoded = decodeCursor(cursor, filters);
    if (decoded.error) return fail(res, 400, decoded.error, '游标无效或与筛选条件不匹配');
    const at = rows.findIndex((m) => m.moment_id === decoded.key);
    rows = at === -1 ? [] : rows.slice(at + 1);
  }
  const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100);
  const page = rows.slice(0, limit);
  const more = rows.length > limit;
  return sendJson(res, 200, {
    items: page.map(momentBody),
    next_cursor: more && page.length ? encodeCursor(page[page.length - 1].moment_id, filters) : null,
  });
}

/**
 * GET /moments/weekly-coverage —— 本班每名幼儿的周覆盖次数（只读派生）。
 *
 * 计数口径逐条抄契约（§4 规则 1／Q59-c1—c3）：只计 `publish_status='s3'` 且覆盖该幼儿
 * 的 **distinct moment_id**；`>=2` 完成，`0`／`1` 未完成，**超过 2 照实显示不截断**。
 * 撤回退出聚合是**派生的**，不是一次写入 —— 所以这里就地数，不存计数。
 *
 * 名册型：`child_id ASC`，**整取不分页**（§3.5）。对象集合是查询当下仍属本班的幼儿，
 * 不是当周名册快照。
 */
function getMomentWeeklyCoverage(req, res, url) {
  const weekKey = url.searchParams.get('week_key') || isoWeekKey(MOMENT_TODAY);
  const published = MOMENTS.filter((m) => m.publish_status === 's3' && m.week_key === weekKey);
  const items = CHILDREN.map((child) => {
    const count = new Set(
      published.filter((m) => m.child_id.indexOf(child.child_id) !== -1).map((m) => m.moment_id)
    ).size;
    return {
      child_id: child.child_id,
      moment_weekly_complete_count: count,
      moment_detail_week_status: count >= 2 ? 'd1' : (count === 1 ? 'd2' : 'd3'),
      moment_status: count >= 2 ? 'h1' : 'h2',
    };
  });
  return sendJson(res, 200, { week_key: weekKey, items });
}

// ── 亲子任务（票据 19） ─────────────────────────────────────────────────────
//
//   NONE --POST--> s1 草稿 --publication--> s2 已发布 --closure--> s3 已结束
//   s1 --PATCH--> s1
//
// **没有任何回头路**（F16）：s2／s3 的时间、正文、附件与 term_id 全部唯读，要改只能
// 关闭旧任务再新建。契约里没有 s2 -> s1，也没有 s3 -> s2。

const PARENT_TASK_WRITE_FIELDS = [
  { key: 'parent_task_type', required: true, kind: 'enum', values: ['t1', 't2'] },
  { key: 'parent_task_title', required: true, kind: 'text', max: 100 },
  { key: 'task_background', required: false, kind: 'text', max: 500 },
  { key: 'task_detail', required: true, kind: 'text', max: 1000 },
  { key: 'start_at', required: true, kind: 'planned_time' },
  { key: 'due_at', required: false, kind: 'planned_time' },
];

/**
 * §1.2 的计划时刻校验。**白名单只有 `start_at` 与 `due_at` 这两列到得了这个端点**；
 * 其余每一个 `*_at` 都是事件时间戳，由 `stripDerived` 静默剥掉，不报错也不生效。
 *
 * 偏移量是**字面量，不是转换**：`Z`、`+00:00`、`+09:00` 一律 422，服务端不做换算。
 * 换算会把教师设的 18:00 截止悄悄变成隔天 02:00 —— 整套裸值制度存在的理由就是不让
 * 这件事发生。
 */
function validatePlannedTimes(body) {
  for (const field of ['start_at', 'due_at']) {
    const value = body[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' || !WIRE_AT.test(value)) {
      return { field, rule: 'offset_must_be_plus0800_literal' };
    }
  }
  return null;
}

function parentTaskBody(row) {
  return { ...row };
}

/** POST /home-school/parent-tasks —— 新建草稿（NONE -> s1）。 */
function postHomeSchoolParentTask(req, res, rawBody) {
  if (refuseWithoutTerm(res)) return;
  const body = stripDerived(rawBody);
  // `term_id` 也不由客户端提交：它在发布时由 start_at 派生（§4 规则 2）。
  delete body.term_id;

  const badTime = validatePlannedTimes(body);
  if (badTime) return fail(res, 422, 'timestamp_not_accepted', '时间格式不被接受', badTime);
  const bad = validateWrite(body, PARENT_TASK_WRITE_FIELDS);
  if (bad) return fail(res, 422, 'validation_failed', '填写内容不符合要求', bad);

  const row = {
    parent_task_id: state.nextParentTaskId++,
    school_id: SCOPE.school_id,
    class_id: SCOPE.class_id,
    teacher_id: TEACHER.teacher_id,
    term_id: null,
    parent_task_type: body.parent_task_type,
    parent_task_title: body.parent_task_title,
    task_background: body.task_background === undefined ? null : body.task_background,
    task_detail: body.task_detail,
    start_at: body.start_at,
    due_at: body.due_at === undefined ? null : body.due_at,
    publish_status: 's1',
    // 服务端设值。客户端提交的 published_at 已经被剥掉，所以这里回的一定是自己的值。
    published_at: null,
    created_at: '2026-08-26T18:00:00+08:00',
    updated_at: '2026-08-26T18:00:00+08:00',
  };
  PARENT_TASKS.unshift(row);
  return sendJson(res, 201, parentTaskBody(row), {
    Location: `${BASE}/home-school/parent-tasks/${row.parent_task_id}`,
  });
}

/** GET /home-school/parent-tasks/{id} —— 一条任务，整条。不在范围内回 404（§2.3）。 */
function getHomeSchoolParentTask(req, res, id) {
  const row = PARENT_TASKS.find((t) => t.parent_task_id === Number(id));
  if (!row) return fail(res, 404, 'not_found', '亲子任务不存在或不在可见范围内');
  return sendJson(res, 200, parentTaskBody(row));
}

/** PATCH /home-school/parent-tasks/{id} —— 改草稿，仅 s1。 */
function patchHomeSchoolParentTask(req, res, id, rawBody) {
  if (refuseWithoutTerm(res)) return;
  const row = PARENT_TASKS.find((t) => t.parent_task_id === Number(id));
  if (!row) return fail(res, 404, 'not_found', '亲子任务不存在或不在可见范围内');
  if (row.publish_status !== 's1') {
    return fail(res, 409, 'state_precondition_failed', '已发布的任务不能修改，请结束后新建',
      { from: row.publish_status, required: 's1' });
  }
  const body = stripDerived(rawBody);
  delete body.term_id;

  const badTime = validatePlannedTimes(body);
  if (badTime) return fail(res, 422, 'timestamp_not_accepted', '时间格式不被接受', badTime);
  const bad = validateWrite(body, PARENT_TASK_WRITE_FIELDS, { partial: true });
  if (bad) return fail(res, 422, 'validation_failed', '填写内容不符合要求', bad);

  applyWrite(row, body, PARENT_TASK_WRITE_FIELDS);
  row.updated_at = '2026-08-26T18:05:00+08:00';
  return sendJson(res, 200, parentTaskBody(row));
}

/**
 * POST /home-school/parent-tasks/{id}/publication —— 发布（s1 -> s2）。
 *
 * 同事务按 `start_at` 落在哪个园历区间派生**唯一** `term_id` 并写入；**未命中即拒绝
 * 发布**，回 409 no_active_term。**绝不猜一个学期**（§5.4）。请求体为空 —— 内容在草稿
 * 阶段已经写好，这一步只做状态转移与派生。
 */
function postParentTaskPublication(req, res, id) {
  if (refuseWithoutTerm(res)) return;
  const row = PARENT_TASKS.find((t) => t.parent_task_id === Number(id));
  if (!row) return fail(res, 404, 'not_found', '亲子任务不存在或不在可见范围内');
  if (row.publish_status !== 's1') {
    return fail(res, 409, 'state_precondition_failed', '只有草稿可以发布',
      { from: row.publish_status, required: 's1' });
  }
  // `start_at` 的日期部分要落进园历区间。裸串比较即可：三个值同为 YYYY-MM-DD 前缀。
  const startDate = String(row.start_at).slice(0, 10);
  if (startDate < TERM.start_date || startDate > TERM.end_date) {
    return fail(res, 409, 'no_active_term', '开始时间没有落进任何一个学期，无法发布');
  }
  row.publish_status = 's2';
  row.term_id = TERM.term_id;
  row.published_at = '2026-08-26T18:10:00+08:00';
  row.updated_at = row.published_at;
  state.parentTaskPublications.push({ parent_task_id: row.parent_task_id, teacher_id: TEACHER.teacher_id });
  return sendJson(res, 200, parentTaskBody(row));
}

/** POST /home-school/parent-tasks/{id}/closure —— 结束（s2 -> s3）。s3 没有回头路。 */
function postParentTaskClosure(req, res, id) {
  if (refuseWithoutTerm(res)) return;
  const row = PARENT_TASKS.find((t) => t.parent_task_id === Number(id));
  if (!row) return fail(res, 404, 'not_found', '亲子任务不存在或不在可见范围内');
  if (row.publish_status !== 's2') {
    return fail(res, 409, 'state_precondition_failed', '只有已发布的任务可以结束',
      { from: row.publish_status, required: 's2' });
  }
  row.publish_status = 's3';
  row.updated_at = '2026-08-26T18:15:00+08:00';
  return sendJson(res, 200, parentTaskBody(row));
}

/** GET /home-school/parent-tasks —— 游标分页，`updated_at DESC, parent_task_id DESC`。 */
function getHomeSchoolParentTasks(req, res, url) {
  const filters = {
    publish_status: url.searchParams.get('publish_status') || '',
    parent_task_type: url.searchParams.get('parent_task_type') || '',
  };
  let rows = PARENT_TASKS.slice()
    .sort((a, b) => (a.updated_at === b.updated_at
      ? b.parent_task_id - a.parent_task_id
      : (a.updated_at < b.updated_at ? 1 : -1)));
  if (filters.publish_status) rows = rows.filter((t) => t.publish_status === filters.publish_status);
  if (filters.parent_task_type) rows = rows.filter((t) => t.parent_task_type === filters.parent_task_type);

  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    const decoded = decodeCursor(cursor, filters);
    if (decoded.error) return fail(res, 400, decoded.error, '游标无效或与筛选条件不匹配');
    const at = rows.findIndex((t) => t.parent_task_id === decoded.key);
    rows = at === -1 ? [] : rows.slice(at + 1);
  }
  const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100);
  const page = rows.slice(0, limit);
  const more = rows.length > limit;
  return sendJson(res, 200, {
    items: page.map(parentTaskBody),
    next_cursor: more && page.length ? encodeCursor(page[page.length - 1].parent_task_id, filters) : null,
  });
}

/**
 * GET /home-school/parent-tasks/{id}/submissions —— 完成情况看板。
 *
 * 名册型：按本班在园名册**左连接**提交行，缺行等价 `c2`；`child_id ASC`，**整取不
 * 分页**（§3.5）。`active_check_batch_key` 的批次内容不回，只回布尔化的「审核中」——
 * 批次键是内部工作值，教师侧没有任何依赖它的动作。
 *
 * ⚠ `openapi.yaml` 在这条路径上**声明了 `limit` 与 `cursor` 两个参数**，与它自己的
 * `x-hualong-sort: child_id ASC` 和 §3.5「名册型不分页」相矛盾。契约正文是权威，所以
 * 这里整取，`next_cursor` 恒为 null；这条自相矛盾记进交接。
 */
function getParentTaskSubmissions(req, res, id) {
  const taskId = Number(id);
  const task = PARENT_TASKS.find((t) => t.parent_task_id === taskId);
  if (!task) return fail(res, 404, 'not_found', '亲子任务不存在或不在可见范围内');

  const items = CHILDREN.map((child) => {
    const hit = PARENT_TASK_SUBMISSIONS.find(
      (s) => s.parent_task_id === taskId && s.child_id === child.child_id
    );
    return {
      child_id: child.child_id,
      child_name: child.child_name,
      submission_status: hit ? hit.submission_status : 'c2',
      under_content_check: hit ? hit.under_content_check : false,
      submitted_at: hit ? hit.submitted_at : null,
    };
  });
  return sendJson(res, 200, { items, next_cursor: null });
}

// ══════════════════════════════════════════════════════════════════════════
// 五大领域量表与综合评估（票据 18）
// ══════════════════════════════════════════════════════════════════════════
//
//   NONE --PUT items/{id} 首次评分--> c2 草稿 --PUT 末题--> c1 已完成
//
// **一个端点，两个已登记出口**（api/action-registry.tsv 两行、openapi 一条路径）：
// `child_assessment.score_item`（NONE→c2）与 `child_assessment.score_item.complete`
// （c2→c1）。中间那些不改状态的评分（c2→c2）刻意没有登记行 —— 登记表记转移，不记端点。
//
// 三条规则抄契约，不是这里发明的：
//   1. `completed_count` = **题项列数**。未评的题没有列，不是 0 分。重评已评的题不涨。
//   2. `child_assessment_status` 由 `completed_count` 派生，**请求体里没有它**。
//   3. 主记录在**首次评分时**建立，同事务绑定 `scale_code`／`scale_version`／
//      `required_count`。升版不回头把旧记录判成草稿。一题未评时主记录不存在，GET 回 404。

/**
 * 题库来自 `data/guide-scale.json`，**服务端读一次**。
 *
 * 后端 spec 05 写明这份 JSON 是 `db_scale_item` 的导入来源（reference data，
 * `UNIQUE(scale_code, scale_version, item_id)`，无状态列、不进覆盖账本）。所以在这个
 * mock 里它扮演那张表。**题库只有这一份**：客户端不内嵌，页面不持有。
 */
const GUIDE_SCALE = JSON.parse(
  readFileSync(new URL('../data/guide-scale.json', import.meta.url), 'utf8')
);

const SCALE_CODE = 'guide';
const SCALE_VERSION = '1.0';

// ══════════════════════════════════════════════════════════════════════════
// 办园质量评估（`db_assessment`）
// ══════════════════════════════════════════════════════════════════════════
//
// **与上面那份五大领域量表是两件不同的量具，别混。**
//
//   办园质量评估  评的是园所：9 个一级指标、30 个小节、120 题。表是 `db_assessment`
//                 与 `db_assessment_item`。首页那张「质量评估」卡指的一直是它，
//                 角标分母是这 120。
//   五大领域量表  评的是**一名幼儿**：5 个领域、124 题，表是 `db_child_assessment`。
//
// ── 三条端点都在契约里，别再发明第四条 ────────────────────────────────────
//
//   `GET /assessments`                                listAssessments
//   `GET /assessments/{id}`                           getAssessment（Assessment + items）
//   `PUT /assessments/{id}/items/{tool_item_code}`    scoreAssessmentItem
//
// 手写它们是因为生成路由只会回样本，拼不出一份评估。契约同时说明了两件**没有**的事：
//
//   **没有创建端点。** `NONE→s1` 没有任何决议指定谁建、何时建、`assessment_scope`
//   与 `assessment_period` 从哪来 —— 契约原话「本端点不创建评估」，并注明教师端唯一
//   的按钮是带着既有 `assessment_id` 跳转的。所以这里的夹具**预先摆好一份**，不提供
//   建的路径；那个缺口是后端的候选缺口，不是客户端能补的。
//
//   **没有提交端点。** 提交这个动作不存在：评完末一题即 s3（登记的两条转移是
//   `assessment.score_item` s1→s2 与 `assessment.score_item.complete` s2→s3）。
//
// 题文也不在这里：契约写着「题文不随作答复制，客户端按 `tool_code + tool_version`
// 从版本化代码资产解析」，所以题库随客户端发版，本响应只回 `tool_item_code` 与作答。

const QUALITY_CODE = 'school-quality-120';
const QUALITY_VERSION = '1.0.0';
const QUALITY_REQUIRED_COUNT = 120;

/**
 * `db_assessment` 一行加它的 `db_assessment_item`。
 *
 * **夹具预先摆好一份**，理由见上：契约里没有创建端点，而教师端那张卡是带着既有
 * `assessment_id` 跳转的。一份空的（一题未评，s1）正是首页角标要显示 `0/120` 的状态。
 */
const ASSESSMENTS = [
  {
    assessment_id: 401,
    class_id: SCOPE.class_id,
    teacher_id: TEACHER.teacher_id,
    // 评的是园所，所以是 a3。`a4=child` 已由 B4 拔除 —— 幼儿用的不是这份工具。
    assessment_scope: 'a3',
    assessment_period: '2026-08',
    tool_code: QUALITY_CODE,
    tool_version: QUALITY_VERSION,
    submitted_at: null,
  },
];

const ASSESSMENT_SNAPSHOT = ASSESSMENTS.map((r) => ({ ...r }));

/** assessment_id -> Map(tool_item_code -> { score, note, file_id }) */
const assessmentItems = new Map();

function resetQuality() {
  ASSESSMENTS.length = ASSESSMENT_SNAPSHOT.length;
  ASSESSMENT_SNAPSHOT.forEach((row, i) => { ASSESSMENTS[i] = { ...row }; });
  assessmentItems.clear();
  state.assessmentScores.length = 0;
}

function itemsOf(id) {
  if (!assessmentItems.has(id)) assessmentItems.set(id, new Map());
  return assessmentItems.get(id);
}

/** `completed_count` = 有 1—5 分的题项数（契约原话）。 */
function assessmentCompletedCount(id) {
  return [...itemsOf(id).values()].filter((i) => i.score >= 1 && i.score <= 5).length;
}

/**
 * `assessment_status` 由 `completed_count` **派生**，请求体里没有它。
 * 一题未评 s1，评了一部分 s2，评满 s3（01 home-spec.md 的 method 段）。
 */
function assessmentStatusOf(id) {
  const done = assessmentCompletedCount(id);
  if (done === 0) return 's1';
  return done < QUALITY_REQUIRED_COUNT ? 's2' : 's3';
}

/** 契约的 `Assessment`：进度与状态派生，题文一个字也不回。 */
function toAssessment(row) {
  return {
    ...row,
    required_count: QUALITY_REQUIRED_COUNT,
    completed_count: assessmentCompletedCount(row.assessment_id),
    assessment_status: assessmentStatusOf(row.assessment_id),
  };
}

/** GET /assessments —— 本人的评估列表，`assessment_period DESC, assessment_id DESC`。 */
function getAssessments(req, res) {
  const items = ASSESSMENTS
    .slice()
    .sort((a, b) => (a.assessment_period === b.assessment_period
      ? b.assessment_id - a.assessment_id
      : (a.assessment_period < b.assessment_period ? 1 : -1)))
    .map(toAssessment);
  return sendJson(res, 200, { items, next_cursor: null });
}

/** GET /assessments/{id} —— 契约的 `AssessmentDetail`：Assessment 加已作答的题项。 */
function getAssessment(req, res, id) {
  const row = ASSESSMENTS.find((r) => r.assessment_id === Number(id));
  if (!row) return fail(res, 404, 'not_found', '这份评估不存在或不在可见范围内');
  return sendJson(res, 200, {
    ...toAssessment(row),
    items: [...itemsOf(row.assessment_id).entries()].map(([code, i]) => ({
      tool_item_code: code,
      score: i.score,
      note: i.note,
      file_id: i.file_id.slice(),
    })),
  });
}

/**
 * PUT /assessments/{id}/items/{tool_item_code} —— 逐题作答。
 *
 * 一个动作，两条已登记转移：首题 s1→s2，末题 s2→s3。**没有单独的提交动作**，
 * 所以评满那一刻就是完成那一刻。回的是该次评估的最新进度（契约的 `Assessment`）。
 *
 * 题号必须是这件工具真有的一条。**服务端不校验题文**——题文是客户端按
 * `tool_code + tool_version` 解析的代码资产，这里只认代码格式。
 */
function putAssessmentItem(req, res, id, code, body) {
  const row = ASSESSMENTS.find((r) => r.assessment_id === Number(id));
  if (!row) return fail(res, 404, 'not_found', '这份评估不存在或不在可见范围内');
  if (assessmentStatusOf(row.assessment_id) === 's3' && !itemsOf(row.assessment_id).has(code)) {
    return fail(res, 409, 'conflict', '这份评估已评满，不能再加题');
  }
  if (!/^I\d{3}$/.test(code)) {
    return fail(res, 404, 'not_found', '没有这道题');
  }

  const score = body.score;
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return fail(res, 422, 'validation_failed', '打分必须是 1 到 5',
      { field: 'score', rule: 'between_1_and_5' });
  }
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length > 300) {
    return fail(res, 422, 'validation_failed', '评价记录最多 300 字',
      { field: 'note', rule: 'max_len_300' });
  }
  // 佐证材料走 `db_file_ref(owner_object='db_assessment_item', usage_key='evidence')`，
  // `db_assessment_item` 本身没有 file_id 列 —— 契约原话。这里只记引用。
  const files = Array.isArray(body.file_id) ? body.file_id : [];

  itemsOf(row.assessment_id).set(code, { score, note, file_id: files });
  state.assessmentScores.push({ assessment_id: row.assessment_id, tool_item_code: code });
  return sendJson(res, 200, toAssessment(row));
}

/** 124 条题项，四层层级拍平 —— 层级不落表，靠 `item_id` 前缀逐级截断（§2.6）。 */
const SCALE_ITEMS = Object.freeze(
  GUIDE_SCALE.domains.flatMap((domain) => domain.aspects.flatMap(
    (aspect) => aspect.goals.flatMap((goal) => goal.items.map((item) => Object.freeze({
      item_id: item.item_id,
      // `item_name` 短名与 `question` 完整问句是**两段不同的文字**，合并会让其中一页
      // 没字可显示（DATABASE_SPEC.md §3.1 的 2026-08-14 更正）。
      item_name: item.item_name,
      question: item.question,
      item_type: item.item_type,
      anchors: item.anchors,
      anchored_levels: item.anchored_levels || [],
      inferred_levels: item.inferred_levels || [],
    })))
  ))
);

const SCALE_REQUIRED_COUNT = SCALE_ITEMS.length;

/**
 * 每名幼儿一份评估，进程内持久。
 *
 * **草稿要真的存得住**：教师填一半退出、再进来，读回来的必须是刚才那些题。所以这张表
 * 活在 `state` 上而不是每次请求现造，`start()` 才清空它。
 *
 * 形状：`child_id -> { child_assessment_id, scale_code, scale_version, required_count,
 * scores: Map<item_id, score>, submitted_at }`。
 */
function assessmentFor(childId) {
  return state.childAssessments.get(childId) || null;
}

function assessmentStatus(row) {
  return row.scores.size >= row.required_count ? 'c1' : 'c2';
}

/** `ChildAssessmentProgress` —— 名册左连接的进度行。无记录时 `child_assessment_id` 为空。 */
function assessmentProgress(child) {
  const row = assessmentFor(child.child_id);
  if (!row) {
    return {
      child_id: child.child_id,
      child_name: child.child_name,
      child_assessment_id: null,
      scale_code: null,
      scale_version: null,
      // 分母来自**现役**量表：还没有主记录的幼儿还没绑定版本。
      required_count: SCALE_REQUIRED_COUNT,
      completed_count: 0,
      child_assessment_status: 'c2',
      submitted_at: null,
    };
  }
  return {
    child_id: child.child_id,
    child_name: child.child_name,
    child_assessment_id: row.child_assessment_id,
    scale_code: row.scale_code,
    scale_version: row.scale_version,
    // 分母随**该行绑定的版本**解释，不随最新版本变动（契约原话）。
    required_count: row.required_count,
    completed_count: row.scores.size,
    child_assessment_status: assessmentStatus(row),
    submitted_at: row.submitted_at,
  };
}

/** 本班在园名册里的那一名幼儿，或 null。范围不符与不存在在这里是同一件事（§2.3）。 */
function childInScope(id) {
  return CHILDREN.find((c) => c.child_id === Number(id)) || null;
}

/**
 * GET /scales/{scale_code}/{scale_version} —— 题库下发，124 题。
 *
 * 只有现役 `guide` 1.0 由这个处理器答；其他版本落到契约生成的路由上（本 mock 不装载
 * 第二份题库，而广度测试打的是一个占位版本号）。
 */
function getScale(req, res) {
  return sendJson(res, 200, {
    scale_code: SCALE_CODE,
    scale_version: SCALE_VERSION,
    items: SCALE_ITEMS.map((item) => ({ ...item })),
  });
}

/** GET /child-assessments —— 名册型，**整取不分页**（§3.5），`child_id ASC`。 */
function getChildAssessments(req, res) {
  return sendJson(res, 200, { items: CHILDREN.map(assessmentProgress) });
}

/**
 * GET /children/{child_id}/child-assessment —— 主记录与**已评题**，续填用。
 *
 * `items` 只含已评题：**未评 = 该题无列，不是 0 分**。一题未评时主记录不存在，回 404 ——
 * 教师第一次进量表页看到的就是它，客户端把它翻译成「还没开始」。
 */
function getChildAssessment(req, res, id) {
  const child = childInScope(id);
  if (!child) return fail(res, 404, 'not_found', '幼儿不存在或不在可见范围内');
  const row = assessmentFor(child.child_id);
  if (!row) return fail(res, 404, 'not_found', '这名幼儿本学期还没有综合评估记录');
  return sendJson(res, 200, {
    ...assessmentProgress(child),
    items: [...row.scores.entries()].map(([item_id, score]) => ({ item_id, score })),
  });
}

/**
 * PUT /children/{child_id}/child-assessment/items/{item_id} —— 逐题增量保存。
 *
 * 请求体是 `ChildAssessmentItemWrite`：`additionalProperties: false`，只有 `score`
 * （1—5 整数，NOT NULL —— 没有「未评」这个值，未评是没有列）。派生键与事件时间戳一律
 * 先剥再验，否则 `additionalProperties: false` 会把一个契约说该收的请求 422 掉（§7.3）。
 */
function putChildAssessmentItem(req, res, id, itemId, rawBody) {
  if (refuseWithoutTerm(res)) return;
  const child = childInScope(id);
  if (!child) return fail(res, 404, 'not_found', '幼儿不存在或不在可见范围内');

  const item = SCALE_ITEMS.find((i) => i.item_id === itemId);
  if (!item) return fail(res, 404, 'not_found', '题号不在现役量表里');

  const body = stripDerived(rawBody || {});
  const extra = Object.keys(body).filter((k) => k !== 'score');
  if (extra.length) {
    return fail(res, 422, 'validation_failed', '请求体含契约未声明的字段',
      { field: extra[0], rule: 'additionalProperties: false' });
  }
  if (!Number.isInteger(body.score) || body.score < 1 || body.score > 5) {
    return fail(res, 422, 'validation_failed', '得分必须是 1 到 5 的整数',
      { field: 'score', rule: 'minimum: 1, maximum: 5' });
  }

  let row = assessmentFor(child.child_id);
  if (!row) {
    // 主记录在首次评分时建立，同事务绑定量表版本与题数。
    row = {
      child_assessment_id: state.nextChildAssessmentId,
      scale_code: SCALE_CODE,
      scale_version: SCALE_VERSION,
      required_count: SCALE_REQUIRED_COUNT,
      scores: new Map(),
      submitted_at: null,
    };
    state.nextChildAssessmentId += 1;
    state.childAssessments.set(child.child_id, row);
  }
  if (assessmentStatus(row) === 'c1') {
    // c1 之后内容锁定。撤销评分（c1→c2）不在转移图上，本契约不提供该路径。
    return fail(res, 409, 'state_precondition_failed', '这份量表已提交，内容已锁定',
      { from: 'c1', required: 'c2' });
  }

  row.scores.set(itemId, body.score);
  if (assessmentStatus(row) === 'c1') {
    row.submitted_at = '2026-08-26T16:20:00+08:00';
    // 服务端真正执行的一次 c2 -> c1。幂等重放在分发层就返回了，处理器根本没跑，所以
    // 这张表不涨 —— 「重复提交只产生一份」要数服务端做了几次，不能数客户端发了几个请求。
    state.childAssessmentCompletions.push({
      child_id: child.child_id,
      child_assessment_id: row.child_assessment_id,
    });
  }
  return sendJson(res, 200, assessmentProgress(child));
}

/**
 * 任一层级的题项级均值（§4 规则 13）。
 *
 * **题项级均值，不是下级均值的均值** —— 各目标／维度题项数不等，两级平均会造成加权失真。
 * 未评的题不进分母；该层级一题未评时回 `null`，**不回 0**：接口要能表达「尚无评分」。
 */
function scaleAggregate(code, scoreLists) {
  let sum = 0;
  let count = 0;
  scoreLists.forEach((scores) => {
    scores.forEach((score, itemId) => {
      if (!itemId.startsWith(code)) return;
      sum += score;
      count += 1;
    });
  });
  return { code, item_count: count, average: count ? sum / count : null };
}

const DOMAIN_CODES = Object.freeze(['H', 'L', 'S', 'K', 'A']);

/** GET /children/{child_id}/child-assessment/report —— 五领域均分 + 逐题明细，零文字分析。 */
function getChildAssessmentReport(req, res, id) {
  const child = childInScope(id);
  if (!child) return fail(res, 404, 'not_found', '幼儿不存在或不在可见范围内');
  const row = assessmentFor(child.child_id);
  if (!row) return fail(res, 404, 'not_found', '这名幼儿本学期还没有综合评估记录');

  const all = scaleAggregate('', [row.scores]);
  return sendJson(res, 200, {
    child_assessment_id: row.child_assessment_id,
    child_id: child.child_id,
    term_id: TERM.term_id,
    scale_code: row.scale_code,
    scale_version: row.scale_version,
    submitted_at: row.submitted_at,
    domains: DOMAIN_CODES.map((code) => scaleAggregate(code, [row.scores])),
    total_average: all.average,
    items: [...row.scores.entries()].map(([item_id, score]) => ({ item_id, score })),
  });
}

/**
 * GET /child-assessments/class-report —— 班级五领域均分。
 *
 * **只统计已完成（c1）**，草稿不计入。无已完成评估时 `assessed_child_count=0` 且
 * `domains: []`，供前端区分「均分 0」与「尚无资料」。
 */
function getChildAssessmentClassReport(req, res) {
  const done = CHILDREN
    .map((c) => assessmentFor(c.child_id))
    .filter((row) => row && assessmentStatus(row) === 'c1');

  return sendJson(res, 200, {
    class_id: SCOPE.class_id,
    term_id: TERM.term_id,
    assessed_child_count: done.length,
    domains: done.length
      ? DOMAIN_CODES.map((code) => scaleAggregate(code, done.map((r) => r.scores)))
      : [],
  });
}

// ── 月度评价与学期评价（票据 20） ───────────────────────────────────────────
//
// 月度评价：`NONE|e1|e2 --PUT--> e1 --publication--> e3`。**`e1` 与 `e2` 的分界是 G51 的
// 未决项**，契约只登记了 `month_eval.publish` 这一条边（`from_state` 写作 `e1|e2`）。这个
// mock 因此把落内容的那一次统一落成 `e1` —— 那是 G51 两种读法里都成立的一支，而且客户端
// **不读** e1／e2（对外一律二元：e3 已完成，其余未完成），所以这个选择影响不到被测的行为。
// 真服务定下分界时改的是这里一行，不是客户端。
//
// 学期评价：`NONE --PUT--> c1`，**一次写成**。全库没有为 `db_term_eval` 定义服务端草稿，
// 所以 `c2` 没有任何写入者 —— 名册左连接时无行即 c2，仅此而已。

// 编号从 1 起，与其余夹具同一条约定：契约巡检（tests/api-coverage.test.mjs）用 `1` 代入
// 每一个路径参数，夹具里没有 1 号就会把「业务前置拒绝」变成一个看起来像门坏了的 404。
// 1 号刻意留在**未发布**态，好让 `POST /home-school/month-evals/1/publication` 真的走得通。
const MONTH_EVALS = [
  {
    month_eval_id: 1,
    teacher_id: TEACHER.teacher_id,
    class_id: SCOPE.class_id,
    child_id: 101,
    eval_month: '2026-07',
    eval_text: '七月这一份还没发布，留着让发布这条边有一个真实的落点。',
    file_id: [],
    month_eval_status: 'e1',
    saved_at: null,
    created_at: '2026-07-30T16:00:00+08:00',
    updated_at: '2026-07-30T16:00:00+08:00',
  },
  {
    month_eval_id: 2,
    teacher_id: TEACHER.teacher_id,
    class_id: SCOPE.class_id,
    child_id: 102,
    eval_month: '2026-07',
    eval_text: '七月能主动收拾自己的餐具，午睡后会帮同伴整理被子。',
    file_id: [],
    month_eval_status: 'e3',
    saved_at: '2026-07-31T17:10:00+08:00',
    created_at: '2026-07-31T16:00:00+08:00',
    updated_at: '2026-07-31T17:10:00+08:00',
  },
];

const MONTH_EVAL_SNAPSHOT = MONTH_EVALS.map((r) => ({ ...r, file_id: r.file_id.slice() }));

/** `db_term_eval`。夹具刻意为空：无行即 c2，测试自己写第一行。 */
const TERM_EVALS = [];

const MONTH_EVAL_PATTERN = /^\d{4}-\d{2}$/;
const EVAL_TEXT_MAX = 500;

/** 把这两张表收回原样。`start()` 每次调用都跑它。 */
function resetEvaluation() {
  MONTH_EVALS.length = MONTH_EVAL_SNAPSHOT.length;
  MONTH_EVAL_SNAPSHOT.forEach((row, i) => {
    MONTH_EVALS[i] = { ...row, file_id: row.file_id.slice() };
  });
  TERM_EVALS.length = 0;
  state.nextMonthEvalId = 700;
  state.nextTermEvalId = 800;
  state.monthEvalPublications.length = 0;
  state.termEvalWrites.length = 0;
}

/** 只留契约声明的键，其余一律 422。派生键与事件时间戳**先剥再验**（§7.3 的顺序）。 */
function onlyDeclared(res, rawBody, allowed) {
  const body = stripDerived(rawBody || {});
  const extra = Object.keys(body).filter((k) => allowed.indexOf(k) === -1);
  if (extra.length) {
    fail(res, 422, 'validation_failed', '请求体含契约未声明的字段',
      { field: extra[0], rule: 'additionalProperties: false' });
    return null;
  }
  return body;
}

/**
 * GET /home-school/month-evals —— 幼儿 × 月份矩阵，游标分页（§3.1）。
 *
 * 排序 `eval_month DESC, child_id ASC`（契约的 x-hualong-sort）。**月份栏由已存在记录的
 * 月份动态生成**，所以这里没有月份清单，只有行。
 */
function getMonthEvals(req, res, url) {
  const filters = {
    eval_month: url.searchParams.get('eval_month') || null,
    child_id: url.searchParams.get('child_id') || null,
  };
  if (filters.eval_month && !MONTH_EVAL_PATTERN.test(filters.eval_month)) {
    return fail(res, 422, 'validation_failed', '期间键格式不合法',
      { field: 'eval_month', rule: 'YYYY-MM' });
  }

  const rows = MONTH_EVALS
    .filter((r) => (!filters.eval_month || r.eval_month === filters.eval_month))
    .filter((r) => (!filters.child_id || r.child_id === Number(filters.child_id)))
    .sort((a, b) => (a.eval_month === b.eval_month
      ? a.child_id - b.child_id
      : (a.eval_month < b.eval_month ? 1 : -1)));

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 20 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return fail(res, 422, 'validation_failed', '分页参数不合法',
      { field: 'limit', rule: 'between_1_and_100' });
  }

  let startIndex = 0;
  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    const decoded = decodeCursor(cursor, filters);
    if (decoded.error) {
      return fail(res, 400, decoded.error,
        decoded.error === 'cursor_invalid' ? '翻页游标不可解' : '筛选条件已变，游标失效');
    }
    startIndex = rows.findIndex((r) => r.month_eval_id === decoded.key) + 1;
    if (startIndex <= 0) return fail(res, 400, 'cursor_invalid', '翻页游标不可解');
  }

  const slice = rows.slice(startIndex, startIndex + limit);
  const last = slice[slice.length - 1];
  const hasMore = startIndex + limit < rows.length;
  return sendJson(res, 200, {
    items: slice.map((r) => ({ ...r, file_id: r.file_id.slice() })),
    next_cursor: hasMore && last ? encodeCursor(last.month_eval_id, filters) : null,
  });
}

/**
 * PUT /home-school/month-evals —— 按 `child_id + eval_month` upsert。
 *
 * **被 G51 阻断的是状态语义，不是请求体的形状**：`MonthEvalDraft` 已登记且稳定，未决的是
 * 落 e1 还是 e2、以及 `saved_at` 在哪一步写。见本节头注。
 */
function putMonthEval(req, res, rawBody) {
  if (refuseWithoutTerm(res)) return;
  const body = onlyDeclared(res, rawBody, ['child_id', 'eval_month', 'eval_text', 'file_id']);
  if (!body) return;

  // schema 先于范围：缺一个必填字段是请求本身不合法（422），与「这个 id 你看不到」
  // （404）不是同一个问题。反过来判会把一次拼错的请求说成一次范围拒绝。
  if (!Number.isInteger(body.child_id)) {
    return fail(res, 422, 'validation_failed', 'child_id 必填',
      { field: 'child_id', rule: 'required integer' });
  }
  const child = childInScope(body.child_id);
  if (!child) return fail(res, 404, 'not_found', '幼儿不存在或不在可见范围内');
  if (!MONTH_EVAL_PATTERN.test(String(body.eval_month || ''))) {
    return fail(res, 422, 'validation_failed', '期间键格式不合法',
      { field: 'eval_month', rule: 'YYYY-MM' });
  }
  const text = typeof body.eval_text === 'string' ? body.eval_text.trim() : '';
  if (text.length < 1 || text.length > EVAL_TEXT_MAX) {
    return fail(res, 422, 'validation_failed', `评价内容 trim 后 1 到 ${EVAL_TEXT_MAX} 字`,
      { field: 'eval_text', rule: `minLength: 1, maxLength: ${EVAL_TEXT_MAX}` });
  }
  const files = body.file_id === undefined ? [] : body.file_id;
  if (!Array.isArray(files) || files.some((f) => !Number.isInteger(f))) {
    return fail(res, 422, 'validation_failed', 'file_id 必须是整数数组',
      { field: 'file_id', rule: 'array of integer' });
  }

  let row = MONTH_EVALS.find(
    (r) => r.child_id === child.child_id && r.eval_month === body.eval_month
  );
  if (row && row.month_eval_status === 'e3') {
    // e3 之后永久唯读 —— 契约里没有 e3→e1，也没有 e3→e2。
    return fail(res, 409, 'state_precondition_failed', '这个月的评价已发布，内容已锁定',
      { from: 'e3', required: 'e1|e2' });
  }
  if (!row) {
    row = {
      month_eval_id: state.nextMonthEvalId,
      teacher_id: TEACHER.teacher_id,   // 派生：永远是会话里的这位教师，不是请求体的
      class_id: SCOPE.class_id,         // 派生
      child_id: child.child_id,
      eval_month: body.eval_month,
      saved_at: null,
      created_at: '2026-08-26T16:20:00+08:00',
    };
    state.nextMonthEvalId += 1;
    MONTH_EVALS.push(row);
  }
  row.eval_text = text;
  row.file_id = files.slice();
  row.month_eval_status = 'e1';
  row.updated_at = '2026-08-26T16:20:00+08:00';
  return sendJson(res, 200, { ...row, file_id: row.file_id.slice() });
}

/** POST /home-school/month-evals/{id}/publication —— `e1|e2 → e3`，教师人工把关。 */
function postMonthEvalPublication(req, res, id) {
  if (refuseWithoutTerm(res)) return;
  const row = MONTH_EVALS.find((r) => r.month_eval_id === Number(id));
  if (!row) return fail(res, 404, 'not_found', '月度评价不存在或不在可见范围内');
  if (row.month_eval_status === 'e3') {
    return fail(res, 409, 'state_precondition_failed', '这个月的评价已发布，内容已锁定',
      { from: 'e3', required: 'e1|e2' });
  }
  row.month_eval_status = 'e3';
  row.saved_at = '2026-08-26T16:21:00+08:00';
  row.updated_at = row.saved_at;
  // 服务端真正执行的一次发布。幂等重放在分发层就返回了，处理器根本没跑，所以这张表不涨。
  state.monthEvalPublications.push({ month_eval_id: row.month_eval_id, child_id: row.child_id });
  return sendJson(res, 200, { ...row, file_id: row.file_id.slice() });
}

/**
 * GET /term-evaluations —— 名册左连接，**整取不分页**（§3.5），`child_id ASC`。
 *
 * **无进行中学期时的读取行为在契约里未定**（G59：§5.4 只管写入）。这个 mock 照常返回
 * 名册，因为「读不到」与「一个都没填」在界面上是同一句话，而写入那一侧服务端仍独立回
 * 409 no_active_term。这是 mock 的一种读法，不是契约的结论 —— 已记进交接。
 */
function getTermEvaluations(req, res) {
  return sendJson(res, 200, {
    items: CHILDREN.map((child) => {
      const row = TERM_EVALS.find((r) => r.child_id === child.child_id) || null;
      return {
        child_id: child.child_id,
        child_name: child.child_name,
        term_eval_id: row ? row.term_eval_id : null,
        term_eval_status: row ? row.term_eval_status : 'c2',
        submitted_at: row ? row.submitted_at : null,
      };
    }),
  });
}

/** GET /children/{child_id}/term-evaluation —— **本人**那一列，无行回 404。 */
function getTermEvaluation(req, res, id) {
  const child = childInScope(id);
  if (!child) return fail(res, 404, 'not_found', '幼儿不存在或不在可见范围内');
  const row = TERM_EVALS.find((r) => r.child_id === child.child_id);
  if (!row) return fail(res, 404, 'not_found', '这名幼儿本学期还没有学期评价');
  return sendJson(res, 200, { ...row, file_id: row.file_id.slice() });
}

/** PUT /children/{child_id}/term-evaluation —— NONE→c1，**一次写成**。 */
function putTermEvaluation(req, res, id, rawBody) {
  if (refuseWithoutTerm(res)) return;
  const child = childInScope(id);
  if (!child) return fail(res, 404, 'not_found', '幼儿不存在或不在可见范围内');

  const body = onlyDeclared(res, rawBody, ['eval_text', 'file_id']);
  if (!body) return;

  const text = typeof body.eval_text === 'string' ? body.eval_text.trim() : '';
  if (text.length < 1 || text.length > EVAL_TEXT_MAX) {
    return fail(res, 422, 'validation_failed', `学期综合评语 trim 后 1 到 ${EVAL_TEXT_MAX} 字`,
      { field: 'eval_text', rule: `minLength: 1, maxLength: ${EVAL_TEXT_MAX}` });
  }
  const files = body.file_id === undefined ? [] : body.file_id;
  if (!Array.isArray(files) || files.some((f) => !Number.isInteger(f))) {
    return fail(res, 422, 'validation_failed', 'file_id 必须是整数数组',
      { field: 'file_id', rule: 'array of integer' });
  }
  if (TERM_EVALS.some((r) => r.child_id === child.child_id)) {
    // c1 之后没有回头路：契约里没有 c1→c2，也没有第二次提交。
    return fail(res, 409, 'state_precondition_failed', '这名幼儿的学期评价已提交，内容已锁定',
      { from: 'c1', required: 'NONE' });
  }

  const row = {
    term_eval_id: state.nextTermEvalId,
    class_id: SCOPE.class_id,           // 派生
    teacher_id: TEACHER.teacher_id,     // 派生
    child_id: child.child_id,
    term_id: TERM.term_id,              // 由当前学期派生，客户端从不提交
    eval_text: text,
    file_id: files.slice(),
    term_eval_status: 'c1',
    submitted_at: '2026-08-26T16:25:00+08:00',
  };
  state.nextTermEvalId += 1;
  TERM_EVALS.push(row);
  state.termEvalWrites.push({ term_eval_id: row.term_eval_id, child_id: row.child_id });
  return sendJson(res, 201, { ...row, file_id: row.file_id.slice() },
    { location: `${BASE}/children/${child.child_id}/term-evaluation` });
}

/**
 * 一名幼儿的成长档案齐备度。
 *
 * 四个状态列**由齐备判定派生写入**（`api/action-coverage.tsv` 四行 no-action），所以这里
 * 现算而不是存一行：存下来就要有人维护它，而没有任何客户端动作直接改它们。
 */
function growthRecordFor(child) {
  const months = MONTH_EVALS.filter(
    (r) => r.child_id === child.child_id && r.month_eval_status === 'e3'
  );
  const term = TERM_EVALS.find((r) => r.child_id === child.child_id) || null;
  const assessment = assessmentFor(child.child_id);
  const assessmentDone = Boolean(assessment && assessmentStatus(assessment) === 'c1');
  // 「截至当前应完成月数」在真服务里按园历算。这个 mock 固定为 1 —— 它是一个夹具值，
  // 不是一条口径；客户端只显示它，不用它做判断。
  const required = 1;
  const teacherTerm = term ? 'c1' : 'c2';
  const record = months.length >= required && teacherTerm === 'c1' && assessmentDone ? 'c1' : 'c2';
  return {
    growth_record_id: 600 + child.child_id,
    class_id: SCOPE.class_id,
    child_id: child.child_id,
    child_name: child.child_name,
    term_id: TERM.term_id,
    required_month_count: required,
    teacher_month_complete_count: months.length,
    // 家长侧的两列这个 mock 没有数据来源，回 c2 而不是编一个 —— 客户端只读教师侧那三项。
    parent_month_complete_count: 0,
    teacher_term_status: teacherTerm,
    parent_term_status: 'c2',
    comprehensive_assessment_status: assessmentDone ? 'c1' : 'c2',
    // 成长册那一列：原型 growth-record.html 的第六列。h1 已定稿／h2 未定稿。
    growth_book_status: growthBookStatusFor(child.child_id),
    is_term_end: false,
    record_status: record,
  };
}

/** GET /growth-records —— 名册型，整取不分页（§3.5）。 */
function getGrowthRecords(req, res) {
  return sendJson(res, 200, { items: CHILDREN.map(growthRecordFor) });
}

/** GET /children/{child_id}/growth-record。 */
function getGrowthRecord(req, res, id) {
  const child = childInScope(id);
  if (!child) return fail(res, 404, 'not_found', '幼儿不存在或不在可见范围内');
  return sendJson(res, 200, growthRecordFor(child));
}

// ══════════════════════════════════════════════════════════════════════════
// 成长档案这条链（2026-08-26 按原型建）
// ══════════════════════════════════════════════════════════════════════════
//
// 五条读面加两条写入。**契约里一条都没有**，与 `/party/home` 不同：那一条契约有，
// 只是没人调。这几条的对象定义写在教师端 `05 home-school-spec.md` 里（db_home_school、
// db_teacher_eval_home、db_teacher_message、db_parent_evaluation[REUSE]），
// `openapi.yaml` 的 149 个操作里一个也没有。缺口逐条记进交接，接真服务时必须重对。
//
// 三张进度表的口径都出自 spec 05 的同一句话：**草稿一律折算为未完成**（二元）。
// 所以下面每一处判定都只认终态，不认「填了一半」。

/** `db_teacher_message`（spec 05，E1）。提交后永久只读，所以没有 update。 */
const TEACHER_MESSAGES = [
  {
    teacher_message_id: 901,
    class_id: SCOPE.class_id,
    teacher_id: TEACHER.teacher_id,
    child_id: 101,
    term_id: TERM.term_id,
    message_text: '小明这学期进步很大，从入园时的害羞到现在能主动举手分享，老师为你骄傲。'
      + '希望你继续保持好奇心，做勇敢表达的小朋友。',
    submitted_at: '2026-08-20T16:20:00+08:00',
  },
  {
    teacher_message_id: 902,
    class_id: SCOPE.class_id,
    teacher_id: TEACHER.teacher_id,
    child_id: 106,
    term_id: TERM.term_id,
    message_text: '浩然是班里的运动小健将，也越来越懂得照顾同伴。'
      + '新学期里希望你在安静活动中也能沉下心来，收获更多。',
    submitted_at: '2026-08-21T09:05:00+08:00',
  },
];

const TEACHER_MESSAGE_SNAPSHOT = TEACHER_MESSAGES.map((r) => ({ ...r }));

/**
 * `db_parent_evaluation` 的**发起面**（spec 05：家长端 canonical，教师端只发起）。
 *
 * 教师写的是给家长看的说明（`evaluation_prompt`），家长自己的回答写在家长端、也在
 * 那一端把关。这里存的是一期一行的发起记录加它的完成情况。
 */
const PARENT_EVALUATIONS = [
  {
    parent_evaluation_round_id: 701,
    class_id: SCOPE.class_id,
    requested_by_teacher_id: TEACHER.teacher_id,
    evaluation_type: 't1',
    evaluation_period: '2026-06',
    evaluation_prompt: '请家长结合本月亲子任务、幼儿在家表现与照片记录，补充孩子的兴趣、生活习惯和成长变化。',
    published_at: '2026-06-01T09:00:00+08:00',
    completed_count: 23,
  },
  {
    parent_evaluation_round_id: 702,
    class_id: SCOPE.class_id,
    requested_by_teacher_id: TEACHER.teacher_id,
    evaluation_type: 't1',
    evaluation_period: '2026-05',
    evaluation_prompt: '请家长回顾五月的亲子共读，写下孩子最喜欢的一本书和他自己的解释。',
    published_at: '2026-05-01T09:00:00+08:00',
    completed_count: 26,
  },
  {
    parent_evaluation_round_id: 703,
    class_id: SCOPE.class_id,
    requested_by_teacher_id: TEACHER.teacher_id,
    evaluation_type: 't1',
    evaluation_period: '2026-04',
    evaluation_prompt: '请家长记录孩子在四月里学会的一件自理小事。',
    published_at: '2026-04-01T09:00:00+08:00',
    completed_count: 28,
  },
];

const PARENT_EVALUATION_SNAPSHOT = PARENT_EVALUATIONS.map((r) => ({ ...r }));

/** 这两张表的可变夹具收回原样。`start()` 每次调用都跑它。 */
function resetGrowthRecordChain() {
  TEACHER_MESSAGES.length = TEACHER_MESSAGE_SNAPSHOT.length;
  TEACHER_MESSAGE_SNAPSHOT.forEach((row, i) => { TEACHER_MESSAGES[i] = { ...row }; });
  PARENT_EVALUATIONS.length = PARENT_EVALUATION_SNAPSHOT.length;
  PARENT_EVALUATION_SNAPSHOT.forEach((row, i) => { PARENT_EVALUATIONS[i] = { ...row }; });
  state.nextTeacherMessageId = 950;
  state.nextParentEvaluationRoundId = 750;
  state.teacherMessageWrites.length = 0;
  state.parentEvaluationPublications.length = 0;
}

/** 一名幼儿这学期有没有成长册（`h1` 已完成 ／ `h2` 未完成，spec 05 的二元口径）。 */
function growthBookStatusFor(childId) {
  const book = GROWTH_BOOKS.find((b) => b.child_id === childId && b.book_status === 'b2');
  return book ? 'h1' : 'h2';
}

/** 一名幼儿这学期的教师寄语。缺行等价未完成。 */
function teacherMessageFor(childId) {
  return TEACHER_MESSAGES.find((m) => m.child_id === childId) || null;
}

/**
 * GET /home-school/home —— 入口页的聚合读取（`db_home_school`，persist=0）。
 *
 * 三个数字与逐儿四列状态，全部从活着的夹具现算：完成一次亲子任务或定稿一本成长册，
 * 这里的数字就会跟着动。spec 05 的算式逐条照做：
 *   child_count        = COUNT(在园幼儿)
 *   average_completion = AVG(每名幼儿的完成率)
 *   reminder_count     = COUNT(需要提醒的幼儿)
 */
function homeSchoolProgressFor(child) {
  // 在园时光：本周有没有被嵌进已发布的场次（h1／h2 二元，见 spec 05）。
  const inMoment = MOMENTS.some(
    (m) => m.publish_status === 's3' && (m.child_id || []).includes(child.child_id)
  );
  // 亲子任务：最新一期已发布任务里，这名幼儿交了没有。缺行等价未交。
  const latest = PARENT_TASKS
    .filter((t) => t.publish_status === 's2' && t.published_at)
    .sort((a, b) => (a.published_at < b.published_at ? 1 : -1))[0];
  const submitted = latest
    ? PARENT_TASK_SUBMISSIONS.some(
      (s) => s.parent_task_id === latest.parent_task_id
        && s.child_id === child.child_id
        && s.submission_status === 'c1'
    )
    : false;
  const record = growthRecordFor(child);
  const statuses = {
    moment_status: inMoment ? 'h1' : 'h2',
    parent_task_status: submitted ? 'h1' : 'h2',
    growth_record_status: record.record_status === 'c1' ? 'h1' : 'h2',
    growth_book_status: growthBookStatusFor(child.child_id),
  };
  const required = 4;
  const completed = Object.values(statuses).filter((s) => s === 'h1').length;
  return {
    child_id: child.child_id,
    child_name: child.child_name,
    ...statuses,
    required_count: required,
    completed_count: completed,
    row_completion_rate: Math.round((completed / required) * 100),
    reminder_required: completed < required,
  };
}

function getHomeSchoolHome(req, res) {
  const rows = CHILDREN.map(homeSchoolProgressFor);
  // spec: IF required_count=0, average_completion=0 —— 一个空班不该把这里除爆。
  const average = rows.length
    ? Math.round(rows.reduce((sum, r) => sum + r.row_completion_rate, 0) / rows.length)
    : 0;
  return sendJson(res, 200, {
    class_id: SCOPE.class_id,
    class_name: SCOPE.class_name,
    child_count: rows.length,
    average_completion: average,
    reminder_count: rows.filter((r) => r.reminder_required).length,
    items: rows,
  });
}

/**
 * GET /home-school/teacher-eval —— 教师评价聚合页（`db_teacher_eval_home`，persist=0）。
 *
 * spec 05 写着 `write_control_count = 0`：这一页只导航与只读展示，一个写入控件也没有，
 * 所以这里只有 GET。四列都按二元口径判：草稿折算为未完成。
 */
function teacherEvalRowFor(child) {
  const month = MONTH_EVALS.find(
    (r) => r.child_id === child.child_id && r.month_eval_status === 'e3'
  );
  const term = TERM_EVALS.find((r) => r.child_id === child.child_id) || null;
  const assessment = assessmentFor(child.child_id);
  return {
    child_id: child.child_id,
    child_name: child.child_name,
    month_eval_status: month ? 'c1' : 'c2',
    term_eval_status: term ? 'c1' : 'c2',
    comprehensive_assessment_status:
      assessment && assessmentStatus(assessment) === 'c1' ? 'c1' : 'c2',
    teacher_message_status: teacherMessageFor(child.child_id) ? 'c1' : 'c2',
  };
}

function getTeacherEvalHome(req, res) {
  return sendJson(res, 200, { items: CHILDREN.map(teacherEvalRowFor) });
}

/** GET /home-school/teacher-messages —— 名册型完成情况，整取不分页（§3.5）。 */
function getTeacherMessages(req, res) {
  return sendJson(res, 200, {
    items: CHILDREN.map((child) => {
      const row = teacherMessageFor(child.child_id);
      return {
        child_id: child.child_id,
        child_name: child.child_name,
        teacher_message_status: row ? 'c1' : 'c2',
        teacher_message_id: row ? row.teacher_message_id : null,
      };
    }),
  });
}

/** GET /home-school/teacher-messages/{child_id} —— 一条已提交的寄语，只读。 */
function getTeacherMessage(req, res, id) {
  const child = childInScope(id);
  if (!child) return fail(res, 404, 'not_found', '幼儿不存在或不在可见范围内');
  const row = teacherMessageFor(child.child_id);
  // 还没写过与不在范围内，对读者是同一件事：都没有可读的那一行。
  if (!row) return fail(res, 404, 'not_found', '尚未提交寄语');
  return sendJson(res, 200, { ...row, child_name: child.child_name });
}

/**
 * POST /home-school/teacher-messages —— 写一条寄语。
 *
 * **提交即终局**：spec 05 与原型都写着「提交后永久只读」，所以重复提交回 409，
 * 不是把旧的覆盖掉。教职工文本走 ADR-0016 第二行（预览后发布），把关在客户端声明、
 * 由服务端记录同意；这个 mock 只验形状与终局性。
 *
 * `child_id=all` 是原型上的「全体幼儿」：一次为全班每个**还没有**寄语的幼儿各建一行。
 * 已经有的不动 —— 覆盖会推翻终局性。
 */
function postTeacherMessage(req, res, body) {
  const text = typeof body.message_text === 'string' ? body.message_text.trim() : '';
  if (!text) {
    return fail(res, 422, 'validation_failed', '寄语内容不能为空',
      { field: 'message_text', rule: 'required' });
  }
  if (text.length > 300) {
    return fail(res, 422, 'validation_failed', '寄语最多 300 字',
      { field: 'message_text', rule: 'max_len_300' });
  }
  // 已经有寄语的一律不进 targets —— 单个与全班都一样。覆盖会悄悄抹掉上一条，
  // 而教师看到的仍是「提交成功」。空的 targets 在下面变成 409。
  const targets = (body.child_id === 'all'
    ? CHILDREN
    : [childInScope(body.child_id)].filter(Boolean)
  ).filter((c) => !teacherMessageFor(c.child_id));

  if (!targets.length) {
    if (body.child_id === 'all') {
      return fail(res, 409, 'conflict', '全班都已提交寄语，寄语提交后不可修改');
    }
    const child = childInScope(body.child_id);
    if (!child) return fail(res, 404, 'not_found', '幼儿不存在或不在可见范围内');
    return fail(res, 409, 'conflict', '这名幼儿的寄语已提交，提交后不可修改');
  }

  const created = targets.map((child) => {
    const row = {
      teacher_message_id: state.nextTeacherMessageId,
      class_id: SCOPE.class_id,
      teacher_id: TEACHER.teacher_id,
      child_id: child.child_id,
      term_id: TERM.term_id,
      message_text: text,
      submitted_at: '2026-08-26T17:40:00+08:00',
    };
    state.nextTeacherMessageId += 1;
    TEACHER_MESSAGES.push(row);
    state.teacherMessageWrites.push({ teacher_message_id: row.teacher_message_id, child_id: row.child_id });
    return row;
  });

  return sendJson(res, 201, { items: created.map((r) => ({ ...r })) });
}

/** GET /home-school/parent-evaluations —— 已发起的各期，最近的在前。 */
function getParentEvaluations(req, res) {
  const rows = PARENT_EVALUATIONS
    .slice()
    .sort((a, b) => (a.published_at < b.published_at ? 1 : -1))
    .map((row) => ({
      ...row,
      child_count: CHILDREN.length,
      completion_rate: Math.round((row.completed_count / CHILDREN.length) * 100),
    }));
  return sendJson(res, 200, { items: rows });
}

/**
 * GET /home-school/parent-evaluations/{id} —— 一期的完成情况，逐儿一行。
 *
 * 家长的答案本身不在这里：那是家长端的内容，教师端读的是**交了没有**。
 */
function getParentEvaluation(req, res, id) {
  const round = PARENT_EVALUATIONS.find((r) => r.parent_evaluation_round_id === Number(id));
  if (!round) return fail(res, 404, 'not_found', '该期家长评价不存在或不在可见范围内');
  const items = CHILDREN.map((child, idx) => ({
    child_id: child.child_id,
    child_name: child.child_name,
    // 完成的是前 `completed_count` 名 —— 夹具的排法，不是一条业务口径。
    evaluation_status: idx < round.completed_count ? 'p2' : 'p0',
  }));
  return sendJson(res, 200, {
    ...round,
    child_count: CHILDREN.length,
    completion_rate: Math.round((round.completed_count / CHILDREN.length) * 100),
    items,
  });
}

/**
 * POST /home-school/parent-evaluations —— 发起一期家长评价。
 *
 * 教师写的是**给家长看的说明**（`evaluation_prompt`），不是家长的答案。作者字段派生：
 * `requested_by_teacher_id` 由会话来，客户端不送（§7.3 / DO-NOT-BUILD 8）。
 */
function postParentEvaluation(req, res, body) {
  const type = body.evaluation_type;
  if (type !== 't1' && type !== 't2') {
    return fail(res, 422, 'validation_failed', '评价类型不合法',
      { field: 'evaluation_type', rule: 'one_of_t1_t2' });
  }
  const prompt = typeof body.evaluation_prompt === 'string' ? body.evaluation_prompt.trim() : '';
  if (!prompt) {
    return fail(res, 422, 'validation_failed', '评价说明不能为空',
      { field: 'evaluation_prompt', rule: 'required' });
  }
  if (prompt.length > 1000) {
    return fail(res, 422, 'validation_failed', '评价说明最多 1000 字',
      { field: 'evaluation_prompt', rule: 'max_len_1000' });
  }
  const period = body.evaluation_period;
  if (typeof period !== 'string' || !period) {
    return fail(res, 422, 'validation_failed', '评价周期不能为空',
      { field: 'evaluation_period', rule: 'required' });
  }
  // `UNIQUE(child_id + evaluation_type + evaluation_period)` 的班级层对应物：
  // 同一周期同一类型只能发起一次，重发是覆盖，不是新建。
  const clash = PARENT_EVALUATIONS.find(
    (r) => r.evaluation_type === type && r.evaluation_period === period
  );
  if (clash) return fail(res, 409, 'conflict', '这一期已经发起过了');

  const row = {
    parent_evaluation_round_id: state.nextParentEvaluationRoundId,
    class_id: SCOPE.class_id,
    requested_by_teacher_id: TEACHER.teacher_id,   // 派生
    evaluation_type: type,
    evaluation_period: period,
    evaluation_prompt: prompt,
    published_at: '2026-08-26T17:45:00+08:00',
    completed_count: 0,
  };
  state.nextParentEvaluationRoundId += 1;
  PARENT_EVALUATIONS.push(row);
  state.parentEvaluationPublications.push({ round_id: row.parent_evaluation_round_id });
  return sendJson(res, 201, { ...row }, {
    location: `${BASE}/home-school/parent-evaluations/${row.parent_evaluation_round_id}`,
  });
}

/**
 * GET /home-school/community-feed —— 家长提交的动态流。
 *
 * DECISIONS B11／E5 拔掉了 `db_community_submission`：这一页读的是**已发布的亲子任务**
 * （t1｜t2）加它们的提交行，按任务类型筛。两个筛选都是查询参数，不是列 ——「全部」表示
 * 不加那一条 predicate。
 *
 * 家长内容在写下时已经过 ADR-0016 第三行的批式把关；这里是读面，不再把一次关。仍在
 * 批次里的那些**不出现在流上**：教师读到的每一条都是已经过关的。
 */
function getCommunityFeed(req, res, url) {
  const type = url.searchParams.get('parent_task_type') || 'all';
  if (!['all', 't1', 't2'].includes(type)) {
    return fail(res, 422, 'validation_failed', '任务类别不合法',
      { field: 'parent_task_type', rule: 'one_of_t1_t2' });
  }
  const published = PARENT_TASKS.filter(
    (t) => ['s2', 's3'].includes(t.publish_status)
      && (type === 'all' || t.parent_task_type === type)
  );
  const items = [];
  for (const task of published) {
    for (const sub of PARENT_TASK_SUBMISSIONS) {
      if (sub.parent_task_id !== task.parent_task_id) continue;
      if (sub.submission_status !== 'c1') continue;
      // 还在内容安全批次里的不上流：读面只呈现已经过关的内容。
      if (sub.under_content_check) continue;
      const child = CHILDREN.find((c) => c.child_id === sub.child_id);
      if (!child) continue;
      items.push({
        parent_task_id: task.parent_task_id,
        parent_task_title: task.parent_task_title,
        parent_task_type: task.parent_task_type,
        child_id: child.child_id,
        child_name: child.child_name,
        submitted_at: sub.submitted_at,
        // 图片按 file_id 给，取图仍要另签 URL（§8.4）。这个 mock 只给张数。
        file_id: [7100 + child.child_id, 7200 + child.child_id],
      });
    }
  }
  items.sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1));
  return sendJson(res, 200, { items });
}

// ── 成长册（票据 21） ───────────────────────────────────────────────────────
//
//   编册   NONE --POST compilation--> e1 --lock--> e2（**单向**）
//   栏目   NONE --POST sections--> d1 --publication--> d2（版面永久冻结）
//   册     NONE --POST books--> b1 --publication--> b2（**永久唯读**）
//
// **版式包一份也没有发布**（ADR-0015 Follow-ups，0／12），所以 manifest 与逐页读取默认
// 回 409 加 `details.rule = 'layout_pack_unreleased'`。`setLayoutPack(true)` 打开一份
// 夹具版式包，好让「有 pack 时预览排得出来」与「没 pack 时诚实降级」两条都测得到。

const LAYOUT_PACK_CODE = 'k2-autumn@0.1.0-fixture';

const compilationState = { row: null };

/** 一本册子。`UNIQUE(child_id, term_id)` —— 一幼儿一学期一本。 */
const GROWTH_BOOKS = [];
const BOOK_SECTIONS = [];
const BOOK_WIDGETS = new Map();   // section_id -> widget[]

function resetGrowthBook() {
  compilationState.row = null;
  GROWTH_BOOKS.length = 0;
  BOOK_SECTIONS.length = 0;
  BOOK_WIDGETS.clear();
  OPTS.layoutPack = false;
  state.nextCompilationId = 300;
  state.nextSectionId = 400;
  state.nextWidgetId = 5000;
  state.nextGrowthBookId = 200;
  state.bookPublications.length = 0;
}

/**
 * 内容指纹 —— roster ＋ 内容。
 *
 * 定稿请求必须把预检回的这个值带回来，漂移回 409 且**零写入**：那是「你预检时看到的班，
 * 和你现在要定稿的班，不是同一个班」的唯一防线（§4 规则 87／86）。
 */
function contentFingerprint() {
  const material = JSON.stringify({
    roster: CHILDREN.map((c) => c.child_id),
    enabled: compilationState.row ? compilationState.row.enabled_sections : [],
    months: MONTH_EVALS.filter((r) => r.month_eval_status === 'e3').map((r) => r.month_eval_id),
    terms: TERM_EVALS.map((r) => r.term_eval_id),
    pack: OPTS.layoutPack ? LAYOUT_PACK_CODE : null,
  });
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

/** POST /teacher/growth-book/compilation —— 建立或取回，本端点**幂等**。 */
function postCompilation(req, res) {
  if (refuseWithoutTerm(res)) return;
  if (compilationState.row) {
    return sendJson(res, 200, { ...compilationState.row });
  }
  compilationState.row = {
    compilation_id: state.nextCompilationId,
    class_id: SCOPE.class_id,
    term_id: TERM.term_id,
    // 默认两类都纳入：`enabled_sections` 只存 time、task 与班级自订 section_id（F19）。
    enabled_sections: ['time', 'task'],
    compilation_status: 'e1',
    revision: 1,
    locked_at: null,
    locked_by: null,
  };
  state.nextCompilationId += 1;
  return sendJson(res, 201, { ...compilationState.row });
}

function compilationInScope(res, id) {
  const row = compilationState.row;
  if (!row || row.compilation_id !== Number(id)) {
    fail(res, 404, 'not_found', '编册不存在或不在可见范围内');
    return null;
  }
  return row;
}

/** PATCH /teacher/growth-book/compilation/{id} —— 改栏目勾选，仅 e1，revision CAS。 */
function patchCompilation(req, res, id, rawBody) {
  const row = compilationInScope(res, id);
  if (!row) return;
  const body = onlyDeclared(res, rawBody, ['revision', 'enabled_sections']);
  if (!body) return;
  if (!Number.isInteger(body.revision)) {
    return fail(res, 422, 'validation_failed', 'revision 必填',
      { field: 'revision', rule: 'required integer' });
  }
  if (row.compilation_status === 'e2') {
    return fail(res, 409, 'state_precondition_failed', '编册已锁定，栏目勾选不能再改',
      { from: 'e2', required: 'e1' });
  }
  if (body.revision !== row.revision) {
    // §5.1：CAS 不符不是「再试一次」，是「你手上那一份已经过期」。
    return fail(res, 409, 'revision_stale', '内容已被他人修改，请刷新后重试');
  }
  const next = body.enabled_sections === undefined ? row.enabled_sections : body.enabled_sections;
  if (!Array.isArray(next) || next.some((k) => typeof k !== 'string')) {
    return fail(res, 422, 'validation_failed', 'enabled_sections 必须是字符串数组',
      { field: 'enabled_sections', rule: 'array of string' });
  }
  const known = ['time', 'task'].concat(BOOK_SECTIONS.map((s) => String(s.section_id)));
  const bad = next.find((k) => known.indexOf(k) === -1);
  if (bad !== undefined) {
    // term／comp／message 固定启用、**不进开关**，所以把它们塞进来是一个错，不是一个选择。
    return fail(res, 422, 'validation_failed', '只有 time、task 与班级自订栏目可以勾选',
      { field: 'enabled_sections', rule: 'time|task|section_id' });
  }
  row.enabled_sections = next.slice();
  row.revision += 1;
  return sendJson(res, 200, { ...row });
}

/** POST /teacher/growth-book/compilation/{id}/lock —— e1→e2，**单向**。 */
function postCompilationLock(req, res, id, rawBody) {
  const row = compilationInScope(res, id);
  if (!row) return;
  if (!req.headers['idempotency-key']) {
    return fail(res, 400, 'malformed_request', '本操作的 Idempotency-Key 是必填的');
  }
  const body = onlyDeclared(res, rawBody, ['revision']);
  if (!body) return;
  if (!Number.isInteger(body.revision)) {
    return fail(res, 422, 'validation_failed', 'revision 必填',
      { field: 'revision', rule: 'required integer' });
  }
  if (row.compilation_status === 'e2') {
    return fail(res, 409, 'state_precondition_failed', '编册已锁定', { from: 'e2', required: 'e1' });
  }
  if (body.revision !== row.revision) {
    return fail(res, 409, 'revision_stale', '内容已被他人修改，请刷新后重试');
  }
  row.compilation_status = 'e2';
  row.revision += 1;
  row.locked_at = '2026-08-26T17:00:00+08:00';
  row.locked_by = TEACHER.teacher_id;
  return sendJson(res, 200, { ...row });
}

/**
 * GET /teacher/growth-book/sections —— 本班本学期的班级栏目清单（契约 v0.6.1 补）。
 *
 * 名册型集合，**整取不分页**（§3.5），按 `anchor_after`、`section_id` 稳定排序。
 * 本端点不收参数：一个班一个学期只有一份编册，也就只有一份栏目清单。
 */
function getBookSections(req, res) {
  if (!requireSession(req, res)) return;
  const rows = BOOK_SECTIONS.slice().sort((a, b) => (
    a.anchor_after === b.anchor_after
      ? a.section_id - b.section_id
      : String(a.anchor_after).localeCompare(String(b.anchor_after))
  ));
  return sendJson(res, 200, { items: rows.map((r) => ({ ...r })) });
}

/** POST /teacher/growth-book/sections —— 新增班级栏目（NONE→d1）。 */
function postBookSection(req, res, rawBody) {
  const body = onlyDeclared(res, rawBody, ['name', 'anchor_after', 'anchor_type']);
  if (!body) return;
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 50) {
    return fail(res, 422, 'validation_failed', '栏目名 1 到 50 字',
      { field: 'name', rule: 'maxLength: 50' });
  }
  if (typeof body.anchor_after !== 'string' || !body.anchor_after) {
    return fail(res, 422, 'validation_failed', 'anchor_after 必填',
      { field: 'anchor_after', rule: 'required' });
  }
  if (['a1', 'a2', 'a3', 'a4'].indexOf(body.anchor_type) === -1) {
    return fail(res, 422, 'validation_failed', 'anchor_type 取值不合法',
      { field: 'anchor_type', rule: 'a1|a2|a3|a4' });
  }
  if (!compilationState.row) {
    return fail(res, 409, 'state_precondition_failed', '本班本学期还没有编册');
  }
  const row = {
    section_id: state.nextSectionId,
    compilation_id: compilationState.row.compilation_id,
    name: body.name.trim(),
    anchor_after: body.anchor_after,
    anchor_type: body.anchor_type,
    section_status: 'd1',
    collection_status: 'c1',
    collection_started_at: null,
    published_at: null,
  };
  state.nextSectionId += 1;
  BOOK_SECTIONS.push(row);
  BOOK_WIDGETS.set(row.section_id, []);
  return sendJson(res, 201, { ...row });
}

function sectionInScope(res, id) {
  const row = BOOK_SECTIONS.find((s) => s.section_id === Number(id));
  if (!row) {
    fail(res, 404, 'not_found', '栏目不存在或不在可见范围内');
    return null;
  }
  return row;
}

/** PATCH /teacher/growth-book/sections/{id} —— 仅 d1。 */
function patchBookSection(req, res, id, rawBody) {
  const row = sectionInScope(res, id);
  if (!row) return;
  const body = onlyDeclared(res, rawBody, ['name', 'anchor_after', 'anchor_type']);
  if (!body) return;
  if (row.section_status !== 'd1') {
    return fail(res, 409, 'state_precondition_failed', '栏目已发布，版面永久冻结',
      { from: 'd2', required: 'd1' });
  }
  if (body.name !== undefined) row.name = String(body.name).trim();
  if (body.anchor_after !== undefined) row.anchor_after = String(body.anchor_after);
  if (body.anchor_type !== undefined) row.anchor_type = body.anchor_type;
  return sendJson(res, 200, { ...row });
}

/**
 * PUT /teacher/growth-book/sections/{id}/widgets —— **整栏目一次提交、一次校验、一次存档**。
 *
 * W6 要求服务端自己重跑一次同页 widget 的重叠检测，任一处重叠则**拒绝整个栏目的存档**
 * —— 前端的标红与置灰只是体验，不是完整性边界。这就是这里是 PUT 整份而不是逐 widget
 * PATCH 的理由：逐个提交无法表达「整栏目要么全存要么全拒」。
 */
function putBookWidgets(req, res, id, rawBody) {
  const row = sectionInScope(res, id);
  if (!row) return;
  const body = onlyDeclared(res, rawBody, ['widgets']);
  if (!body) return;
  if (!Array.isArray(body.widgets)) {
    return fail(res, 422, 'validation_failed', 'widgets 必须是数组',
      { field: 'widgets', rule: 'array' });
  }
  if (row.section_status !== 'd1') {
    return fail(res, 409, 'state_precondition_failed', '栏目已发布，版面永久冻结',
      { from: 'd2', required: 'd1' });
  }

  const problem = widgetProblem(body.widgets);
  if (problem) {
    return fail(res, 422, 'validation_failed', '版面校验未通过，整栏目拒绝存档',
      { field: 'widgets', rule: problem });
  }

  const saved = body.widgets.map((w) => ({
    widget_id: Number.isInteger(w.widget_id) ? w.widget_id : nextWidgetId(),
    page_index: w.page_index,
    grid_x: w.grid_x,
    grid_y: w.grid_y,
    grid_w: w.grid_w,
    grid_h: w.grid_h,
    widget_type: w.widget_type,
    binding_key: w.binding_key,
    content: w.binding_key === 'literal' ? (w.content || null) : null,
    config: w.config || null,
  }));
  BOOK_WIDGETS.set(row.section_id, saved);
  return sendJson(res, 200, { widgets: saved.map((w) => ({ ...w })) });
}

function nextWidgetId() {
  const id = state.nextWidgetId;
  state.nextWidgetId += 1;
  return id;
}

/**
 * 服务端的版面重验。回**第一条**问题码，取值与契约的 422 说明逐字相同。
 *
 * 硬校验来自 §4 规则 8／9／14：`grid_x ∈ 0..14`、`grid_y ∈ 0..23`、`grid_x+grid_w<=15`、
 * `grid_y+grid_h<=24`、最小 2 × 2、同页不重叠、`literal` 是唯一可以在 widget 上存
 * `content` 的绑定。
 */
function widgetProblem(widgets) {
  for (const w of widgets) {
    if (!Number.isInteger(w.page_index) || w.page_index < 0) return 'cross_page';
    if (!Number.isInteger(w.grid_w) || !Number.isInteger(w.grid_h)
      || w.grid_w < 2 || w.grid_h < 2) return 'min_size';
    if (!Number.isInteger(w.grid_x) || !Number.isInteger(w.grid_y)
      || w.grid_x < 0 || w.grid_y < 0
      || w.grid_x + w.grid_w > 15 || w.grid_y + w.grid_h > 24) return 'out_of_grid';
    if (w.binding_key !== 'literal' && w.content) return 'literal_only_content';
  }
  for (let i = 0; i < widgets.length; i += 1) {
    for (let j = i + 1; j < widgets.length; j += 1) {
      const a = widgets[i];
      const b = widgets[j];
      if (a.page_index !== b.page_index) continue;
      if (a.grid_x < b.grid_x + b.grid_w && b.grid_x < a.grid_x + a.grid_w
        && a.grid_y < b.grid_y + b.grid_h && b.grid_y < a.grid_y + a.grid_h) return 'overlap';
    }
  }
  return null;
}

/** POST /teacher/growth-book/books —— 建立或取回（NONE→b1）。`UNIQUE(child_id, term_id)`。 */
function postGrowthBook(req, res, rawBody) {
  if (refuseWithoutTerm(res)) return;
  const body = onlyDeclared(res, rawBody, ['child_id']);
  if (!body) return;
  // schema 先于范围，理由同 putMonthEval。
  if (!Number.isInteger(body.child_id)) {
    return fail(res, 422, 'validation_failed', 'child_id 必填',
      { field: 'child_id', rule: 'required integer' });
  }
  const child = childInScope(body.child_id);
  if (!child) return fail(res, 404, 'not_found', '幼儿不存在或不在可见范围内');

  const existing = GROWTH_BOOKS.find((b) => b.child_id === child.child_id);
  if (existing) return sendJson(res, 200, { ...existing });

  const row = {
    growth_book_id: state.nextGrowthBookId,
    child_id: child.child_id,
    class_id: SCOPE.class_id,
    term_id: TERM.term_id,
    compilation_id: compilationState.row ? compilationState.row.compilation_id : null,
    book_release_id: 1,
    // 建册时冻结，**永不回写**。没有版式包时仍然冻结一个码 —— 真服务解析不到 pack 时
    // 该怎么办是 ADR-0015 Follow-ups 的事，这个 mock 不替它选一种读法，只如实记下它。
    pack_code: LAYOUT_PACK_CODE,
    // 不定长内容的版式挑选序列种子（W14）。首次建立后不变。
    layout_seed: 40 + child.child_id,
    book_status: 'b1',
    published_at: null,
  };
  state.nextGrowthBookId += 1;
  GROWTH_BOOKS.push(row);
  return sendJson(res, 201, { ...row });
}

/**
 * GET /teacher/growth-book/precheck —— 全班预检，**零写入**。
 *
 * **契约上这条路径没有 `x-hualong-blocked-on`**，但 ADR-0013／§4 规则 93 要求它与
 * manifest 共用同一个 composer，而那一个是被版式包阻断的。所以真服务的预检在 0／12 的
 * 今天同样算不出真页数。这个 mock 因此在没有版式包时回一个**占位页数**并如实标注 ——
 * 那是夹具值，不是口径。差异已记进交接。
 */
function getPrecheck(req, res) {
  const total = OPTS.layoutPack ? LAYOUT_PACK_PAGES.length : 0;
  return sendJson(res, 200, {
    content_fingerprint: contentFingerprint(),
    children: CHILDREN.map((child) => {
      const book = GROWTH_BOOKS.find((b) => b.child_id === child.child_id) || null;
      const hasMonth = MONTH_EVALS.some(
        (r) => r.child_id === child.child_id && r.month_eval_status === 'e3'
      );
      const hasTerm = TERM_EVALS.some((r) => r.child_id === child.child_id);
      const problems = (hasMonth || hasTerm)
        ? []
        : [{ rule: 'section_incomplete', section_key: 'term' }];
      return {
        child_id: child.child_id,
        total_pages: total,
        section_pages: {},
        problems,
        publishable: problems.length === 0,
        blocked_by_class_shared_content: false,
        book_status: book ? book.book_status : 'b1',
      };
    }),
  });
}

/** POST /teacher/growth-book/books/{id}/publication —— b1→b2，**永久唯读**，幂等键必填。 */
function postGrowthBookPublication(req, res, id, rawBody) {
  if (!req.headers['idempotency-key']) {
    return fail(res, 400, 'malformed_request', '本操作的 Idempotency-Key 是必填的');
  }
  const row = GROWTH_BOOKS.find((b) => b.growth_book_id === Number(id));
  if (!row) return fail(res, 404, 'not_found', '成长册不存在或不在可见范围内');

  const body = onlyDeclared(res, rawBody, ['content_fingerprint']);
  if (!body) return;
  if (typeof body.content_fingerprint !== 'string' || !body.content_fingerprint) {
    return fail(res, 422, 'validation_failed', 'content_fingerprint 必填',
      { field: 'content_fingerprint', rule: 'required' });
  }
  if (body.content_fingerprint !== contentFingerprint()) {
    // 零写入。指纹漂移的意思是「你预检时看到的班，和现在要定稿的班不是同一个」。
    return fail(res, 409, 'fingerprint_drift', '内容在预检之后变过，请重新预检');
  }
  if (row.book_status === 'b2') {
    return fail(res, 409, 'state_precondition_failed', '这本已定稿，永久唯读',
      { from: 'b2', required: 'b1' });
  }

  row.book_status = 'b2';
  row.published_at = '2026-08-26T17:30:00+08:00';
  // 服务端真正执行的一次 b1 -> b2。幂等重放在分发层就返回了，处理器根本没跑，所以这张
  // 表不涨 —— 「重复确认只存在一份成长册」要数服务端做了几次。
  state.bookPublications.push({ growth_book_id: row.growth_book_id, child_id: row.child_id });
  return sendJson(res, 200, { ...row });
}

// ── 夹具版式包 ─────────────────────────────────────────────────────────────
//
// **一份版式包也没有发布**（ADR-0015 Follow-ups，0／12），所以默认关。打开它是为了让
// 「有 pack 时预览排得出来、长文本与图片数量变化都不重叠」这一条测得到；关着它是为了让
// 「没有 pack 时诚实降级」那一条测得到。两条都要有。
//
// 固定 spine：`cover → school_intro → title_page → toc[1..k] → body → back_cover`
// （契约 `getResolvedBookManifest`）。TOC 只列其后的正文，**但 TOC 自身计入 200 页**。

const LAYOUT_PACK_LONG_TEXT = [
  '这个学期他在集体活动里越来越愿意先说出自己的想法，再听同伴把话讲完。',
  '搭建区的合作从抢材料变成了先商量分工，遇到塌下来的桥会自己找原因再试一次。',
  '生活自理上能独立整理床铺与餐具，午睡起床后还会提醒同伴把鞋子摆好。',
  '语言表达从短句变成了完整的叙述，讲述春游那一天的经过时用上了先、然后、最后。',
  '建议家庭继续给他一些需要等待与轮流的机会，让规则意识在真实的生活场景里长出来。',
].join('');

/**
 * 一页 body 的 widget。**格坐标，`0..14 / 0..23`，两两不重叠，最小 2 × 2。**
 *
 * 三种排布刻意不同，好让「图片数量变化时版式不错乱」有真实的差异可断言：
 * 3 图是三条横幅加一段说明，6 图是两列三行，长文本页是标题加一整块正文。
 */
function packBodyPage(kind) {
  if (kind === 'time-3') {
    return [
      { kind: 'image', grid_x: 0, grid_y: 0, grid_w: 15, grid_h: 6, image: packImage(1) },
      { kind: 'image', grid_x: 0, grid_y: 6, grid_w: 15, grid_h: 6, image: packImage(2) },
      { kind: 'image', grid_x: 0, grid_y: 12, grid_w: 15, grid_h: 6, image: packImage(3) },
      { kind: 'text', grid_x: 0, grid_y: 18, grid_w: 15, grid_h: 6, text: '九月的户外活动。' },
    ];
  }
  if (kind === 'time-6') {
    const out = [];
    [0, 8, 16].forEach((y, rowIndex) => {
      [0, 8].forEach((x, colIndex) => {
        out.push({
          kind: 'image', grid_x: x, grid_y: y, grid_w: 7, grid_h: 7,
          image: packImage(rowIndex * 2 + colIndex + 1),
        });
      });
    });
    return out;
  }
  // 'term-text'
  return [
    { kind: 'text', grid_x: 0, grid_y: 0, grid_w: 15, grid_h: 2, text: '学期综合评语' },
    { kind: 'text', grid_x: 0, grid_y: 2, grid_w: 15, grid_h: 22, text: LAYOUT_PACK_LONG_TEXT },
  ];
}

/**
 * 派生图。**尺寸由服务端从版式包几何算出**，客户端不得指定（ADR-0015）；这里回的宽高
 * 是按 `min(cssWidth × min(dpr, 2), 4096)` 算好的样子，客户端只读不算。
 */
function packImage(n) {
  return {
    url: `https://example.invalid/derived/${n}.jpg`,
    expires_at: '2026-08-26T18:00:00+08:00',
    width_px: 886,
    height_px: 354,
  };
}

const LAYOUT_PACK_PAGES = [
  { ordinal: 1, folio: null, page_role: 'cover', section_key: null, layout_code: 'cover-1', kind: 'cover' },
  { ordinal: 2, folio: null, page_role: 'school_intro', section_key: 'intro', layout_code: 'intro-1', kind: 'term-text' },
  { ordinal: 3, folio: null, page_role: 'title_page', section_key: null, layout_code: 'title-1', kind: 'cover' },
  { ordinal: 4, folio: 1, page_role: 'toc', section_key: null, layout_code: 'toc-1', kind: 'term-text' },
  { ordinal: 5, folio: 2, page_role: 'body', section_key: 'time', layout_code: 'time-3', kind: 'time-3' },
  { ordinal: 6, folio: 3, page_role: 'body', section_key: 'time', layout_code: 'time-6', kind: 'time-6' },
  { ordinal: 7, folio: 4, page_role: 'body', section_key: 'term', layout_code: 'term-1', kind: 'term-text' },
  { ordinal: 8, folio: null, page_role: 'back_cover', section_key: null, layout_code: 'back-1', kind: 'cover' },
];

function packElements(page) {
  if (page.kind === 'cover') {
    // 封面整页一张图。占满内容区，仍在 `0..14 / 0..23` 内。
    return [{ kind: 'image', grid_x: 0, grid_y: 0, grid_w: 15, grid_h: 24, image: packImage(9) }];
  }
  return packBodyPage(page.kind);
}

/** 没有版式包时的那一次拒绝。409 是契约给这两条路径声明过的码，rule 走 §2.2 的 details。 */
function refuseWithoutPack(res) {
  if (OPTS.layoutPack) return false;
  fail(res, 409, 'state_precondition_failed', '没有已发布的版式包可解析',
    { rule: 'layout_pack_unreleased' });
  return true;
}

function bookInScope(res, id) {
  const row = GROWTH_BOOKS.find((b) => b.growth_book_id === Number(id));
  if (!row) {
    fail(res, 404, 'not_found', '成长册不存在或不在可见范围内');
    return null;
  }
  return row;
}

/** GET /growth-book/books/{id}/manifest —— request-local 解析，**不落表**。 */
function getBookManifest(req, res, id) {
  const row = bookInScope(res, id);
  if (!row) return;
  if (refuseWithoutPack(res)) return;
  return sendJson(res, 200, {
    growth_book_id: row.growth_book_id,
    fingerprint: contentFingerprint(),
    book_release_id: row.book_release_id,
    pack_code: row.pack_code,
    total_pages: LAYOUT_PACK_PAGES.length,
    pages: LAYOUT_PACK_PAGES.map((p) => ({
      ordinal: p.ordinal, folio: p.folio, page_role: p.page_role,
      section_key: p.section_key, layout_code: p.layout_code,
    })),
    // TOC 只列其后的正文，不列封面／园所介绍／扉页／TOC／封底。
    toc: LAYOUT_PACK_PAGES
      .filter((p) => p.page_role === 'body')
      .map((p) => ({ level: 1, title: p.section_key === 'time' ? '在园时光' : '教师综合评估', ordinal: p.ordinal })),
  });
}

/** GET /growth-book/books/{id}/pages/{ordinal} —— 按页取内容与派生图，每次重新授权。 */
function getBookPage(req, res, id, ordinal, url) {
  const row = bookInScope(res, id);
  if (!row) return;
  if (refuseWithoutPack(res)) return;

  const fingerprint = url.searchParams.get('fingerprint');
  if (!fingerprint) {
    return fail(res, 422, 'validation_failed', 'fingerprint 必填',
      { field: 'fingerprint', rule: 'required' });
  }
  if (fingerprint !== contentFingerprint()) {
    return fail(res, 409, 'fingerprint_drift', 'manifest 已变，请重新取一次');
  }
  const page = LAYOUT_PACK_PAGES.find((p) => p.ordinal === Number(ordinal));
  if (!page) return fail(res, 404, 'not_found', '这一页不存在');

  const dprRaw = Number(url.searchParams.get('dpr'));
  // ADR-0015 决策一：**服务端把它钳到 ≤ 2**。客户端声称 dpr=5 不得让服务端签出一张
  // 越界的派生图。缺省按 1 处理。
  const appliedDpr = Math.min(Number.isFinite(dprRaw) && dprRaw >= 1 ? dprRaw : 1, 2);

  return sendJson(res, 200, {
    ordinal: page.ordinal,
    folio: page.folio,
    page_role: page.page_role,
    layout_code: page.layout_code,
    applied_dpr: appliedDpr,
    elements: packElements(page),
  });
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

/**
 * Test hook: the a2 → a3 transitions the server actually executed.
 *
 * 「重复点击只产生一条提交」只有对着这份记录才断言得了。幂等重放在分发层就返回了
 * 原始状态码与响应体，处理器根本没跑，所以这张表不涨 —— 数客户端发了几个请求答不了
 * 这个问题，数服务端做了几次才行。
 */
export function taskCompletions() {
  return state.taskCompletions.slice();
}

/**
 * Test hook: the s1 -> s2 transitions the server actually executed (票据 15).
 *
 * 「重复点击不产生两条待审核记录」只有对着这份记录才断言得了。幂等重放在分发层就返回了
 * 原始状态码与响应体，处理器根本没跑，所以这张表不涨。
 */
export function librarySubmissions() {
  return state.librarySubmissions.slice();
}

/** Test hook: the training-feedback rows the server actually created (票据 16). */
/**
 * 教师档案的修改申请。
 *
 * 提交一份就会留一份 s2，而「同时最多一份 s2」是服务端的前置 —— 同一个测试文件里的
 * 前一条用例会挡住后一条。给测试一把还原的钥匙，与 `setNoTerm` 同一个理由。
 */
export function resetProfileChanges() {
  PROFILE_CHANGES.length = 0;
}

export function trainingFeedbackWrites() {
  return state.trainingFeedbackWrites.slice();
}

/** Test hook: the s1 -> s3 在园时光 publications the server actually executed (票据 17). */
export function momentPublications() {
  return state.momentPublications.slice();
}

/** Test hook: the s1 -> s2 亲子任务 publications the server actually executed (票据 19). */
export function parentTaskPublications() {
  return state.parentTaskPublications.slice();
}

/** Test hook: the class roster the mock serves, so a test can size the matrix. */
export function classRoster() {
  return CHILDREN.map((c) => ({ ...c }));
}

/** Test hook: the c2 -> c1 综合评估 submissions the server actually executed (票据 18). */
export function childAssessmentCompletions() {
  return state.childAssessmentCompletions.slice();
}

/** Test hook: the e1|e2 -> e3 月度评价 publications the server actually executed (票据 20). */
export function monthEvalPublications() {
  return state.monthEvalPublications.slice();
}

/** Test hook: the NONE -> c1 学期评价 rows the server actually created (票据 20). */
export function termEvalWrites() {
  return state.termEvalWrites.slice();
}

/** Test hook: the b1 -> b2 成长册 定稿 the server actually executed (票据 21). */
export function bookPublications() {
  return state.bookPublications.slice();
}

/** Test hook: every 成长册 row, so "只存在一份" is a count of rows not of requests. */
export function growthBooks() {
  return GROWTH_BOOKS.map((b) => ({ ...b }));
}

/**
 * Test hook: 发布或撤下那份夹具版式包。
 *
 * 默认关 —— 事实是一份也没有发布（ADR-0015 Follow-ups，0／12）。打开它才测得到「有 pack
 * 时预览排得出来」，关着它才测得到「没 pack 时诚实降级」。两条都要有。
 */
export function setLayoutPack(released) {
  OPTS.layoutPack = Boolean(released);
}

/** Test hook: 夹具版式包的页数，好让测试知道翻到第几页算翻完。 */
export function layoutPackPageCount() {
  return LAYOUT_PACK_PAGES.length;
}

/** Test hook: the 124 scale items the mock serves, so a test can score them all. */
export function scaleItems() {
  return SCALE_ITEMS.map((item) => ({ ...item }));
}

/** Test hook: the six week keys the progress span covers, newest last. */
export function momentWeekKeys() {
  return MOMENT_WEEK_KEYS.slice();
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
