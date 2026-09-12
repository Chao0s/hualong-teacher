/** 为05人工选片检查准备空月评格与真实相册照片，不写月评、不改已有记录。 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {installWxStub} from '../../../tools/lib/wx-stub.mjs';
import {DB_URL,testdataPath} from '../../../tools/lib/testdata-path.mjs';
installWxStub();
const require=createRequire(import.meta.url);
const co=require('../../../miniprogram/services/co-education');
const auth=require('../../../miniprogram/utils/auth');
const guard=require('../../../miniprogram/utils/guard');
const time=require('../../../miniprogram/utils/time');
const {Client}=require(resolve(testdataPath(),'node_modules/pg'));
assert.match(new URL(DB_URL).pathname,/test/i);
const db=new Client(DB_URL);await db.connect();
const manifest=new URL('./monthly-draft-review.local.json',import.meta.url);
let created;
try {
  await guard.requireSession();const ctx=await auth.refreshContext();
  const source=JSON.parse(await readFile(new URL('./monthly-photo-review.local.json',import.meta.url),'utf8'));
  const months=time.wholeMonthsOfTerm(ctx.current_term.start_date,ctx.current_term.end_date);
  const target=(await db.query(`SELECT ch.child_id,ch.child_name,m.month FROM db_child ch CROSS JOIN unnest($1::text[]) m(month)
    WHERE ch.class_id=$2 AND ch.enrollment_status='e1' AND NOT EXISTS(
      SELECT 1 FROM db_month_eval me WHERE me.child_id=ch.child_id AND me.teacher_id=$3 AND me.eval_month=m.month)
    ORDER BY m.month,ch.child_id LIMIT 1`,[months,ctx.scope.class_id,ctx.subject.teacher_id])).rows[0];
  assert.ok(target,'No empty monthly cell; never overwrite existing evaluations');
  const before=await co.weeklyCoverage();
  const record=await co.publish({title:'月评选片审核用图',content:'用于教师端检查真实横竖图选片与草稿保存。',
    date:ctx.current_term.start_date,childIds:[target.child_id],fileIds:source.fileIds});
  created=record.moment_id;
  const album=await co.listMoments({childId:target.child_id,limit:100});
  const entry=album.items.find(m=>m.id===created);assert.ok(entry);
  assert.deepEqual(entry.fileIds,source.fileIds);
  for(const fileId of entry.fileIds) {
    const url=await co.photoUrl(fileId,entry.photoOwner);assert.match(url,/\/_media\//);
    const response=await fetch(url);assert.equal(response.status,200);await response.arrayBuffer();
  }
  assert.equal(await co.monthEvalRow({childId:target.child_id,month:target.month}),null);
  assert.deepEqual(await co.weeklyCoverage(),before,'current week is unchanged');
  await writeFile(manifest,JSON.stringify({childId:target.child_id,childName:target.child_name,month:target.month,
    momentId:created,fileIds:source.fileIds,weekKey:entry.weekKey,sourceDate:ctx.current_term.start_date},null,2));
  console.log(`Prepared empty ${target.month} monthly cell for child_id=${target.child_id}; true-photo source moment=${created}, week=${entry.weekKey}. No monthly evaluation was written; current weekly counts unchanged.`);
  created=null;
} finally {
  try {if(created)await co.remove(created);} finally {await db.end();}
}
