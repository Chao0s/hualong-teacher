/**
 * 写入路径的探针：传附件 -> 新建草稿 -> 提交审核 -> **把自己造的行删干净**。
 *
 * 四张表会被写到：`db_file`（媒体上传那一趟落的行）、`db_resource`、`db_case`、
 * `db_content_access_event`（取短链那一趟落的行）。封面与 Word 附件是
 * `db_resource`／`db_case` 上的直接外键列，所以清理顺序是先内容行、再事件行、
 * 最后文件行 —— 反过来会撞外键。
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
 *   node tools/probe-library-write.mjs --base http://localhost:3861/api/v1   # 打另一个端口
 */

import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
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
const config = require_(resolve(MP, 'config.js'));
const { Client } = require_(resolve(TESTDATA, 'node_modules', 'pg'));
const {getObject,removeObject}=await import(pathToFileURL(resolve(TESTDATA,'server/lib/local-media.mjs')));

// `--base <url>` 把请求改打到另一个端口。改了服务端要重启才生效，而 3860 那扇窗口
// 是别人开的；起一个 3861 验完再关。`utils/request.js` 每次发出前都现读
// `config.env.baseUrl`，改这一格就够。
const baseAt = process.argv.indexOf('--base');
if (baseAt !== -1 && process.argv[baseAt + 1]) config.env.baseUrl = process.argv[baseAt + 1];

const sb = scoreboard();
const check = sb.check.bind(sb);
const note = sb.note.bind(sb);

const db = new Client(DB_URL);

async function counts() {
  const r = await db.query(
    'SELECT (SELECT count(*)::int FROM db_resource) AS resources,'
    + ' (SELECT count(*)::int FROM db_case) AS cases,'
    + ' (SELECT count(*)::int FROM db_file) AS files,'
    + ' (SELECT count(*)::int FROM db_content_access_event) AS events,'
    + ' (SELECT count(*)::int FROM db_review_action) AS reviews'
  );
  return r.rows[0];
}

const made = { resources: [], cases: [], files: [], events: [], reviews: [] };

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
  started.events = before.events;
  started.reviews = before.reviews;
  console.log(`基线：db_resource=${before.resources}，db_case=${before.cases}`
    + `，db_file=${before.files}，db_content_access_event=${before.events}`
    + `，db_review_action=${before.reviews}`);

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
  // 这两发**不带** `Idempotency-Key`，钉的是票据那一把键：
  // `uk_file_object UNIQUE (bucket, object_key)` 会让第二笔 INSERT 变成 500，
  // 而没带幂等键的重试正是会撞上它的那一种。断言因此钉在这里：
  // 同一个 file_id，且没有第二行。
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
  const storedBytes=await getObject(fileRow.bucket,fileRow.object_key);
  check('file_size 等于处理后成品字节数', fileRow.file_size === storedBytes.length,
    `实际 ${fileRow.file_size}，成品 ${storedBytes.length}`);
  check('file_hash 对应处理后成品',fileRow.file_hash===createHash('sha256').update(storedBytes).digest('hex'));
  check('file_hash 是 64 位十六进制（该列 NOT NULL 且无默认值）',
    /^[0-9a-f]{64}$/.test(fileRow.file_hash || ''), `实际 ${fileRow.file_hash}`);
  check('object_key 落在 processed/ 前缀',
    String(fileRow.object_key).startsWith('processed/'), `实际 ${fileRow.object_key}`);
  check('storage_provider=p2、visibility=v1',
    fileRow.storage_provider === 'p2' && fileRow.visibility === 'v1',
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
  // G77（已修）：`POST /media/files` 的可选 `file_name` 把教师挑的名字送到库里。
  // 钉的是库里那一格，不是回包 —— 回包照抄请求体也能骗过。
  check('库里存的就是教师挑的那个文件名（G77 已修）',
    planRow.file_name === '探针详案.docx', `实际 ${planRow.file_name}`);
  // 封面走 wx.chooseMedia，没有原名，服务端派生一个 —— 派生名以扩展名结尾、不是空串。
  const coverName = (await db.query(
    'SELECT file_name FROM db_file WHERE file_id = $1', [cover.fileId],
  )).rows[0].file_name;
  check('没给 file_name 的封面落了派生名（.png 结尾，不为空）',
    /\.png$/.test(coverName || ''), `实际 ${coverName}`);
  // 传一个 trim 后为空的名字要被拒，不能落成没有名字的一行。
  const blankCred = await api.post('/media/upload-credentials', {
    body: { usage_key: 'image', content_type: 'image/png', byte_size: PNG_BYTES.length },
  });
  await postBytes(blankCred, COVER_PATH);
  let blankRejected = null;
  try {
    const bad = await api.post('/media/files', { body: { upload_ticket: blankCred.upload_ticket, file_name: '   ' } });
    if (bad && bad.file_id) made.files.push(bad.file_id);
  } catch (err) { blankRejected = err; }
  check('file_name 全是空白回 422 validation_failed',
    Boolean(blankRejected) && blankRejected.statusCode === 422 && blankRejected.code === 'validation_failed',
    blankRejected ? `实际 ${blankRejected.statusCode} ${blankRejected.code}` : '这一发落库了');

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

  // ---- G78：作者取自己 s1 草稿的封面回 200，别人的 s1／s4 仍是 404 ---------------
  //
  // 两头都钉（§7.4）：只钉「自己的取得到」，把那一支放宽成「本园的都取得到」也照样绿。
  // 数据集里 resource 5 是教师 5 的 s1（封面 20），resource 7 是教师 7 的 s4（封面 24）；
  // 探针以教师 1 登录，两条都不是他的。
  const ownCover = await media.fileUrl(cover.fileId, { object: media.OWNER.RESOURCE, id: res.resource_id });
  check('作者取自己 s1 草稿的封面回 200（G78 已修）',
    Boolean(ownCover && ownCover.url) && ownCover.fileId === cover.fileId,
    `实际 ${JSON.stringify(ownCover)}`);
  const ownWord = await media.fileUrl(plan.fileId, { object: media.OWNER.RESOURCE, id: res.resource_id });
  check('作者取自己 s1 草稿的 Word 回 200，且 file_name 是教师挑的名字',
    Boolean(ownWord && ownWord.url) && ownWord.name === '探针详案.docx',
    `实际 ${JSON.stringify(ownWord)}`);
  for (const [label, fileId, ownerId] of [
    ['别人的 s1 草稿（resource 5 / file 20）', 20, 5],
    ['别人的 s4 被驳回（resource 7 / file 24）', 24, 7],
  ]) {
    let code = 0;
    try {
      await media.fileUrl(fileId, { object: media.OWNER.RESOURCE, id: ownerId });
    } catch (err) { code = err.statusCode; }
    check(`${label}的封面仍是 404`, code === 404, `实际 ${code || '200'}`);
  }

  // ---- 自己的草稿自己看得见（与读探针里「别人的草稿看不见」互为对照） --------
  const mine = await library.listResources({ limit: 100 });
  check('自己新建的草稿在列表里看得见',
    mine.items.some((r) => r.id === res.resource_id),
    '刚建的草稿没出现在自己的列表里');

  // ---- 提交审核 s1 -> s2 ---------------------------------------------------
  //
  // 除了状态，**submitted_at 也要钉到库里那一格**。它是 action-registry.tsv 第 7 行
  // 登记的副作用（`set:submitted_at`），而服务端写的是 `now()` —— 数据集给不了
  // 期望值，只能读回来比。
  //
  // 比的是「库里那一格逐字等于回包那一格」，不是「回包长得像时间戳」。§7.6 记的
  // 那次八小时偏移，五支探针 212 项断言一支都没抓到，就因为它们断言的是格式。
  // 服务端的 fmtAt（db/testdata/server/lib/http.mjs）是纯切片、不做时区换算，
  // 所以 to_char(...) || '+08:00' 与回包应当逐字相同。哪天它又改回「当本地时间
  // 转 UTC」，这一项会红。
  const beforeSubmit = await db.query(
    'SELECT submitted_at FROM db_resource WHERE resource_id=$1', [res.resource_id]);
  check('新建的草稿 submitted_at 是 NULL（还没交）',
    beforeSubmit.rows[0].submitted_at === null,
    `实际 ${JSON.stringify(beforeSubmit.rows[0].submitted_at)}`);

  const submitted = await library.submitResource(res.resource_id);
  const after = await library.getResource(res.resource_id);
  const row = await db.query(
    `SELECT resource_status,
            submitted_at IS NOT NULL AS has_at,
            to_char(submitted_at, 'YYYY-MM-DD"T"HH24:MI:SS') || '+08:00' AS wire
       FROM db_resource WHERE resource_id=$1`, [res.resource_id]);
  check('提交审核后库里的状态是 s2', row.rows[0].resource_status === 's2',
    `实际 ${row.rows[0].resource_status}`);
  check('提交审核后库里落了 submitted_at', row.rows[0].has_at === true, '还是 NULL');
  check('资源 submitted_at 的回包与库里那一格逐字相同',
    submitted && submitted.submitted_at === row.rows[0].wire,
    `回包 ${submitted && submitted.submitted_at}，库里 ${row.rows[0].wire}`);
  check('详情页读到的状态文案是「待审核」', after.statusLabel === '待审核',
    `实际「${after.statusLabel}」`);
  // G78 的边：放行只到 s1／s4。交上去（s2）之后作者自己也取不到 —— 与 PATCH 的可改范围同一条。
  let s2CoverCode = 0;
  try {
    await media.fileUrl(cover.fileId, { object: media.OWNER.RESOURCE, id: res.resource_id });
  } catch (err) { s2CoverCode = err.statusCode; }
  check('交上去（s2）之后作者取自己的封面回 404（放行只到 s1／s4）',
    s2CoverCode === 404, `实际 ${s2CoverCode || '200'}`);

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

  // 案例那一支也钉：同一个封面 file_id 经 db_case 这个宿主取，作者 s1 放行。
  const ownCaseCover = await media.fileUrl(cover.fileId, { object: media.OWNER.CASE, id: kase.case_id });
  check('作者取自己 s1 案例草稿的封面回 200（G78 已修，db_case 那一支）',
    Boolean(ownCaseCover && ownCaseCover.url), `实际 ${JSON.stringify(ownCaseCover)}`);

  const kaseDetail = await library.getCase(kase.case_id);
  // 取档前置是 s3。刚建的草稿不该给下载按钮 —— 给了，教师点下去只能拿到 404，
  // 而 404 在契约里既是「不存在」也是「你看不到」（§2.3），读不出区别。
  check('草稿状态的案例不给下载按钮（canDownload 为假）', kaseDetail.canDownload === false,
    `canDownload=${kaseDetail.canDownload}，wordFileId=${kaseDetail.wordFileId}`);
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

  // ---- 案例也提交一次，钉它的 submitted_at ---------------------------------
  //
  // 以前这支探针只提交资源，案例那一条 submission 从来没被走过。两条是**两条契约
  // 操作**（`submitResource` / `submitCase`），不是一条带参数的操作 —— 只测一条，
  // 另一条的路径写错、动作键改名都不会红。
  const caseBefore = await db.query(
    'SELECT submitted_at FROM db_case WHERE case_id=$1', [kase.case_id]);
  check('新建的案例草稿 submitted_at 是 NULL（还没交）',
    caseBefore.rows[0].submitted_at === null,
    `实际 ${JSON.stringify(caseBefore.rows[0].submitted_at)}`);

  const caseSubmitted = await library.submitCase(kase.case_id);
  const caseRow = await db.query(
    `SELECT case_status,
            submitted_at IS NOT NULL AS has_at,
            to_char(submitted_at, 'YYYY-MM-DD"T"HH24:MI:SS') || '+08:00' AS wire
       FROM db_case WHERE case_id=$1`, [kase.case_id]);
  check('案例提交审核后库里的状态是 s2', caseRow.rows[0].case_status === 's2',
    `实际 ${caseRow.rows[0].case_status}`);
  check('案例提交审核后库里落了 submitted_at', caseRow.rows[0].has_at === true, '还是 NULL');
  check('案例 submitted_at 的回包与库里那一格逐字相同',
    caseSubmitted && caseSubmitted.submitted_at === caseRow.rows[0].wire,
    `回包 ${caseSubmitted && caseSubmitted.submitted_at}，库里 ${caseRow.rows[0].wire}`);

  // ---- 两个详情页都能拿到短链（#10 的第二半） ------------------------------
  //
  // 前置是 s3：服务端对教师那一支的可见性判定写死 `… = 's3'`，所以探针刚建的
  // s2 行点不出短链。取数据集里两条 s3 且有 word_file_id 的行。
  //
  // 这一条钉的是「两条契约操作都真的走通了」。拆函数之前只有 case-detail 调过
  // downloadLink，resource-detail 连按钮都没有 —— 资源那一条从没被调用过。
  const maxEvt = await db.query(
    'SELECT COALESCE(max(content_access_event_id), 0)::int AS m FROM db_content_access_event');
  const eventsBefore = maxEvt.rows[0].m;
  for (const [label, fn, id] of [
    ['资源', library.resourceDownloadLink, 1],
    ['案例', library.caseDownloadLink, 1],
  ]) {
    const link = await fn(id);
    check(`${label}详情取得短链，且带过期时刻`,
      Boolean(link && link.url) && Boolean(link.expiresAt),
      `实际 ${JSON.stringify(link)}`);
    check(`${label}短链是本地契约服务端的占位域名（预览环境不接 COS）`,
      link.placeholder === true,
      `url=${link.url}`);
  }
  const eventRows = await db.query(
    `SELECT content_access_event_id FROM db_content_access_event
       WHERE content_access_event_id > $1 AND teacher_id = 1 AND event_type = 'link_issued'
       ORDER BY content_access_event_id`, [eventsBefore]);
  made.events.push(...eventRows.rows.map((r) => r.content_access_event_id));
  check('两次取档各写了一笔 link_issued 事件（登记表第 9、15 行的副作用）',
    eventRows.rows.length === 2, `实际新增 ${eventRows.rows.length} 笔`);

  // ---- 「我的上传」：mine=true 与 PATCH 的 s1|s4（#13） --------------------
  //
  // mine 的断言**两头都钉**：既钉「回来的每一条都是我的」，也钉「条数严格小于
  // 不带 mine 时的条数」。只钉前者不够 —— 服务端忽略 mine 时回的是全部行，而
  // 「每条都是我的」在那批行里也可能碰巧成立（G84 就是这么漏过去的）。
  const myUp = await library.listMyUploads({ limit: 100 });
  const allRes = await library.listResources({ limit: 100 });
  const allCase = await library.listCases({ limit: 100 });
  check('我的上传里每一条都能查到，且带那句话与能不能改',
    myUp.items.length > 0 && myUp.items.every((r) => r.name && r.statusLabel && r.note
      && typeof r.editable === 'boolean' && (r.kind === 'resource' || r.kind === 'case')),
    `实际 ${JSON.stringify(myUp.items.slice(0, 2))}`);
  check('我的上传严格少于全部（钉住「忽略 mine」这个恒真陷阱）',
    myUp.items.length < allRes.items.length + allCase.items.length,
    `我的 ${myUp.items.length} 条，全部 ${allRes.items.length + allCase.items.length} 条`);
  check('合并了两条独立游标流，所以不谎报游标', myUp.nextCursor === null,
    `nextCursor=${myUp.nextCursor}`);
  check('只有 s1 与 s4 能点进改（F27）',
    myUp.items.every((r) => r.editable === (r.status === 's1' || r.status === 's4')),
    `实际 ${myUp.items.map((r) => r.status + ':' + r.editable).join(' ')}`);

  // 探针刚建的那条资源现在是 s2（上面提交过），所以它**不该**能改。
  // 这一条钉的是 F27 那句「s2 审核期间内容冻结」—— 状态码对不算过，还要核库里没变
  // （§7.5：不可逆动作只测状态码等于没测）。
  const beforePatch = await db.query(
    'SELECT resource_name FROM db_resource WHERE resource_id=$1', [res.resource_id]);
  let s2Rejected = false;
  let s2Code = '';
  try {
    await library.updateResource(res.resource_id, { name: '探针改名（不该成功）' });
  } catch (err) {
    s2Rejected = true;
    s2Code = err.code || '';
  }
  const afterPatch = await db.query(
    'SELECT resource_name FROM db_resource WHERE resource_id=$1', [res.resource_id]);
  check('s2 待审的资源改不动（F27：审核期间内容冻结）', s2Rejected, `没报错，code=${s2Code}`);
  check('而且库里那一行真的没变（不只看状态码）',
    afterPatch.rows[0].resource_name === beforePatch.rows[0].resource_name,
    `改前「${beforePatch.rows[0].resource_name}」改后「${afterPatch.rows[0].resource_name}」`);

  // 再建一条留在 s1，验 PATCH 真的改得动，且 undefined 的键一个都不发。
  const draft = await library.createResource({
    name: '探针草稿（可删）', tag: '艺', grade: ['小班'], type: '文档',
    explain: '改之前的解读。', access: '改之前的获取。', trans: '改之前的转化。',
  });
  made.resources.push(draft.resource_id);
  await library.updateResource(draft.resource_id, { name: '探针草稿（已改名）' });
  const patched = await db.query(
    'SELECT resource_name, resource_explain, resource_status FROM db_resource WHERE resource_id=$1',
    [draft.resource_id]);
  check('s1 草稿改得动，名字落库', patched.rows[0].resource_name === '探针草稿（已改名）',
    `实际「${patched.rows[0].resource_name}」`);
  check('没传的键一个都没被清空（PATCH 缺席=不改，§1.1）',
    patched.rows[0].resource_explain === '改之前的解读。',
    `实际「${patched.rows[0].resource_explain}」`);
  check('改草稿不动状态（s1→s1）', patched.rows[0].resource_status === 's1',
    `实际 ${patched.rows[0].resource_status}`);
  // 三段正文都要落库。此前 PATCH 只收 name／explain，access／trans 送了也静默丢 ——
  // 改草稿的表单接上（#67）之后这两格才有人送，所以钉到库里那两列。
  await library.updateResource(draft.resource_id, { access: '改之后的获取。', trans: '改之后的转化。' });
  const patched2 = await db.query(
    'SELECT resource_access, resource_trans, resource_name FROM db_resource WHERE resource_id=$1',
    [draft.resource_id]);
  check('PATCH 的 resource_access／resource_trans 真的落库',
    patched2.rows[0].resource_access === '改之后的获取。' && patched2.rows[0].resource_trans === '改之后的转化。',
    `实际「${patched2.rows[0].resource_access}」「${patched2.rows[0].resource_trans}」`);
  check('只改 access／trans 时名字没动', patched2.rows[0].resource_name === '探针草稿（已改名）',
    `实际「${patched2.rows[0].resource_name}」`);

  // ---- review_note（#67）：s4 且作者本人才有，其余 null ---------------------------
  //
  // 数据集里 t1／t2 一条 d2 都没有（两条 s4 的历史是 d1 + d3），所以理由只能由探针
  // 自己造：把刚建的草稿按管理端驳回的形状写成 s4 + 一条 d2 的 db_review_action。
  // 两行都是本探针造的，cleanup 收走；db_review_action 的行数要回到基线。
  const REJECT_NOTE = '探针驳回理由：封面出现幼儿正面，请更换后重交。';
  // 先钉 s1：没有驳回过 → null，而且回包里这一格要**存在**（不是没这个字段，§7.6）。
  const rawS1 = await api.get(`/library/resources/${draft.resource_id}`);
  check('自己的 s1 草稿 review_note 是 null（字段存在）',
    Object.hasOwn(rawS1, 'review_note') && rawS1.review_note === null,
    `实际 ${JSON.stringify(rawS1.review_note)}`);
  await db.query("UPDATE db_resource SET resource_status = 's4', updated_at = now() WHERE resource_id = $1",
    [draft.resource_id]);
  const ra = await db.query(
    `INSERT INTO db_review_action (school_id, admin_id, target_type, resource_id, decision, decision_reason)
     VALUES (1, 1, 't1', $1, 'd2', $2) RETURNING review_action_id`,
    [draft.resource_id, REJECT_NOTE]);
  made.reviews.push(ra.rows[0].review_action_id);
  // 再插一条更早的 d2，钉「取的是最近一条」而不是随便一条。
  const raOld = await db.query(
    `INSERT INTO db_review_action (school_id, admin_id, target_type, resource_id, decision, decision_reason, created_at)
     VALUES (1, 1, 't1', $1, 'd2', '探针旧理由（不该被取到）', now() - interval '1 day') RETURNING review_action_id`,
    [draft.resource_id]);
  made.reviews.push(raOld.rows[0].review_action_id);

  const myUp2 = await library.listMyUploads({ limit: 100 });
  const rejectedRow = myUp2.items.find((r) => r.kind === 'resource' && r.id === draft.resource_id);
  check('我的上传里 s4 那一条带驳回理由，且逐字等于 db_review_action 最近一条 d2 的备注',
    Boolean(rejectedRow) && rejectedRow.reviewNote === REJECT_NOTE,
    `实际 ${JSON.stringify(rejectedRow)}`);
  check('s4 那一条落在「草稿（含被驳回）」组、可改',
    myUp2.drafts.some((r) => r.kind === 'resource' && r.id === draft.resource_id && r.editable === true)
      && !myUp2.submitted.some((r) => r.kind === 'resource' && r.id === draft.resource_id),
    `drafts=${myUp2.drafts.map((r) => r.kind + r.id).join(',')}`);
  check('两组是同一份 items 的划分（drafts + submitted = items，且 submitted 全不可改）',
    myUp2.drafts.length + myUp2.submitted.length === myUp2.items.length
      && myUp2.submitted.every((r) => r.editable === false),
    `drafts ${myUp2.drafts.length} + submitted ${myUp2.submitted.length} ≠ items ${myUp2.items.length}`);
  const draftForEdit = await library.resourceDraft(draft.resource_id);
  check('回填表单的 resourceDraft 也带同一条理由，且可改',
    draftForEdit.reviewNote === REJECT_NOTE && draftForEdit.editable === true
      && draftForEdit.access === '改之后的获取。',
    `实际 ${JSON.stringify(draftForEdit)}`);
  // 别人的 s4：给数据集里教师 7 的 resource 7 临时插一条 d2，教师 1 看得见这一行、
  // 看不见理由。两头钉：行在列表里，note 是 null。
  const raOther = await db.query(
    `INSERT INTO db_review_action (school_id, admin_id, target_type, resource_id, decision, decision_reason)
     VALUES (1, 1, 't1', 7, 'd2', '探针：别人的驳回理由，教师 1 不该看到') RETURNING review_action_id`);
  made.reviews.push(raOther.rows[0].review_action_id);
  const rawOther = await api.get('/library/resources/7');
  const listOther = (await api.getPage('/library/resources', { limit: 100 })).items
    .find((r) => r.resource_id === 7);
  check('别人的 s4 看得见那一行，但 review_note 是 null（详情与列表两处）',
    rawOther.resource_status === 's4' && rawOther.review_note === null
      && Boolean(listOther) && listOther.review_note === null,
    `详情 ${JSON.stringify(rawOther.review_note)}，列表 ${JSON.stringify(listOther && listOther.review_note)}`);

  // s4 直接改、直接重交（F27）：PATCH 成功、/submission 落成 s2。
  await library.updateResource(draft.resource_id, { name: '探针草稿（驳回后再改）' });
  await library.submitResource(draft.resource_id);
  const resubmitted = await db.query(
    'SELECT resource_name, resource_status FROM db_resource WHERE resource_id=$1', [draft.resource_id]);
  check('s4 改得动且重交后库里是 s2（F27：不经 s1）',
    resubmitted.rows[0].resource_name === '探针草稿（驳回后再改）' && resubmitted.rows[0].resource_status === 's2',
    `实际「${resubmitted.rows[0].resource_name}」${resubmitted.rows[0].resource_status}`);
  const rawS2 = await api.get(`/library/resources/${draft.resource_id}`);
  check('重交成 s2 之后 review_note 回到 null（只在 s4 时非空）', rawS2.review_note === null,
    `实际 ${JSON.stringify(rawS2.review_note)}`);
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
  // 审核动作最先删：fk_ra_resource 指着资源行。它们是本探针为 review_note 造的，
  // 表本身「只插不改不删」的规矩管的是生产审计，不管测试残渣。
  for (const id of made.reviews) {
    await db.query('DELETE FROM db_review_action WHERE review_action_id=$1', [id]);
  }
  // 先删案例（它引用资源），再删资源，**最后才删文件**：封面与 Word 是
  // db_resource／db_case 上的外键列，文件先删就撞 fk_res_cover 那一族。
  for (const id of made.cases) {
    await db.query('DELETE FROM db_case WHERE case_id=$1', [id]);
  }
  for (const id of made.resources) {
    await db.query('DELETE FROM db_resource WHERE resource_id=$1', [id]);
  }
  // 取档写的存取事件也是本探针造的行，一样要收走 —— 否则 STATS.md 的
  // db_content_access_event 基线每跑一次就多两行。
  for (const id of made.events) {
    await db.query('DELETE FROM db_content_access_event WHERE content_access_event_id=$1', [id]);
  }
  // 文件行排在事件行后面：db_content_access_event.file_id 有 fk_cae_file。
  for (const id of made.files) {
    const deleted=await db.query('DELETE FROM db_file WHERE file_id=$1 RETURNING bucket,object_key,storage_provider', [id]);
    for(const row of deleted.rows)if(row.storage_provider==='p2')await removeObject(row.bucket,row.object_key);
  }
  // 序列回退，让下一次灌库/生成不出现空洞
  await db.query("SELECT setval('db_resource_resource_id_seq', (SELECT max(resource_id) FROM db_resource))");
  await db.query("SELECT setval('db_case_case_id_seq', (SELECT max(case_id) FROM db_case))");
  await db.query("SELECT setval('db_file_file_id_seq', (SELECT max(file_id) FROM db_file))");
  await db.query("SELECT setval('db_content_access_event_content_access_event_id_seq', (SELECT max(content_access_event_id) FROM db_content_access_event))");
  await db.query("SELECT setval('db_review_action_review_action_id_seq', (SELECT max(review_action_id) FROM db_review_action))");
  // 磁盘上那两个临时文件也是本次造的。没造出来就没什么可删。
  for (const path of [COVER_PATH, WORD_PATH]) {
    try { unlinkSync(path); } catch { /* 没造出来 */ }
  }
}

// 资源与案例的基线是数据集不变量（12／10 行），写死；对不上就是数据集变了或有残渣。
// 存取事件不同：它是 append-only 的事件表，别的探针与别的轮次也在往里写，所以这里
// 只钉「本探针收走了自己加的那几行」—— 拿开工时的行数当基线，不去管别人留下的。
const started = { resources: 12, cases: 10, events: null, reviews: null };

main()
  .catch((err) => check(`探针本身出错：${err && err.stack ? err.stack : err}`, false))
  // 清理必须无论主体成败都跑：主体半途炸掉时，已经建出来的行更需要被收走。
  .then(async () => {
    try {
      await cleanup();
      const after = await counts();
      check('清理后 db_resource 回到 12 行', after.resources === started.resources,
        `实际 ${after.resources} 行`);
      check('清理后 db_content_access_event 回到开工时的行数（本探针只收自己加的）',
        started.events === null || after.events === started.events,
        `基线 ${started.events} 行，实际 ${after.events} 行`);
      check('清理后 db_case 回到 10 行', after.cases === started.cases,
        `实际 ${after.cases} 行`);
      // db_file 的基线不写死：它是本次开跑那一刻量的，本探针没有别的行可依。
      check('清理后 db_file 回到基线', filesBaseline !== null && after.files === filesBaseline,
        `基线 ${filesBaseline} 行，实际 ${after.files} 行`);
      check('清理后 db_review_action 回到开工时的行数（review_note 的驳回行是本探针造的）',
        started.reviews === null || after.reviews === started.reviews,
        `基线 ${started.reviews} 行，实际 ${after.reviews} 行`);
      console.log(`清理后：db_resource=${after.resources}，db_case=${after.cases}`
        + `，db_file=${after.files}，db_content_access_event=${after.events}`
        + `，db_review_action=${after.reviews}`);
    } catch (err) {
      check(`清理失败，数据库可能残留了行：${err.message}`, false);
    }
    await db.end().catch(() => {});
    sb.report();
  });
