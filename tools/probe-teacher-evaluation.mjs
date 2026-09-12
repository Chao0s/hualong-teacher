/** 教师评价总览真实HTTP与四个子页一致性；不修改业务记录。 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {installWxStub} from './lib/wx-stub.mjs';
installWxStub();
const require=createRequire(import.meta.url);
const config=require('../miniprogram/config');
const p=process.argv.indexOf('--base');if(p>=0) config.env.baseUrl=process.argv[p+1];
const guard=require('../miniprogram/utils/guard');
const session=require('../miniprogram/utils/session');
const api=require('../miniprogram/utils/request');
const assess=require('../miniprogram/services/assessment');
const co=require('../miniprogram/services/co-education');
const path='/teacher-evaluations/progress';
assert.equal((await fetch(config.env.baseUrl+path)).status,401);
await guard.requireSession();
const raw=await api.get(path);
assert.ok(raw.items.length);
assert.equal(raw.term_id,session.getCurrentTerm().term_id);
const board=await assess.teacherEvaluationBoard();
const [monthly,term,comp,message]=await Promise.all([
  co.monthEvalBoard({month:raw.eval_month}),assess.termEvaluationBoard(),assess.childAssessmentProgress(),assess.messageBoard(),
]);
for(const row of board.rows) {
  const find=b=>b.rows.find(r=>r.childId===row.childId);
  const expected=[find(monthly)?.states[0]==='done',find(term)?.done,find(comp)?.done,find(message)?.done];
  assert.deepEqual(row.states,expected.map(done=>done?'done':'miss'));
  // 完成项有真实详情可读取。
  if(expected[0]) assert.equal((await co.monthEvalRow({childId:row.childId,month:raw.eval_month})).status,'e3');
  if(expected[1]) assert.ok((await assess.getTermEvaluation(row.childId)).text);
  if(expected[3]) assert.ok(await assess.getTeacherMessage(row.childId));
}
const original=await api.get(path);
assert.deepEqual(await api.get(path,{query:{class_id:2,teacher_id:2,term_id:'1999-2000-1'}}),original);
await assert.rejects(()=>api.get(path,{query:{eval_month:'1999-01'}}),err=>err.code==='validation_failed');
for(const month of raw.month_options) {
  const selected=await assess.teacherEvaluationBoard({month});
  const matrix=await co.monthEvalBoard({month});
  assert.equal(selected.month,month);
  for(const row of selected.rows) assert.equal(row.states[0],matrix.rows.find(r=>r.childId===row.childId)?.states[0] || 'miss');
}
const login=await fetch(config.env.baseUrl+'/dev/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({surface:'parent',subject_id:1})});
assert.equal(login.status,201);
const parent=await login.json();
assert.equal((await fetch(config.env.baseUrl+path,{headers:{Authorization:`Bearer ${parent.token}`}})).status,403);
let definition;globalThis.Page=x=>{definition=x;};require('../miniprogram/pages/teacher-evaluation/index');
const page={...definition,data:structuredClone(definition.data),setData(x){Object.assign(this.data,x);}};
await page.refresh();assert.deepEqual(page.data.rows,board.rows);
const load=assess.teacherEvaluationBoard;
assess.teacherEvaluationBoard=async()=>{throw new Error('probe failure');};
await page.refresh();assert.equal(page.data.error,'probe failure');assert.deepEqual(page.data.rows,[]);
assess.teacherEvaluationBoard=async()=>({termId:null,month:raw.eval_month,monthOptions:[],rows:[]});
await page.refresh();assert.equal(page.data.error,'');assert.equal(page.data.termId,null);
assess.teacherEvaluationBoard=load;
await page.refresh();assert.deepEqual(page.data.rows,board.rows);
console.log(`PASS: ${board.rows.length} children; four underlying page states/details, scope, authentication, reload/error/recovery. Rendering remains manual.`);
