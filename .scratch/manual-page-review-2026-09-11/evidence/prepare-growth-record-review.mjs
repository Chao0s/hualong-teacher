/** 本地测试库的评价进度显示样本；只改6条汇总记录，不伪造评价正文。 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DB_URL, testdataPath } from '../../../tools/lib/testdata-path.mjs';
import { installWxStub } from '../../../tools/lib/wx-stub.mjs';

const require=createRequire(import.meta.url);
const config=require('../../../miniprogram/config');
assert.equal(config.env.name,'testdata');
assert.ok(['127.0.0.1','localhost'].includes(new URL(config.env.baseUrl).hostname));
assert.match(new URL(DB_URL).pathname,/test/i);
installWxStub();
const guard=require('../../../miniprogram/utils/guard');
const api=require('../../../miniprogram/utils/request');
const session=require('../../../miniprogram/utils/session');
const assess=require('../../../miniprogram/services/assessment');
const {Client}=require(resolve(testdataPath(),'node_modules/pg'));
const db=new Client(DB_URL);
await db.connect();
try {
  await guard.requireSession();
  const term=session.getCurrentTerm();
  assert.ok(term?.term_id,'active test term required');
  assert.match((await db.query('SELECT current_database() AS name')).rows[0].name,/test/i);
  const identity=(await db.query('SELECT school_id,class_id FROM db_teacher WHERE teacher_id=$1',[config.devSubjectId])).rows[0];
  const overviewBefore=await api.get('/home-school/progress');
  await db.query('BEGIN');
  const originals=(await db.query(`SELECT g.* FROM db_growth_record g JOIN db_child ch ON ch.child_id=g.child_id
    WHERE g.school_id=$1 AND g.class_id=$2 AND g.term_id=$3 AND ch.class_id=$2 AND ch.enrollment_status='e1'
    ORDER BY g.child_id LIMIT 6 FOR UPDATE OF g`,[identity.school_id,identity.class_id,term.term_id])).rows;
  assert.equal(originals.length,6,'six existing current-term test records required');
  const backup=new URL('./growth-records.local.json',import.meta.url);
  if(!existsSync(backup)) {
    writeFileSync(backup,JSON.stringify({teacherId:config.devSubjectId,...identity,termId:term.term_id,originals},null,2)+'\n');
  } else {
    const old=JSON.parse(readFileSync(backup,'utf8'));
    assert.equal(old.termId,term.term_id);
    assert.equal(old.class_id,identity.class_id);
    assert.deepEqual(old.originals.map((r)=>r.growth_record_id),originals.map((r)=>r.growth_record_id));
  }
  // 顺序：家长月度、家长学期、教师月度、教师学期、综合。
  const cases=[
    [true,true,true,true,true],
    [false,false,false,false,false],
    [true,false,false,false,false],
    [false,false,true,false,false],
    [false,true,false,true,false],
    [false,false,false,false,true],
  ];
  for(let i=0;i<originals.length;i++) {
    const r=originals[i],done=cases[i];
    const need=r.required_month_count;
    assert.ok(need>0,'preserve the database-required month count');
    const partial=i===1?0:Math.max(0,need-1);
    const parentCount=done[0]?need:partial;
    const teacherCount=done[2]?need:partial;
    const recordDone=done[0]&&done[2]&&(!r.is_term_end||(done[1]&&done[3]&&done[4]));
    const changed=await db.query(`UPDATE db_growth_record
      SET parent_month_complete_count=$1,parent_term_status=$2,teacher_month_complete_count=$3,
          teacher_term_status=$4,comprehensive_assessment_status=$5,record_status=$6
      WHERE growth_record_id=$7 AND school_id=$8 AND class_id=$9 AND term_id=$10`,
      [parentCount,done[1]?'c1':'c2',teacherCount,done[3]?'c1':'c2',done[4]?'c1':'c2',recordDone?'c1':'c2',r.growth_record_id,identity.school_id,identity.class_id,term.term_id]);
    assert.equal(changed.rowCount,1);
  }
  await db.query('COMMIT');
  const response=await api.get('/growth-records');
  const board=await assess.growthRecordBoard();
  for(let i=0;i<originals.length;i++) {
    const r=originals[i];
    const row=board.rows.find((child)=>child.childId===r.child_id);
    assert.deepEqual(row.states,cases[i].map((done)=>done?'done':'miss'));
    assert.ok(response.items.some((child)=>child.growth_record_id===r.growth_record_id));
  }
  assert.deepEqual(await api.get('/home-school/progress'),overviewBefore,'the moment/parent-task review fixture stays unchanged');
  console.log(JSON.stringify({term:term.term_id,updated:originals.map((r,i)=>({row:i+1,childId:r.child_id,requiredMonths:r.required_month_count,completed:cases[i]})),classRows:board.rows.length,overviewUnchanged:true}));
} catch(err) {
  await db.query('ROLLBACK');
  throw err;
} finally { await db.end(); }
