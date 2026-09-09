/**
 * 教师专业档案 —— 契约的 `org` 模块里属于教师本人的那三条端点。
 *
 * Boundary: 页面 `require` 本模块、把返回值直接 `setData`，
 * **不在页面里拼 URL、不在页面里译枚举、不在页面里判状态机**。
 *
 *   `GET  /teacher-profile`          本人档案（含证书与当前那条待审申请）
 *   `GET  /teacher-profile/changes`  本人的档案修改申请，新的在前
 *   `POST /teacher-profile/changes`  提交一条修改申请（NONE → s2）
 *
 * ── 教师改不了自己的档案，只能提申请 ───────────────────────────────────────
 *
 * G45（教师专业档案：字段绑定说教师直接写、审核模型说教师提申请，两套契约互斥）
 * 于 2026-08-27 由园方拍申请制。所以本模块**没有 PATCH**：教师提交的是
 * `db_teacher_profile_change`（教师档案修改申请）的一行，管理端 t3 队列批准后才落
 * canonical。页面上那个按钮的字是「提交审核」，不是「保存」。
 *
 * **教师端不产生 `s1` 草稿**：草稿留在客户端，服务端只见提交后的那一份。
 * 取消（`s5`）与审核决定（`s3`／`s4`）都不在教师端。
 *
 * ── 姓名与任教班级不在这条端点里 ───────────────────────────────────────────
 *
 * 契约逐字：「那是名册权威持有的身份字段，随会话 `scope` 下发（§6.4：`scope` 只作
 * 显示用）。放进本端点等于让教师给自己改授权边界。」
 *
 * 所以**姓名取自会话**（`session.getSubject().teacher_name`），由本模块拼进
 * `fields`，页面不必自己去翻会话。
 *
 * **任教班级一行不渲染。** 会话里只有 `class_id`，没有班级名：`SessionContext.scope`
 * 是 `additionalProperties: false`，只有 `school_id`／`class_id`／`partner_school_id`
 * 三个键。教师端也没有任何一条端点回本班班名。CLAUDE.md §8「没有数据源就不要渲染
 * 它，更不要编一个出来」—— 所以这一行删掉，不填 `class_id`，也不留一个空格子。
 *
 * ── 教龄与在园年数删掉了，不是漏了 ─────────────────────────────────────────
 *
 * 契约的 `first_taught_at` 与 `joined_school_at` **恒为 null**，且各自带一句
 * `x-hualong-blocked-on: G45（原型写「教龄 8 年」，但这一列在任何一张表里都没有）`。
 * 契约同一处逐字写着「客户端照回 null 并不画那一行 —— **不拿今年去减**」。
 *
 * ── 「学历类别」下拉没有落点，所以只剩一个等级下拉 ───────────────────────────
 *
 * G37（教师证书的「学历类别」下拉无落点）：原型的证书行有一个双用下拉，选「学历
 * 证书」时列 本科／硕士／博士，其余时列 校级…国家级。后者正是
 * `db_teacher_credential.credential_level` 的 `l1`—`l5`，**前者不在该枚举里**，
 * 学历层级的唯一落点是同一个弹层上方那个「最高学历」（`education_level`）。
 *
 * 所以三种文件类型共用同一个 `credential_level` 下拉。该列可空，下拉因此带一个
 * 「不填」档，选它就不送这个键 —— 不默认替教师填一个「园级」。
 *
 * ── 职称是自由文本，不是五选一 ─────────────────────────────────────────────
 *
 * `db_teacher_profile.professional_title` 是 `VARCHAR(50)`，没有 CHECK、没有枚举。
 * 原型把它做成 正高／副高／一级／二级／三级 的下拉，那五个值没有任何权威 ——
 * 而数据集里真实存在的值是「一级教师」「高级教师」这种，五选一根本填不出来。
 * 所以这里是一个 `maxLength=50` 的输入框。
 *
 * ── `change_payload` 只送要改的键 ───────────────────────────────────────────
 *
 * 契约逐字：「**变更字段和值，不是整份档案** —— 只送要改的键。省略一个键意味着
 * 『不改它』，不意味着『清空它』。」`diffPayload()` 因此逐键与当前档案比对，
 * 相同的不送。
 *
 * **唯独 `credentials` 是整份清单**：契约逐字「送出即为该教师证书的完整目标清单，
 * 不是增量」。所以弹层要先把既有证书填进去，删掉一行就是要求删掉那一张证书。
 *
 * ── `full_preview_confirmed` 只能是客户端行为 ───────────────────────────────
 *
 * 登记表 `api/action-registry.tsv:37` 给 `teacher_profile_change.submit` 写了四条
 * 前置：`self_scope_inline`（服务端做）、`no_open_s2`（服务端做，本模块另在界面上
 * 先说明原因）、`full_preview_confirmed`、`credential_file_owned`（服务端做，
 * 提交里的每个 `file_id` 都要是本人的）。
 *
 * 第三条**服务端验不了**，契约自己写明了这一点（`api/openapi.yaml` 的
 * `publishMonthEval` 描述逐字）：管理端的批准有服务端可验的 `preview_receipt`
 * （§10.4：签发过全部附件读取 URL 之后才发的短时签名），**教师端这一侧没有任何
 * 等价原语，「完整预览」目前只能是客户端行为。契约不假装它已经被验证过。**
 *
 * 所以本模块把它做成一件能看见的事、并且只做到能做到的那一步：
 *   1. `previewText(diff, before)` 把**每一处改动逐条列成中文**（旧值 → 新值），
 *      证书逐行列出名称与已选文件；
 *   2. 页面用 `wx.showModal` 把这段文字整段摆出来，教师按「确认提交」才发请求。
 *
 * **它挡不住绕过界面直接 POST 的调用**，因为服务端没有可验的收据。这句话写在这里，
 * 不是写在别处：`docs/DO-NOT-BUILD.md` 第 13 条援引的 `utils/moderation.js`
 * （GATES／assertGate／requireHumanGate）**在本仓库不存在**，`miniprogram/utils/`
 * 下只有 auth、book-viewer、derived、errors、growth-book、guard、radar、request、
 * session、time 十个文件。没有那个模块可以 require，所以把关路径
 * 的声明就落在这一段头注与 `previewText()` 上。
 */

const api = require('../utils/request');
const session = require('../utils/session');
const time = require('../utils/time');
const media = require('./media');

const PROFILE_PATH = '/teacher-profile';
const CHANGES_PATH = '/teacher-profile/changes';

/* ── 枚举表。权威是 hualong-backend/db/01_schema.sql 的列注释 ────────────── */

/** `db_teacher_profile.education_level`（01_schema.sql:924）。 */
const EDUCATION_LEVEL = { e1: '中专', e2: '大专', e3: '本科', e4: '硕士', e5: '博士', e6: '其他' };

/** `db_teacher_profile.job_role`（01_schema.sql:925）。 */
const JOB_ROLE = { j1: '主班', j2: '配班', j3: '保育员', j4: '教研组长', j5: '其他' };

/** `db_teacher_credential.credential_type`（01_schema.sql:951）。 */
const CREDENTIAL_TYPE = { c1: '学历证书', c2: '能力证书', c3: '专业奖项' };

/** `db_teacher_credential.credential_level`（01_schema.sql:953）。 */
const CREDENTIAL_LEVEL = { l1: '园级', l2: '区级', l3: '市级', l4: '省级', l5: '国家级', l6: '其他' };

/**
 * `db_teacher_profile_change.change_status`（01_schema.sql:965）。
 *
 * 教师端只产生 `s2`。`s1` 与 `s5` 数据库允许、按 G45 的决议永远不会被写入
 * （退役它们已移交 G46），教师端也就永远收不到 —— 但表里照抄全部五个：
 * 收到一个没见过的编码时，「未知状态」比一个空白格子好读。
 */
const CHANGE_STATUS = { s1: '草稿', s2: '待审核', s3: '已通过', s4: '已驳回', s5: '已取消' };

/** 三档语气，对齐本仓库其它页面的徽章样式。s2 事情还在走，s4 不是错误但要看得见。 */
const CHANGE_TONE = { s1: 'plain', s2: 'doing', s3: 'done', s4: 'reject', s5: 'plain' };

/**
 * 上传证书原件时报给服务端的 `usage_key`。
 *
 * **证书不产生 `db_file_ref` 行**（`db_teacher_credential.file_id` 是直连列），
 * 所以这个值只决定 object_key 前缀，不会有哪一行记下它。取 `attachment` ——
 * 那是 `db_file_ref.usage_key` 自己的 DEFAULT，不宣称一个永远不会被记录的用途。
 */
const CREDENTIAL_USAGE = media.USAGE.ATTACHMENT;

/* ── 选择器的选项表 ──────────────────────────────────────────────────────── */

/**
 * 枚举表变成 `<picker range="..." range-key="label">` 收得下的形状。
 *
 * **页面不译枚举，也不自己排选项。** 顺序就是枚举表的顺序，也就是 DDL 列注释的
 * 顺序 —— 换一个顺序就要有人回答「为什么 j3 排在 j1 前面」。
 *
 * @param {object} map  编码 → 中文
 * @param {string} [blank] 有值时在最前面插一档「不填」，它的 key 是空串
 */
function optionList(map, blank) {
  const items = Object.keys(map).map((key) => ({ key, label: map[key] }));
  return blank ? [{ key: '', label: blank }].concat(items) : items;
}

// `job_role`／`education_level`／`credential_level` 三列**都可空**（DDL 上都没有
// NOT NULL），所以三个下拉都多一档「不填」。**没有这一档就会说谎**：一位岗位为空
// 的教师打开弹层会看到「主班」，一按提交就把「主班」当成一次修改送上去。
const JOB_ROLE_OPTIONS = optionList(JOB_ROLE, '不填');
const EDUCATION_OPTIONS = optionList(EDUCATION_LEVEL, '不填');
// `credential_type` 是 NOT NULL，没有「不填」这一档。
const CREDENTIAL_TYPE_OPTIONS = optionList(CREDENTIAL_TYPE);
const CREDENTIAL_LEVEL_OPTIONS = optionList(CREDENTIAL_LEVEL, '不填');

/** 某个编码在选项表里的下标。查不到回 0 —— `<picker>` 的 value 不接受 -1。 */
function indexOfKey(options, key) {
  const i = options.findIndex((o) => o.key === (key || ''));
  return i > -1 ? i : 0;
}

/* ── 读 ──────────────────────────────────────────────────────────────────── */

/** 取档要交上去的宿主那一对。**`owner_id` 是 `credential_id`**，见 media.js 的 OWNER。 */
function credentialOwner(credentialId) {
  return { object: media.OWNER.TEACHER_CREDENTIAL, id: credentialId };
}

/** 一张证书。每个值都可以直接 `setData`。 */
function decorateCredential(row) {
  const level = row.credential_level || '';
  return {
    credentialId: row.credential_id,
    type: row.credential_type,
    typeLabel: CREDENTIAL_TYPE[row.credential_type] || '未知类型',
    name: row.credential_name || '（未命名）',
    level,
    levelLabel: level ? (CREDENTIAL_LEVEL[level] || '未知等级') : '',
    fileId: row.file_id,
    // 服务端从 db_file 派生的显示名。取不到就用 id 兜底，不留一个空白的文件行。
    fileName: row.file_name || `文件 ${row.file_id}`,
    // `issuer` 与 `issued_date` 回包里有，这里**不装饰也不返回**：原型的证书行
    // 只有名称与徽章两处，没有它们的位置。渲染不到的值不进 setData。
    // c3 是奖项，徽章显示等级（区级／市级…）；c1／c2 显示类型。原型就是这么分的，
    // 两者都有落点：前者是 credential_level，后者是 credential_type。
    award: row.credential_type === 'c3',
    badge: row.credential_type === 'c3'
      ? (CREDENTIAL_LEVEL[level] || CREDENTIAL_TYPE.c3)
      : (CREDENTIAL_TYPE[row.credential_type] || '证书'),
  };
}

/**
 * 把证书分成原型那两区：资格证书（c1／c2）与专业奖项（c3）。
 *
 * **空的那一区不渲染**：一个只有标题、下面什么都没有的区块，读起来像加载失败。
 */
function groupCredentials(items) {
  const groups = [
    { subhead: '资格证书', items: items.filter((x) => x.type !== 'c3') },
    { subhead: '专业奖项', items: items.filter((x) => x.type === 'c3') },
  ];
  return groups.filter((g) => g.items.length);
}

/** 一条修改申请。 */
function decorateChange(row) {
  const status = row.change_status;
  return {
    changeId: row.teacher_profile_change_id,
    status,
    statusLabel: CHANGE_STATUS[status] || '未知状态',
    tone: CHANGE_TONE[status] || 'plain',
    pending: status === 's2',
    payload: row.change_payload || {},
    submittedLabel: row.submitted_at ? time.formatStamp(row.submitted_at) : '',
    appliedLabel: row.applied_at ? time.formatStamp(row.applied_at) : '',
  };
}

/**
 * 本人档案。
 *
 * `fields` 是「基本履历」那一栏要显示的行，**已经按顺序排好、已经译过枚举**，
 * 页面直接 `wx:for`。没有值的行不进去 —— 契约允许 `professional_title`／
 * `education_level`／`job_role` 全为 null。
 *
 * `pendingChange` 是契约内嵌的那条 `s2`，没有则 null。
 */
async function getProfile() {
  const row = await api.get(PROFILE_PATH);
  const subject = session.getSubject() || {};
  const credentials = (row.credentials || []).map(decorateCredential);

  const jobRole = row.job_role || '';
  const educationLevel = row.education_level || '';
  const title = row.professional_title || '';

  const fields = [];
  // 姓名来自会话，不是本端点。任教班级没有数据源，一行都不画（见头注）。
  if (subject.teacher_name) fields.push({ label: '姓名', value: subject.teacher_name });
  if (jobRole) fields.push({ label: '岗位', value: JOB_ROLE[jobRole] || '未知岗位' });
  if (title) fields.push({ label: '职称', value: title });
  if (educationLevel) {
    fields.push({ label: '最高学历', value: EDUCATION_LEVEL[educationLevel] || '未知学历' });
  }
  if (row.career_summary) fields.push({ label: '履历摘要', value: row.career_summary });

  return {
    profileId: row.teacher_profile_id,
    name: subject.teacher_name || '',
    fields,
    title,
    jobRole,
    educationLevel,
    careerSummary: row.career_summary || '',
    credentials,
    groups: groupCredentials(credentials),
    pendingChange: row.pending_change ? decorateChange(row.pending_change) : null,
  };
}

/**
 * 本人的修改申请，新的在前（服务端排序 `submitted_at DESC,
 * teacher_profile_change_id DESC`，客户端不重排）。
 */
async function listChanges({ cursor, limit } = {}) {
  const page = await api.getPage(CHANGES_PATH, { cursor, limit });
  return { items: page.items.map(decorateChange), nextCursor: page.nextCursor };
}

/**
 * 上一次改到哪一步了，没提过则 null。
 *
 * **要的是第一页的第一条**，不是 `pendingChange`：`pendingChange` 只有 `s2`，
 * 而档案页要说的是「上一次改到哪一步」——`s3=已通过` 与 `s4=已驳回` 同样要看得见。
 */
async function latestChange() {
  const page = await listChanges({ limit: 1 });
  return page.items.length ? page.items[0] : null;
}

/* ── 写 ──────────────────────────────────────────────────────────────────── */

// api/action-registry.tsv 的 action_key。
const ACTIONS = { submit: 'teacher_profile_change.submit' };

/** `professional_title` 的字数上限，与 DDL 的 `VARCHAR(50)` 一致。 */
const TITLE_MAX = 50;

/** `credential_name` 的字数上限，与 DDL 的 `VARCHAR(150)` 一致。 */
const CREDENTIAL_NAME_MAX = 150;

/**
 * 一份表单变成 `change_payload`。**只留与当前档案不同的键。**
 *
 * @param {object} form  `{ title, jobRole, educationLevel, credentials: [{type, name, level, fileId}] }`
 * @param {object} before `getProfile()` 的返回值
 * @returns {object} 可直接交给 `submitChange()` 的 payload；没有任何改动时是 `{}`
 *
 * `credentials` 要么整份送、要么完全不送 —— 契约说它是完整目标清单，送半份等于
 * 要求删掉没送的那几张。所以只在清单**真的变了**的时候才放进 payload。
 */
function diffPayload(form, before) {
  const payload = {};
  const title = String(form.title || '').trim();
  // **已填的字段清不掉。三个可空字段同一条规则。** 契约的 `job_role` 与
  // `education_level` 是 `enum: [j1..j5]`／`[e1..e6]`，没有空串也没有 null；
  // `professional_title` 是 `maxLength: 50` 的字符串，契约与 DDL 都没有把空串
  // 定义成「清空这一列」。三个都一样：从空改成有值送得出去，反过来送不出去。
  //
  // 此前这里三个字段有三种行为：两个枚举挡住，职称却把 `''` 照送。**空串是一个
  // 谁都没定义过的值** —— 管理端批准时把它写进 canonical，还是当成「不改」，
  // 没有任何一份权威说得出来。「教师怎么清空一个字段」目前无权威，已登记
  // （`docs/API-CONTRACT.md` §15 与后端 `db/GAPS.md` G88）。
  if (title && title !== (before.title || '')) payload.professional_title = title;
  if (form.jobRole && form.jobRole !== (before.jobRole || '')) payload.job_role = form.jobRole;
  if (form.educationLevel && form.educationLevel !== (before.educationLevel || '')) {
    payload.education_level = form.educationLevel;
  }

  const next = (form.credentials || []).map(toPayloadCredential);
  const now = (before.credentials || []).map((c) => toPayloadCredential({
    type: c.type, name: c.name, level: c.level, fileId: c.fileId,
  }));
  if (JSON.stringify(next) !== JSON.stringify(now)) payload.credentials = next;
  return payload;
}

/**
 * 一行表单变成契约的 credential 项。
 *
 * 契约的 `TeacherProfileChangePayload.credentials[]` 是
 * `additionalProperties: false`，只收 `credential_type`／`credential_name`／
 * `credential_level`／`file_id` 四个键。**`credential_level` 可省**，省略即不填。
 *
 * `issuer` 与 `issued_date` 这两列在这里**送不出去** —— 契约的 payload 项没有它们
 * 的位置。既有证书重新送一遍时它们不在 payload 里，这一点写在这里，不掩盖。
 */
function toPayloadCredential(row) {
  const item = {
    credential_type: row.type,
    credential_name: String(row.name || '').trim(),
    file_id: row.fileId,
  };
  if (row.level) item.credential_level = row.level;
  return item;
}

/**
 * 提交前的本地预检。**预检不是校验**：服务端独立再验一次。
 *
 * @returns {string} 不能提交的理由（可直接 toast），可以提交时是空串
 */
function whyCannotSubmit(form, before, latest) {
  // `no_open_s2`：登记表的第二条前置。服务端会回
  // `state_precondition_failed`，这里先说明原因，免得点下去才知道。
  if (latest && latest.pending) {
    return '已有一份修改申请在审核中，通过或驳回之后才能再提交';
  }
  // 把一个**已填的**职称、岗位或学历清空，这份契约里送不出去（见 diffPayload）。
  // **当场说清楚。** 不说的话它会被 diffPayload 悄悄丢掉：只改了这一项时屏幕上
  // 会冒出「没有任何改动」，而教师明明改了；连带其它项一起改时，提交会成功、
  // 这一项却没发出去。两种都是界面在说假话。
  if (!String(form.title || '').trim() && before.title) {
    return '职称不能清空，请填一个，或联系园所管理员';
  }
  if (!form.jobRole && before.jobRole) return '岗位不能改成「不填」，请选一档，或联系园所管理员';
  if (!form.educationLevel && before.educationLevel) {
    return '最高学历不能改成「不填」，请选一档，或联系园所管理员';
  }
  if (String(form.title || '').length > TITLE_MAX) return `职称最多 ${TITLE_MAX} 字`;
  const rows = form.credentials || [];
  for (let i = 0; i < rows.length; i += 1) {
    const name = String(rows[i].name || '').trim();
    if (!name) return `第 ${i + 1} 份文件还没有填名称`;
    if (name.length > CREDENTIAL_NAME_MAX) return `第 ${i + 1} 份文件的名称最多 ${CREDENTIAL_NAME_MAX} 字`;
    // 上传成功才有 file_id。只有本地文件名而没有 file_id 的一行，送出去必被拒。
    if (!rows[i].fileId) return `第 ${i + 1} 份文件还没有上传成功`;
  }
  if (!Object.keys(diffPayload(form, before)).length) return '没有任何改动，不用提交';
  return '';
}

/**
 * `full_preview_confirmed` 的那段完整预览文字。**逐条列出这次要改什么。**
 *
 * 见头注：服务端没有可验的收据，这一步只能是客户端行为，所以它至少要把改动
 * **整段摆出来**，而不是问一句「确定吗」。
 *
 * @returns {string} 可直接放进 `wx.showModal` 的 content
 */
function previewText(payload, before) {
  const lines = [];
  if ('professional_title' in payload) {
    lines.push(`职称：${before.title || '（未填）'} → ${payload.professional_title}`);
  }
  if ('job_role' in payload) {
    lines.push(`岗位：${JOB_ROLE[before.jobRole] || '（未填）'} → ${JOB_ROLE[payload.job_role] || payload.job_role}`);
  }
  if ('education_level' in payload) {
    lines.push(`最高学历：${EDUCATION_LEVEL[before.educationLevel] || '（未填）'} → ${EDUCATION_LEVEL[payload.education_level] || payload.education_level}`);
  }
  if (payload.credentials) {
    lines.push(`证书与奖项：${before.credentials.length} 份 → ${payload.credentials.length} 份，提交后以下面这份清单为准：`);
    payload.credentials.forEach((item, i) => {
      const level = item.credential_level ? `｜${CREDENTIAL_LEVEL[item.credential_level] || item.credential_level}` : '';
      lines.push(`  ${i + 1}. ${item.credential_name}（${CREDENTIAL_TYPE[item.credential_type] || item.credential_type}${level}）`);
    });
  }
  lines.push('');
  lines.push('提交后进入管理端审核，通过之后才会更新档案。');
  return lines.join('\n');
}

/**
 * 提交一条修改申请（NONE → `s2=待审核`）。
 *
 * `school_id`／`teacher_id`／`teacher_profile_id`／`submitted_at` 是派生字段，
 * **客户端一个都不送**（§7.3，DO-NOT-BUILD 8；`utils/derived.js` 另有一道剥离）。
 *
 * 失败原样抛 `ApiError`，交给页面的 `guard` 与 `submitFailureText()`。
 */
function submitChange(payload) {
  return api.post(CHANGES_PATH, {
    action: ACTIONS.submit,
    body: { change_payload: payload },
  });
}

/**
 * 把提交失败译成教师看得懂的一句。
 *
 * 只译这一条端点**特有**的两个码，其余交回 `errors.js` 的通用文案：
 *
 *   `state_precondition_failed`  已经有一条 `s2` 在审。通用文案说不出这一点，而
 *                                教师要知道的是「等审完」，不是「稍后重试」
 *   `validation_failed`          `credential_file_owned` 没过时是这个码。文案里
 *                                只说文件不能用，**不说是谁的** —— 「不是你的」与
 *                                「根本没有」对提交者是同一个答案（§2.3）
 */
function submitFailureText(err) {
  if (err && err.code === 'state_precondition_failed') {
    return '已有一份修改申请在审核中，通过或驳回之后才能再提交';
  }
  if (err && err.code === 'validation_failed'
      && err.details && String(err.details.rule) === 'credential_file_owned') {
    return '有一份证书原件不能用，请重新上传';
  }
  return (err && err.userMessage) || '提交失败，请稍后重试';
}

module.exports = {
  JOB_ROLE_OPTIONS,
  EDUCATION_OPTIONS,
  CREDENTIAL_TYPE_OPTIONS,
  CREDENTIAL_LEVEL_OPTIONS,
  indexOfKey,
  EDUCATION_LEVEL,
  JOB_ROLE,
  CREDENTIAL_TYPE,
  CREDENTIAL_LEVEL,
  CHANGE_STATUS,
  CREDENTIAL_USAGE,
  TITLE_MAX,
  CREDENTIAL_NAME_MAX,
  credentialOwner,
  getProfile,
  listChanges,
  latestChange,
  diffPayload,
  previewText,
  whyCannotSubmit,
  submitChange,
  submitFailureText,
};
