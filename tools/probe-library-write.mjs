/**
 * 写入路径的探针：传附件 -> 新建草稿 -> 提交审核 -> **把自己造的行删干净**。
 *
 * 三张表会被写到：`db_file`（媒体上传那一趟落的行）、`db_resource`、`db_case`。
 * 封面与 Word 附件是 `db_resource`／`db_case` 上的直接外键列，所以清理顺序是
 * 先内容行、后文件行 —— 反过来会撞外键。
 *
 * 与读探针分开一个文件，因为这一个**会改数据库**。db/testdata 的数据集是生成物，
 * 种子写死 20260425，同一份代码永远产出逐字节相同的 SQL —— 留下几行测试残渣，
 * `verify.sql` 的 E 组（查规模与形状）就会开始报，而那时没人知道是数据坏了还是
 * 探针没扫干净。所以这个脚本的最后一步是自己收拾，并且**核对行数回到基线**。
 *
 * 清理走 SQL 而不是 API：契约里没有 `DELETE /library/resources/{id}`，资源与案例
 * 一旦建起来只能改状态，删不掉。这不是契约的缺陷（教师本来就不该能抹掉记录），
 * 但它意味着测试残渣只能从库这一侧收走。
 *
 *   node tools/probe-library-write.mjs
 */

import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { installWxStub, scoreboard } from './lib/wx-stub.mjs';
import { testdataPath, DB_URL } from './lib/testdata-path.mjs';

installWxStub();

const HERE = dirname(fileURLToPath(import.meta.url));
const MP = resolve(HERE, '..', 'miniprogram');
const TESTDATA = testdataPath();

const require_ = createRequire(import.meta.url);
const library = require_(resolve(MP, 'services', 'library.js'));
const media = require_(resolve(MP, 'services', 'media.js'));
const guard = require_(resolve(MP, 'utils', 'guard.js'));
const api = require_(resolve(MP, 'utils', 'request.js'));
const { Client } = require_(resolve(TESTDATA, 'node_modules', 'pg'));

const sb = scoreboard();
const check = sb.check.bind(sb);
const note = sb.note.bind(sb);

const db = new Client(DB_URL);

async function counts() {
  const r = await db.query(
    'SELECT (SELECT count(*)::int FROM db_resource) AS resources,'
    + ' (SELECT count(*)::int FROM db_case) AS cases,'
    + ' (SELECT count(*)::int FROM db_file) AS files'
  );
  return r.rows[0];
}

const made = { resources: [], cases: [], files: [] };

/**
 * 要传的两个文件，探针自己在磁盘上造。
 *
 * PNG 是真的 1x1 PNG，.docx 里装的却是几个字节的纯文本 —— 服务端**不做内容实判**
 * （`content_sniff_ok` 那一条前置在本服务端没有执行，收件口一个字节都不留），
 * 所以造一份真的 docx 在这里证明不了任何多余的事。真机上的格式实判只有接上正式
 * 环境才测得到。
 */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const DOCX_BYTES = Buffer.from('probe-only, not a real docx', 'utf8');
const COVER_PATH = join(tmpdir(), 'hualong-probe-cover.png');
const WORD_PATH = join(tmpdir(), 'hualong-probe-plan.docx');

/** 清理后拿它跟 db_file 的行数比。main() 一进去就量，量的是动手之前那一刻。 */
let filesBaseline = null;

async function main() {
  await db.connect();
  const before = await counts();
  filesBaseline = before.files;
  console.log(`基线：db_resource=${before.resources}，db_case=${before.cases}，db_file=${before.files}`);

  await guard.requireSession();

  writeFileSync(COVER_PATH, PNG_BYTES);
  writeFileSync(WORD_PATH, DOCX_BYTES);

  // ---- 签发上传凭证：形状、四条约束、以及「它一次库都不写」 ----------------
  //
  // 直接走 api.post 而不是 media.uploadFile：service 只把凭证转手交给
  // wx.uploadFile，中间那一包 form_fields 在返回值里看不见。要断言 §8.2 的四条
  // 约束，就得拿到凭证本身。
  const cred = await api.post('/media/upload-credentials', {
    body: { usage_key: 'image', content_type: 'image/png', byte_size: PNG_BYTES.length },
  });
  sb.has(cred, [
    'upload_ticket', 'bucket', 'region', 'url', 'object_key',
    'form_fields', 'field_order', 'expires_at', 'max_bytes',
  ], 'UploadCredentials');
  check('max_bytes 是 10485760', cred.max_bytes === 10485760, `实际 ${cred.max_bytes}`);
  check('object_key 落在 incoming/ 前缀（该前缀没有读取路径）',
    String(cred.object_key).startsWith('incoming/'), `实际 ${cred.object_key}`);
  check('form_fields.key 与 object_key 是同一个',
    cred.form_fields.key === cred.object_key,
    `form_fields.key=${cred.form_fields.key}，object_key=${cred.object_key}`);
  check('field_order 第一格是 key（客户端按它排 multipart）',
    cred.field_order[0] === 'key', `实际 ${JSON.stringify(cred.field_order)}`);

  // policy 是 base64 的 JSON。§8.2 的四条约束逐条钉在它的 conditions 上 ——
  // 断言「有 policy 这个字段」等于没断言（§7.6：形状不是值）。
  const policy = JSON.parse(Buffer.from(cred.form_fields.policy, 'base64').toString('utf8'));
  const hasCond = (head, name, value) => (policy.conditions || []).some(
    (c) => Array.isArray(c) && c[0] === head && c[1] === name && c[2] === value,
  );
  check('policy 把 key 绑死到单一 object_key（eq，不是 starts-with）',
    hasCond('eq', '$key', cred.object_key), `实际 conditions=${JSON.stringify(policy.conditions)}`);
  check('policy 绑死 Content-Type', hasCond('eq', '$Content-Type', 'image/png'),
    `实际 conditions=${JSON.stringify(policy.conditions)}`);
  check('policy 绑死 content-length-range 1..10485760',
    (policy.conditions || []).some((c) => Array.isArray(c) && c[0] === 'content-length-range'
      && c[1] === 1 && c[2] === 10485760),
    `实际 conditions=${JSON.stringify(policy.conditions)}`);
  const ttlMs = new Date(policy.expiration).getTime() - Date.now();
  check('policy 有效期不超过 15 分钟', ttlMs > 0 && ttlMs <= 15 * 60 * 1000,
    `实际 ${Math.round(ttlMs / 1000)} 秒`);

  // 契约给签发凭证的 x-hualong-action 是空的，因为它什么都不写。钉在行数上。
  const afterIssue = await counts();
  check('签发凭证不落库：db_file 行数不变',
    afterIssue.files === before.files, `${before.files} -> ${afterIssue.files}`);

  // ---- 同一张票据提交两次，回同一行 ----------------------------------------
  //
  // `Idempotency-Key` 那颗头目前到不了服务端的 handler（后端 issue #29），
  // 而 `uk_file_object UNIQUE (bucket, object_key)` 会让第二笔 INSERT 变成 500。
  // 实际挡住重放的是票据，所以断言钉在这里：同一个 file_id，且没有第二行。
  await postBytes(cred, COVER_PATH);
  const first = await api.post('/media/files', { body: { upload_ticket: cred.upload_ticket } });
  if (first && first.file_id) made.files.push(first.file_id);
  const second = await api.post('/media/files', { body: { upload_ticket: cred.upload_ticket } });
  check('同一张 upload_ticket 再提交一次，回同一个 file_id',
    Boolean(first.file_id) && first.file_id === second.file_id,
    `第一次 ${first && first.file_id}，第二次 ${second && second.file_id}`);
  const afterReplay = await counts();
  check('重放没有新建第二行 db_file',
    afterReplay.files === before.files + 1, `${before.files} -> ${afterReplay.files}`);

  // ---- 走 service 的完整三步：封面（图片）与 Word 附件 ----------------------
  const cover = await media.uploadFile(COVER_PATH, {
    usageKey: media.USAGE.IMAGE, byteSize: PNG_BYTES.length,
  });
  if (cover && cover.fileId) made.files.push(cover.fileId);
  check('media.uploadFile 回了 file_id', Boolean(cover && cover.fileId),
    `回的是 ${JSON.stringify(cover)}`);

  // 回包只有五个字段（File schema），其余列一律回库里查 —— 从回包读一个不存在的
  // 字段会恒为 undefined，那种断言看着在测，其实一直在放行。
  const fileRow = (await db.query(
    `SELECT file_type, file_size, file_hash, bucket, object_key,
            storage_provider, visibility, uploader_type, uploaded_by
       FROM db_file WHERE file_id = $1`,
    [cover.fileId],
  )).rows[0];
  check('封面落库为 f1（图片）', fileRow.file_type === 'f1', `实际 ${fileRow.file_type}`);
  check('file_size 等于送出去的字节数', fileRow.file_size === PNG_BYTES.length,
    `实际 ${fileRow.file_size}，送出 ${PNG_BYTES.length}`);
  check('file_hash 是 64 位十六进制（该列 NOT NULL 且无默认值）',
    /^[0-9a-f]{64}$/.test(fileRow.file_hash || ''), `实际 ${fileRow.file_hash}`);
  check('object_key 落在 incoming/ 前缀',
    String(fileRow.object_key).startsWith('incoming/'), `实际 ${fileRow.object_key}`);
  check('storage_provider=p1、visibility=v1',
    fileRow.storage_provider === 'p1' && fileRow.visibility === 'v1',
    `实际 ${fileRow.storage_provider}/${fileRow.visibility}`);
  check('uploader_type=c1 且 uploaded_by 是登录教师 1',
    fileRow.uploader_type === 'c1' && fileRow.uploaded_by === 1,
    `实际 ${fileRow.uploader_type}/${fileRow.uploaded_by}`);

  const plan = await media.uploadFile(WORD_PATH, {
    usageKey: media.USAGE.MAIN_FILE, byteSize: DOCX_BYTES.length, fileName: '探针详案.docx',
  });
  if (plan && plan.fileId) made.files.push(plan.fileId);
  const planRow = (await db.query(
    'SELECT file_type, file_name FROM db_file WHERE file_id = $1', [plan.fileId],
  )).rows[0];
  check('Word 附件落库为 f2（docx）', planRow.file_type === 'f2', `实际 ${planRow.file_type}`);
  // G77：两个媒体端点的请求体都放不下原始文件名，服务端从 object_key 派生一个。
  // 所以「教师挑的名字存下来了」这件事**不成立**，断言钉的是它确实没存下来。
  check('库里存的不是教师挑的那个文件名（后端 G77）',
    planRow.file_name !== '探针详案.docx', `实际 ${planRow.file_name}`);

  // ---- 建资源草稿 ----------------------------------------------------------
  const res = await library.createResource({
    name: '探针资源（可删）',
    tag: '住',
    grade: ['大班'],
    type: '文档',
    explain: '这是写入探针建的行，脚本结束时会删掉。',
    access: '取自探针。',
    trans: '取自探针。',
    coverFileId: cover.fileId,
    wordFileId: plan.fileId,
  });
  check('POST /library/resources 回了 resource_id', Boolean(res && res.resource_id),
    `回的是 ${JSON.stringify(res)}`);
  if (res && res.resource_id) made.resources.push(res.resource_id);

  check('新建的资源是草稿 s1', res.resource_status === 's1', `实际 ${res.resource_status}`);
  check('回包带回了 cover_file_id 与 word_file_id',
    res.cover_file_id === cover.fileId && res.word_file_id === plan.fileId,
    `实际 ${res.cover_file_id}/${res.word_file_id}，送出 ${cover.fileId}/${plan.fileId}`);

  // POST 的回包是**精简形状**：只有 { resource_id, resource_name, resource_status }。
  // 所以派生列与枚举编码要回库里查，不能从回包上读 —— 从回包读会因为字段不存在
  // 而恒为 undefined，那种断言看着在测，其实一直在放行。
  const stored = await db.query(
    'SELECT school_id, created_by, resource_tag, grade, cover_file_id, word_file_id'
    + ' FROM db_resource WHERE resource_id=$1',
    [res.resource_id]
  );
  const s = stored.rows[0];
  // 这一票要修的就是这两列：此前 INSERT 的列表里根本没有它们，送了也不落库。
  check('cover_file_id 真的落进了 db_resource', s.cover_file_id === cover.fileId,
    `实际 ${s.cover_file_id}，送出 ${cover.fileId}`);
  check('word_file_id 真的落进了 db_resource', s.word_file_id === plan.fileId,
    `实际 ${s.word_file_id}，送出 ${plan.fileId}`);
  check('school_id 由服务端派生为 1', s.school_id === 1, `实际 ${s.school_id}`);
  check('created_by 由服务端派生为登录教师 1', s.created_by === 1, `实际 ${s.created_by}`);
  check('resource_tag 存的是编码 g3 而不是「住」', s.resource_tag === 'g3', `实际 ${s.resource_tag}`);
  check('grade 存的是编码数组 [k3]', JSON.stringify(s.grade) === JSON.stringify(['k3']),
    `实际 ${JSON.stringify(s.grade)}`);

  // ---- 自己的草稿自己看得见（与读探针里「别人的草稿看不见」互为对照） --------
  const mine = await library.listResources({ limit: 100 });
  check('自己新建的草稿在列表里看得见',
    mine.items.some((r) => r.id === res.resource_id),
    '刚建的草稿没出现在自己的列表里');

  // ---- 提交审核 s1 -> s2 ---------------------------------------------------
  await library.submitForReview('resource', res.resource_id);
  const after = await library.getResource(res.resource_id);
  const row = await db.query('SELECT resource_status FROM db_resource WHERE resource_id=$1', [res.resource_id]);
  check('提交审核后库里的状态是 s2', row.rows[0].resource_status === 's2',
    `实际 ${row.rows[0].resource_status}`);
  check('详情页读到的状态文案是「待审核」', after.statusLabel === '待审核',
    `实际「${after.statusLabel}」`);

  // ---- 建案例草稿，并关联一条资源 ------------------------------------------
  const kase = await library.createCase({
    name: '探针案例（可删）',
    grade: '大班',
    field: '社会',
    areas: ['集体教学', '主题探究'],
    intro: '这是写入探针建的行，脚本结束时会删掉。',
    trans: '取自探针。',
    resourceIds: [1],
    coverFileId: cover.fileId,
    wordFileId: plan.fileId,
  });
  check('POST /library/cases 回了 case_id', Boolean(kase && kase.case_id),
    `回的是 ${JSON.stringify(kase)}`);
  if (kase && kase.case_id) made.cases.push(kase.case_id);
  const storedCase = await db.query(
    'SELECT case_area, case_grade, case_field, cover_file_id, word_file_id'
    + ' FROM db_case WHERE case_id=$1', [kase.case_id]
  );
  check('cover_file_id 真的落进了 db_case',
    storedCase.rows[0].cover_file_id === cover.fileId,
    `实际 ${storedCase.rows[0].cover_file_id}，送出 ${cover.fileId}`);
  check('word_file_id 真的落进了 db_case',
    storedCase.rows[0].word_file_id === plan.fileId,
    `实际 ${storedCase.rows[0].word_file_id}，送出 ${plan.fileId}`);
  check('case_area 存的是编码数组 [a1,a3]',
    JSON.stringify(storedCase.rows[0].case_area) === JSON.stringify(['a1', 'a3']),
    `实际 ${JSON.stringify(storedCase.rows[0].case_area)}`);
  check('case_grade/case_field 存的是编码 k3/f3',
    storedCase.rows[0].case_grade === 'k3' && storedCase.rows[0].case_field === 'f3',
    `实际 ${storedCase.rows[0].case_grade}/${storedCase.rows[0].case_field}`);

  const kaseDetail = await library.getCase(kase.case_id);
  check('活动类型译回中文', JSON.stringify(kaseDetail.areas) === JSON.stringify(['集体教学', '主题探究']),
    `实际 ${JSON.stringify(kaseDetail.areas)}`);

  // resource_ids：客户端按 CaseWrite 发了 [1]，服务端收下不报错，却存成 NULL。
  // 用原始 curl 绕开本客户端复现，结果一样，所以缺口在服务端不在这里。
  const savedIds = await db.query('SELECT resource_ids FROM db_case WHERE case_id=$1', [kase.case_id]);
  if (savedIds.rows[0].resource_ids === null) {
    note(
      'db/testdata 服务端不落 CaseWrite.resource_ids —— 收下、回 201、存成 NULL。',
      `POST 带 resource_ids:[1]，库里 case_id=${kase.case_id} 的 resource_ids 为 NULL；`
      + '原始 curl 绕开本客户端复现结果相同。契约有这个字段，db_case 也有这一列。'
    );
    check('既然没落库，详情的关联资源就该是空的（不编一条出来）',
      kaseDetail.relatedResources.length === 0,
      `实际 ${JSON.stringify(kaseDetail.relatedResources)}`);
  } else {
    check('案例详情把 resource_ids 展开成了名称',
      kaseDetail.relatedResources.length === 1 && Boolean(kaseDetail.relatedResources[0].name),
      `实际 ${JSON.stringify(kaseDetail.relatedResources)}`);
  }

  // ---- derived 注入（DO-NOT-BUILD 8 / 契约 §7.3，越权测试的 F 组） ----------
  //
  // 走 api.post 而不是 library.createResource：service 只把认识的字段拼进 body，
  // 注入的键根本到不了 utils/derived.js。要测「发出前剥离」这条，就得从
  // request 层进去 —— 否则测的是 service 的解构，不是剥离。
  const injected = await api.post('/library/resources', {
    body: {
      resource_name: '探针注入（可删）',
      resource_tag: 'g5',
      resource_type: 'r1',
      resource_explain: '测 derived 剥离。',
      resource_access: '测 derived 剥离。',
      resource_trans: '测 derived 剥离。',
      // 以下三个是 derived 层，客户端永不发送。utils/derived.js 应在发出前剥掉。
      school_id: 999,
      created_by: 13,
      // 事件时间戳同族，服务端自己写（§1.2）。
      created_at: '1999-01-01T00:00:00+08:00',
    },
  });
  if (injected && injected.resource_id) made.resources.push(injected.resource_id);

  const inj = await db.query(
    'SELECT school_id, created_by, created_at FROM db_resource WHERE resource_id=$1',
    [injected.resource_id]
  );
  check('注入的 school_id=999 未被采用（仍为 1）', inj.rows[0].school_id === 1,
    `实际 ${inj.rows[0].school_id}`);
  check('注入的 created_by=13（离职教师）未被采用（仍为 1）', inj.rows[0].created_by === 1,
    `实际 ${inj.rows[0].created_by}`);
  check('注入的 created_at 未被采用', new Date(inj.rows[0].created_at).getFullYear() !== 1999,
    `实际 ${inj.rows[0].created_at}`);
  check('注入了 derived 键也不报错，照常建成（§7.3 静默忽略）',
    Boolean(injected.resource_id), '这一发被拒了');

  // ---- 别人上传的 file_id 当不了自己的封面 ----------------------------------
  //
  // 两列有真外键，所以一个不存在的 id 会以 500 冒出来；一个**存在但不是自己传的**
  // id 才是会被静默存下来的那种，于是「这是谁的封面」变成客户端说了算。
  const foreign = await db.query(
    "SELECT file_id FROM db_file WHERE NOT (uploader_type='c1' AND uploaded_by=1)"
    + ' ORDER BY file_id LIMIT 1'
  );
  if (foreign.rows.length) {
    let rejected = null;
    try {
      const bad = await library.createResource({
        name: '探针越权封面（可删）',
        tag: '住',
        grade: ['大班'],
        type: '文档',
        explain: '测封面归属复验。',
        access: '测封面归属复验。',
        trans: '测封面归属复验。',
        coverFileId: foreign.rows[0].file_id,
      });
      // 没被拒就是真建出来了，得收走 —— 否则这一行留在库里，下次跑基线就对不上。
      if (bad && bad.resource_id) made.resources.push(bad.resource_id);
    } catch (err) {
      rejected = err;
    }
    check('别人上传的 file_id 当封面被拒（422 validation_failed）',
      Boolean(rejected) && rejected.statusCode === 422 && rejected.code === 'validation_failed',
      rejected ? `实际 ${rejected.statusCode} ${rejected.code}` : '这一发建成功了');
  } else {
    note('数据集里没有第二个上传者的文件，封面归属复验这一条没测到。',
      "SELECT file_id FROM db_file WHERE NOT (uploader_type='c1' AND uploaded_by=1) 是空的");
  }
}

/**
 * 把字节送到收件口。**这一发不经过 utils/request.js**，与 services/media.js 的
 * postObject 同一个理由：字节直连对象存储，不带票、不回契约的错误信封。
 *
 * 这里手写一遍而不复用 service，是因为要拿同一张票据提交两次 —— service 的
 * uploadFile 一趟只走一张票据，重放测不到。
 */
function postBytes(cred, filePath) {
  const formData = {};
  cred.field_order.forEach((k) => { formData[k] = cred.form_fields[k]; });
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: cred.url,
      filePath,
      name: 'file',
      formData,
      success: (r) => (r.statusCode === 200
        ? resolve()
        : reject(new Error(`收件口回 ${r.statusCode}`))),
      fail: (e) => reject(new Error(e.errMsg)),
    });
  });
}

async function cleanup() {
  // 先删案例（它引用资源），再删资源，**最后才删文件**：封面与 Word 是
  // db_resource／db_case 上的外键列，文件先删就撞 fk_res_cover 那一族。
  for (const id of made.cases) {
    await db.query('DELETE FROM db_case WHERE case_id=$1', [id]);
  }
  for (const id of made.resources) {
    await db.query('DELETE FROM db_resource WHERE resource_id=$1', [id]);
  }
  for (const id of made.files) {
    await db.query('DELETE FROM db_file WHERE file_id=$1', [id]);
  }
  // 序列回退，让下一次灌库/生成不出现空洞
  await db.query("SELECT setval('db_resource_resource_id_seq', (SELECT max(resource_id) FROM db_resource))");
  await db.query("SELECT setval('db_case_case_id_seq', (SELECT max(case_id) FROM db_case))");
  await db.query("SELECT setval('db_file_file_id_seq', (SELECT max(file_id) FROM db_file))");
  // 磁盘上那两个临时文件也是本次造的。没造出来就没什么可删。
  for (const path of [COVER_PATH, WORD_PATH]) {
    try { unlinkSync(path); } catch { /* 没造出来 */ }
  }
}

const started = { resources: 12, cases: 10 };

main()
  .catch((err) => check(`探针本身出错：${err && err.stack ? err.stack : err}`, false))
  // 清理必须无论主体成败都跑：主体半途炸掉时，已经建出来的行更需要被收走。
  .then(async () => {
    try {
      await cleanup();
      const after = await counts();
      check('清理后 db_resource 回到 12 行', after.resources === started.resources,
        `实际 ${after.resources} 行`);
      check('清理后 db_case 回到 10 行', after.cases === started.cases,
        `实际 ${after.cases} 行`);
      // db_file 的基线不写死：它是本次开跑那一刻量的，本探针没有别的行可依。
      check('清理后 db_file 回到基线', filesBaseline !== null && after.files === filesBaseline,
        `基线 ${filesBaseline} 行，实际 ${after.files} 行`);
      console.log(`清理后：db_resource=${after.resources}，db_case=${after.cases}，db_file=${after.files}`);
    } catch (err) {
      check(`清理失败，数据库可能残留了行：${err.message}`, false);
    }
    await db.end().catch(() => {});
    sb.report();
  });
