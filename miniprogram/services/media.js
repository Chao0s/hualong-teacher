/**
 * 媒体 —— 契约的 media 模块。**本轮只有取档这一半。**
 *
 * Boundary: 页面 require 本模块、把返回值直接用，**不在页面里拼 URL、不在页面里
 * 写宿主表名、不在页面里判文件类型**。
 *
 *   `GET /media/files/{file_id}/url`   逐张逐次签发短时读取 URL
 *
 * 上传那一半（`POST /media/upload-credentials`、`POST /media/files`）归票据 #2，
 * 本轮不做。它是**纯追加**：加两个写函数与一张上传用的枚举表，本文件已有的读函数
 * 一行都不用动。
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
 * ── 还没接到本模块的五个下载入口，逐条记在这里 ───────────────────────────────
 *
 * 它们都是**整页仍是字面量**的页面：页面本身还没有从契约取数，附件按钮也就没有
 * 真的 file_id 可以传。要先重写页面，才谈得上接这一条。
 *
 *   `coordination-file-list`（综合协调 → 文件列表）  **没有票据**。目录写死在
 *                                                    index.js 的 CATALOG 里
 *   `teacher-profile`（个人档案）                    票据 #15
 *   `teacher-task-detail`（首页那条线的任务详情）    票据 #18
 *   `course-building`（课程建设）                    三个文件名是编出来的，没有
 *                                                    数据源；CLAUDE.md §8「没有
 *                                                    数据源就不要渲染它」，**不接**
 */

const api = require('../utils/request');

const FILE_PATH = '/media/files';

/**
 * 宿主表名。`owner_object` 收的就是这个字符串 ——
 * `db_file_ref.owner_object` 的列注释逐字：「所属表名, 如 db_moment」。
 *
 * 只列本轮真的有调用点的六个。加一个新宿主时在这里加一行，页面照旧不写表名。
 */
const OWNER = {
  MOMENT: 'db_moment',
  PARENT_TASK_SUBMISSION: 'db_parent_task_submission',
  MONTH_EVAL: 'db_month_eval',
  PARTY_STUDY: 'db_party_study',
  PARTY_ACTIVITY: 'db_party_activity',
  TRAINING: 'db_training',
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

module.exports = {
  OWNER,
  FILE_TYPE,
  PLACEHOLDER_TEXT,
  fileUrl,
  openFile,
};
