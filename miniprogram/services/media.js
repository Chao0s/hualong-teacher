/**
 * 媒体 —— 契约的 media 模块，取档与上传两半都在这里。
 *
 * Boundary: 页面 require 本模块、把返回值直接用，**不在页面里拼 URL、不在页面里
 * 写宿主表名、不在页面里判文件类型**。
 *
 *   `POST /media/upload-credentials`   签发 COS 表单上传凭证，**一次库都不写**
 *   `POST /media/files`                把已上传的对象落成一行 db_file
 *   `GET /media/files/{file_id}/url`   逐张逐次签发短时读取 URL
 *
 * 上传是三步一趟，中间那一步不经过 `utils/request.js` —— 理由写在下面
 * 「字节不走 API 实例」那一节，不是随手开的第二个出口。
 *
 * ── 五个家族本来就有取档端点，不需要各开一条 ─────────────────────────────────
 *
 * 党建学习、党建活动、品牌建设、协调文档、研修的附件，**全部走上面这一条端点**
 * （`ContentFileRef` 的字段说明逐字写着「一律走 GET /media/files/{file_id}/url」）。
 * 按家族各开一条取档端点在 2026-08-20 已经拒过（`docs/API-CONTRACT.md:641`，
 * §8.1「媒体路径只有一条」），不要重开这个话题。
 *
 * 资源与案例是**另一套**：它们走 `POST /library/{族}/{id}/download-link` 的
 * bearer 短链（30 分钟），在 `services/library.js` 里，与本模块的 5 分钟签名 URL
 * 不是同一样东西，也不要互相抄。
 *
 * ── owner 那一对是授权参数，不是统计参数 ─────────────────────────────────────
 *
 * `owner_object` + `owner_id` 契约标为**必填**：同一个 file_id 允许被多条记录引用，
 * 只给 file_id 反推不出唯一的宿主，「按该宿主的规则重验调用者」这一层就无从执行。
 * 所以每个调用点都必须说清楚「这个文件是从哪一条记录点进来的」。
 *
 * 宿主表名写在下面的 `OWNER` 一份，页面从 service 返回值里拿 `fileOwner`／
 * `photoOwner`，**页面里不出现表名字面量**。
 *
 * ── 预览与下载是同一条链接，不是两条 ─────────────────────────────────────────
 *
 * 小程序上「预览」就是「下到 tempFilePath 再 `wx.openDocument`」—— 平台没有第二种
 * 打开方式。所以原型上的「在线预览」与「下载文件」两个按钮走的是**同一个函数**，
 * 拿的是**同一条链接**。契约也是这么说的：能不能预览由 MIME 加客户端能力决定，
 * 不是一个管理端开关（F8 已删 `allow_preview`／`allow_download`）。
 *
 * ── 链接是短链，绝不缓存 ─────────────────────────────────────────────────────
 *
 * 有效期不超过 5 分钟，响应带 `Cache-Control: no-store`（§8.4）。**每次点都重新
 * 取一次**，不把 url 存进列表数据里 —— 存进去的那一刻它就开始过期，而过期之后
 * 页面上看到的是一张打不开的图，不是一条错误。
 *
 * ── 还没接到本模块的两个下载入口，逐条记在这里 ───────────────────────────────
 *
 * 它们都是**整页仍是字面量**的页面：页面本身还没有从契约取数，附件按钮也就没有
 * 真的 file_id 可以传。要先重写页面，才谈得上接这一条。
 *
 *   `coordination-file-list`（综合协调 → 文件列表）  **没有票据**。目录写死在
 *                                                    index.js 的 CATALOG 里
 *   `course-building`（课程建设）                    三个文件名是编出来的，没有
 *                                                    数据源；CLAUDE.md §8「没有
 *                                                    数据源就不要渲染它」，**不接**
 */

const api = require('../utils/request');
const { ApiError } = require('../utils/errors');

const FILE_PATH = '/media/files';
const CREDENTIALS_PATH = '/media/upload-credentials';

/**
 * 宿主表名。`owner_object` 收的就是这个字符串 ——
 * `db_file_ref.owner_object` 的列注释逐字：「所属表名, 如 db_moment」。
 *
 * 只列真的有调用点的八个。加一个新宿主时在这里加一行，页面照旧不写表名。
 *
 * `TEACHER_CREDENTIAL` 是**直连列宿主**：`db_teacher_credential.file_id` 是列，不是
 * `db_file_ref` 行（`01_schema.sql:938` NOT NULL，FK :943）。所以它的 `owner_id`
 * 是 **`credential_id`**，不是 `file_id` —— 服务端那一支照 `tc.credential_id` 认
 * （`routes/shared.mjs` 的 `fileReachable`），填错回 404。
 */
const OWNER = {
  MOMENT: 'db_moment',
  PARENT_TASK_SUBMISSION: 'db_parent_task_submission',
  MONTH_EVAL: 'db_month_eval',
  PARTY_STUDY: 'db_party_study',
  PARTY_ACTIVITY: 'db_party_activity',
  TRAINING: 'db_training',
  TASK: 'db_task',
  TEACHER_CREDENTIAL: 'db_teacher_credential',
  // 也是直连列宿主：`db_resource.cover_file_id`／`word_file_id` 与 `db_case` 同名两列。
  // `owner_id` 是 `resource_id`／`case_id`。s3 人人可取；作者本人的 s1／s4 也可取（G78）。
  RESOURCE: 'db_resource',
  CASE: 'db_case',
};

// db_file.file_type —— 01_schema.sql:498 逐字：
// `f1=image|f2=docx|f3=xlsx|f4=pdf|f5=video|f6=other`。中文取教师读得懂的说法。
const FILE_TYPE = { f1: '图片', f2: 'Word', f3: 'Excel', f4: 'PDF', f5: '视频', f6: '文件' };

// `wx.openDocument` 的 fileType 取值。f1 走 previewImage，f5／f6 平台打不开 ——
// 查不到就是打不开，不猜一个扩展名塞进去。
const OPEN_AS = { f2: 'docx', f3: 'xlsx', f4: 'pdf' };

// 薄契约服务端明确标注为假的取档域名。它自己的 README §二.2 写着：会**真的做完
// 授权**，然后回一个假 URL —— 它不接对象存储。图片另有一张本机占位图，不落这里。
const PLACEHOLDER_HOST = 'example-cos.invalid';

/** 拿到假 URL 时说的那句话。授权是真过了，别报成失败。 */
const PLACEHOLDER_TEXT = '预览环境不接对象存储，因此没有真实文件可下。接上正式环境后，这里会直接打开这份文件。';

/**
 * 取一次短时读取 URL。
 *
 * @param {number} fileId 档案 id
 * @param {{object: string, id: number}} owner 宿主那一对。**必填**，见头注。
 * @returns {Promise<{url, name, type, typeLabel, size, expiresAt, placeholder}>}
 *
 * 失败原样抛 `ApiError`：
 *   `404` 关联不存在，或存在但不属于调用者（§2.3 最小必要，两者逐字节相同）
 *   `400` 少带了 owner 那一对（`malformed_request`）
 * **不在这里翻译成「无权限」** —— 那会把「有这条但你看不到」泄漏出去。
 */
async function fileUrl(fileId, owner) {
  const res = await api.get(`${FILE_PATH}/${fileId}/url`, {
    query: { owner_object: owner.object, owner_id: owner.id },
  });
  const url = (res && res.url) || '';
  return {
    fileId: (res && res.file_id) || fileId,
    url,
    name: (res && res.file_name) || '',
    type: (res && res.file_type) || '',
    typeLabel: FILE_TYPE[res && res.file_type] || '文件',
    size: (res && res.file_size) || 0,
    expiresAt: (res && res.expires_at) || '',
    placeholder: url.indexOf(PLACEHOLDER_HOST) > -1,
  };
}

/**
 * 下到临时文件再打开。**这就是小程序上的「预览」，也是「下载」**，见头注。
 *
 * `wx.downloadFile` 的 success 只表示这次 HTTP 往返成功，`statusCode` 可能是 404 ——
 * 只看 success 会把一次失败的下载当成一份空文件交给 `wx.openDocument`。
 */
function downloadThenOpen(url, openAs) {
  return new Promise((resolve) => {
    wx.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode !== 200) {
          resolve({ opened: false, placeholder: false, reason: '文件下载失败，请稍后重试' });
          return;
        }
        wx.openDocument({
          filePath: res.tempFilePath,
          fileType: openAs,
          success: () => resolve({ opened: true, placeholder: false, reason: '' }),
          fail: () => resolve({ opened: false, placeholder: false, reason: '这个文件打不开，请稍后重试' }),
        });
      },
      fail: () => resolve({ opened: false, placeholder: false, reason: '文件下载失败，请稍后重试' }),
    });
  });
}

/**
 * 打开一份附件：取链接 → 下载 → 打开。**预览与下载共用这一个函数。**
 *
 * @returns {Promise<{opened: boolean, placeholder: boolean, reason: string}>}
 *   `placeholder` 为真时**授权是真的过了**，只是这个环境没有对象存储 ——
 *   页面据此说明情况，不要报成失败：报成失败会把「权限不足」与「预览环境不接
 *   COS」混为一谈，而这两件事的处理方式完全相反。
 *   `opened` 为假且 `placeholder` 为假时，`reason` 是可直接 toast 的一句中文。
 *
 * 取链接失败（401／404／400）**原样抛出**，交给页面的 `guard` 与错误文案处理 ——
 * 吞掉它会让「登录过期」看起来像「文件打不开」。
 */
async function openFile(fileId, owner) {
  const link = await fileUrl(fileId, owner);
  if (link.placeholder) return { opened: false, placeholder: true, reason: PLACEHOLDER_TEXT };
  // 图片交给 wx.previewImage：它自己取字节，不必先落地成临时文件。
  if (link.type === 'f1') {
    wx.previewImage({ urls: [link.url] });
    return { opened: true, placeholder: false, reason: '' };
  }
  const openAs = OPEN_AS[link.type];
  if (!openAs) {
    return { opened: false, placeholder: false, reason: `${link.typeLabel}在小程序里打不开，请到电脑上查看` };
  }
  return downloadThenOpen(link.url, openAs);
}

/* ── 上传 ────────────────────────────────────────────────────────────────── */

// api/action-registry.tsv 的 action_key。**签发凭证没有 action_key，那是对的** ——
// 它一次库都不写，登记表里也就没有它的行，不要替它发明一行。
const ACTIONS = { commit: 'media.file.commit' };

/**
 * `UploadCredentialsRequest.content_type` 的 6 值枚举，按扩展名查。
 *
 * 枚举里没有 xlsx，也没有影片：影片另有 DO-NOT-BUILD 12 挡着（`wx.uploadFile`
 * 单次 10 MB 硬上限使手机视频根本发不出去）。查不到的扩展名**当场拒绝**，不猜一个
 * `application/octet-stream` 发出去 —— 服务端的 enum 会回 422，而教师看到的会是
 * 一句和文件格式无关的话。
 */
const CONTENT_TYPE = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * `db_file_ref.usage_key` 的 12 值域（`01_schema.sql:528` 的列注释）里，本客户端
 * 用到的两个。
 *
 * **这一格只说明用途，决定不了库里那一行。** 挂哪个 `usage_key` 是宿主写入端点
 * 的事：`POST /moments` 写的是 `image`；资源与案例的封面与 Word 是
 * `db_resource`／`db_case` 上的**直接外键列**，根本没有 `db_file_ref` 行。
 */
const USAGE = { IMAGE: 'image', MAIN_FILE: 'main_file', ATTACHMENT: 'attachment' };

/** 契约 `UploadCredentialsRequest.byte_size` 的上界，也是响应的 `max_bytes`。 */
const MAX_BYTES = 10485760;

/** 扩展名 -> content_type。取不到就是空串，调用方据此拒绝。 */
function contentTypeOf(filePath) {
  const dot = String(filePath || '').lastIndexOf('.');
  const ext = dot > -1 ? String(filePath).slice(dot + 1).toLowerCase() : '';
  return CONTENT_TYPE[ext] || '';
}

/**
 * ── 字节不走 API 实例，所以上传是第二个 HTTP 出口 ───────────────────────────
 *
 * `utils/request.js` 是**通往 API 实例的**唯一出口：它管的是 §1–§5 那一套 ——
 * Bearer 票、`X-Request-Id`、幂等键、§2.2 的错误信封、derived 剥离、429 退避。
 * 这一发一样都用不上：字节直连对象存储（§8.1，生产上永远不经过 API 实例），
 * 授权在 `form_fields` 的签名里而不在 Authorization 头里，回来的也不是契约的
 * 错误信封。塞进 `utils/request.js` 会让那个模块的每一条承诺当场失真。
 *
 * 取档那一半早就是这样了：`downloadThenOpen` 的 `wx.downloadFile` 同样直连对象
 * 存储、同样不带票。上传只是把同一条边界补齐，不是新开一条。
 *
 * **`field_order` 只能尽力**：`wx.uploadFile` 的 `formData` 是个对象，字段顺序由
 * 平台序列化时决定。这里按 `field_order` 逐个塞进去（JS 的字符串键保持插入顺序），
 * 文件字段交给 `name` 由平台放最后 —— 这是客户端能做到的全部，做不到的那部分
 * 写在这里，不假装保证得了。
 */
function postObject(cred, filePath) {
  return new Promise((resolve, reject) => {
    const formData = {};
    (cred.field_order || []).forEach((key) => {
      const value = cred.form_fields ? cred.form_fields[key] : undefined;
      if (value !== undefined) formData[key] = value;
    });
    wx.uploadFile({
      // 地址由服务端给（`UploadCredentials.url`），客户端不拼、也不改 —— policy
      // 把 key 绑死到单一 object_key，改一个字这一发就该失败。
      url: cred.url,
      filePath,
      // COS 表单上传（PostObject）的文件字段就叫 `file`，且必须排在最后。
      name: 'file',
      formData,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
          return;
        }
        reject(objectStoreError(res));
      },
      fail: (err) => reject(new ApiError({
        statusCode: 0,
        code: 'upstream_unavailable',
        message: (err && err.errMsg) ? `文件上传失败：${err.errMsg}` : '文件上传失败，请稍后重试',
      })),
    });
  });
}

/**
 * 对象存储那一发失败时的错误。
 *
 * 本机的收件口回的是契约的错误信封（JSON），生产上的 COS 回的是 XML。解得开就用
 * 它的 `code`／`message`，解不开就退回一句可以直接 toast 的中文 —— **不把 XML
 * 原文丢给教师看**。
 */
function objectStoreError(res) {
  let body = res.data;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (body && body.code) {
    return new ApiError({
      statusCode: res.statusCode,
      code: body.code,
      message: body.message,
      requestId: body.request_id,
      details: body.details,
    });
  }
  return new ApiError({
    statusCode: res.statusCode,
    code: 'upstream_unavailable',
    message: '文件上传失败，请稍后重试',
  });
}

/**
 * 传一个文件：签发凭证 → 传字节 → 落库。**页面只需要调这一个函数。**
 *
 * @param {string} filePath 本地临时路径（`wx.chooseMedia`／`wx.chooseMessageFile` 给的）
 * @param {{usageKey: string, byteSize: number, fileName: string}} opts
 *        `byteSize` 是选文件时平台报的字节数。**必须传**：凭证要在字节发出去之前
 *        就把 `content-length-range` 绑进 policy，猜一个会让 policy 与实物对不上。
 *        `fileName` 可不传。`wx.chooseMessageFile` 的临时路径不保证带扩展名，而
 *        `content_type` 是按扩展名查的 —— 有原名就用原名认，认不出再退回路径。
 * @returns {Promise<{fileId, name, type, typeLabel, size}>} 落库后的那一行 db_file
 *
 * 三步都可能抛 `ApiError`，原样往上抛：
 *   `422 validation_failed`  格式不在 6 值枚举里、超过 10 MB、票据无效或未收到字节
 *   `401`                    交给页面的 `guard` 处理
 *
 * **落库之前不存在 file_id。** 中途失败就什么都没有发生 —— 没有半条记录，也不占
 * 任何业务对象的图片额度（契约 §8.3）。所以调用方只要 catch 住这一发即可，
 * 不需要回滚什么。
 *
 * `fileName` 给了就随落库那一发送上去（`POST /media/files` 的可选 `file_name`，G77），
 * 库里存的就是教师挑的那个名字；没给（`wx.chooseMedia` 的图片没有原名）服务端从
 * `object_key` 派生一个。回的 `name` 是库里那一格。
 */
async function uploadFile(filePath, { usageKey, byteSize, fileName } = {}) {
  const contentType = contentTypeOf(fileName) || contentTypeOf(filePath);
  if (!contentType) {
    throw new ApiError({
      statusCode: 422,
      code: 'validation_failed',
      message: '这种格式不能上传，请换成图片、PDF 或 Word 文档',
    });
  }
  // 前端预检**不替代**服务端复验（契约 §8.2 原话）：服务端按实际字节再验一次。
  // 这里挡下来只是为了省一趟往返，并且给一句说得清的中文。
  if (!Number.isInteger(byteSize) || byteSize < 1) {
    throw new ApiError({
      statusCode: 422,
      code: 'validation_failed',
      message: '读不到文件大小，请重新选择',
    });
  }
  if (byteSize > MAX_BYTES) {
    throw new ApiError({
      statusCode: 422,
      code: 'validation_failed',
      message: `单个文件不能超过 ${MAX_BYTES / 1024 / 1024} MB`,
    });
  }

  const cred = await api.post(CREDENTIALS_PATH, {
    body: { usage_key: usageKey, content_type: contentType, byte_size: byteSize },
  });
  await postObject(cred, filePath);
  // `idempotency` 在登记表里是 `optional`，所以 utils/request.js 不为它生成键。
  // 这一发真正的幂等键是 upload_ticket：同一张票据再提交一次回同一行，不新建。
  const commit = { upload_ticket: cred.upload_ticket };
  // 只在真的有原名时才带这一格：发 null 与不发在服务端是同一件事（派生一个）。
  if (fileName) commit.file_name = fileName;
  const file = await api.post(FILE_PATH, {
    action: ACTIONS.commit,
    body: commit,
  });
  return {
    fileId: file.file_id,
    name: file.file_name,
    type: file.file_type,
    typeLabel: FILE_TYPE[file.file_type] || '文件',
    size: file.file_size,
  };
}

module.exports = {
  OWNER,
  FILE_TYPE,
  USAGE,
  MAX_BYTES,
  PLACEHOLDER_TEXT,
  fileUrl,
  openFile,
  uploadFile,
};
