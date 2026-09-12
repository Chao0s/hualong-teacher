/** Add two clearly labelled local review submissions with real downloaded photographs.
 * New records only; keep the previously latest parent task and all existing submissions unchanged.
 * Existing local manifest is reused rather than adding duplicate fixtures.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {installWxStub} from '../../../tools/lib/wx-stub.mjs';
import {DB_URL,testdataPath} from '../../../tools/lib/testdata-path.mjs';
installWxStub();const require=createRequire(import.meta.url);
const co=require('../../../miniprogram/services/co-education');
const media=require('../../../miniprogram/services/media');
const guard=require('../../../miniprogram/utils/guard');
const auth=require('../../../miniprogram/utils/auth');
const sharp=require(resolve(testdataPath(),'node_modules/sharp'));
const {Client}=require(resolve(testdataPath(),'node_modules/pg'));
const storage=await import(pathToFileURL(resolve(testdataPath(),'server/lib/local-media.mjs')));
const catalog=JSON.parse(await readFile(new URL('./community-photo-sources.json',import.meta.url),'utf8'));
const manifestPath=new URL('./community-real-photo-review.local.json',import.meta.url);
assert.match(new URL(DB_URL).pathname,/test/i);
const db=new Client(DB_URL);await db.connect();
const localFiles=[],madeFiles=[],taskIds=[],posts=[];
let temp,committed=false,retained=false;
try {
  await guard.requireSession();const ctx=await auth.refreshContext();
  let existing;try{existing=JSON.parse(await readFile(manifestPath,'utf8'));}catch(err){if(err.code!=='ENOENT')throw err;}
  async function verify(manifest) {
    const all=await co.listCommunityFeed({limit:100});
    for(const post of manifest.posts) {
      const row=all.items.find(r=>r.id===post.submissionId);assert.ok(row,'review post is visible');
      assert.deepEqual(row.fileIds,post.fileIds,'source photo order/count preserved');
      for(const fileId of row.fileIds) {
        const link=await media.fileUrl(fileId,row.photoOwner);assert.match(link.url,/\/_media\//);
        const res=await fetch(link.url);assert.equal(res.status,200);assert.equal(res.headers.get('content-type'),'image/jpeg');
        const bytes=Buffer.from(await res.arrayBuffer());
        const record=(await db.query('SELECT * FROM db_file WHERE file_id=$1',[fileId])).rows[0];
        assert.equal(record.storage_provider,'p2');assert.equal(record.file_size,bytes.length);
        assert.equal(record.file_hash,createHash('sha256').update(bytes).digest('hex'));
        const meta=await sharp(bytes).metadata();assert.ok(meta.width>200&&meta.height>200);
        const stats=await sharp(bytes).stats();assert.ok(stats.channels.some(c=>c.stdev>20),'actual photo content has detail');
      }
      console.log(`Verified post ${post.submissionId}: ${row.fileIds.length} real stored JPEG files via authenticated media URL.`);
    }
    for(const type of ['t1','t2']) {
      const filtered=await co.listCommunityFeed({type,timeWindow:'week',limit:100});
      for(const post of manifest.posts.filter(p=>p.type===type))assert.ok(filtered.items.some(r=>r.id===post.submissionId),'available in current week/type filter');
    }
  }
  if(existing) {
    await verify(existing);retained=true;
    console.log('Existing review fixture reused.');
  } else {
    const before=await co.homeSchoolProgress();
    const latest=(await db.query("SELECT parent_task_id FROM db_parent_task WHERE class_id=$1 AND publish_status IN('s2','s3') AND published_at<=NOW() ORDER BY published_at DESC,parent_task_id DESC LIMIT 1",[ctx.scope.class_id])).rows[0];
    assert.ok(latest,'need an existing task so the current progress baseline can be preserved');
    const children=(await db.query(`SELECT ch.child_id,ch.child_name,p.parent_id FROM db_child ch
      JOIN LATERAL(SELECT parent_id FROM db_parent WHERE parent_status='s1' AND ch.caretakers @> jsonb_build_array(jsonb_build_object('id',parent_id)) ORDER BY parent_id LIMIT 1) p ON TRUE
      WHERE ch.class_id=$1 AND ch.enrollment_status='e1' ORDER BY ch.child_id LIMIT 2`,[ctx.scope.class_id])).rows;
    assert.equal(children.length,2);assert.ok(ctx.current_term);
    temp=await mkdtemp(join(tmpdir(),'hualong-community-photos-'));
    for(const source of catalog.images) {
      let response=await fetch(source.url,{signal:AbortSignal.timeout(30000)});
      if(!response.ok&&source.url.includes('thumb.wikimedia.org'))response=await fetch(source.url.replace('thumb.wikimedia.org','upload.wikimedia.org'),{signal:AbortSignal.timeout(30000)});
      assert.equal(response.status,200,source.file);
      const bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.length<10*1024*1024);
      assert.equal((await sharp(bytes).metadata()).format,'jpeg');
      const path=join(temp,`${source.key}.jpg`);await writeFile(path,bytes);localFiles.push(path);
      const saved=await media.uploadFile(path,{usageKey:media.USAGE.IMAGE,byteSize:bytes.length});madeFiles.push(saved.fileId);
      const row=(await db.query('SELECT bucket,object_key,file_hash FROM db_file WHERE file_id=$1',[saved.fileId])).rows[0];
      const expected=await sharp(bytes).rotate().resize({width:2000,height:2000,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:84,mozjpeg:true}).toBuffer();
      assert.deepEqual(await storage.getObject(row.bucket,row.object_key),expected,'stored result contains processed source photo');
      console.log(`Uploaded ${source.key}: actual JPEG content verified.`);
    }
    const specs=[{type:'t1',title:'图片审核·自然观察',imageIndices:[0,1]},
      {type:'t2',title:'图片审核·四图观察',imageIndices:[0,1,2,3]}];
    await db.query('BEGIN');
    try {
      for(let i=0;i<specs.length;i++) {
        const spec=specs[i],child=children[i];
        const task=(await db.query(`INSERT INTO db_parent_task(school_id,class_id,teacher_id,term_id,parent_task_type,parent_task_title,task_detail,start_at,publish_status,published_at)
          VALUES($1,$2,$3,$4,$5,$6,'本地图片审核样本，用于检查真实照片显示和整组收录。',$7::date,'s2',
            (SELECT published_at-INTERVAL '1 day' FROM db_parent_task WHERE parent_task_id=$8)) RETURNING parent_task_id`,
          [ctx.scope.school_id,ctx.scope.class_id,ctx.subject.teacher_id,ctx.current_term.term_id,spec.type,spec.title,ctx.school_today,latest.parent_task_id])).rows[0];
        taskIds.push(task.parent_task_id);
        const selected=spec.imageIndices.map(n=>catalog.images[n]);
        const caption=`【真实照片审核样本】${selected.map(s=>s.label).join('、')}。公开摄影作品供界面检查，不代表实际家庭活动。\n照片：${selected.map(s=>`${s.label} ${s.author}`).join('；')}。CC BY-SA 3.0；已缩放和重新编码，来源见项目community-photo-sources.json。`;
        const submission=(await db.query(`INSERT INTO db_parent_task_submission(parent_task_id,child_id,parent_id,submission_text,submission_status,read_at,submitted_at,parent_book_included,teacher_book_included)
          VALUES($1,$2,$3,$4,'c1',$5::date+TIME '22:00',$5::date+TIME '23:50'+($6::int*INTERVAL '1 minute'),false,false) RETURNING parent_task_submission_id`,
          [task.parent_task_id,child.child_id,child.parent_id,caption,ctx.school_today,i])).rows[0];
        const fileIds=spec.imageIndices.map(n=>madeFiles[n]);
        for(const fid of fileIds)await db.query("INSERT INTO db_file_ref(owner_object,owner_id,usage_key,file_id) VALUES('db_parent_task_submission',$1,'image',$2)",[submission.parent_task_submission_id,fid]);
        posts.push({taskId:task.parent_task_id,submissionId:submission.parent_task_submission_id,childId:child.child_id,childName:child.child_name,title:spec.title,type:spec.type,fileIds,images:selected.map(s=>s.label)});
      }
      await db.query('COMMIT');committed=true;
    }catch(err){await db.query('ROLLBACK');throw err;}
    const manifest={schoolToday:ctx.school_today,fileIds:madeFiles,posts,sources:catalog};
    await verify(manifest);
    assert.deepEqual(await co.homeSchoolProgress(),before,'existing latest task and home progress remain unchanged');
    await writeFile(manifestPath,JSON.stringify(manifest,null,2));retained=true;
    console.log('Retained 2 labelled review posts with 4 unique real photographs. Existing latest-task progress unchanged.');
  }
} finally {
  try {
    if(!retained) {
      if(committed&&taskIds.length) {
        await db.query("DELETE FROM db_file_ref WHERE owner_object='db_parent_task_submission' AND owner_id IN(SELECT parent_task_submission_id FROM db_parent_task_submission WHERE parent_task_id=ANY($1::int[]))",[taskIds]);
        await db.query('DELETE FROM db_parent_task_submission WHERE parent_task_id=ANY($1::int[])',[taskIds]);
        await db.query('DELETE FROM db_parent_task WHERE parent_task_id=ANY($1::int[])',[taskIds]);
      }
      for(const id of madeFiles){const row=(await db.query('DELETE FROM db_file WHERE file_id=$1 RETURNING bucket,object_key',[id])).rows[0];if(row)await storage.removeObject(row.bucket,row.object_key);}
    }
    for(const path of localFiles)await unlink(path);if(temp)await rmdir(temp);
  }finally{await db.end();}
}
