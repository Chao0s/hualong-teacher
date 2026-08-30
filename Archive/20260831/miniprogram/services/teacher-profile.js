/**
 * 教师专业档案 —— 读 canonical，写申请（G45）。
 *
 * **园方 2026-08-27 拍板：走申请制。** 教师读得到自己的档案，但改不了它：修改一律经
 * `POST /teacher-profile/changes` 提交申请，管理员在 t3 审核队列批准后才落 canonical。
 * 拍这一边的理由是资产已经站在这里 —— `db_teacher_profile_change` 表、管理端 t3 队列、
 * `db_review_action.teacher_profile_change_id` 外键都已建好；原型那枚按钮也写着「提交审核」。
 *
 * 拍板之前契约里**连读都没有**，所以这一页此前一行也建不出来。契约三条是同一次改动加的
 * （hualong-backend 6dbc5dd，v0.6）。
 *
 * ── 两件事不在这份档案里 ────────────────────────────────────────────────────
 *
 * **姓名与任教班级**：名册权威持有的身份字段，随会话上下文（`scope`）下发，教师改不了。
 * 原型自己的注释写着理由 —— 留着那两个控件等于让教师给自己改授权边界。
 *
 * **教龄与在园年数**：原型写「2018.09（教龄 8 年）」，那两列在任何一张表里都没有。契约把
 * `first_taught_at`／`joined_school_at` 标了 `x-hualong-blocked-on: G45`，服务端可回 null，
 * 本层照回 null，页面按空串不画那两行。**不自己拿今年去减** —— 客户端不做时间算术。
 */

const api = require('../utils/request');
const identity = require('./identity');
const moderation = require('../utils/moderation');

const PROFILE_PATH = '/teacher-profile';
const CHANGE_PATH = '/teacher-profile/changes';

// api/action-registry.tsv 的 action_key。带上它，登记册与代码可以对眼。
const ACTION_SUBMIT = 'teacher_profile_change.submit';

// 契约 TeacherProfileChangeWrite.change_payload.credentials[].credential_name
const CREDENTIAL_NAME_MAX = 150;

// 枚举编码到中文。客户端不猜没见过的编码，一律降级成一句话（§1.1）。
const JOB_ROLE = { j1: '主班', j2: '配班', j3: '保育员', j4: '教研组长', j5: '其他' };
const EDUCATION = { e1: '中专', e2: '大专', e3: '本科', e4: '硕士', e5: '博士', e6: '其他' };
const CREDENTIAL_TYPE = { c1: '学历证书', c2: '能力证书', c3: '专业奖项' };
const CREDENTIAL_LEVEL = { l1: '园级', l2: '区级', l3: '市级', l4: '省级', l5: '国家级', l6: '其他' };
const CHANGE_STATUS = { s1: '草稿', s2: '待审核', s3: '已通过', s4: '已驳回', s5: '已取消' };

/** 选择位的取值。页面绑它，不自己写一份枚举。 */
function options() {
  const list = (map) => Object.keys(map).map((key) => ({ key, label: map[key] }));
  return {
    job_role: list(JOB_ROLE),
    education_level: list(EDUCATION),
    credential_type: list(CREDENTIAL_TYPE),
    credential_level: list(CREDENTIAL_LEVEL),
  };
}

/** 证书的一行。`file_name` 由服务端从 `db_file` 派生，本层只排版。 */
function toCredential(row) {
  return {
    credential_id: row.credential_id,
    credential_type: row.credential_type,
    type_label: CREDENTIAL_TYPE[row.credential_type] || '证书',
    credential_name: row.credential_name,
    // 可空列。空串让页面按空串开合，不渲染一个空标签。
    level_label: row.credential_level ? (CREDENTIAL_LEVEL[row.credential_level] || '其他') : '',
    file_id: row.file_id,
    file_name: row.file_name || row.credential_name,
  };
}

/**
 * 本人的专业档案。
 *
 * 姓名与班级从会话上下文取（§6.4：`scope` 只作显示用，显示正是它许可的用法），
 * 不从这个端点要 —— 端点也不给。
 */
async function load() {
  const row = await api.get(PROFILE_PATH);
  const me = identity.homeIdentity();
  const credentials = (row.credentials || []).map(toCredential);
  const pending = row.pending_change || null;
  return {
    // 名册那一半，只读回显。
    teacher_name: me.teacherName || '',
    class_label: me.className || '',
    // 档案那一半，同样只读 —— 改要提申请。
    job_role: row.job_role || '',
    job_role_label: row.job_role ? (JOB_ROLE[row.job_role] || '其他') : '',
    professional_title: row.professional_title || '',
    education_level: row.education_level || '',
    education_label: row.education_level ? (EDUCATION[row.education_level] || '其他') : '',
    // 契约把这两列标了 blocked-on G45：服务端可回 null，那两行就不画。
    first_taught_label: row.first_taught_at || '',
    joined_school_label: row.joined_school_at || '',
    // 原型把证书分成「资格证书」与「专业奖项」两节：c1／c2 归前者，c3 归后者。
    certificates: credentials.filter((c) => c.credential_type !== 'c3'),
    awards: credentials.filter((c) => c.credential_type === 'c3'),
    // 上一次改的还在审时，页面要说出来 —— 否则教师会以为没提交上去。
    pending_label: pending ? (CHANGE_STATUS[pending.change_status] || '处理中') : '',
  };
}

/** 一次逻辑提交的幂等键，生成一次、重发复用（§4.2）。 */
function newAttemptKey() {
  return api.uuid();
}

/** 名称超长就地拦。服务端仍会独立复验（§6.4）。 */
function tooLongNames(credentials) {
  return (credentials || [])
    .filter((c) => String(c.credential_name || '').trim().length > CREDENTIAL_NAME_MAX)
    .map((c) => c.credential_name);
}

/**
 * 按契约的 `TeacherProfileChangeWrite` 重建请求体。
 *
 * `additionalProperties: false` 两层都有，所以这里逐键重建，不把页面的草稿整个送出去 ——
 * 草稿上还挂着 `type_label` 之类只给界面看的字段，送出去就是 422。
 * 派生字段（school_id／teacher_id／teacher_profile_id／submitted_at）一个也不送（§7.3）。
 */
function buildChangeBody(draft) {
  const payload = {};
  if (draft.job_role) payload.job_role = draft.job_role;
  if (draft.education_level) payload.education_level = draft.education_level;
  if (draft.professional_title) payload.professional_title = draft.professional_title;
  const credentials = (draft.credentials || [])
    .filter((c) => c.credential_name && c.file_id)
    .map((c) => {
      const one = {
        credential_type: c.credential_type,
        credential_name: String(c.credential_name).trim(),
        file_id: Number(c.file_id),
      };
      if (c.credential_level) one.credential_level = c.credential_level;
      return one;
    });
  if (credentials.length) payload.credentials = credentials;
  return { change_payload: payload };
}

/**
 * 提交修改申请（NONE -> s2）。
 *
 * **把关路径必填、无默认值**（ADR-0016）。这一票带的是教职工自述的文本与证书原件，走
 * 「记录同意 ＋ 预览后发布」那一条；证书原件是图片时另走图片那一条，由调用方一并声明。
 */
async function submitChange({ gates, draft, previewedInFull, confirmed, imageCount, idempotencyKey }) {
  moderation.assertGate(gates, {
    previewedInFull,
    confirmed,
    what: '档案修改申请',
    imageCount: imageCount || 0,
  });
  return api.post(CHANGE_PATH, {
    action: ACTION_SUBMIT,
    idempotencyKey,
    body: buildChangeBody(draft),
  });
}

/**
 * 预览要读的那几行。
 *
 * ADR-0016 的「完整预览」要的是**最终内容**，不是一个摘要。所以这里把编码翻回中文、把
 * 证书逐条摊开 —— 教师读到的必须与管理员在审核队列里看到的是同一份东西。
 */
function previewLines(draft, options) {
  const labelOf = (list, key) => {
    const hit = (list || []).find((o) => o.key === key);
    return hit ? hit.label : '';
  };
  const lines = [];
  if (draft.job_role) lines.push(`岗位：${labelOf(options.job_role, draft.job_role)}`);
  if (draft.professional_title) lines.push(`职称：${draft.professional_title}`);
  if (draft.education_level) lines.push(`最高学历：${labelOf(options.education_level, draft.education_level)}`);
  for (const c of draft.credentials || []) {
    const type = labelOf(options.credential_type, c.credential_type);
    const level = c.credential_level ? `（${labelOf(options.credential_level, c.credential_level)}）` : '';
    lines.push(`新增${type}${level}：${c.credential_name}`);
  }
  if (!lines.length) lines.push('这次没有任何改动。');
  return lines;
}

// ── 证书原件：选、传、取 ─────────────────────────────────────────────────────

// 契约 UploadCredentialsRequest.content_type 的白名单里，证书用得上的那几个。
const CREDENTIAL_TYPES = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

// 处理前单档上限 10 MB（CONTEXT.md §3）。与资源库同一个数，同一个理由。
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// db_file_ref.usage_key。证书原件是这条内容的主文件。
const USAGE_KEY = 'main_file';

const FILE_OWNER = 'db_teacher_credential';

function extensionOf(fileName) {
  const dot = String(fileName || '').lastIndexOf('.');
  return dot < 0 ? '' : String(fileName).slice(dot + 1).toLowerCase();
}

/**
 * 选一份证书原件。
 *
 * 原型的 `accept` 收 pdf／doc／docx／jpg／jpeg／png；契约的 `content_type` 白名单里没有
 * `doc`，所以这里收 pdf 与三种图片。**大小在选完的那一刻就判** —— 让教师等一趟上传才
 * 知道文件太大，是把一个本机答得出的问题送去问服务器。
 */
function pickCredentialFile() {
  return new Promise((resolve, reject) => {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['pdf', 'jpg', 'jpeg', 'png'],
      success: (res) => {
        const file = (res.tempFiles || [])[0];
        if (!file) { resolve(null); return; }
        const ext = extensionOf(file.name);
        const contentType = CREDENTIAL_TYPES[ext];
        if (!contentType) {
          reject(new Error('只接受 PDF 或图片（jpg／png）格式的证书原件'));
          return;
        }
        if (Number(file.size) > MAX_UPLOAD_BYTES) {
          const mb = (Number(file.size) / 1024 / 1024).toFixed(1);
          reject(new Error(`这份文件 ${mb} MB，超过单档上限 10 MB，请压缩后再传`));
          return;
        }
        resolve({
          path: file.path,
          size: file.size,
          name: file.name || '证书原件',
          contentType,
          isImage: contentType.indexOf('image/') === 0,
        });
      },
      fail: (err) => {
        if (err && String(err.errMsg || '').indexOf('cancel') !== -1) { resolve(null); return; }
        reject(new Error('选择文件失败，请重试'));
      },
    });
  });
}

/**
 * 契约 §8 的媒体流：签凭证 -> 字节直传对象存储 -> 落库拿 file_id。
 *
 * §8.1 铁律：**字节不经过 API 实例**。中间那一趟走凭证里给的地址，用 `wx.uploadFile`
 * （multipart 的 POST），因为凭证放行的是 COS 的 PostObject。
 */
async function uploadPickedFile(picked) {
  const cred = await api.post('/media/upload-credentials', {
    body: {
      usage_key: USAGE_KEY,
      content_type: picked.contentType,
      byte_size: picked.size,
    },
  });

  await new Promise((resolve, reject) => {
    wx.uploadFile({
      url: cred.url,
      filePath: picked.path,
      name: 'file',
      formData: cred.form_fields,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error('上传失败，请检查网络后重试'));
      },
      fail: () => reject(new Error('上传失败，请检查网络后重试')),
    });
  });

  const file = await api.post('/media/files', { body: { upload_ticket: cred.upload_ticket } });
  return file.file_id;
}

/** 打不开时的那句话。一种措辞，一个地方。 */
function sayCannotOpen(message) {
  wx.showToast({ title: message, icon: 'none' });
}

/**
 * 打开一份证书原件（原型每行右侧的「预览」「下载」）。
 *
 * §8.4：读取形状里没有可直接访问的地址，每一次取档都现签，服务端借这次调用重跑一遍授权。
 * 所以这里不缓存 URL。图片走预览，PDF 走文档打开 —— 两个词落到平台给得出的那一种。
 */
async function openCredentialFile(file) {
  const ext = extensionOf(file.file_name);
  const isImage = ['jpg', 'jpeg', 'png'].indexOf(ext) !== -1;
  if (!isImage && ext !== 'pdf') {
    sayCannotOpen('这种格式的文件无法在手机上打开，请到电脑上查看');
    return;
  }

  let signed;
  try {
    signed = await api.get(`/media/files/${file.file_id}/url`, {
      query: { owner_object: FILE_OWNER, owner_id: Number(file.file_id) },
    });
  } catch (err) {
    sayCannotOpen('取档失败，请稍后再试');
    return;
  }

  if (isImage) {
    wx.previewImage({ urls: [signed.url], fail: () => sayCannotOpen('图片打开失败，请稍后再试') });
    return;
  }
  wx.downloadFile({
    url: signed.url,
    success: (res) => {
      if (res.statusCode !== 200) { sayCannotOpen('文件下载失败，请稍后再试'); return; }
      wx.openDocument({
        filePath: res.tempFilePath,
        fileType: ext,
        showMenu: true,
        fail: () => sayCannotOpen('文件打开失败，请到电脑上查看'),
      });
    },
    fail: () => sayCannotOpen('文件下载失败，请检查网络后再试'),
  });
}

module.exports = {
  CREDENTIAL_NAME_MAX,
  MAX_UPLOAD_BYTES,
  options,
  load,
  newAttemptKey,
  tooLongNames,
  buildChangeBody,
  submitChange,
  previewLines,
  pickCredentialFile,
  uploadPickedFile,
  openCredentialFile,
};
