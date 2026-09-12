/** Dedicated teacher-only and shared-selection records, without changing previous review selections. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {installWxStub} from '../../../tools/lib/wx-stub.mjs';
import {testdataPath,DB_URL} from '../../../tools/lib/testdata-path.mjs';
installWxStub();const require=createRequire(import.meta.url);
const co=require('../../../miniprogram/services/co-education');const book=require('../../../miniprogram/services/growth-book');
const guard=require('../../../miniprogram/utils/guard');const auth=require('../../../miniprogram/utils/auth');
const {Client}=require(resolve(testdataPath(),'node_modules/pg'));
const manifest=new URL('./family-time-review.local.json',import.meta.url);
let previous;try{previous=JSON.parse(await readFile(manifest,'utf8'));}catch(err){if(err.code!=='ENOENT')throw err;}
if(previous)console.log('Review fixtures already recorded; no selections reset.');
else {
  assert.match(new URL(DB_URL).pathname,/test/i);const db=new Client(DB_URL);await db.connect();
  let taskId,retained=false;const entries=[];
  try {
    await guard.requireSession();const ctx=await auth.refreshContext();const before=await co.homeSchoolProgress();
    const source=JSON.parse(await readFile(new URL('./community-real-photo-review.local.json',import.meta.url),'utf8'));
    const latest=(await db.query("SELECT parent_task_id FROM db_parent_task WHERE class_id=$1 AND publish_status IN('s2','s3') AND published_at<=NOW() ORDER BY published_at DESC,parent_task_id DESC LIMIT 1",[ctx.scope.class_id])).rows[0];assert.ok(latest);
    const created=await co.createTaskDraft({type:'t2',title:'亲子时光收录审核',detail:'用于核对教师收录与家长收录的独立性。',startAt:co.taskWireTime(ctx.school_today,'08:00'),dueAt:null});taskId=created.id;
    await db.query("UPDATE db_parent_task SET term_id=$2,publish_status='s2',published_at=(SELECT published_at-INTERVAL '1 day' FROM db_parent_task WHERE parent_task_id=$3) WHERE parent_task_id=$1",[taskId,ctx.current_term.term_id,latest.parent_task_id]);
    for(let i=0;i<2;i++) {
      const seed=source.posts[i];
      const saved=(await db.query(`INSERT INTO db_parent_task_submission(parent_task_id,child_id,parent_id,submission_text,submission_status,read_at,submitted_at,parent_book_included,teacher_book_included)
        SELECT $1,s.child_id,s.parent_id,s.submission_text,'c1',s.read_at,s.submitted_at,$3,false
        FROM db_parent_task_submission s JOIN db_child ch ON ch.child_id=s.child_id
        WHERE s.parent_task_submission_id=$2 AND ch.class_id=$4 RETURNING parent_task_submission_id`,[taskId,seed.submissionId,i===1,ctx.scope.class_id])).rows[0];assert.ok(saved);
      const id=saved.parent_task_submission_id;
      for(const fileId of seed.fileIds)await db.query("INSERT INTO db_file_ref(owner_object,owner_id,usage_key,file_id) VALUES('db_parent_task_submission',$1,'image',$2)",[id,fileId]);
      if(i===1)await db.query("INSERT INTO db_file_ref(owner_object,owner_id,usage_key,file_id) VALUES('db_parent_task_submission',$1,'book_parent',$2)",[id,seed.fileIds[0]]);
      await co.setBookInclusion(id,{included:true,fileIds:seed.fileIds});
      entries.push({childId:seed.childId,childName:seed.childName,submissionId:id,parentIncluded:i===1,fileIds:seed.fileIds});
    }
    const board=await book.loadTaskManage();assert.equal(board.children.length,10);
    for(const e of entries){const row=board.children.find(c=>c.id===e.childId).tasks.find(t=>t.id===e.submissionId);assert.ok(row.canRemove);assert.equal(row.parentIncluded,e.parentIncluded);}
    assert.deepEqual(await co.homeSchoolProgress(),before);
    await writeFile(manifest,JSON.stringify({taskId,title:'亲子时光收录审核',termId:ctx.current_term.term_id,entries},null,2));retained=true;
    console.log('Prepared two real current-term selection records; previous latest-task progress and original submissions preserved.');
  } finally {
    try{if(!retained&&taskId){await db.query("DELETE FROM db_file_ref WHERE owner_object='db_parent_task_submission' AND owner_id IN(SELECT parent_task_submission_id FROM db_parent_task_submission WHERE parent_task_id=$1)",[taskId]);await db.query('DELETE FROM db_parent_task_submission WHERE parent_task_id=$1',[taskId]);await db.query('DELETE FROM db_parent_task WHERE parent_task_id=$1',[taskId]);}}finally{await db.end();}
  }
}
