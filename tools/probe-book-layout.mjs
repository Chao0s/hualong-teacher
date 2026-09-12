/** Real layout roundtrip, scoped reads, frozen writes and failed-save preservation. --keep prepares two drafts. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {installWxStub} from './lib/wx-stub.mjs';
import {DB_URL,testdataPath} from './lib/testdata-path.mjs';
installWxStub();const require=createRequire(import.meta.url);
const book=require('../miniprogram/services/growth-book');const api=require('../miniprogram/utils/request');
const guard=require('../miniprogram/utils/guard');const auth=require('../miniprogram/utils/auth');const config=require('../miniprogram/config');
const {Client}=require(resolve(testdataPath(),'node_modules/pg'));assert.match(new URL(DB_URL).pathname,/test/i);
const db=new Client(DB_URL);await db.connect();const made=[];const retained=new Set();
let definition;globalThis.Page=p=>{definition=p;};require('../miniprogram/pages/growth-book-section-edit/index');
function editor(id) {
  const p={...definition,data:structuredClone(definition.data),setData(values,callback){
    for(const [key,value] of Object.entries(values)) {
      const parts=key.replace(/\[(\d+)\]/g,'.$1').split('.');let obj=this.data;
      for(const part of parts.slice(0,-1))obj=obj[part];obj[parts.at(-1)]=value;
    }
    if(callback)callback();
  }};
  p.load=()=>{};p.onLoad({id:String(id)});p.load=definition.load;return p;
}
const widgets=[
  {id:'image-a',page:0,x:0,y:0,w:6,h:8,type:'image',binding:'collected',content:'',config:{fit:'cover'}},
  {id:'text-a',page:0,x:0,y:10,w:12,h:6,type:'text',binding:'literal',content:[{t:'第一行',b:1,c:'#189b91'},{t:'\n第二行',i:1}],config:{size:14,align:'center'}},
  {id:'image-b',page:1,x:1,y:1,w:6,h:8,type:'image',binding:'collected',content:'',config:{fit:'crop'}},
];
const endpoint=id=>`/teacher/growth-book/sections/${id}/widgets`;
async function create(name){const s=await book.createSection({name,anchorAfter:'time',anchorType:'a2'});made.push(s.id);return s;}
try {
  await guard.requireSession();const ctx=await auth.refreshContext();assert.equal((await book.ensureCompilation()).locked,false);
  const sec=await create(`回读${randomUUID().slice(0,5)}`);
  assert.equal(await book.saveWidgets(sec.id,widgets),3);
  assert.equal((await book.getWidgets(sec.id)).pageCount,2,'legacy omitted count inferred');
  await book.saveWidgets(sec.id,widgets,3);
  let layout=await book.getWidgets(sec.id);assert.equal(layout.pageCount,3);assert.equal(layout.widgets.length,3);
  assert.deepEqual(layout.widgets[1].content,widgets[1].content);assert.equal(layout.widgets[1].config.align,'center');
  const page=editor(sec.id);await page.load();assert.equal(page.data.loadError,'');assert.equal(page.pageCount,3);
  assert.equal(page.widgets[0].x,0);assert.equal(page.widgets[2].page,1);
  page.widgets[0].x=2;page.widgets[0].w=5;page.widgets[0].h=7;
  page.widgets[1].config.size=18;page.pageCount=4;
  await page.onSave();
  const reopened=editor(sec.id);await reopened.load();assert.equal(reopened.data.loadError,'');assert.equal(reopened.pageCount,4);
  assert.equal(reopened.widgets[0].x,2);assert.equal(reopened.widgets[0].w,5);assert.equal(reopened.widgets[1].config.size,18);
  assert.deepEqual(reopened.widgets[1].content,widgets[1].content,'rich text survives page save/reopen');
  const stable=await api.get(endpoint(sec.id));
  async function rejected(body,rule){await assert.rejects(api.put(endpoint(sec.id),{body}),e=>e.code==='validation_failed'&&e.details.rule===rule);assert.deepEqual(await api.get(endpoint(sec.id)),stable);}
  const overlap=structuredClone(stable.widgets);overlap[1].grid_x=2;overlap[1].grid_y=1;
  await rejected({widgets:overlap,page_count:4},'no_overlap_within_page');
  await rejected({widgets:stable.widgets,page_count:1},'covers_widgets_1_200');
  const badStyle=structuredClone(stable.widgets);badStyle[1].config.text_styles[0].end=999;
  await rejected({widgets:badStyle,page_count:4},'valid_text_style_ranges');
  const hugeFont=structuredClone(stable.widgets);hugeFont[1].config.font_size=1000;
  await rejected({widgets:hugeFont,page_count:4},'text_exceeds_box');
  const smallBound=structuredClone(stable.widgets);Object.assign(smallBound[1],{binding_key:'child.message',content:null,grid_w:2,grid_h:2,config:{font_size:14}});
  await rejected({widgets:smallBound,page_count:4},'text_exceeds_box');
  const foreign=await fetch(config.env.baseUrl+'/dev/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({surface:'teacher',subject_id:3})});
  const foreignToken=(await foreign.json()).token;
  for(const method of ['GET','PUT']) {
    const response=await fetch(config.env.baseUrl+endpoint(sec.id),{method,headers:{Authorization:'Bearer '+foreignToken,'Content-Type':'application/json'},body:method==='PUT'?JSON.stringify({widgets:stable.widgets,page_count:4}):undefined});
    assert.equal(response.status,404,'other class cannot read or replace layout');
  }
  assert.deepEqual(await api.get(endpoint(sec.id)),stable);
  await book.publishSection(sec.id);
  layout=await book.getWidgets(sec.id);assert.equal(layout.locked,true);assert.equal(layout.published,true);
  await assert.rejects(book.saveWidgets(sec.id,widgets,3),e=>e.code==='state_precondition_failed'&&e.details.rule==='layout_locked');
  const frozen=await api.get(endpoint(sec.id));assert.equal(frozen.page_count,4);assert.deepEqual(frozen.widgets,stable.widgets);
  const lockedComp=(await db.query("SELECT compilation_id FROM db_growth_book_compilation WHERE class_id=$1 AND compilation_status='e2' LIMIT 1",[ctx.scope.class_id])).rows[0];
  assert.ok(lockedComp,'fixture has a locked historical compilation');
  const lockedSec=(await db.query("INSERT INTO db_growth_book_section(compilation_id,name,anchor_after,anchor_type) VALUES($1,'只读回归','time','a2') RETURNING section_id",[lockedComp.compilation_id])).rows[0].section_id;made.push(lockedSec);
  assert.equal((await book.getWidgets(lockedSec)).locked,true);
  await assert.rejects(book.saveWidgets(lockedSec,widgets,3),e=>e.details.rule==='layout_locked');
  await assert.rejects(book.publishSection(lockedSec),e=>e.details.rule==='layout_locked');
  assert.equal((await book.getWidgets(lockedSec)).widgets.length,0);
  console.log('PASS: geometry, page indices, rich text, font/alignment/fit, trailing blank pages, real editor reopen; rejected overlap/style/count preserves original; cross-class read/write denied; published and locked layouts read-only.');
  if(process.argv.includes('--keep')) {
    const path='.scratch/manual-page-review-2026-09-11/evidence/layout-review.local.json';let existing;
    try{existing=JSON.parse(await readFile(path,'utf8'));}catch(err){if(err.code!=='ENOENT')throw err;}
    if(existing)console.log('Existing manual drafts retained; no duplicate samples created.');
    else {
      const a=await create('排版审核A');await book.saveWidgets(a.id,widgets,3);
      const b=await create('排版审核B');await book.saveWidgets(b.id,widgets,2);
      await writeFile(path,JSON.stringify({draftA:{id:a.id,name:a.name,pageCount:3},draftB:{id:b.id,name:b.name,pageCount:2}},null,2));
      retained.add(a.id);retained.add(b.id);console.log('Retained two dedicated manual drafts: 排版审核A / 排版审核B.');
    }
  }
} finally {
  try{for(const id of made.filter(id=>!retained.has(id))) {
    await db.query('DELETE FROM db_book_material_submission WHERE widget_id IN(SELECT widget_id FROM db_book_widget WHERE section_id=$1)',[id]);
    await db.query('DELETE FROM db_book_widget WHERE section_id=$1',[id]);
    await db.query('DELETE FROM db_growth_book_section WHERE section_id=$1',[id]);
  }}finally{await db.end();}
}
