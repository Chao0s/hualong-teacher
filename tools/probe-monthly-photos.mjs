/** Verify original image content through upload -> child album -> monthly draft -> published view.
 * Usage: node tools/probe-monthly-photos.mjs [--keep] image1.png image2.png
 * --keep retains only newly created sample records and writes their IDs to an ignored local manifest.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {installWxStub} from './lib/wx-stub.mjs';
import {DB_URL,testdataPath} from './lib/testdata-path.mjs';
installWxStub();
const require=createRequire(import.meta.url);
const co=require('../miniprogram/services/co-education');
const media=require('../miniprogram/services/media');
const auth=require('../miniprogram/utils/auth');
const guard=require('../miniprogram/utils/guard');
const time=require('../miniprogram/utils/time');
const config=require('../miniprogram/config');
const {Client}=require(resolve(testdataPath(),'node_modules/pg'));
const sharp=require(resolve(testdataPath(),'node_modules/sharp'));
const {removeObject}=await import(pathToFileURL(resolve(testdataPath(),'server/lib/local-media.mjs')));
assert.match(new URL(DB_URL).pathname,/test/i);
const db=new Client(DB_URL);await db.connect();
const args=process.argv.slice(2),keep=args.includes('--keep'),paths=args.filter(a=>a!=='--keep');
let definition;globalThis.Page=p=>{definition=p;};require('../miniprogram/pages/teacher-monthly-form/index');
function makePage(child,month,view=false){return {...definition,entry:{childId:child,month,view},data:structuredClone(definition.data),setData(values,callback){
  for(const [key,value] of Object.entries(values)) {
    const parts=key.replace(/\[(\d+)\]/g,'.$1').split('.');let obj=this.data;
    for(const part of parts.slice(0,-1))obj=obj[part];obj[parts.at(-1)]=value;
  }
  if(callback)callback();
}};}
async function waitFor(check){for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Timed out waiting for photo URLs');}
let momentId,evalId,success=false,selected,evalContent;
const fileIds=[],expectedImages=[];
const label=`Monthly photo probe ${randomUUID().slice(0,8)}`;
wx.showModal=o=>o.success?.({confirm:true});
try {
  await guard.requireSession();const context=await auth.refreshContext();
  const teacher=context.subject.teacher_id,classId=context.scope.class_id;
  const summary=(await db.query(`SELECT me.eval_month,me.month_eval_status,count(*)::int AS records,
    count(*) FILTER(WHERE EXISTS(SELECT 1 FROM db_file_ref fr WHERE fr.owner_object='db_month_eval' AND fr.owner_id=me.month_eval_id AND fr.usage_key='image'))::int AS with_photos
    FROM db_month_eval me WHERE me.class_id=$1 AND me.teacher_id=$2 GROUP BY 1,2 ORDER BY 1,2`,[classId,teacher])).rows;
  const providers=(await db.query(`SELECT f.storage_provider,count(*)::int AS references,
    count(*) FILTER(WHERE f.object_key LIKE 'incoming/%')::int AS legacy_discarded_uploads
    FROM db_month_eval me JOIN db_file_ref fr ON fr.owner_object='db_month_eval' AND fr.owner_id=me.month_eval_id AND fr.usage_key='image'
    JOIN db_file f ON f.file_id=fr.file_id WHERE me.class_id=$1 AND me.teacher_id=$2 GROUP BY 1`,[classId,teacher])).rows;
  console.log(JSON.stringify({existingMonthly:summary,photoProviders:providers}));
  const roster=await co.classRoster();
  for(const child of roster) {
    const actual=[];let cursor;
    do {
      const result=await co.listMoments({childId:child.childId,limit:100,cursor});
      actual.push(...result.items.map(m=>m.id));cursor=result.nextCursor;
    } while(cursor);
    const expected=(await db.query(`SELECT m.moment_id FROM db_moment m
      WHERE m.class_id=$1 AND EXISTS(SELECT 1 FROM db_moment_upload mu WHERE mu.moment_id=m.moment_id AND mu.child_id=$2)
      ORDER BY m.moment_id`,[classId,child.childId])).rows.map(r=>r.moment_id);
    assert.deepEqual(actual.sort((a,b)=>a-b),expected,'child album matches tagged source activities exactly');
  }
  const first=await co.listMoments({childId:roster[0].childId,limit:1});
  if(first.nextCursor)await assert.rejects(co.listMoments({childId:roster[1].childId,cursor:first.nextCursor,limit:1}),e=>e.code==='cursor_filter_mismatch');
  const outsider=(await db.query('SELECT child_id FROM db_child WHERE class_id<>$1 LIMIT 1',[classId])).rows[0];
  if(outsider)await assert.rejects(co.listMoments({childId:outsider.child_id,limit:100}),e=>e.code==='scope_violation');
  await assert.rejects(co.listMoments({childId:-1}),e=>e.code==='validation_failed');
  console.log(`PASS child filtering: ${roster.length} albums match DB; unrelated class, invalid child id and cross-child cursor rejected.`);
  if(!paths.length) {console.log('Inspection only; pass PNG file paths to verify content.');success=true;}
  else {
    const term=context.current_term;assert.ok(term);
    const months=time.wholeMonthsOfTerm(term.start_date,term.end_date);
    selected=(await db.query(`SELECT ch.child_id,ch.child_name,months.month
      FROM db_child ch CROSS JOIN unnest($1::text[]) AS months(month)
      WHERE ch.class_id=$2 AND ch.enrollment_status='e1'
        AND NOT EXISTS(SELECT 1 FROM db_month_eval me WHERE me.child_id=ch.child_id AND me.teacher_id=$3 AND me.eval_month=months.month)
      ORDER BY months.month,ch.child_id LIMIT 1`,[months,classId,teacher])).rows[0];
    assert.ok(selected,'No empty current-term monthly cell; do not overwrite user evaluations');
    evalContent=`${label}\n照片核对样本：${selected.month}。包含真实横图与竖图，用于检查选片、草稿回填和发布后照片显示。`;
    for(const path of paths) {
      const bytes=await readFile(path);
      assert.equal((await sharp(bytes).metadata()).format,'png','probe expects PNG sources');
      expectedImages.push(await sharp(bytes).rotate().resize({width:2000,height:2000,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:84,mozjpeg:true}).toBuffer());
      const file=await media.uploadFile(path,{usageKey:media.USAGE.IMAGE,byteSize:bytes.length});fileIds.push(file.fileId);
    }
    const weeklyBefore=await co.weeklyCoverage();
    // Use a prior week inside the term so retained review samples do not change current weekly progress.
    const sourceDate=term.start_date;
    assert.notEqual(sourceDate.slice(0,10),context.school_today);
    const moment=await co.publish({title:label,content:'真实横竖图片核对样本',date:sourceDate,childIds:[selected.child_id],fileIds});
    momentId=moment.moment_id;
    const page=makePage(selected.child_id,selected.month);await page.load();assert.equal(page.data.error,'');
    assert.equal(page.data.evalId,0,'only a previously empty monthly evaluation may be filled');
    await page.onOpenAlbum();
    const ownPhotos=()=>page.data.visibleGroups.flatMap(g=>g.photos).filter(p=>fileIds.includes(p.fileId));
    assert.equal(ownPhotos().length,fileIds.length,'all uploaded photos enter the selected child album');
    await waitFor(()=>ownPhotos().every(p=>p.url));
    for(let gi=0;gi<page.data.visibleGroups.length;gi++)for(let pi=0;pi<page.data.visibleGroups[gi].photos.length;pi++) {
      if(fileIds.includes(page.data.visibleGroups[gi].photos[pi].fileId))page.onTogglePhoto({currentTarget:{dataset:{gi,pi}}});
    }
    page.onConfirmAlbum();assert.deepEqual([...page.data.imported.map(p=>p.fileId)].sort(),[...fileIds].sort());
    page.onContentInput({detail:{value:evalContent}});
    await page.onSave();evalId=page.data.evalId;assert.ok(evalId);assert.equal(page.data.status,'e1');
    async function verify(label,instance) {
      await waitFor(()=>instance.data.imported.length===fileIds.length&&instance.data.imported.every(p=>p.url));
      for(const photo of instance.data.imported) {
        assert.match(photo.url,/\/_media\//,'new uploads must not return placeholder URLs');
        const res=await fetch(photo.url);assert.equal(res.status,200);
        const bytes=Buffer.from(await res.arrayBuffer());const expected=expectedImages[fileIds.indexOf(photo.fileId)];
        assert.deepEqual(bytes,expected,'actual bytes equal processed original PNG content');
        const row=(await db.query('SELECT storage_provider,file_size,file_hash FROM db_file WHERE file_id=$1',[photo.fileId])).rows[0];
        assert.equal(row.storage_provider,'p2');assert.equal(row.file_size,bytes.length);
        assert.equal(row.file_hash,createHash('sha256').update(bytes).digest('hex'));
      }
      console.log(`PASS ${label}: ${fileIds.length} real photo payloads, dimensions/content/hash match original processing.`);
    }
    const draft=makePage(selected.child_id,selected.month);await draft.load();await verify('draft reopening',draft);
    await draft.onPublish();assert.equal(draft.data.readonly,true);assert.equal(draft.data.status,'e3');
    const published=makePage(selected.child_id,selected.month,true);await published.load();await verify('published reopening',published);
    assert.equal(published.data.readonly,true);assert.equal(published.data.content,page.data.content);
    assert.deepEqual(await co.weeklyCoverage(),weeklyBefore,'sample source does not change current weekly counts');
    const unassociated=(await co.classRoster()).find(r=>r.childId!==selected.child_id);assert.ok(unassociated);
    const other=await co.listMoments({childId:unassociated.childId,limit:100});
    assert.ok(other.items.every(m=>!m.fileIds.some(id=>fileIds.includes(id))),'other child album excludes sample photos');
    success=true;
    if(keep) {
      const manifest={childId:selected.child_id,childName:selected.child_name,month:selected.month,evalId,momentId,fileIds,sourceDate,sourcePaths:paths.map(p=>resolve(p))};
      await writeFile('.scratch/manual-page-review-2026-09-11/evidence/monthly-photo-review.local.json',JSON.stringify(manifest,null,2));
      console.log(`RETAINED sample: child_id=${selected.child_id}, month=${selected.month}, month_eval_id=${evalId}; IDs saved in ignored local review manifest.`);
    }
  }
} finally {
  try {
    if(!(success&&keep)) {
      if(!evalId&&selected)evalId=(await db.query('SELECT month_eval_id FROM db_month_eval WHERE child_id=$1 AND teacher_id=$2 AND eval_month=$3 AND eval_text=$4',[selected.child_id,config.devSubjectId,selected.month,evalContent])).rows[0]?.month_eval_id;
      if(evalId) {
        await db.query("DELETE FROM db_file_ref WHERE owner_object='db_month_eval' AND owner_id=$1",[evalId]);
        await db.query('DELETE FROM db_month_eval WHERE month_eval_id=$1',[evalId]);
      }
      if(momentId)await co.remove(momentId);
      for(const id of fileIds) {
        const row=(await db.query('DELETE FROM db_file WHERE file_id=$1 RETURNING bucket,object_key',[id])).rows[0];
        if(row)await removeObject(row.bucket,row.object_key);
      }
      console.log('Probe-created records cleaned.');
    }
  } finally {await db.end();}
}
