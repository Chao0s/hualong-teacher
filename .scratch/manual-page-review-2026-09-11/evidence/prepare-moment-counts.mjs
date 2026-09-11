// 仅当前本地测试库：保留前两行1次/0次，其余补齐2次；不删除已有活动或提交。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { DB_URL, testdataPath } from '../../../tools/lib/testdata-path.mjs';
import { installWxStub } from '../../../tools/lib/wx-stub.mjs';

const require = createRequire(import.meta.url);
const config = require('../../../miniprogram/config');
assert.equal(config.env.name, 'testdata');
assert.ok(['127.0.0.1','localhost'].includes(new URL(config.env.baseUrl).hostname));
assert.match(new URL(DB_URL).pathname, /test/i);
installWxStub();
const guard = require('../../../miniprogram/utils/guard');
const api = require('../../../miniprogram/utils/request');
const { Client } = require(resolve(testdataPath(), 'node_modules/pg'));
const db = new Client(DB_URL);
await db.connect();
let committed = false;
try {
  const dbName = (await db.query('SELECT current_database() AS name')).rows[0].name;
  assert.match(dbName, /test/i);
  const health = await (await fetch(`${config.env.baseUrl}/_health`)).json();
  await guard.requireSession();
  const before = await api.get('/home-school/progress');
  assert.ok(before.children.length >= 3);
  const identity = (await db.query('SELECT school_id,class_id FROM db_teacher WHERE teacher_id=$1', [config.devSubjectId])).rows[0];
  const targetCounts = before.children.map((child, i) => ({
    childId: child.child_id, count: i === 0 ? 1 : i === 1 ? 0 : 2,
  }));
  const differences = before.children.map((child,i) => targetCounts[i].count - child.moment_weekly_complete_count);
  assert.ok(differences.every((n) => n >= 0), 'this additive fixture never removes existing activity associations');
  assert.equal(before.children[0].moment_weekly_complete_count,1,'first row must already have one activity');
  assert.equal(before.children[1].moment_weekly_complete_count,0,'second row must already have no activity');

  await db.query('BEGIN');
  const term = (await db.query('SELECT term_id FROM db_school_term WHERE school_id=$1 AND start_date<=$2::date AND end_date>=$2::date', [identity.school_id, health.today])).rows;
  assert.equal(term.length,1,'fixture date must be inside the current test term');
  const made=[];
  for (let round=1;round<=Math.max(...differences);round++) {
    const children=targetCounts.filter((_,i)=>differences[i]>=round).map((r)=>r.childId);
    const row=(await db.query(`
      INSERT INTO db_moment(school_id,class_id,teacher_id,moment_title,moment_content,moment_date,week_key,publish_status,published_at)
      VALUES($1,$2,$3,$4,$5,$6::date,to_char($6::date,'IYYY-"W"IW'),'s3',CURRENT_TIMESTAMP)
      RETURNING moment_id`, [identity.school_id,identity.class_id,config.devSubjectId,
      `进度审核样例${round}`, '用于人工核对本周0次、1次和2次进度。测试内容。', health.today])).rows[0];
    const inserted=await db.query(`
      INSERT INTO db_moment_upload(moment_id,child_id,uploaded_at)
      SELECT $1,ch.child_id,CURRENT_TIMESTAMP FROM db_child ch
      WHERE ch.child_id=ANY($2::int[]) AND ch.school_id=$3 AND ch.class_id=$4 AND ch.enrollment_status='e1'`,
      [row.moment_id,children,identity.school_id,identity.class_id]);
    assert.equal(inserted.rowCount,children.length);
    made.push({momentId:row.moment_id,childIds:children});
  }
  const actual=(await db.query(`
    SELECT ch.child_id,count(DISTINCT m.moment_id)::int AS count
    FROM db_child ch LEFT JOIN db_moment_upload mu ON mu.child_id=ch.child_id
    LEFT JOIN db_moment m ON m.moment_id=mu.moment_id AND m.class_id=$1 AND m.school_id=$2 AND m.publish_status='s3' AND m.week_key=$3
    WHERE ch.class_id=$1 AND ch.school_id=$2 AND ch.enrollment_status='e1'
    GROUP BY ch.child_id ORDER BY ch.child_id`,[identity.class_id,identity.school_id,before.week_key])).rows;
  assert.deepEqual(actual.map((r)=>[r.child_id,r.count]),targetCounts.map((r)=>[r.childId,r.count]));
  const record={database:dbName,teacherId:config.devSubjectId,...identity,today:health.today,weekKey:before.week_key,
    created:made,targets:targetCounts,beforeCounts:before.children.map((r)=>({childId:r.child_id,count:r.moment_weekly_complete_count})),
    beforeMetrics:{child_count:before.child_count,average_completion:before.average_completion,reminder_count:before.reminder_count}};
  // 先保存新增ID以便日后精确撤除；没有修改任何既有记录。
  const evidence = new URL('./moment-counts.local.json', import.meta.url);
  if(made.length) writeFileSync(evidence, JSON.stringify({...record,state:'prepared'},null,2)+'\n');
  await db.query('COMMIT');
  committed=true;
  if(made.length) writeFileSync(evidence, JSON.stringify({...record,state:'committed'},null,2)+'\n');
  const after=await api.get('/home-school/progress');
  assert.deepEqual(after.children.map((r)=>r.moment_weekly_complete_count),targetCounts.map((r)=>r.count));
  assert.deepEqual(after.children.map((r)=>r.moment_status),targetCounts.map((r)=>r.count>=2?'h1':'h2'));
  assert.deepEqual(after.children.map((r)=>r.parent_task_status),before.children.map((r)=>r.parent_task_status));
  const complete=after.children.reduce((n,r)=>n+Number(r.moment_status==='h1')+Number(r.parent_task_status==='h1'),0);
  assert.equal(after.average_completion,Math.round(complete*10000/(after.child_count*2))/100);
  assert.equal(after.reminder_count,after.children.filter((r)=>r.moment_status==='h2'||r.parent_task_status==='h2').length);
  const weekly = await api.get('/moments/weekly-coverage');
  assert.deepEqual(weekly.items.map((r)=>r.covered_count),targetCounts.map((r)=>r.count));
  console.log(JSON.stringify({created:made,week:after.week_key,rows:after.children.map((r)=>({childId:r.child_id,count:r.moment_weekly_complete_count,momentStatus:r.moment_status,parentStatus:r.parent_task_status})),metrics:{child_count:after.child_count,average_completion:after.average_completion,reminder_count:after.reminder_count}}));
} catch (err) {
  if(!committed) await db.query('ROLLBACK');
  throw err;
} finally {
  await db.end();
}
