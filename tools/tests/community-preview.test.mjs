import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const co=require('../../miniprogram/services/co-education');
let definition;globalThis.Page=p=>{definition=p;};require('../../miniprogram/pages/community-coeducation/index');
function setup(ids=[11,12,13,14]) {
  const previews=[],toasts=[],reads=[];
  globalThis.wx={showLoading(){},hideLoading(){},showToast:o=>toasts.push(o.title),previewImage:o=>previews.push(o)};
  const owner={object:'db_parent_task_submission',id:605};
  co.photoUrl=async(id,got)=>{assert.deepEqual(got,owner);reads.push(id);return `https://fresh.invalid/${id}`;};
  const page={...definition,data:{visible:[{id:605,fileIds:ids,photoOwner:owner,photos:ids.slice(0,3).map(fileId=>({fileId,url:'https://expired.invalid/old'}))}]}};
  return {page,previews,toasts,reads,click:(fileId)=>page.onPreviewPhotos({currentTarget:{dataset:{id:605,fileId}}})};
}
test('single photo opens from its thumbnail',async()=>{
  const t=setup([11]);await t.click(11);assert.deepEqual(t.previews[0].urls,['https://fresh.invalid/11']);assert.equal(t.previews[0].current,'https://fresh.invalid/11');
});
test('clicked thumbnail opens at the selected image with the complete fresh group',async()=>{
  const t=setup();await t.click(12);assert.deepEqual(t.reads,[11,12,13,14]);assert.equal(t.previews[0].current,'https://fresh.invalid/12');assert.equal(t.previews[0].urls.length,4);
});
test('+N opens the first hidden image',async()=>{
  const t=setup();await t.click(14);assert.equal(t.previews[0].current,'https://fresh.invalid/14');
});
test('a failed preceding image does not shift the selected image',async()=>{
  const t=setup();co.photoUrl=async id=>id===11?'':`https://fresh.invalid/${id}`;await t.click(12);assert.equal(t.previews[0].current,'https://fresh.invalid/12');assert.equal(t.previews[0].urls.length,3);
});
test('selected image failure gives feedback, not a different image',async()=>{
  const t=setup();co.photoUrl=async id=>id===12?'':`https://fresh.invalid/${id}`;await t.click(12);assert.equal(t.previews.length,0);assert.equal(t.toasts.length,1);assert.equal(t.page.previewing,false);
});
test('native preview failure is explained',async()=>{
  const t=setup();await t.click(11);t.previews[0].fail();assert.equal(t.toasts[0],'照片预览失败，请重试');
});
test('duplicate taps while loading open once',async()=>{
  const t=setup();await Promise.all([t.click(11),t.click(11)]);assert.equal(t.previews.length,1);assert.equal(t.reads.length,4);
});
test('filtered out post does not open a late preview',async()=>{
  const t=setup();const work=t.click(11);t.page.data.visible=[];await work;assert.equal(t.previews.length,0);
});
test('unavailable post or unrelated file id cannot open',async()=>{
  const t=setup();await t.click(99);assert.equal(t.reads.length,0);t.page.data.visible[0].underCheck=true;await t.click(11);assert.equal(t.previews.length,0);
});
