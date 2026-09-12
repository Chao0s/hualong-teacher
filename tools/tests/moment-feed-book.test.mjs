import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const book=require('../../miniprogram/services/growth-book');
let definition;globalThis.Page=p=>{definition=p;};
require('../../miniprogram/pages/home-school-moment-feed/index');
function setup(included=true) {
  const calls=[],toasts=[],modals=[];let confirm=true;
  globalThis.wx={showLoading(){},hideLoading(){},showToast:o=>toasts.push(o.title),showModal:o=>{modals.push(o);o.success({confirm});}};
  book.listMaterials=async()=>included?[{id:901,momentId:10}]:[];
  book.addMoment=async id=>{calls.push(['add',id]);included=true;return {growth_material_id:902};};
  book.removeMaterial=async id=>{calls.push(['remove',id]);included=false;};
  const page={...definition,data:{...structuredClone(definition.data),moments:[{id:10,title:'Test activity'}]},inBook:new Set(),materialByMoment:new Map(),setData(v){Object.assign(this.data,v);}};
  return {page,calls,toasts,modals,cancel(){confirm=false;},click:()=>page.onAddToBook({currentTarget:{dataset:{id:10}}})};
}
test('remove uses material id, keeps card and allows re-add',async()=>{
  const t=setup();await t.page.loadBookState();await t.click();
  assert.deepEqual(t.calls,[['remove',901]]);assert.equal(t.page.data.moments.length,1);
  assert.equal(t.page.data.moments[0].inBook,false);assert.match(t.modals[0].content,/原活动、照片和本周上传进度保留/);
  await t.click();assert.deepEqual(t.calls,[['remove',901],['add',10]]);
  assert.equal(t.page.materialByMoment.get(10),902);
  await t.click();assert.deepEqual(t.calls.at(-1),['remove',902]);
});
test('cancel does not change inclusion or call API',async()=>{
  const t=setup();await t.page.loadBookState();t.cancel();await t.click();
  assert.deepEqual(t.calls,[]);assert.equal(t.page.data.moments[0].inBook,true);assert.equal(t.page.bookActionBusy,false);
});
test('duplicate taps open one confirmation and send one removal',async()=>{
  const t=setup();await t.page.loadBookState();
  await Promise.all([t.click(),t.click()]);assert.equal(t.modals.length,1);assert.equal(t.calls.length,1);
});
test('locked compilation keeps inclusion and explains failure',async()=>{
  const t=setup();await t.page.loadBookState();
  book.removeMaterial=async()=>{throw {details:{rule:'compilation_locked'}};};
  await t.click();assert.equal(t.page.data.moments[0].inBook,true);
  assert.ok(t.toasts.some(s=>s.includes('锁定')));assert.equal(t.page.bookActionBusy,false);
});
test('failed state read does not offer an unverified write',async()=>{
  const t=setup();book.listMaterials=async()=>{throw new Error('offline');};
  await t.page.loadBookState();await t.click();assert.deepEqual(t.calls,[]);
  assert.equal(t.page.data.bookStateReady,false);assert.equal(t.page.data.bookStateError,true);
});
test('older state request cannot overwrite newer results',async()=>{
  const t=setup();let resolveOld;
  book.listMaterials=()=>new Promise(r=>{resolveOld=r;});
  const old=t.page.loadBookState();book.listMaterials=async()=>[];
  await t.page.loadBookState();resolveOld([{id:901,momentId:10}]);await old;
  assert.equal(t.page.data.moments[0].inBook,false);
});
