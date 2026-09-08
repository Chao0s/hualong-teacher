/**
 * 教师专业档案三条端点的探针。**会改数据库，跑完自己收拾。**
 *
 *   `GET  /teacher-profile`          本人档案（含证书与内嵌的那条 s2）
 *   `GET  /teacher-profile/changes`  本人的档案修改申请
 *   `POST /teacher-profile/changes`  提交一条修改申请（NONE → s2）
 *
 * 桩掉 `wx.*` 之后加载**未经修改的发布代码**：`utils/request.js`、
 * `services/profile.js`、`services/media.js` 全是原样的。所以路径写错、字段改名、
 * 枚举译反都会红。
 *
 * 这一组要钉的东西：
 *
 *   值钉到库里那一行   职称、学历、岗位、证书名称、证书等级、文件显示名逐字段与
 *                      `db_teacher_profile`／`db_teacher_credential`／`db_file`
 *                      比对（CLAUDE.md §7.6：形状断言对 12:00 和 20:00 一样通过）
 *   范围两头钉         **看得见自己那几行，且别人的那几行不在里面**（§7.4）：
 *                      教师 1 读到 credential 1／2，读不到教师 2 的 credential 3；
 *                      change 列表只有自己那一条，教师 5 与教师 9 的两条不在里面
 *   `no_open_s2`       已有一条 s2 时提交回 `state_precondition_failed`，
 *                      **且一行都不多**（§7.5：状态码对不算过）
 *   `credential_file_owned`  payload 里写别人的 `file_id` 时被拒，**且一行都不多**
 *   `pending_change`   契约声明它内嵌在档案里。提交前是 null，提交后是刚建的那一条
 *   `change_payload` 原样回读  提交时那一份与库里那一格 JSONB 逐键相同 ——
 *                      「审核界面与教师读到的必须是同一份」
 *   证书取档的宿主那一对  `owner_object='db_teacher_credential'` 且
 *                      **`owner_id` 是 `credential_id` 不是 `file_id`**；
 *                      别人的证书取不到
 *   证书不写供档事件   `db_teacher_credential` 不在 `ck_cae_content_type` 的 k1—k7
 *                      取值域里，一笔都不该多
 *
 * 写入那一半用**教师 2**（李婉婷）跑：数据集里教师 1 有一条 s2 挂着，`no_open_s2`
 * 会把每一次提交都挡掉，成功那条路就永远走不到。换人的写法照 `probe-moments.mjs`。
 *
 *   node tools/probe-teacher-profile.mjs
 */

import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installWxStub, scoreboard } from './lib/wx-stub.mjs';
import { testdataPath, DB_URL } from './lib/testdata-path.mjs';

installWxStub();

const HERE = dirname(fileURLToPath(import.meta.url));
const MP = resolve(HERE, '..', 'miniprogram');
const TESTDATA = testdataPath();

const require_ = createRequire(import.meta.url);
const profile = require_(resolve(MP, 'services', 'profile.js'));
const media = require_(resolve(MP, 'services', 'media.js'));
const guard = require_(resolve(MP, 'utils', 'guard.js'));
const auth = require_(resolve(MP, 'utils', 'auth.js'));
const session = require_(resolve(MP, 'utils', 'session.js'));
const config = require_(resolve(MP, 'config.js'));
const { Client } = require_(resolve(TESTDATA, 'node_modules', 'pg'));

const sb = scoreboard();
const check = sb.check.bind(sb);
const has = sb.has.bind(sb);

const db = new Client(DB_URL);

// config.js 的 devSubjectId 是 1：陈静，大一班（class 1），school 1。
const ME = { teacher_id: 1, school_id: 1 };
// 写入那一半换的人。教师 2 李婉婷同班配班，数据集里没有任何 change 行。
const WRITER = { teacher_id: 2, school_id: 1 };

// STATS.md 的基线。跑完必须回到这两个数。
const BASE_CHANGES = 3;
const BASE_EVENTS = 142;

/** 本次跑出来的申请行 id，收尾时逐条删掉。 */
const made = [];

async function countChanges() {
  const r = await db.query('SELECT count(*)::int AS n FROM db_teacher_profile_change');
  return r.rows[0].n;
}

async function countEvents() {
  const r = await db.query('SELECT count(*)::int AS n FROM db_content_access_event');
  return r.rows[0].n;
}

/** 某位教师名下的申请行，新的在前，逐列取回来，不取 `*`。 */
async function changeRows(teacherId) {
  const r = await db.query(
    `SELECT teacher_profile_change_id AS id, school_id, teacher_id, teacher_profile_id,
            change_payload, change_status,
            to_char(submitted_at, 'YYYY-MM-DD HH24:MI') AS submitted_label,
            to_char(applied_at, 'YYYY-MM-DD HH24:MI') AS applied_label
       FROM db_teacher_profile_change
      WHERE teacher_id = $1
      ORDER BY submitted_at DESC, teacher_profile_change_id DESC`,
    [teacherId],
  );
  return r.rows;
}

/**
 * 断言这次提交被拒，**且一行都没多**。
 *
 * 只看状态码不算过（§7.5）：一个回 409 却真的插了行的实作，只看码是看不出来的。
 */
async function refusesSubmit(label, payload, expectCode, expectRule) {
  const before = await countChanges();
  let code = '(没被拒)';
  let rule = '';
  try {
    await profile.submitChange(payload);
  } catch (err) {
    code = err.code;
    rule = err.details ? String(err.details.rule || '') : '';
  }
  check(`${label} 回 ${expectCode}`, code === expectCode, `实际 ${code}`);
  if (expectRule) {
    check(`${label} 的 details.rule 是 ${expectRule}`, rule === expectRule, `实际「${rule}」`);
  }
  const after = await countChanges();
  check(`${label} 之后 db_teacher_profile_change 没有多出行`,
    after === before, `${before} → ${after}`);
}

async function main() {
  await db.connect();

  const startChanges = await countChanges();
  const startEvents = await countEvents();
  console.log(`基线：db_teacher_profile_change=${startChanges}，db_content_access_event=${startEvents}`);
  check('db_teacher_profile_change 基线与 STATS.md 一致', startChanges === BASE_CHANGES, `实际 ${startChanges}`);
  check('db_content_access_event 基线与 STATS.md 一致', startEvents === BASE_EVENTS, `实际 ${startEvents}`);

  const ctx = await guard.requireSession();
  check('登录成功，角色为 teacher', ctx.role === 'teacher', `role=${ctx.role}`);

  /* ── 读：档案本体逐列钉到 db_teacher_profile ─────────────────────────── */

  const dbProfile = (await db.query(
    `SELECT teacher_profile_id, professional_title, education_level, job_role, career_summary
       FROM db_teacher_profile WHERE teacher_id = $1`,
    [ME.teacher_id],
  )).rows[0];
  check('数据集里有教师 1 的档案行', Boolean(dbProfile), '一条也没有');
  if (!dbProfile) return;

  const mine = await profile.getProfile();
  has(mine, ['profileId', 'fields', 'groups', 'credentials', 'pendingChange'], '档案');
  check(`teacher_profile_id 与库一致（${dbProfile.teacher_profile_id}）`,
    mine.profileId === dbProfile.teacher_profile_id, `实际 ${mine.profileId}`);
  check(`professional_title 与库那一行逐字相同（${dbProfile.professional_title}）`,
    mine.title === dbProfile.professional_title, `实际「${mine.title}」`);
  check(`education_level 与库一致（${dbProfile.education_level}）`,
    mine.educationLevel === dbProfile.education_level, `实际 ${mine.educationLevel}`);
  check(`job_role 与库一致（${dbProfile.job_role}）`,
    mine.jobRole === dbProfile.job_role, `实际 ${mine.jobRole}`);

  // 枚举译得对不对，钉到 DDL 的列注释，不钉到「有值就行」。
  check(`最高学历译成「${profile.EDUCATION_LEVEL[dbProfile.education_level]}」`,
    mine.fields.some((f) => f.label === '最高学历'
      && f.value === profile.EDUCATION_LEVEL[dbProfile.education_level]),
    JSON.stringify(mine.fields));
  check(`岗位译成「${profile.JOB_ROLE[dbProfile.job_role]}」`,
    mine.fields.some((f) => f.label === '岗位'
      && f.value === profile.JOB_ROLE[dbProfile.job_role]),
    JSON.stringify(mine.fields));

  // 姓名来自会话，不是这条端点。任教班级、教龄、在园年数一行都不该画。
  const subject = session.getSubject() || {};
  check(`姓名取自会话（${subject.teacher_name}）`,
    mine.fields.some((f) => f.label === '姓名' && f.value === subject.teacher_name),
    JSON.stringify(mine.fields));
  check('不画「任教班级」—— 会话里只有 class_id，没有班级名',
    !mine.fields.some((f) => f.label === '任教班级'), JSON.stringify(mine.fields));
  check('不画「首次任教」「本园任职」—— 契约恒为 null，且不拿今年去减',
    !mine.fields.some((f) => f.label === '首次任教' || f.label === '本园任职'),
    JSON.stringify(mine.fields));

  /* ── 读：证书两头钉 ──────────────────────────────────────────────────── */

  const dbCreds = (await db.query(
    `SELECT tc.credential_id, tc.credential_type, tc.credential_name, tc.credential_level,
            tc.file_id, f.file_name
       FROM db_teacher_credential tc JOIN db_file f ON f.file_id = tc.file_id
      WHERE tc.teacher_id = $1 AND tc.is_active
      ORDER BY tc.credential_id`,
    [ME.teacher_id],
  )).rows;
  check(`看得见自己的 ${dbCreds.length} 张证书`,
    mine.credentials.length === dbCreds.length, `实际 ${mine.credentials.length} 张`);
  dbCreds.forEach((row, i) => {
    const got = mine.credentials[i] || {};
    check(`证书 ${row.credential_id}：名称与库逐字相同（${row.credential_name}）`,
      got.name === row.credential_name, `实际「${got.name}」`);
    check(`证书 ${row.credential_id}：credential_type=${row.credential_type}，译成「${profile.CREDENTIAL_TYPE[row.credential_type]}」`,
      got.type === row.credential_type
      && got.typeLabel === profile.CREDENTIAL_TYPE[row.credential_type],
      `实际 ${got.type}／「${got.typeLabel}」`);
    check(`证书 ${row.credential_id}：credential_level=${row.credential_level}，译成「${profile.CREDENTIAL_LEVEL[row.credential_level]}」`,
      got.level === (row.credential_level || '')
      && got.levelLabel === (row.credential_level ? profile.CREDENTIAL_LEVEL[row.credential_level] : ''),
      `实际 ${got.level}／「${got.levelLabel}」`);
    check(`证书 ${row.credential_id}：file_name 与 db_file 那一行逐字相同（${row.file_name}）`,
      got.fileName === row.file_name, `实际「${got.fileName}」`);
    const owner = profile.credentialOwner(row.credential_id);
    check(`证书 ${row.credential_id}：宿主那一对是 db_teacher_credential + credential_id`,
      owner.object === 'db_teacher_credential' && owner.id === row.credential_id,
      JSON.stringify(owner));
  });

  // 范围的另一头：别人的证书不在自己这份里（§7.4）。
  const others = (await db.query(
    'SELECT credential_id FROM db_teacher_credential WHERE teacher_id <> $1 AND is_active ORDER BY credential_id',
    [ME.teacher_id],
  )).rows.map((r) => r.credential_id);
  check(`别人的 ${others.length} 张证书一张都不在自己这份里`,
    !mine.credentials.some((c) => others.includes(c.credentialId)),
    JSON.stringify(mine.credentials.map((c) => c.credentialId)));

  // 分区：c1／c2 进「资格证书」，c3 进「专业奖项」，空的那一区不渲染。
  const awardCount = dbCreds.filter((r) => r.credential_type === 'c3').length;
  const certCount = dbCreds.length - awardCount;
  const expectGroups = (certCount ? 1 : 0) + (awardCount ? 1 : 0);
  check(`证书分成 ${expectGroups} 区（资格证书 ${certCount} 张、专业奖项 ${awardCount} 张），空的不渲染`,
    mine.groups.length === expectGroups, `实际 ${mine.groups.length} 区`);

  /* ── 证书取档：宿主那一对 + 不写供档事件 ─────────────────────────────── */

  const first = mine.credentials[0];
  let eventsBefore = await countEvents();
  const link = await media.fileUrl(first.fileId, profile.credentialOwner(first.credentialId));
  check(`自己的证书取得到地址（credential ${first.credentialId}）`, Boolean(link.url), '空的');
  check(`取档回的 file_name 与库一致（${dbCreds[0].file_name}）`,
    link.name === dbCreds[0].file_name, `实际「${link.name}」`);
  check('证书取档不写 downloaded —— db_teacher_credential 不在 k1—k7 取值域里',
    (await countEvents()) === eventsBefore, '多出了行');

  // owner_id 填 file_id 而不是 credential_id 时必须查不到：直连列宿主认的是
  // credential_id，两者填反在回包上看不出来，只有这一条断言看得出来。
  let code = '(没被拒)';
  try {
    await media.fileUrl(first.fileId, { object: media.OWNER.TEACHER_CREDENTIAL, id: first.fileId });
  } catch (err) { code = err.code; }
  check('owner_id 误填 file_id 时回 not_found', code === 'not_found', `实际 ${code}`);

  // 范围的另一头：别人的证书取不到（同班同事的也不给）。
  const otherCred = (await db.query(
    `SELECT credential_id, file_id FROM db_teacher_credential
      WHERE teacher_id <> $1 AND is_active ORDER BY credential_id LIMIT 1`,
    [ME.teacher_id],
  )).rows[0];
  if (otherCred) {
    code = '(没被拒)';
    try {
      await media.fileUrl(otherCred.file_id,
        { object: media.OWNER.TEACHER_CREDENTIAL, id: otherCred.credential_id });
    } catch (err) { code = err.code; }
    check(`别人的证书（credential ${otherCred.credential_id}）取不到，回 not_found`,
      code === 'not_found', `实际 ${code}`);
  }

  /* ── 读：修改申请只回本人的 ──────────────────────────────────────────── */

  const dbMineChanges = await changeRows(ME.teacher_id);
  const page = await profile.listChanges({});
  check(`修改申请看得见自己的 ${dbMineChanges.length} 条`,
    page.items.length === dbMineChanges.length, `实际 ${page.items.length} 条`);
  const otherChangeIds = (await db.query(
    'SELECT teacher_profile_change_id AS id FROM db_teacher_profile_change WHERE teacher_id <> $1',
    [ME.teacher_id],
  )).rows.map((r) => r.id);
  check(`别人的 ${otherChangeIds.length} 条申请一条都不在里面`,
    !page.items.some((x) => otherChangeIds.includes(x.changeId)),
    JSON.stringify(page.items.map((x) => x.changeId)));

  if (dbMineChanges.length) {
    const row = dbMineChanges[0];
    const latest = await profile.latestChange();
    check(`最新一条是 ${row.id}（服务端排序 submitted_at DESC，客户端不重排）`,
      latest.changeId === row.id, `实际 ${latest && latest.changeId}`);
    check(`change_status=${row.change_status}，译成「${profile.CHANGE_STATUS[row.change_status]}」`,
      latest.status === row.change_status
      && latest.statusLabel === profile.CHANGE_STATUS[row.change_status],
      `实际 ${latest.status}／「${latest.statusLabel}」`);
    check(`submitted_at 钉到库里那一行（${row.submitted_label}）`,
      latest.submittedLabel === row.submitted_label, `实际「${latest.submittedLabel}」`);
    check('change_payload 原样回读，逐键与库里那一格相同',
      JSON.stringify(latest.payload) === JSON.stringify(row.change_payload),
      `回包 ${JSON.stringify(latest.payload)}`);

    // 契约声明 pending_change 内嵌在档案里，没有则 null。教师 1 挂着一条 s2。
    const pendingRow = dbMineChanges.find((r) => r.change_status === 's2');
    if (pendingRow) {
      check(`档案内嵌的 pending_change 就是那条 s2（${pendingRow.id}）`,
        Boolean(mine.pendingChange) && mine.pendingChange.changeId === pendingRow.id,
        JSON.stringify(mine.pendingChange));
      // 界面上先说明原因，而不是等按下去才失败。
      const why = profile.whyCannotSubmit(
        { title: '换一个职称', credentials: [] }, mine, latest);
      check('有 s2 挂着时 whyCannotSubmit 说得出原因', Boolean(why), `实际「${why}」`);
      await refusesSubmit('有 s2 挂着时再提交', { professional_title: '换一个职称' },
        'state_precondition_failed', 'one_pending_per_teacher');
    }
  }

  /* ── 写：换教师 2，那位没有任何 change 行 ────────────────────────────── */

  const realSubject = config.devSubjectId;
  session.clear();
  config.devSubjectId = WRITER.teacher_id;
  await auth.ensureSession();

  try {
    const before = await profile.getProfile();
    check('教师 2 名下没有待审申请（pending_change 为 null）',
      before.pendingChange === null, JSON.stringify(before.pendingChange));
    check('教师 2 的 latestChange 是 null',
      (await profile.latestChange()) === null, '不是 null');

    // 没改任何东西时 diffPayload 是空的，whyCannotSubmit 拦下来。
    const same = {
      title: before.title,
      jobRole: before.jobRole,
      educationLevel: before.educationLevel,
      credentials: before.credentials.map((c) => ({
        type: c.type, level: c.level, name: c.name, fileId: c.fileId,
      })),
    };
    check('原样不动时 change_payload 是空的（只送要改的键）',
      Object.keys(profile.diffPayload(same, before)).length === 0,
      JSON.stringify(profile.diffPayload(same, before)));
    check('原样不动时 whyCannotSubmit 拦下来',
      profile.whyCannotSubmit(same, before, null) === '没有任何改动，不用提交',
      `实际「${profile.whyCannotSubmit(same, before, null)}」`);

    // `credential_file_owned`：payload 里写别人的 file_id 要被拒，且一行都不多。
    const foreignFile = (await db.query(
      `SELECT file_id FROM db_file
        WHERE NOT (uploader_type = 'c1' AND uploaded_by = $1)
          AND NOT EXISTS (SELECT 1 FROM db_teacher_credential tc
                           WHERE tc.file_id = db_file.file_id AND tc.teacher_id = $1)
        ORDER BY file_id LIMIT 1`,
      [WRITER.teacher_id],
    )).rows[0];
    check('数据集里找得到一个不属于教师 2 的 file_id', Boolean(foreignFile), '一个也没有');
    if (foreignFile) {
      await refusesSubmit(`payload 里写别人的 file_id（${foreignFile.file_id}）`, {
        credentials: [{
          credential_type: 'c2', credential_name: '探针造的证书', file_id: foreignFile.file_id,
        }],
      }, 'validation_failed', 'credential_file_owned');
    }

    // 同一条前置的绕行道：`credentials` 送成**对象**而不是数组。服务端不按契约的
    // schema 验请求体，所以判据那一段是 `Array.isArray` 守着的 —— 守不住就等于
    // 别人的 `file_id` 连查都不查就落进 JSONB。这一条钉的是那个 `else`。
    if (foreignFile) {
      await refusesSubmit('credentials 送成对象而不是数组', {
        credentials: { 0: { credential_type: 'c2', credential_name: '探针造的证书', file_id: foreignFile.file_id } },
      }, 'validation_failed', 'array_required');
    }

    /* ── 真的提交一条，逐列与库比对 ──────────────────────────────────── */

    const form = {
      title: `${before.title}（探针）`,
      jobRole: before.jobRole,
      educationLevel: before.educationLevel,
      credentials: same.credentials,
    };
    check('改了职称之后 whyCannotSubmit 放行',
      profile.whyCannotSubmit(form, before, null) === '',
      `实际「${profile.whyCannotSubmit(form, before, null)}」`);
    const payload = profile.diffPayload(form, before);
    check('change_payload 只有 professional_title 这一个键',
      JSON.stringify(Object.keys(payload)) === JSON.stringify(['professional_title']),
      JSON.stringify(payload));

    // full_preview_confirmed 的那段文字：改了什么必须在里面说得出来。
    const preview = profile.previewText(payload, before);
    check('完整预览文字里说得出旧值与新值',
      preview.includes(before.title) && preview.includes(form.title.trim()),
      preview);

    const created = await profile.submitChange(payload);
    check('提交回 s2=待审核', created.change_status === 's2', `实际 ${created.change_status}`);
    made.push(created.teacher_profile_change_id);

    const rows = await changeRows(WRITER.teacher_id);
    check('库里多了教师 2 的那一行', rows.length === 1, `实际 ${rows.length} 行`);
    const landed = rows[0];
    check(`落库的 change_status 是 s2（实际 ${landed.change_status}）`, landed.change_status === 's2');
    check(`school_id 与 teacher_id 是服务端派生的（${WRITER.school_id}／${WRITER.teacher_id}）`,
      landed.school_id === WRITER.school_id && landed.teacher_id === WRITER.teacher_id,
      JSON.stringify([landed.school_id, landed.teacher_id]));
    check(`teacher_profile_id 指向本人档案（${before.profileId}）`,
      landed.teacher_profile_id === before.profileId, `实际 ${landed.teacher_profile_id}`);
    check('submitted_at 已写', Boolean(landed.submitted_label), '是空的');
    check('applied_at 仍为空（s3 之前不写入 canonical）',
      landed.applied_label === null, `实际 ${landed.applied_label}`);
    check('库里那一格 change_payload 与送出去的那一份逐键相同',
      JSON.stringify(landed.change_payload) === JSON.stringify(payload),
      JSON.stringify(landed.change_payload));

    // 提交之后档案里那条 pending_change 就是刚建的这一行。
    const after = await profile.getProfile();
    check('提交后档案内嵌的 pending_change 就是刚建的那一条',
      Boolean(after.pendingChange) && after.pendingChange.changeId === landed.id,
      JSON.stringify(after.pendingChange));
    check('canonical 没有被改动 —— 职称仍是原来那个',
      after.title === before.title, `实际「${after.title}」`);

    // `no_open_s2`：第二次提交要被拒，且一行都不多。
    await refusesSubmit('教师 2 紧接着再提交一次', { professional_title: '再改一次' },
      'state_precondition_failed', 'one_pending_per_teacher');
  } finally {
    config.devSubjectId = realSubject;
    session.clear();
    await auth.ensureSession();
  }

  check('换回原教师后会话正常', Boolean(session.getToken()), '没有票');
  check('全程没有多出供档事件', (await countEvents()) === startEvents, '多出了行');
}

/** 收拾：删掉本次造出来的申请行，并核对总数回到基线。 */
async function cleanup() {
  if (made.length) {
    await db.query(
      'DELETE FROM db_teacher_profile_change WHERE teacher_profile_change_id = ANY($1::int[])',
      [made],
    );
  }
  const end = await countChanges();
  check(`收拾干净：db_teacher_profile_change 回到 ${BASE_CHANGES}（本次造了 ${made.length} 行）`,
    end === BASE_CHANGES, `实际 ${end}`);
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
