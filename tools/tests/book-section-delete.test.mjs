import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const book=require('../../miniprogram/services/growth-book');
let definition;globalThis.Page=p=>{definition=p;};require('../../miniprogram/pages/growth-book-section-materials/index');
function page(locked=false) {
  const p={...definition,data:structuredClone(definition.data),setData(v){Object.assign(this.data,v);}};
  p.sectionId='123';p.page={section:{published:true},compilation:{locked},rows:[],doneCount:0,totalCount:0,judged:false,judgeNote:''};p.render();return p;
}
test('published editable section enables deletion and explains material cleanup',()=>{
  const p=page();assert.equal(p.data.deleteDisabled,false);assert.match(p.data.deleteNote,/已收家庭材料/);
});
test('deletion uses section service once and returns only after success',async()=>{
  const p=page();let resolve,calls=0,backs=0;globalThis.wx={showToast(){},navigateBack(){backs++;}};
  book.deleteSection=id=>{assert.equal(id,'123');calls++;return new Promise(r=>{resolve=r;});};
  const pending=p.onDeleteSection();await p.onDeleteSection();assert.equal(calls,1);assert.equal(backs,0);assert.equal(p.data.deleteDisabled,true);
  resolve();await pending;assert.equal(backs,1);
});
test('server locked rejection keeps page, explains error and releases double-click lock',async()=>{
  const p=page();let backs=0,title='';globalThis.wx={showToast(o){title=o.title;},navigateBack(){backs++;}};
  book.deleteSection=async()=>{throw {code:'state_precondition_failed',details:{rule:'compilation_locked'}};};
  await p.onDeleteSection();assert.equal(backs,0);assert.match(title,/编册已锁定/);assert.equal(p.deleting,false);assert.equal(p.data.deleteDisabled,true);
});
test('locked or unreadable section cannot delete',async()=>{
  let calls=0;globalThis.wx={showToast(){}};book.deleteSection=async()=>{calls++;};
  const p=page(true);await p.onDeleteSection();
  p.page=null;p.data.deleteDisabled=false;await p.onDeleteSection();assert.equal(calls,0);
});
