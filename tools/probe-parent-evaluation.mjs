/** Real session date and replies. --write additionally verifies publishing, cleaning only its own rows. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {installWxStub} from './lib/wx-stub.mjs';
import {testdataPath,DB_URL} from './lib/testdata-path.mjs';
installWxStub();
const require=createRequire(import.meta.url);
const co=require('../miniprogram/services/co-education');
const auth=require('../miniprogram/utils/auth');
const guard=require('../miniprogram/utils/guard');
const time=require('../miniprogram/utils/time');
const {Client}=require(resolve(testdataPath(),'node_modules/pg'));
assert.match(new URL(DB_URL).pathname,/test/i);
let definition;globalThis.Page=p=>{definition=p;};
function page(path) {
  require(path);return {...definition,data:structuredClone(definition.data),setData(values,callback){Object.assign(this.data,values);if(callback)callback();}};
}
const task=page('../miniprogram/pages/parent-task-publish/index');
const evaluation=page('../miniprogram/pages/parent-evaluation-publish/index');
const db=new Client(DB_URL);await db.connect();
const originalNow=Date.now;
const write=process.argv.includes('--write');
const probeTitle=`Parent evaluation probe ${randomUUID()}\nSecond line`;
let selectedPeriod,scope;
try {
  await guard.requireSession();const context=await auth.refreshContext();
  scope=context.scope;
  Date.now=()=>Date.UTC(2099,8,12,4);
  await task.onLoad({});assert.equal(task.data.error,'');assert.equal(task.data.startDate,context.school_today);
  await evaluation.refresh();assert.equal(evaluation.data.failed,'');
  assert.equal(evaluation.data.period,context.school_today.slice(0,7));
  assert.equal(evaluation.data.startDate,context.school_today);
  assert.equal(evaluation.data.dueDate,time.addLocalDays(context.school_today,7));
  evaluation.onTypeChange({detail:{value:1}});
  assert.equal(evaluation.data.period,context.current_term.term_id);
  evaluation.onTypeChange({detail:{value:0}});
  assert.equal(evaluation.data.period,context.school_today.slice(0,7));
  evaluation.onMonthChange({detail:{value:'2026-05'}});
  assert.equal(evaluation.data.period,'2026-05');assert.ok(evaluation.data.title.includes('2026年5月'));
  const customTitle='Custom title\nSecond line';
  evaluation.onTitleInput({detail:{value:customTitle}});
  evaluation.onDueDate({detail:{value:'2026-05-10'}});
  evaluation.onMonthChange({detail:{value:'2026-06'}});
  assert.equal(evaluation.data.title,customTitle);assert.equal(evaluation.data.dueDate,'2026-05-10');
  evaluation.onTypeChange({detail:{value:1}});
  assert.equal(evaluation.data.period,context.current_term.term_id);
  evaluation.onTypeChange({detail:{value:0}});assert.equal(evaluation.data.period,'2026-06');
  await evaluation.refresh();assert.equal(evaluation.data.period,'2026-06');assert.equal(evaluation.data.title,customTitle);
  evaluation.onMonthChange({detail:{value:'2026-13'}});assert.equal(evaluation.data.period,'2026-06');
  Date.now=originalNow;
  const counts=(await db.query(`SELECT evaluation_type,evaluation_period,count(*)::int AS total,
    count(*) FILTER(WHERE evaluation_status='p2')::int AS done
    FROM db_parent_evaluation WHERE class_id=$1 GROUP BY evaluation_type,evaluation_period`,[context.scope.class_id])).rows;
  for(const group of evaluation.data.history) {
    const expected=counts.find(r=>r.evaluation_type===group.type&&r.evaluation_period===group.period);
    assert.ok(expected);assert.equal(group.total,expected.total);assert.equal(group.done,expected.done);
  }
  assert.equal(evaluation.data.history.length,counts.length,'history includes every period in this fixture');
  const board=await co.listParentEvaluations({limit:100});
  let submitted=0,unsubmitted=0;
  for(const row of board.rows) {
    const detail=await co.getParentEvaluation(row.id);
    assert.equal(detail.childId,row.childId);assert.equal(detail.period,row.period);assert.equal(detail.type,row.type);
    const stored=(await db.query('SELECT evaluation_text,evaluation_status FROM db_parent_evaluation WHERE parent_evaluation_id=$1',[row.id])).rows[0];
    if(stored.evaluation_status==='p2') {assert.equal(detail.text,stored.evaluation_text||'');submitted++;}
    else {assert.equal(detail.text,'','unsubmitted family draft stays hidden');unsubmitted++;}
  }
  assert.ok(submitted>0&&unsubmitted>0,'manual review has both kinds of sample');
  console.log(`PASS: server date overrides device clock; monthly/term switching; ${counts.length} history groups match DB; ${submitted} submitted and ${unsubmitted} unsubmitted replies verified. No business rows written.`);
  console.log('Available periods: '+evaluation.data.history.map(g=>`${g.type}/${g.period}: ${g.done}/${g.total} submitted`).join('; '));
  if(write) {
    const candidates=Array.from({length:12},(_,i)=>`2099-${String(i+1).padStart(2,'0')}`);
    const occupied=(await db.query("SELECT DISTINCT evaluation_period FROM db_parent_evaluation WHERE class_id=$1 AND evaluation_type='t1'",[scope.class_id])).rows.map(r=>r.evaluation_period);
    selectedPeriod=candidates.find(p=>!occupied.includes(p));assert.ok(selectedPeriod,'need an unused isolated month');
    evaluation.onMonthChange({detail:{value:selectedPeriod}});
    evaluation.onTitleInput({detail:{value:probeTitle}});
    evaluation.onPromptInput({detail:{value:'Original activity requirements'}});
    const before=(await db.query('SELECT count(*)::int n FROM db_parent_evaluation')).rows[0].n;
    const roster=(await db.query("SELECT child_id FROM db_child WHERE class_id=$1 AND enrollment_status='e1' ORDER BY child_id",[scope.class_id])).rows.map(r=>r.child_id);
    let confirm=false;const modals=[],toasts=[],posts=[];
    wx.showModal=o=>{modals.push(o);o.success?.({confirm,cancel:!confirm});};
    wx.showToast=o=>toasts.push(o.title);
    const request=wx.request;
    wx.request=o=>{if(o.method==='POST'&&o.url.endsWith('/home-school/parent-evaluations'))posts.push(o.data);return request(o);};
    await evaluation.onPublish();assert.equal(posts.length,0,'cancel does not write');assert.equal(evaluation.data.publishing,false);
    confirm=true;await Promise.all([evaluation.onPublish(),evaluation.onPublish()]);
    assert.equal(posts.length,1,'duplicate tap sends only one publication');
    assert.equal(posts[0].evaluation_period,selectedPeriod);assert.equal(posts[0].evaluation_title,probeTitle);
    assert.ok(modals.at(-1).content.includes(co.evalPeriodLabelOf(selectedPeriod)),'confirmation includes selected period');
    assert.ok(toasts.some(t=>t.startsWith('已发布')));
    const read=()=>db.query("SELECT parent_evaluation_id,child_id,evaluation_period,evaluation_title,evaluation_prompt,evaluation_status,evaluation_text FROM db_parent_evaluation WHERE class_id=$1 AND evaluation_type='t1' AND evaluation_period=$2 ORDER BY child_id",[scope.class_id,selectedPeriod]);
    const first=(await read()).rows;assert.deepEqual(first.map(r=>r.child_id),roster);
    assert.ok(first.every(r=>r.evaluation_title===probeTitle&&r.evaluation_period===selectedPeriod));
    await db.query("UPDATE db_parent_evaluation SET evaluation_status='p2',evaluation_text='Synthetic submitted reply',submitted_at=NOW() WHERE parent_evaluation_id=$1",[first[0].parent_evaluation_id]);
    const preserved=(await read()).rows;
    evaluation.onPromptInput({detail:{value:'Changed requirements must not replace existing'}});
    await evaluation.onPublish();assert.equal(posts.length,2);
    assert.deepEqual((await read()).rows,preserved,'repeat does not overwrite title, requirements or submitted reply');
    assert.equal((await db.query('SELECT count(*)::int n FROM db_parent_evaluation')).rows[0].n,before+roster.length);
    console.log(`PASS: selected ${selectedPeriod} persisted for ${roster.length} current children; multiline title, cancellation, double-click guard, repeat preserves existing rows and submitted reply.`);
  }
} finally {
  Date.now=originalNow;
  try {
    if(write&&selectedPeriod&&scope) {
      const cleaned=await db.query("DELETE FROM db_parent_evaluation WHERE class_id=$1 AND evaluation_type='t1' AND evaluation_period=$2 AND evaluation_title=$3 RETURNING parent_evaluation_id",[scope.class_id,selectedPeriod,probeTitle]);
      console.log(`Cleaned ${cleaned.rowCount} probe-created rows; existing user evaluations were not changed.`);
    }
  } finally {await db.end();}
}
