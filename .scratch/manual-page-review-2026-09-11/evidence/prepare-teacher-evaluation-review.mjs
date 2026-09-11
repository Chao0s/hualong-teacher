/** 本地测试库：准备6种教师评价状态，完成项有真实业务记录与题项可读。 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {DB_URL,testdataPath} from '../../../tools/lib/testdata-path.mjs';
import {installWxStub} from '../../../tools/lib/wx-stub.mjs';
const require=createRequire(import.meta.url);
const config=require('../../../miniprogram/config');
const pos=process.argv.indexOf('--base');
if(pos>=0) config.env.baseUrl=process.argv[pos+1];
assert.equal(config.env.name,'testdata');
assert.ok(['127.0.0.1','localhost'].includes(new URL(config.env.baseUrl).hostname));
assert.match(new URL(DB_URL).pathname,/test/i);
installWxStub();
const guard=require('../../../miniprogram/utils/guard');
const api=require('../../../miniprogram/utils/request');
const {Client}=require(resolve(testdataPath(),'node_modules/pg'));
const {teacherEvaluationProgress}=await import(pathToFileURL(resolve(testdataPath(),'server/routes/teacher-evaluation.mjs')));
const db=new Client(DB_URL);await db.connect();
let committed=false;
try {
  assert.match((await db.query('SELECT current_database() AS name')).rows[0].name,/test/i);
  await guard.requireSession();
  const health=await(await fetch(config.env.baseUrl+'/_health')).json();
  const identity=(await db.query('SELECT teacher_id,school_id,class_id FROM db_teacher WHERE teacher_id=$1',[config.devSubjectId])).rows[0];
  const ctx={scope:{derived:identity},config:{today:health.today}};
  const query=async(sql,args)=>(await db.query(sql,args)).rows[0];
  const summaryBefore=await api.get('/home-school/progress');
  const recordBefore=await api.get('/growth-records');
  const before=await teacherEvaluationProgress(ctx,query);
  assert.ok(before.term_id&&before.items.length>=6);
  const children=before.items.slice(0,6).map(r=>r.child_id);
  const cases=[[true,true,true,true],[false,false,false,false],[true,false,false,false],
    [false,true,false,false],[false,false,true,false],[false,false,false,true]];
  const fields=['month_eval_status','term_eval_status','comprehensive_status','message_status'];
  for(let i=0;i<6;i++) for(let j=0;j<4;j++) {
    if(!cases[i][j]) assert.equal(before.items[i][fields[j]],'h2','fixture never deletes or reverses a completed item');
  }
  await db.query('BEGIN');
  const originals={
    month:(await db.query('SELECT * FROM db_month_eval WHERE teacher_id=$1 AND eval_month=$2 AND child_id=ANY($3::int[])',[identity.teacher_id,before.eval_month,children])).rows,
    term:(await db.query('SELECT * FROM db_term_eval WHERE teacher_id=$1 AND term_id=$2 AND child_id=ANY($3::int[])',[identity.teacher_id,before.term_id,children])).rows,
    comp:(await db.query('SELECT * FROM db_child_assessment WHERE term_id=$1 AND child_id=ANY($2::int[])',[before.term_id,children])).rows,
    message:(await db.query('SELECT * FROM db_teacher_message WHERE term_id=$1 AND child_id=ANY($2::int[])',[before.term_id,children])).rows,
  };
  assert.equal(originals.month.length,6);assert.equal(originals.term.length,6);assert.equal(originals.comp.length,6);
  const backup=new URL('./teacher-evaluation.local.json',import.meta.url);
  if(!existsSync(backup)) writeFileSync(backup,JSON.stringify({identity,month:before.eval_month,term:before.term_id,originals},null,2)+'\n');
  else {
    const saved=JSON.parse(readFileSync(backup,'utf8'));
    assert.equal(saved.term,before.term_id);assert.equal(saved.identity.teacher_id,identity.teacher_id);
  }
  const created={scores:[],messages:[]};
  for(let i=0;i<6;i++) {
    const childId=children[i],done=cases[i];
    if(done[0]) await db.query(`UPDATE db_month_eval SET month_eval_status='e3',saved_at=$1::date+interval '12 hours'
      WHERE child_id=$2 AND teacher_id=$3 AND class_id=$4 AND eval_month=$5 AND month_eval_status<>'e3'`,
      [health.today,childId,identity.teacher_id,identity.class_id,before.eval_month]);
    if(done[1]) await db.query(`UPDATE db_term_eval SET term_eval_status='c1',eval_text=COALESCE(eval_text,'教师评价进度审核样例'),submitted_at=$1::date+interval '12 hours'
      WHERE child_id=$2 AND teacher_id=$3 AND class_id=$4 AND term_id=$5 AND term_eval_status='c2'`,
      [health.today,childId,identity.teacher_id,identity.class_id,before.term_id]);
    if(done[2]) {
      const a=originals.comp.find(r=>r.child_id===childId);
      const inserted=await db.query(`INSERT INTO db_child_assessment_item(child_assessment_id,item_id,score)
        SELECT $1,item_id,3 FROM db_scale_item WHERE scale_code=$2 AND scale_version=$3
        ON CONFLICT(child_assessment_id,item_id) DO NOTHING RETURNING child_assessment_item_id`,[a.child_assessment_id,a.scale_code,a.scale_version]);
      created.scores.push(...inserted.rows.map(r=>r.child_assessment_item_id));
      const count=Number((await query('SELECT count(*) AS n FROM db_child_assessment_item WHERE child_assessment_id=$1',[a.child_assessment_id])).n);
      assert.equal(count,a.required_count,'completion requires every actual scale item');
      await db.query("UPDATE db_child_assessment SET completed_count=$1,child_assessment_status='c1',submitted_at=COALESCE(submitted_at,$2::date+interval '12 hours') WHERE child_assessment_id=$3",[count,health.today,a.child_assessment_id]);
    }
    if(done[3]) {
      const added=await db.query(`INSERT INTO db_teacher_message(school_id,class_id,child_id,teacher_id,term_id,content)
        VALUES($1,$2,$3,$4,$5,'教师评价进度审核样例：本学期寄语已提交。')
        ON CONFLICT(child_id,term_id) DO NOTHING RETURNING teacher_message_id`,
        [identity.school_id,identity.class_id,childId,identity.teacher_id,before.term_id]);
      created.messages.push(...added.rows.map(r=>r.teacher_message_id));
    }
  }
  const after=await teacherEvaluationProgress(ctx,query);
  assert.deepEqual(after.items.slice(0,6).map(r=>fields.map(f=>r[f]==='h1')),cases);
  assert.deepEqual(after.items.slice(6),before.items.slice(6),'other children unchanged');
  const saved=JSON.parse(readFileSync(backup,'utf8'));
  const history=[...(saved.applications||[]),{created,targets:children.map((id,i)=>({childId:id,completed:cases[i]}))}];
  writeFileSync(backup,JSON.stringify({...saved,applications:history,state:'prepared'},null,2)+'\n');
  await db.query('COMMIT');committed=true;
  writeFileSync(backup,JSON.stringify({...saved,applications:history,state:'committed'},null,2)+'\n');
  assert.deepEqual(await api.get('/home-school/progress'),summaryBefore);
  assert.deepEqual(await api.get('/growth-records'),recordBefore);
  const actual=await api.get('/teacher-evaluations/progress');
  assert.deepEqual(actual,after);
  console.log(JSON.stringify({month:after.eval_month,term:after.term_id,rows:after.items.slice(0,6).map(r=>({childId:r.child_id,completed:fields.map(f=>r[f]==='h1')})),newScores:created.scores.length,newMessages:created.messages.length,otherReviewFixturesUnchanged:true}));
} catch(err) {
  if(!committed) await db.query('ROLLBACK');
  throw err;
} finally {await db.end();}
