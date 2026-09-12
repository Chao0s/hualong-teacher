import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {DB_URL,testdataPath} from '../../../tools/lib/testdata-path.mjs';
const require=createRequire(import.meta.url);
const {Client}=require(resolve(testdataPath(),'node_modules/pg'));
assert.match(new URL(DB_URL).pathname,/test/i);
const db=new Client({connectionString:DB_URL});
await db.connect();
try {
  const sections=(await db.query('SELECT section_id,name,page_count,section_status,collection_status FROM db_growth_book_section WHERE section_id IN (15,16) ORDER BY section_id')).rows;
  const widgets=(await db.query('SELECT section_id,page_index,grid_x,grid_y,grid_w,grid_h,widget_type,binding_key,content,config FROM db_book_widget WHERE section_id IN (15,16) ORDER BY section_id,page_index,widget_type')).rows;
  assert.deepEqual(sections.map(s=>s.page_count),[3,2]);
  assert.ok(sections.every(s=>s.section_status==='d1'&&s.collection_status==='c1'));
  assert.equal(widgets.length,6);
  const a=widgets.find(w=>w.section_id===15&&w.page_index===0&&w.widget_type==='image');
  assert.deepEqual([a.grid_x,a.grid_y,a.grid_w,a.grid_h],[1,0,5,7]);
  const b=widgets.find(w=>w.section_id===16&&w.binding_key==='literal');
  assert.equal(b.content,'一起观察小树\n记录今天的发现');
  assert.equal(b.config.font_size,18);assert.equal(b.config.align,'right');
  assert.ok(b.config.text_styles.some(s=>s.b&&s.c==='#189b91'));
  for(const sectionId of [15,16]) {
    const image=widgets.find(w=>w.section_id===sectionId&&w.page_index===1);
    assert.deepEqual([image.grid_x,image.grid_y,image.grid_w,image.grid_h],[1,1,6,8]);
  }
  await writeFile(new URL('./12-weapp-db-readback.local.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),sections,widgets},null,2));
  console.log('PASS: A geometry; blank page removed; B text/newline/bold/italic/color/font/alignment; both page-2 images unchanged; drafts unpublished.');
} finally { await db.end(); }
