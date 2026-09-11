/** 教师家园总览：真实HTTP+客户端接线+独立数据库比对。只读业务数据。 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { installWxStub } from './lib/wx-stub.mjs';
import { testdataPath, DB_URL } from './lib/testdata-path.mjs';

installWxStub();
const require = createRequire(import.meta.url);
const config = require('../miniprogram/config');
const baseArg = process.argv.indexOf('--base');
if (baseArg >= 0) config.env.baseUrl = process.argv[baseArg + 1];
const base = config.env.baseUrl;
const co = require('../miniprogram/services/co-education');
const guard = require('../miniprogram/utils/guard');
const session = require('../miniprogram/utils/session');
const { Client } = require(resolve(testdataPath(),'node_modules/pg'));
const db = new Client(DB_URL);
const unwrap = (body) => body.data ?? body;
const fetchProgress = (token, query='') => fetch(`${base}/home-school/progress${query}`, {
  headers: token ? { Authorization:`Bearer ${token}` } : {},
});
await db.connect();
try {
  assert.equal((await fetchProgress()).status,401);
  await guard.requireSession();
  const raw = await fetchProgress(session.getToken());
  assert.equal(raw.status,200);
  assert.equal(raw.headers.get('cache-control'),'no-store');
  const body = unwrap(await raw.json());
  const { rows:[teacher] } = await db.query('SELECT school_id,class_id FROM db_teacher WHERE teacher_id=$1',[config.devSubjectId]);
  const children = (await db.query("SELECT child_id FROM db_child WHERE class_id=$1 AND school_id=$2 AND enrollment_status='e1' ORDER BY child_id",[teacher.class_id,teacher.school_id])).rows;
  assert.ok(children.length, 'test teacher needs nonempty roster');
  assert.deepEqual(body.children.map((r)=>r.child_id),children.map((r)=>r.child_id));
  const tasks = (await db.query("SELECT parent_task_id FROM db_parent_task WHERE school_id=$1 AND class_id=$2 AND publish_status IN ('s2','s3') AND published_at<=NOW() ORDER BY published_at DESC,parent_task_id DESC LIMIT 1",[teacher.school_id,teacher.class_id])).rows;
  assert.equal(body.latest_parent_task_id,tasks[0]?.parent_task_id ?? null);
  let completed=0, reminded=0;
  for (const row of body.children) {
    const count = Number((await db.query("SELECT count(DISTINCT m.moment_id) AS n FROM db_moment m JOIN db_moment_upload u USING(moment_id) WHERE u.child_id=$1 AND m.class_id=$2 AND m.school_id=$3 AND m.publish_status='s3' AND m.week_key=$4",[row.child_id,teacher.class_id,teacher.school_id,body.week_key])).rows[0].n);
    const submitted = (await db.query("SELECT 1 FROM db_parent_task_submission WHERE child_id=$1 AND parent_task_id=$2 AND submission_status='c1'",[row.child_id,body.latest_parent_task_id])).rowCount>0;
    assert.equal(row.moment_weekly_complete_count,count);
    assert.equal(row.moment_status,count>=2?'h1':'h2');
    assert.equal(row.parent_task_status,submitted?'h1':'h2');
    assert.deepEqual(Object.keys(row).sort(),['child_id','child_name','moment_weekly_complete_count','moment_status','parent_task_status'].sort());
    completed+=Number(count>=2)+Number(submitted);
    reminded+=Number(count<2||!submitted);
  }
  assert.equal(body.child_count,children.length);
  assert.equal(body.average_completion,Math.round(completed*10000/(children.length*2))/100);
  assert.equal(body.reminder_count,reminded);
  const spoof = unwrap(await (await fetchProgress(session.getToken(),'?class_id=2&school_id=999&week_key=1999-W01')).json());
  assert.deepEqual(spoof,body,'client query cannot choose another class or week');

  const login = await fetch(`${base}/dev/session`, { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({surface:'parent',subject_id:1}) });
  assert.equal(login.status,201);
  const parent = unwrap(await login.json());
  assert.equal((await fetchProgress(parent.token)).status,403);

  const mapped = await co.homeSchoolProgress();
  assert.equal(mapped.rows.length,body.child_count);
  assert.deepEqual(mapped.metrics.map((r)=>r.value),[String(body.child_count),`${body.average_completion}%`,String(body.reminder_count)]);
  for (let i=0;i<mapped.rows.length;i++) {
    assert.equal(mapped.rows[i].cells.length,2);
    assert.deepEqual(mapped.rows[i].cells.map((c)=>c.state),[body.children[i].moment_status,body.children[i].parent_task_status].map((s)=>s==='h1'?'done':'miss'));
  }
  let definition;
  globalThis.Page = (page) => { definition=page; };
  require('../miniprogram/pages/home-school/index');
  const page = { ...definition,data:structuredClone(definition.data),setData(update){Object.assign(this.data,update);} };
  await page.load();
  assert.equal(page.data.loading,false);
  assert.equal(page.data.rows.length,body.child_count);
  const original=co.homeSchoolProgress;
  co.homeSchoolProgress=async()=>{throw new Error('probe failure');};
  await page.load();
  assert.equal(page.data.error,'probe failure');
  assert.deepEqual(page.data.rows,[]);
  assert.deepEqual(page.data.metrics,[]);
  co.homeSchoolProgress=original;
  await page.load();
  assert.equal(page.data.error,'');
  assert.equal(page.data.rows.length,body.child_count);
  console.log(`PASS: HTTP authorization/scope, ${body.child_count} roster rows and both computed states, metrics, client mapping, page reload/error/recovery. No UI rendering tested.`);
} finally {
  await db.end();
}
