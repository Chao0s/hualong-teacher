/** Real local DB: all six source photos included, no duplication after reload, independent parent selection. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {installWxStub} from './lib/wx-stub.mjs';
import {DB_URL,testdataPath} from './lib/testdata-path.mjs';
installWxStub();const require=createRequire(import.meta.url);
const co=require('../miniprogram/services/co-education');const guard=require('../miniprogram/utils/guard');const auth=require('../miniprogram/utils/auth');
const book=require('../miniprogram/services/growth-book');
const {Client}=require(resolve(testdataPath(),'node_modules/pg'));assert.match(new URL(DB_URL).pathname,/test/i);
const db=new Client(DB_URL);await db.connect();let taskId,submissionId,tempChildId;
let definition;globalThis.Page=p=>{definition=p;};require('../miniprogram/pages/community-coeducation/index');
const page={...definition,data:structuredClone(definition.data),setData(v){Object.assign(this.data,v);},fillPhotos(){}};
require('../miniprogram/pages/growth-book-task-manage/index');
const family={...definition,data:structuredClone(definition.data),setData(v){Object.assign(this.data,v);}};
const toasts=[];wx.showToast=o=>toasts.push(o.title);
try {
  await guard.requireSession();const ctx=await auth.refreshContext();
  const task=await co.createTaskDraft({type:'t2',title:`Inclusion probe ${randomUUID().slice(0,8)}`,detail:'Temporary test only',startAt:co.taskWireTime(ctx.school_today,'08:00'),dueAt:null});
  taskId=task.id;await co.publishTask(taskId);
  submissionId=(await db.query('SELECT parent_task_submission_id FROM db_parent_task_submission WHERE parent_task_id=$1 ORDER BY child_id LIMIT 1',[taskId])).rows[0].parent_task_submission_id;
  await db.query("UPDATE db_parent_task_submission SET submission_status='c1',submission_text='Synthetic photo collection test',submitted_at=NOW(),read_at=NOW(),parent_book_included=true,teacher_book_included=false WHERE parent_task_submission_id=$1",[submissionId]);
  const files=(await db.query("SELECT file_id FROM db_file WHERE file_type='f1' ORDER BY file_id LIMIT 7")).rows.map(r=>r.file_id);assert.equal(files.length,7);
  const originals=files.slice(0,6);
  for(const fid of originals)await db.query("INSERT INTO db_file_ref(owner_object,owner_id,usage_key,file_id) VALUES('db_parent_task_submission',$1,'image',$2)",[submissionId,fid]);
  await db.query("INSERT INTO db_file_ref(owner_object,owner_id,usage_key,file_id) VALUES('db_parent_task_submission',$1,'book_parent',$2)",[submissionId,files[0]]);
  const originalState=(await db.query('SELECT submission_text,submission_status,parent_book_included FROM db_parent_task_submission WHERE parent_task_submission_id=$1',[submissionId])).rows[0];
  const refs=async key=>(await db.query("SELECT file_id FROM db_file_ref WHERE owner_object='db_parent_task_submission' AND owner_id=$1 AND usage_key=$2 ORDER BY file_id",[submissionId,key])).rows.map(r=>r.file_id);
  await page.refresh();let post=page.data.visible.find(r=>r.id===submissionId);assert.ok(post);assert.deepEqual(post.fileIds,originals,'parent selection is not counted again as a source photo');assert.equal(post.photos.length,3);
  const click={currentTarget:{dataset:{id:submissionId}}};
  await Promise.all([page.onToggleMaterial(click),page.onToggleMaterial(click)]);
  assert.deepEqual(await refs('book_teacher'),originals,'all six photos saved, not only three thumbnails');
  post=page.data.visible.find(r=>r.id===submissionId);assert.equal(post.included,true);assert.deepEqual(post.fileIds,originals,'reload does not duplicate originals');
  assert.equal(toasts.at(-1),'已加入成长册');
  await assert.rejects(co.setBookInclusion(submissionId,{included:true,fileIds:[files[6]]}),e=>e.code==='validation_failed');
  assert.deepEqual(await refs('book_teacher'),originals,'rejected stray file does not change the selection');
  await page.onToggleMaterial(click);assert.deepEqual(await refs('book_teacher'),[]);assert.equal(page.data.visible.find(r=>r.id===submissionId).included,false);
  assert.deepEqual(await refs('image'),originals);assert.deepEqual(await refs('book_parent'),[files[0]]);
  assert.deepEqual((await db.query('SELECT submission_text,submission_status,parent_book_included FROM db_parent_task_submission WHERE parent_task_submission_id=$1',[submissionId])).rows[0],originalState);
  await page.onToggleMaterial(click);assert.deepEqual(await refs('book_teacher'),originals);
  assert.deepEqual(page.data.visible.find(r=>r.id===submissionId).fileIds,originals);
  await family.load();assert.equal(family.data.error,'');
  const owner=family.data.children.find(c=>c.tasks.some(t=>t.id===submissionId));assert.ok(owner);
  const selected=()=>family.data.children.find(c=>c.id===owner.id).tasks.find(t=>t.id===submissionId);
  assert.equal(selected().canRemove,true);assert.equal(selected().parentIncluded,true);
  let confirm=false;wx.showModal=o=>o.success({confirm,cancel:!confirm});
  const remove={currentTarget:{dataset:{child:owner.id,task:submissionId}}};
  await family.onRemoveTask(remove);assert.deepEqual(await refs('book_teacher'),originals,'cancel leaves selection unchanged');
  confirm=true;await family.onRemoveTask(remove);
  assert.deepEqual(await refs('book_teacher'),[]);assert.ok(selected(),'parent choice keeps entry visible');assert.equal(selected().canRemove,false);
  await page.refresh();assert.equal(page.data.visible.find(r=>r.id===submissionId).included,false,'community page agrees');
  await db.query('UPDATE db_parent_task_submission SET parent_book_included=false WHERE parent_task_submission_id=$1',[submissionId]);
  await db.query("DELETE FROM db_file_ref WHERE owner_object='db_parent_task_submission' AND owner_id=$1 AND usage_key='book_parent'",[submissionId]);
  await co.setBookInclusion(submissionId,{included:true,fileIds:originals});await family.load();
  assert.equal(selected().parentIncluded,false);await family.onRemoveTask(remove);assert.equal(selected(),undefined,'teacher-only entry disappears');
  assert.deepEqual(await refs('image'),originals,'source attachments preserved');
  // Isolated inactive child: test the finalized-book gate without editing a real child's book.
  tempChildId=(await db.query("INSERT INTO db_child(school_id,class_id,child_name,enrollment_status,caretakers) VALUES($1,$2,'inclusion gate probe','e2','[]') RETURNING child_id",[ctx.scope.school_id,ctx.scope.class_id])).rows[0].child_id;
  const parent=(await db.query('SELECT parent_id FROM db_parent ORDER BY parent_id LIMIT 1')).rows[0].parent_id;
  const lockedSubmission=(await db.query("INSERT INTO db_parent_task_submission(parent_task_id,child_id,parent_id,submission_status,submission_text) VALUES($1,$2,$3,'c1','gate probe') RETURNING parent_task_submission_id",[taskId,tempChildId,parent])).rows[0].parent_task_submission_id;
  await db.query("INSERT INTO db_file_ref(owner_object,owner_id,usage_key,file_id) VALUES('db_parent_task_submission',$1,'image',$2)",[lockedSubmission,files[0]]);
  await co.setBookInclusion(lockedSubmission,{included:true,fileIds:[files[0]]});
  await db.query("INSERT INTO db_growth_book(school_id,class_id,child_id,teacher_id,term_id,book_status,published_at) VALUES($1,$2,$3,$4,$5,'b2',NOW())",[ctx.scope.school_id,ctx.scope.class_id,tempChildId,ctx.subject.teacher_id,ctx.current_term.term_id]);
  const lockedBefore=(await db.query('SELECT teacher_book_included,updated_at FROM db_parent_task_submission WHERE parent_task_submission_id=$1',[lockedSubmission])).rows[0];
  await assert.rejects(co.setBookInclusion(lockedSubmission,{included:false,fileIds:[]}),e=>e.code==='state_precondition_failed'&&e.details.rule==='target_book_finalized');
  assert.deepEqual((await db.query('SELECT teacher_book_included,updated_at FROM db_parent_task_submission WHERE parent_task_submission_id=$1',[lockedSubmission])).rows[0],lockedBefore);
  assert.equal((await db.query("SELECT 1 FROM db_file_ref WHERE owner_object='db_parent_task_submission' AND owner_id=$1 AND usage_key='book_teacher'",[lockedSubmission])).rows.length,1);
  const otherClass=(await db.query('SELECT class_id FROM db_class WHERE school_id=$1 AND class_id<>$2 LIMIT 1',[ctx.scope.school_id,ctx.scope.class_id])).rows[0].class_id;
  await db.query('UPDATE db_child SET class_id=$2 WHERE child_id=$1',[tempChildId,otherClass]);
  await assert.rejects(co.setBookInclusion(lockedSubmission,{included:false,fileIds:[]}),e=>e.code==='not_found');
  console.log('PASS: family list/teacher-only removal/parent-preserved removal and cancellation; community synchronization; finalized book rejects with rows and refs unchanged; cross-class rejected.');
  console.log('PASS: 6 original photos -> 6 teacher selections; add/reload/remove/re-add; no duplicate source photos; source text/files and parent choice preserved; stray file rejected.');
} finally {
  try {
    if(taskId) {
      await db.query("DELETE FROM db_file_ref WHERE owner_object='db_parent_task_submission' AND owner_id IN(SELECT parent_task_submission_id FROM db_parent_task_submission WHERE parent_task_id=$1)",[taskId]);
      await db.query('DELETE FROM db_parent_task_submission WHERE parent_task_id=$1',[taskId]);
      await db.query('DELETE FROM db_parent_task WHERE parent_task_id=$1',[taskId]);
      console.log('Probe-created task, submissions and references removed. Existing files untouched.');
    }
    if(tempChildId){await db.query('DELETE FROM db_growth_book WHERE child_id=$1',[tempChildId]);await db.query('DELETE FROM db_child WHERE child_id=$1',[tempChildId]);}
  } finally {await db.end();}
}
