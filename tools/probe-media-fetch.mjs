/**
 * 取档（`GET /media/files/{file_id}/url`）的探针。**会改数据库，跑完自己收拾。**
 *
 * 桩掉 `wx.*` 之后加载**未经修改的发布代码**：`utils/request.js`、
 * `services/media.js`、`services/party.js`、`services/training.js`、
 * `services/co-education.js` 全是原样的。所以路径写错、少带参数、宿主填错都会红。
 *
 * 这一条端点要钉的东西：
 *
 *   owner 是授权参数   `owner_object` + `owner_id` 契约标为必填。少带回 400，
 *                      填错回 404。**这两条各自一个断言** —— 「查不到」与「没问」
 *                      混成一个码之后，客户端永远查不出自己少带了参数
 *   元数据钉到库里那一行  `file_name`／`file_type`／`file_size` 逐字段与
 *                      `db_file` 比对，不看形状（CLAUDE.md §7.6：形状断言对
 *                      12:00 和 20:00 一样通过）
 *   范围两头钉         本班的动态图片取得到 **且** 别班的那张取不到（§7.4）
 *   事件与它记录的那件事同生共死  k3／k7 每次成功供档写一笔 `downloaded`，
 *                      **重复成功重复计数**（§4 规则 19／20／21）；`file_id` 必填、
 *                      `link_id` 必须为空（`ck_cae_link`）。逐列与库里比对
 *   在园时光不写事件   `db_moment` 不在 k1—k7 的取值域里，一笔也不该多
 *   有效期是 5 分钟那一套  不是资源／案例那条 30 分钟的 bearer 短链
 *
 * **这个环境不接对象存储**，所以：文档类回一个明确标注为假的地址（客户端据此
 * 不去下载），图片回一张本机占位图（客户端据此走 `wx.previewImage`）。
 * 探针断言的是**客户端选了哪条路**，不是「文件真的打开了」——
 * 真的能不能打开只有开发者工具里真点才知道。
 *
 *   node tools/probe-media-fetch.mjs
 */

import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installWxStub, scoreboard, wxCalls } from './lib/wx-stub.mjs';
import { testdataPath, DB_URL } from './lib/testdata-path.mjs';

installWxStub();

const HERE = dirname(fileURLToPath(import.meta.url));
const MP = resolve(HERE, '..', 'miniprogram');
const TESTDATA = testdataPath();

const require_ = createRequire(import.meta.url);
const media = require_(resolve(MP, 'services', 'media.js'));
const party = require_(resolve(MP, 'services', 'party.js'));
const training = require_(resolve(MP, 'services', 'training.js'));
const co = require_(resolve(MP, 'services', 'co-education.js'));
const guard = require_(resolve(MP, 'utils', 'guard.js'));
const api = require_(resolve(MP, 'utils', 'request.js'));
const { Client } = require_(resolve(TESTDATA, 'node_modules', 'pg'));

const sb = scoreboard();
const check = sb.check.bind(sb);
const note = sb.note.bind(sb);
const has = sb.has.bind(sb);

const db = new Client(DB_URL);

// config.js 的 devSubjectId 是 1：陈静，大一班（class 1），school 1。
const ME = { teacher_id: 1, class_id: 1, school_id: 1 };
// STATS.md 的基线。跑完必须回到这个数。
const BASE_EVENTS = 142;

/** 本次跑出来的事件行 id，收尾时逐条删掉。 */
const made = [];

async function eventCount() {
  const r = await db.query('SELECT count(*)::int AS n FROM db_content_access_event');
  return r.rows[0].n;
}

/** 某个 file_id 上新增的 `downloaded` 行，按 id 升序。逐列取回来，不取 *。 */
async function newEvents(sinceId) {
  const r = await db.query(
    `SELECT content_access_event_id AS id, actor_type, teacher_id, partner_account_id,
            content_type, study_id, activity_id, brand_id, document_id, training_id,
            event_type, file_id, link_id
       FROM db_content_access_event
      WHERE content_access_event_id > $1
      ORDER BY content_access_event_id`,
    [sinceId],
  );
  r.rows.forEach((row) => { if (!made.includes(row.id)) made.push(row.id); });
  return r.rows;
}

async function maxEventId() {
  const r = await db.query(
    'SELECT coalesce(max(content_access_event_id), 0)::int AS n FROM db_content_access_event');
  return r.rows[0].n;
}

/** 断言这次取档被拒，**且一笔事件也没多**：拒了却记一笔就是一次假供档。 */
async function refuses(label, act, expectCode) {
  const before = await maxEventId();
  let code = '(没被拒)';
  try {
    await act();
  } catch (err) {
    code = err.code;
  }
  check(`${label} 回 ${expectCode}`, code === expectCode, `实际 ${code}`);
  const after = await newEvents(before);
  check(`${label} 之后没有多出事件行`, after.length === 0,
    `多出 ${after.length} 行：${JSON.stringify(after)}`);
}

/** 一笔 `downloaded` 的形状，逐列钉到 CHECK 要求的那个样子。 */
function checkDownloadRow(label, row, { content_type, idCol, ownerId, fileId }) {
  check(`${label}：actor_type='c1' 且 teacher_id=${ME.teacher_id}（ck_cae_actor）`,
    row.actor_type === 'c1' && row.teacher_id === ME.teacher_id && row.partner_account_id === null,
    JSON.stringify([row.actor_type, row.teacher_id, row.partner_account_id]));
  check(`${label}：content_type='${content_type}'（ck_cae_content_type）`,
    row.content_type === content_type, `实际 ${row.content_type}`);
  check(`${label}：${idCol}=${ownerId}，其余内容 id 为空（ck_cae_target）`,
    row[idCol] === ownerId
    && ['study_id', 'activity_id', 'brand_id', 'document_id', 'training_id']
      .filter((c) => c !== idCol).every((c) => row[c] === null),
    JSON.stringify(row));
  check(`${label}：event_type='downloaded'`, row.event_type === 'downloaded', row.event_type);
  check(`${label}：file_id=${fileId}（列注释 01_schema.sql:2086 要求必填）`,
    row.file_id === fileId, `实际 ${row.file_id}`);
  check(`${label}：link_id 为空（ck_cae_link 禁止 k3—k7 带短链）`,
    row.link_id === null, `实际 ${row.link_id}`);
}

async function main() {
  await db.connect();

  const start = await eventCount();
  console.log(`基线：db_content_access_event=${start}`);
  check('基线与 STATS.md 一致', start === BASE_EVENTS, `实际 ${start}`);

  const ctx = await guard.requireSession();
  check('登录成功，角色为 teacher', ctx.role === 'teacher', `role=${ctx.role}`);

  /* ── 党建学习的主文件（k3） ──────────────────────────────────────────── */

  const studyFix = (await db.query(
    `SELECT fr.owner_id AS study_id, fr.file_id, f.file_name, f.file_type, f.file_size
       FROM db_file_ref fr
       JOIN db_file f ON f.file_id = fr.file_id
       JOIN db_party_study s ON s.study_id = fr.owner_id
      WHERE fr.owner_object = 'db_party_study'
        AND s.study_status = 's3' AND s.school_id = $1
      ORDER BY fr.file_ref_id LIMIT 1`,
    [ME.school_id],
  )).rows[0];
  check('数据集里有一份本园已发布的党建学习附件', Boolean(studyFix), '一条也没有');
  if (!studyFix) return;

  const study = await party.getStudy(studyFix.study_id);
  has(study, ['files', 'fileOwner'], '党建学习详情');
  check('services/party 给出宿主那一对，页面不用自己拼表名',
    study.fileOwner.object === 'db_party_study' && study.fileOwner.id === studyFix.study_id,
    JSON.stringify(study.fileOwner));

  let before = await maxEventId();
  const link = await media.fileUrl(studyFix.file_id, study.fileOwner);
  has(link, ['url', 'name', 'type', 'size', 'expiresAt', 'placeholder'], '取档回包');
  check(`file_name 与 db_file 那一行逐字相同（${studyFix.file_name}）`,
    link.name === studyFix.file_name, `实际「${link.name}」`);
  check(`file_type 与库一致（${studyFix.file_type}）`,
    link.type === studyFix.file_type, `实际 ${link.type}`);
  check(`file_size 与库一致（${studyFix.file_size}）`,
    Number(link.size) === Number(studyFix.file_size), `实际 ${link.size}`);
  check('回包里有一个非空 url', Boolean(link.url), '空的');

  // 有效期：不超过 5 分钟。资源／案例那条 bearer 短链是 30 分钟，两套不能混。
  const nowWire = (await db.query(
    `SELECT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS') || '+08:00' AS w`)).rows[0].w;
  const aheadMin = (Date.parse(link.expiresAt) - Date.parse(nowWire)) / 60000;
  check('expires_at 落在 5 分钟那一档（>0 且 <=6 分钟）',
    aheadMin > 0 && aheadMin <= 6, `实际提前 ${aheadMin.toFixed(1)} 分钟`);
  check('expires_at 不是 30 分钟那一档（那是资源／案例的 bearer 短链）',
    aheadMin < 25, `实际提前 ${aheadMin.toFixed(1)} 分钟`);

  const rows1 = await newEvents(before);
  check('一次成功供档写一笔事件', rows1.length === 1, `实际 ${rows1.length} 笔`);
  if (rows1.length === 1) {
    checkDownloadRow('党建学习', rows1[0], {
      content_type: 'k3', idCol: 'study_id',
      ownerId: studyFix.study_id, fileId: studyFix.file_id,
    });
  }

  // 规则 19／20／21：重复成功重复计数。**这不是重复提交，是规则要的。**
  before = await maxEventId();
  await media.fileUrl(studyFix.file_id, study.fileOwner);
  const rows2 = await newEvents(before);
  check('再取一次再记一笔（重复成功重复计数）', rows2.length === 1, `实际 ${rows2.length} 笔`);

  /* ── owner 那一对是授权参数，不是统计参数 ────────────────────────────── */

  await refuses('少带 owner 那一对',
    () => api.get(`/media/files/${studyFix.file_id}/url`), 'malformed_request');
  await refuses('只带 owner_object 不带 owner_id',
    () => api.get(`/media/files/${studyFix.file_id}/url`,
      { query: { owner_object: 'db_party_study' } }), 'malformed_request');

  const otherStudy = (await db.query(
    `SELECT study_id FROM db_party_study
      WHERE school_id = $1 AND study_status = 's3' AND study_id <> $2 LIMIT 1`,
    [ME.school_id, studyFix.study_id],
  )).rows[0];
  if (otherStudy) {
    await refuses(`owner_id 指着另一份学习文件（study ${otherStudy.study_id} 并不持有这个 file）`,
      () => media.fileUrl(studyFix.file_id, { object: 'db_party_study', id: otherStudy.study_id }),
      'not_found');
  } else {
    note('本园只有一份带附件的已发布学习文件，`owner_id` 错配那一条没打成。',
      '需要第二份 s3 且带 file_ref 的 db_party_study。');
  }

  await refuses('owner_object 换成另一张表（db_training）',
    () => media.fileUrl(studyFix.file_id, { object: 'db_training', id: studyFix.study_id }),
    'not_found');
  await refuses('file_id 不存在',
    () => media.fileUrl(99999999, study.fileOwner), 'not_found');

  /* ── 详情端点给不了的内容，取档也给不了 ──────────────────────────────── */

  // 详情端点只回 s3（routes/teacher-content.mjs 的 publishedItem）。取档那一支
  // 一度只问 owner_object 在不在一张名单里，既不问园所也不问状态，于是详情回 404
  // 的那份下架材料，附件照样取得到，而且还记一笔 downloaded ——
  // 「详情回 404」与「取档回 200」同时成立，就是绕开详情直接取档。
  const goneStudy = (await db.query(
    `SELECT fr.owner_id AS study_id, fr.file_id
       FROM db_file_ref fr
       JOIN db_party_study s ON s.study_id = fr.owner_id
      WHERE fr.owner_object = 'db_party_study'
        AND s.school_id = $1 AND s.study_status <> 's3'
      ORDER BY fr.file_ref_id LIMIT 1`,
    [ME.school_id],
  )).rows[0];
  if (goneStudy) {
    await refuses(`已下架的学习材料（study ${goneStudy.study_id}，status<>'s3'）取不到附件`,
      () => media.fileUrl(goneStudy.file_id,
        { object: 'db_party_study', id: goneStudy.study_id }), 'not_found');
  } else {
    note('本园没有「非 s3 且带附件」的党建学习材料，内容状态那一条没打成。',
      "需要一份 study_status<>'s3' 且有 db_file_ref 行的 db_party_study。");
  }

  const goneDoc = (await db.query(
    `SELECT fr.owner_id AS document_id, fr.file_id
       FROM db_file_ref fr
       JOIN db_coord_document d ON d.document_id = fr.owner_id
      WHERE fr.owner_object = 'db_coord_document'
        AND d.school_id = $1 AND d.document_status <> 's3'
      ORDER BY fr.file_ref_id LIMIT 1`,
    [ME.school_id],
  )).rows[0];
  if (goneDoc) {
    await refuses(`未发布或已下架的协调文档（document ${goneDoc.document_id}）取不到附件`,
      () => media.fileUrl(goneDoc.file_id,
        { object: 'db_coord_document', id: goneDoc.document_id }), 'not_found');
  } else {
    note('本园没有「非 s3 且带附件」的协调文档，那一条没打成。',
      "需要一份 document_status<>'s3' 且有 db_file_ref 行的 db_coord_document。");
  }

  // 别园那一头钉不上：数据集只有一所园（db_school 一行）。predicate 里的
  // school_id 收口因此没有反例可打，写下来免得下一手以为打过了。
  note('别园的园所级附件取不到 —— 这一条打不成。',
    '数据集只有 school 1 一所园，没有第二所园的党建／协调／研修行可当反例。');

  /* ── 文档类：客户端不去下载一个明确标注为假的地址 ─────────────────────── */

  wxCalls.downloadFile.length = 0;
  wxCalls.openDocument.length = 0;
  wxCalls.previewImage.length = 0;
  // openFile 内部照样取一次链接，所以照样多一笔 downloaded。**取回来登记掉**，
  // 否则收尾时删不到它，库里多留一行，下一次跑的基线就对不上
  // （CLAUDE.md §6：会改数据库的探针必须自己收拾）。
  before = await maxEventId();
  const opened = await media.openFile(studyFix.file_id, study.fileOwner);
  await newEvents(before);
  if (studyFix.file_type === 'f1') {
    note('本园第一份党建学习附件是图片，文档那一支没打成。', `file_type=${studyFix.file_type}`);
  } else {
    check('文档类回的是标注为假的地址，openFile 报 placeholder',
      opened.placeholder === true && opened.opened === false, JSON.stringify(opened));
    check('placeholder 时**不**调用 wx.downloadFile（下一个假地址等于制造一次假失败）',
      wxCalls.downloadFile.length === 0, `实际调了 ${wxCalls.downloadFile.length} 次`);
    check('placeholder 时给出可直接显示的一句中文',
      opened.reason === media.PLACEHOLDER_TEXT, `实际「${opened.reason}」`);
  }

  /* ── 研修材料（k7） ──────────────────────────────────────────────────── */

  const trainFix = (await db.query(
    `SELECT fr.owner_id AS training_id, fr.file_id, f.file_name
       FROM db_file_ref fr
       JOIN db_file f ON f.file_id = fr.file_id
       JOIN db_training t ON t.training_id = fr.owner_id
      WHERE fr.owner_object = 'db_training'
        AND t.school_id = $1 AND t.training_status = 's1'
      ORDER BY fr.file_ref_id LIMIT 1`,
    [ME.school_id],
  )).rows[0];
  if (trainFix) {
    const detail = await training.getTraining(trainFix.training_id);
    check('services/training 给出宿主那一对',
      detail.fileOwner.object === 'db_training' && detail.fileOwner.id === trainFix.training_id,
      JSON.stringify(detail.fileOwner));
    const hit = detail.files.find((f) => f.fileId === trainFix.file_id);
    check(`研修材料的名字来自 db_file.file_name（${trainFix.file_name}）`,
      Boolean(hit) && hit.name === trainFix.file_name, JSON.stringify(hit));

    before = await maxEventId();
    await media.fileUrl(trainFix.file_id, detail.fileOwner);
    const rows3 = await newEvents(before);
    check('研修取档写一笔事件', rows3.length === 1, `实际 ${rows3.length} 笔`);
    if (rows3.length === 1) {
      checkDownloadRow('研修', rows3[0], {
        content_type: 'k7', idCol: 'training_id',
        ownerId: trainFix.training_id, fileId: trainFix.file_id,
      });
    }
  } else {
    note('本园没有已发布且带材料的研修活动，k7 那一支没打成。',
      'db_file_ref(owner_object=db_training) 在本园的 s1 活动上一行也没有。');
  }

  /* ── 在园时光的图片：范围两头钉，且一笔事件也不该多 ───────────────────── */

  const mineFix = (await db.query(
    `SELECT fr.owner_id AS moment_id, fr.file_id, f.file_type
       FROM db_file_ref fr
       JOIN db_file f ON f.file_id = fr.file_id
       JOIN db_moment m ON m.moment_id = fr.owner_id
      WHERE fr.owner_object = 'db_moment' AND m.class_id = $1 AND f.file_type = 'f1'
      ORDER BY fr.file_ref_id LIMIT 1`,
    [ME.class_id],
  )).rows[0];
  check('本班有带图片的在园时光', Boolean(mineFix), '一条也没有');

  if (mineFix) {
    before = await maxEventId();
    const owner = { object: 'db_moment', id: mineFix.moment_id };
    const url = await co.photoUrl(mineFix.file_id, owner);
    check('本班动态的图片取得到地址', Boolean(url), '回了空串');
    const rows4 = await newEvents(before);
    check('在园时光**不**写 downloaded（db_moment 不在 k1—k7 取值域里）',
      rows4.length === 0, `多出 ${rows4.length} 行：${JSON.stringify(rows4)}`);

    // photoUrl 少带 owner 时服务端回 400，而 photoUrl 吞掉异常回空串 ——
    // 页面渲染占位而不是整屏炸掉。这一条同时钉住「参数真的发出去了」。
    const noOwner = await co.photoUrl(mineFix.file_id, { object: '', id: 0 });
    check('少带 owner 时 photoUrl 回空串（页面渲染占位，不炸整屏）',
      noOwner === '', `实际「${noOwner}」`);

    wxCalls.previewImage.length = 0;
    wxCalls.downloadFile.length = 0;
    const img = await media.openFile(mineFix.file_id, owner);
    check('图片走 wx.previewImage，不落地成临时文件',
      img.opened === true && wxCalls.previewImage.length === 1
      && wxCalls.downloadFile.length === 0,
      `previewImage ${wxCalls.previewImage.length} 次、downloadFile ${wxCalls.downloadFile.length} 次`);

    // 服务端的取档也要清掉本段自己造出来的行（图片那两次不写事件，这里只是保险）
    await newEvents(before);
  }

  const otherFix = (await db.query(
    `SELECT fr.owner_id AS moment_id, fr.file_id
       FROM db_file_ref fr
       JOIN db_moment m ON m.moment_id = fr.owner_id
      WHERE fr.owner_object = 'db_moment' AND m.class_id <> $1
      ORDER BY fr.file_ref_id LIMIT 1`,
    [ME.class_id],
  )).rows[0];
  if (otherFix) {
    await refuses(`别班动态的图片取不到（moment ${otherFix.moment_id}）`,
      () => media.fileUrl(otherFix.file_id, { object: 'db_moment', id: otherFix.moment_id }),
      'not_found');
  } else {
    note('数据集里没有别班的在园时光附件，范围断言只钉住了一头。', 'db_moment 的 file_ref 全在本班。');
  }

  /* ── 教师证书那一支打不了 ────────────────────────────────────────────── */

  const cred = (await db.query('SELECT count(*)::int AS n FROM db_teacher_credential')).rows[0].n;
  if (cred === 0) {
    note('教师证书（直连列宿主 db_teacher_credential.file_id）那一条分支没打成。',
      'db_teacher_credential 表 0 行 —— 数据集里没有证书，造一行才能打，'
      + '而造行要连带造 db_file。归票据 #15（个人档案整页重写）一起做。');
  }

  /* ── 月度评价的照片：宿主是 db_month_eval，范围与月评列表同一条 ────────── */

  const evalFix = (await db.query(
    `SELECT fr.owner_id AS month_eval_id, fr.file_id
       FROM db_file_ref fr
       JOIN db_month_eval me ON me.month_eval_id = fr.owner_id
      WHERE fr.owner_object = 'db_month_eval' AND me.teacher_id = $1
      ORDER BY fr.file_ref_id LIMIT 1`,
    [ME.teacher_id],
  )).rows[0];
  if (evalFix) {
    before = await maxEventId();
    let evalLink = null;
    let code = '(通过)';
    try {
      evalLink = await media.fileUrl(evalFix.file_id,
        { object: 'db_month_eval', id: evalFix.month_eval_id });
    } catch (err) {
      code = err.code;
    }
    check(`月度评价回填的照片取得到地址（month_eval ${evalFix.month_eval_id}）`,
      code === '(通过)' && Boolean(evalLink && evalLink.url), `实际 ${code}`);
    const rows5 = await newEvents(before);
    check('月度评价**不**写 downloaded（db_month_eval 不在 k1—k7 取值域里）',
      rows5.length === 0, `多出 ${rows5.length} 行：${JSON.stringify(rows5)}`);
  } else {
    note('本人名下没有带照片的月度评价，那一支没打成。',
      "db_file_ref(owner_object='db_month_eval') 一行也没有。");
  }
}

/** 收拾：删掉本次造出来的事件行，并核对总数回到基线。 */
async function cleanup() {
  if (made.length) {
    await db.query(
      'DELETE FROM db_content_access_event WHERE content_access_event_id = ANY($1::int[])',
      [made],
    );
  }
  const end = await eventCount();
  check(`收拾干净：db_content_access_event 回到 ${BASE_EVENTS}（本次造了 ${made.length} 行）`,
    end === BASE_EVENTS, `实际 ${end}`);
}

// 收拾放在**尾链上**，不放在 main() 里：main() 中途抛错时也要把自己造的行删掉。
// 「跑到一半炸了所以没收拾」与「没造行」在库里长得不一样，下一次基线就对不上了。
main()
  .catch((err) => {
    check(`探针本身出错：${err && err.stack ? err.stack : err}`, false);
  })
  .then(async () => {
    try {
      await cleanup();
    } catch (err) {
      check(`收拾失败，库里可能留了 ${made.length} 行：${err && err.message}`, false);
    }
    try { await db.end(); } catch { /* 已经断开就算了 */ }
    sb.report();
  });
