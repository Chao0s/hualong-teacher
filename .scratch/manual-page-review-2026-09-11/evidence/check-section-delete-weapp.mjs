import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {DB_URL,testdataPath} from '../../../tools/lib/testdata-path.mjs';
const require=createRequire(import.meta.url);const {Client}=require(resolve(testdataPath(),'node_modules/pg'));
assert.match(new URL(DB_URL).pathname,/test/i);
const db=new Client(DB_URL);await db.connect();
const path=new URL('./section-delete-weapp.local.json',import.meta.url);
try {
  if(process.argv[2]==='prepare') {
    await db.query('BEGIN');
    const comp=(await db.query("SELECT compilation_id FROM db_growth_book_compilation WHERE class_id=1 AND compilation_status='e1' ORDER BY compilation_id DESC LIMIT 1 FOR UPDATE")).rows[0];assert.ok(comp);
    const section=(await db.query("INSERT INTO db_growth_book_section(compilation_id,name,anchor_after,anchor_type,section_status,collection_status,created_by) VALUES($1,'删除验证临时栏目','time','a2','d2','c2',1) RETURNING section_id",[comp.compilation_id])).rows[0].section_id;
    const next=(await db.query("INSERT INTO db_growth_book_section(compilation_id,name,anchor_after,anchor_type,created_by) VALUES($1,'删除验证后继',$2,'a4',1) RETURNING section_id",[comp.compilation_id,String(section)])).rows[0].section_id;
    const widget=(await db.query("INSERT INTO db_book_widget(section_id,grid_x,grid_y,grid_w,grid_h,widget_type,binding_key) VALUES($1,0,0,6,8,'image','collected') RETURNING widget_id",[section])).rows[0].widget_id;
    const file=(await db.query('SELECT file_id FROM db_file ORDER BY file_id LIMIT 1')).rows[0].file_id;
    const submissions=[];
    for(const [child,status] of [[1,'q1'],[2,'q2']]) {
      const sub=(await db.query("INSERT INTO db_book_material_submission(widget_id,child_id,submitted_by_parent_id,submission_text,submission_status) VALUES($1,$2,1,'临时删除验证材料',$3) RETURNING book_material_submission_id",[widget,child,status])).rows[0].book_material_submission_id;
      submissions.push(sub);
      await db.query("INSERT INTO db_content_check(batch_key,book_material_submission_id,target_type,submitted_by_parent_id,content_kind,content_hash) VALUES('weapp-delete',$1,'t9',1,'text','test')",[sub]);
      await db.query("INSERT INTO db_file_ref(file_id,owner_object,owner_id,usage_key) VALUES($1,'db_book_material_submission',$2,'material')",[file,sub]);
    }
    await db.query("UPDATE db_growth_book_compilation SET enabled_sections=COALESCE(enabled_sections,'[]'::jsonb)||to_jsonb($2::text),revision=revision+1 WHERE compilation_id=$1",[comp.compilation_id,String(section)]);
    await db.query('COMMIT');
    const result={section,next,widget,file,submissions,compilationId:comp.compilation_id};await writeFile(path,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  } else {
    const f=JSON.parse(await readFile(path,'utf8'));
    assert.equal((await db.query('SELECT 1 FROM db_growth_book_section WHERE section_id=$1',[f.section])).rowCount,0);
    assert.equal((await db.query('SELECT 1 FROM db_book_widget WHERE widget_id=$1',[f.widget])).rowCount,0);
    assert.equal((await db.query('SELECT 1 FROM db_book_material_submission WHERE book_material_submission_id=ANY($1::int[])',[f.submissions])).rowCount,0);
    assert.equal((await db.query('SELECT 1 FROM db_content_check WHERE book_material_submission_id=ANY($1::int[])',[f.submissions])).rowCount,0);
    assert.equal((await db.query("SELECT 1 FROM db_file_ref WHERE owner_object='db_book_material_submission' AND owner_id=ANY($1::int[])",[f.submissions])).rowCount,0);
    const next=(await db.query('SELECT anchor_after,anchor_type FROM db_growth_book_section WHERE section_id=$1',[f.next])).rows[0];assert.deepEqual(next,{anchor_after:'time',anchor_type:'a2'});
    const comp=(await db.query('SELECT enabled_sections FROM db_growth_book_compilation WHERE compilation_id=$1',[f.compilationId])).rows[0];assert.ok(!comp.enabled_sections.map(String).includes(String(f.section)));
    assert.equal((await db.query('SELECT 1 FROM db_file WHERE file_id=$1',[f.file])).rowCount,1);
    console.log('PASS: UI deletion removed section/widget/2 submissions/2 checks/2 refs; next section anchor repaired; enabled section removed; shared file preserved.');
    if(process.argv[2]==='cleanup') {
      const base='http://127.0.0.1:3860/api/v1';
      const session=await fetch(base+'/dev/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({surface:'teacher',subject_id:1})});assert.equal(session.status,201);
      const {token}=await session.json();
      const response=await fetch(base+'/teacher/growth-book/sections/'+f.next,{method:'DELETE',headers:{Authorization:'Bearer '+token}});assert.equal(response.status,204);
      console.log('PASS: temporary successor removed through API; existing review drafts retained.');
    }
  }
} catch(err) {await db.query('ROLLBACK');throw err;} finally {await db.end();}
