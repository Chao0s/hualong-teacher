/** 评价进度：真实数据库→HTTP→service→页面加载／失败恢复。只读测试数据。 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { installWxStub } from './lib/wx-stub.mjs';
import { DB_URL,testdataPath } from './lib/testdata-path.mjs';

installWxStub();
const require=createRequire(import.meta.url);
const config=require('../miniprogram/config');
const arg=process.argv.indexOf('--base');
if(arg>=0) config.env.baseUrl=process.argv[arg+1];
const assess=require('../miniprogram/services/assessment');
const guard=require('../miniprogram/utils/guard');
const session=require('../miniprogram/utils/session');
const api=require('../miniprogram/utils/request');
const {Client}=require(resolve(testdataPath(),'node_modules/pg'));
const db=new Client(DB_URL);
await db.connect();
try {
  await guard.requireSession();
  const term=session.getCurrentTerm()?.term_id;
  assert.ok(term);
  const identity=(await db.query('SELECT school_id,class_id FROM db_teacher WHERE teacher_id=$1',[config.devSubjectId])).rows[0];
  const actual=await api.get('/growth-records');
  const stored=(await db.query('SELECT * FROM db_growth_record WHERE class_id=$1 AND school_id=$2 AND term_id=$3 ORDER BY child_id',[identity.class_id,identity.school_id,term])).rows;
  assert.ok(stored.length,'nonempty test records required');
  assert.deepEqual(actual.items.map(r=>r.growth_record_id),stored.map(r=>r.growth_record_id));
  const fields=['child_id','required_month_count','teacher_month_complete_count','parent_month_complete_count','teacher_term_status','parent_term_status','comprehensive_assessment_status','record_status'];
  const board=await assess.growthRecordBoard();
  assert.deepEqual(board.columns.map(r=>r.key),['parentMonth','parentTerm','teacherMonth','teacherTerm','comprehensive']);
  for(let i=0;i<stored.length;i++) {
    const r=stored[i];
    for(const key of fields) assert.equal(actual.items[i][key],r[key],key);
    const row=board.rows.find(child=>child.childId===r.child_id);
    assert.ok(row);
    assert.deepEqual(row.states,[
      r.required_month_count>0&&r.parent_month_complete_count>=r.required_month_count,
      r.parent_term_status==='c1',
      r.required_month_count>0&&r.teacher_month_complete_count>=r.required_month_count,
      r.teacher_term_status==='c1',
      r.comprehensive_assessment_status==='c1',
    ].map(done=>done?'done':'miss'));
  }
  let definition;
  globalThis.Page=page=>{definition=page;};
  require('../miniprogram/pages/growth-record/index');
  const page={...definition,data:structuredClone(definition.data),setData(update){Object.assign(this.data,update);}};
  await page.refresh();
  assert.equal(page.data.loading,false);
  assert.deepEqual(page.data.rows,board.rows);
  const original=assess.growthRecordBoard;
  assess.growthRecordBoard=async()=>{throw new Error('probe failure');};
  await page.refresh();
  assert.equal(page.data.error,'probe failure');
  assert.equal(page.data.loading,false);
  assert.deepEqual(page.data.rows,[],'failed read cannot retain old progress');
  assess.growthRecordBoard=async()=>({columns:board.columns,rows:[]});
  await page.refresh();
  assert.equal(page.data.error,'');
  assert.deepEqual(page.data.rows,[],'empty roster is distinct from request failure');
  // 旧请求晚返回不能覆盖新进度。
  let releaseOld,started;
  const reached=new Promise(resolve=>{started=resolve;});
  assess.growthRecordBoard=()=>new Promise(resolve=>{releaseOld=resolve;started();});
  const old=page.refresh();
  await reached;
  assess.growthRecordBoard=original;
  await page.refresh();
  releaseOld({columns:[],rows:[]});
  await old;
  assert.deepEqual(page.data.rows,board.rows);
  assert.equal(page.data.error,'');
  console.log(`PASS: ${stored.length} database records, HTTP fields, five-column mapping, page reload/error/empty/recovery and stale response protection. UI rendering remains manual.`);
} finally { await db.end(); }
