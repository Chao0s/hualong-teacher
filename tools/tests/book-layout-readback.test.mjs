import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const book=require('../../miniprogram/services/growth-book');const api=require('../../miniprogram/utils/request');
let definition;globalThis.Page=p=>{definition=p;};require('../../miniprogram/pages/growth-book-section-edit/index');
globalThis.wx={setNavigationBarTitle(){},showToast(){}};
function page() {
  const p={...definition,data:structuredClone(definition.data),setData(v){Object.assign(this.data,v);}};
  p.load=()=>{};p.onLoad({id:'1'});p.load=definition.load;return p;
}
test('rich text styles and additional config survive service read-write roundtrip',async()=>{
  const config={font_size:18,align:'right',future_setting:7,text_styles:[{start:0,end:2,b:true,c:'#189b91'},{start:2,end:4,i:true}]};
  api.get=async()=>({section_status:'d1',compilation_status:'e1',page_count:3,widgets:[{widget_id:10,page_index:0,grid_x:0,grid_y:0,grid_w:10,grid_h:6,widget_type:'text',binding_key:'literal',content:'甲乙丙丁',config}]});
  const value=await book.getWidgets(1);let sent;
  api.put=async(path,{body})=>{sent=body;return {widgets:body.widgets};};
  await book.saveWidgets(1,value.widgets,value.pageCount);
  assert.equal(sent.page_count,3);assert.equal(sent.widgets[0].content,'甲乙丙丁');assert.deepEqual(sent.widgets[0].config,config);
});
test('failed saved-layout read keeps editor locked and never substitutes default widgets',async()=>{
  const p=page();book.loadBookEdit=async()=>({compilation:{locked:false},sections:[{id:1,key:'1',published:false}]});
  book.getWidgets=async()=>{throw new Error('读取失败');};await p.load();
  assert.equal(p.data.loadError,'读取失败');assert.equal(p.data.saveDisabled,true);assert.equal(p.locked,true);assert.deepEqual(p.widgets,[]);
});
test('persist flushes the latest native editor content and formatting before saving',async()=>{
  const p=page();p.section={id:1,key:'1',name:'测试'};p.sections=[];p.anchorIds=['time'];p.anchorTypes=['a2'];p.pageCount=2;
  p.data.sectionName='测试';p.data.anchorIndex=0;p.selected='literal';
  p.widgets=[{id:'literal',page:0,x:0,y:0,w:10,h:8,type:'text',binding:'literal',content:'旧文字',config:{size:14,align:'left'}}];
  p.editorCtx={getContents:o=>o.success({delta:{ops:[{insert:'最新文字',attributes:{bold:true}},{insert:'\n'}]}})};
  book.updateSection=async()=>p.section;let saved;
  book.saveWidgets=async(id,widgets,count)=>{saved={widgets,count};return 1;};
  await p.persist();assert.equal(saved.count,2);assert.deepEqual(saved.widgets[0].content,[{t:'最新文字',b:1}]);
});
