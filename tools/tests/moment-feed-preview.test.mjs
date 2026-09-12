import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const co=require('../../miniprogram/services/co-education');
let definition;
globalThis.Page=p=>{definition=p;};
require('../../miniprogram/pages/home-school-moment-feed/index');
function setup(ids=[11,12,13,14,15]) {
  const previews=[],toasts=[],reads=[];
  globalThis.wx={showLoading:()=>{},hideLoading:()=>{},showToast:x=>toasts.push(x.title),previewImage:x=>previews.push(x)};
  const owner={object:'db_moment',id:101};
  co.photoUrl=async(id,gotOwner)=>{assert.deepEqual(gotOwner,owner);reads.push(id);return `https://fresh.invalid/${id}`;};
  const page={...definition,data:{moments:[{id:101,fileIds:ids,photoOwner:owner,photos:ids.slice(0,3).map(fileId=>({fileId,url:'https://expired.invalid/old'}))}]}};
  const click=(fileId)=>page.onPreviewPhotos({currentTarget:{dataset:{id:101,fileId}}});
  return {page,click,previews,toasts,reads};
}
test('thumbnail opens the selected picture with every photo and fresh URLs',async()=>{
  const t=setup();await t.click(12);
  assert.equal(t.previews.length,1);assert.equal(t.previews[0].current,'https://fresh.invalid/12');
  assert.deepEqual(t.previews[0].urls,[11,12,13,14,15].map(id=>`https://fresh.invalid/${id}`));
  assert.deepEqual(t.reads,[11,12,13,14,15]);assert.equal(t.page.previewing,false);
});
test('single picture can open without a +N button',async()=>{
  const t=setup([11]);await t.click(11);
  assert.equal(t.previews[0].current,'https://fresh.invalid/11');assert.equal(t.previews[0].urls.length,1);
});
test('+N starts at the first hidden photo',async()=>{
  const t=setup();await t.click(14);assert.equal(t.previews[0].current,'https://fresh.invalid/14');
});
test('failed earlier photo does not shift the selected picture',async()=>{
  const t=setup();co.photoUrl=async(id)=>id===11?'':`https://fresh.invalid/${id}`;
  await t.click(12);assert.equal(t.previews[0].current,'https://fresh.invalid/12');
  assert.equal(t.previews[0].urls.length,4);
});
test('unavailable selected photo gives feedback instead of showing a different child photo',async()=>{
  const t=setup();co.photoUrl=async(id)=>id===12?'':`https://fresh.invalid/${id}`;
  await t.click(12);assert.equal(t.previews.length,0);assert.equal(t.toasts.length,1);assert.equal(t.page.previewing,false);
});
test('native preview failure gives feedback',async()=>{
  const t=setup();await t.click(11);t.previews[0].fail();assert.equal(t.toasts.length,1);
});
