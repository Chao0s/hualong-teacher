/**
 * 图片选择与契约 §8 的三步媒体流。
 *
 * 为什么是 `utils/` 而不是某个服务：**分包与服务模块一一对应**（`verify:build` 的规则），
 * 所以 `packages/co-education` 只能 require `services/co-education`。媒体流是跨模块的
 * 平台事实，不属于任何一个模块的边界，放在 utils 里两个分包才都用得上。
 *
 * ⚠ `services/library.js` 里有一份等价的实现，早于本文件（票据 15）。两份并存不是设计，
 * 是本轮不重构能工作的代码的结果 —— 把上传表单挪到本模块上来是另一次改动，记在交接里。
 *
 * ── 只收图片，一个视频入口也没有（DO-NOT-BUILD 12）─────────────────────────────
 *
 * 用 `wx.chooseImage` 而**不是** `wx.chooseMedia`：后者默认同时收视频，要靠一个参数把
 * 它关掉，参数写错就是一个视频入口；`wx.chooseImage` 根本回不了视频。代价是它在基础库
 * 2.21.0 起被标为不再维护 —— 用一个还在文档里的旧接口换「视频入口不可能存在」，这笔
 * 交换与 services/library.js 的 `pickCoverImage` 是同一笔。
 *
 * 那个关视频的参数名**故意不写在这里**：tests/moments.test.mjs 的负向断言逐字扫本文件，
 * 提到它就等于让扫描跳过整个文件，而跳过的那一次正是它该抓住的那一次。
 */

const api = require('./request');

// CONTEXT.md §3 / 契约 §8.2：处理前单档 10 MB。**平台与产品共同的硬上限**，所以在选完
// 的那一刻就要用它，不能等上传失败再说。
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** 超过平台单次上限。 */
function tooLarge(bytes) {
  return Number(bytes) > MAX_UPLOAD_BYTES;
}

/**
 * 拒绝的那句话。**说出这个文件多大与上限是多少**，而不是「文件太大」—— 教师要知道
 * 该压到多少。措辞留在一个地方，四个页面说同一句。
 */
function tooLargeReason(picked) {
  const size = `${(Number(picked.size) / 1024 / 1024).toFixed(1)} MB`;
  return `这张照片 ${size}，超过微信单次上传的 10 MB 上限，请压缩后再选。`;
}

/**
 * 选若干张图片。
 *
 * @param {number} count 还能再选几张。平台上限九张由调用方按已选张数算好。
 * @returns {Promise<Array<{path:string,size:number,name:string,contentType:string}>>}
 *          教师取消时回空数组 —— 取消不是失败，不弹话。
 */
function pickImages(count) {
  return new Promise((resolve, reject) => {
    wx.chooseImage({
      count: Math.max(1, Number(count) || 1),
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        resolve((res.tempFiles || []).map((file, i) => ({
          path: file.path,
          size: file.size,
          name: `照片${i + 1}`,
          contentType: 'image/jpeg',
        })));
      },
      fail: (err) => {
        // 取消选择在平台上也走 fail，errMsg 里带 cancel。它不是失败。
        if (err && String(err.errMsg || '').indexOf('cancel') !== -1) { resolve([]); return; }
        reject(new Error('选择照片失败，请重试'));
      },
    });
  });
}

/**
 * 契约 §8 的媒体流：签凭证 -> 字节直传对象存储 -> 落库拿 file_id。
 *
 * §8.1 铁律：**字节不经过 API 实例**。两个请求发给 API，中间那一趟走凭证里那个 API
 * 基址之外的地址，且用 `wx.uploadFile`（multipart 的 POST），因为凭证放行的是 COS 的
 * PostObject。
 *
 * 大小在**选完的那一刻**已经拦过一次；这里不再拦，服务端在签凭证时独立复验
 * （§6.4：客户端预先禁用不是边界）。
 *
 * @returns {Promise<number>} file_id
 */
async function uploadPickedFile(picked, usageKey) {
  const cred = await api.post('/media/upload-credentials', {
    body: {
      usage_key: usageKey,
      content_type: picked.contentType,
      byte_size: picked.size,
    },
  });

  await new Promise((resolve, reject) => {
    wx.uploadFile({
      url: cred.url,
      filePath: picked.path,
      // 文件字段放最后，其余按 field_order —— 顺序是 COS 表单上传的要求，不是习惯。
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

module.exports = {
  MAX_UPLOAD_BYTES,
  tooLarge,
  tooLargeReason,
  pickImages,
  uploadPickedFile,
};
