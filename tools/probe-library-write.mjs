/**
 * 写入路径的探针：新建草稿 -> 提交审核 -> **把自己造的行删干净**。
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
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installWxStub, scoreboard } from './lib/wx-stub.mjs';
import { testdataPath, DB_URL } from './lib/testdata-path.mjs';

installWxStub();

const HERE = dirname(fileURLToPath(import.meta.url));
const MP = resolve(HERE, '..', 'miniprogram');
const TESTDATA = testdataPath();

const require_ = createRequire(import.meta.url);
const library = require_(resolve(MP, 'services', 'library.js'));
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
    + ' (SELECT count(*)::int FROM db_content_access_event) AS events'
  );
  return r.rows[0];
}

const made = { resources: [], cases: [], events: [] };

async function main() {
  await db.connect();
  const before = await counts();
  started.events = before.events;
  console.log(`基线：db_resource=${before.resources}，db_case=${before.cases}，db_content_access_event=${before.events}`);

  await guard.requireSession();

  // ---- 建资源草稿 ----------------------------------------------------------
  const res = await library.createResource({
    name: '探针资源（可删）',
    tag: '住',
    grade: ['大班'],
    type: '文档',
    explain: '这是写入探针建的行，脚本结束时会删掉。',
    access: '取自探针。',
    trans: '取自探针。',
  });
  check('POST /library/resources 回了 resource_id', Boolean(res && res.resource_id),
    `回的是 ${JSON.stringify(res)}`);
  if (res && res.resource_id) made.resources.push(res.resource_id);

  check('新建的资源是草稿 s1', res.resource_status === 's1', `实际 ${res.resource_status}`);

  // POST 的回包是**精简形状**：只有 { resource_id, resource_name, resource_status }。
  // 所以派生列与枚举编码要回库里查，不能从回包上读 —— 从回包读会因为字段不存在
  // 而恒为 undefined，那种断言看着在测，其实一直在放行。
  const stored = await db.query(
    'SELECT school_id, created_by, resource_tag, grade FROM db_resource WHERE resource_id=$1',
    [res.resource_id]
  );
  const s = stored.rows[0];
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

  // ---- 建案例草稿，并关联一条资源 ------------------------------------------
  const kase = await library.createCase({
    name: '探针案例（可删）',
    grade: '大班',
    field: '社会',
    areas: ['集体教学', '主题探究'],
    intro: '这是写入探针建的行，脚本结束时会删掉。',
    trans: '取自探针。',
    resourceIds: [1],
  });
  check('POST /library/cases 回了 case_id', Boolean(kase && kase.case_id),
    `回的是 ${JSON.stringify(kase)}`);
  if (kase && kase.case_id) made.cases.push(kase.case_id);
  const storedCase = await db.query(
    'SELECT case_area, case_grade, case_field FROM db_case WHERE case_id=$1', [kase.case_id]
  );
  check('case_area 存的是编码数组 [a1,a3]',
    JSON.stringify(storedCase.rows[0].case_area) === JSON.stringify(['a1', 'a3']),
    `实际 ${JSON.stringify(storedCase.rows[0].case_area)}`);
  check('case_grade/case_field 存的是编码 k3/f3',
    storedCase.rows[0].case_grade === 'k3' && storedCase.rows[0].case_field === 'f3',
    `实际 ${storedCase.rows[0].case_grade}/${storedCase.rows[0].case_field}`);

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
}

async function cleanup() {
  // 先删案例（它引用资源），再删资源。db_file_ref 之类的从属行随外键级联，
  // 没有级联的就先删从属行 —— 这里两张表都只是本体行，没有附件。
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
  // 序列回退，让下一次灌库/生成不出现空洞
  await db.query("SELECT setval('db_resource_resource_id_seq', (SELECT max(resource_id) FROM db_resource))");
  await db.query("SELECT setval('db_case_case_id_seq', (SELECT max(case_id) FROM db_case))");
  await db.query("SELECT setval('db_content_access_event_content_access_event_id_seq', (SELECT max(content_access_event_id) FROM db_content_access_event))");
}

// 资源与案例的基线是数据集不变量（12／10 行），写死；对不上就是数据集变了或有残渣。
// 存取事件不同：它是 append-only 的事件表，别的探针与别的轮次也在往里写，所以这里
// 只钉「本探针收走了自己加的那几行」—— 拿开工时的行数当基线，不去管别人留下的。
const started = { resources: 12, cases: 10, events: null };

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
      console.log(`清理后：db_resource=${after.resources}，db_case=${after.cases}，db_content_access_event=${after.events}`);
    } catch (err) {
      check(`清理失败，数据库可能残留了行：${err.message}`, false);
    }
    await db.end().catch(() => {});
    sb.report();
  });
