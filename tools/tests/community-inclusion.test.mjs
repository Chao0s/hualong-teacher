import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const co=require('../../miniprogram/services/co-education');
let definition;globalThis.Page=p=>{definition=p;};require('../../miniprogram/pages/community-coeducation/index');
function setup(fileIds=[1,2,3,4,5,6]) {
  const calls=[],toasts=[];let included=false;
  globalThis.wx={showToast:o=>toasts.push(o.title)};
  const row=()=>({id:20,author:'Test',fileIds,included,photoOwner:{object:'db_parent_task_submission',id:20}});
  co.listCommunityFeed=async()=>({items:[row()]});
  co.setBookInclusion=async(id,body)=>{calls.push({id,body});included=body.included;};
  const page={...definition,data:{...structuredClone(definition.data),visible:[row()]},setData(v){Object.assign(this.data,v);},fillPhotos(){}};
  return {page,calls,toasts,click:()=>page.onToggleMaterial({currentTarget:{dataset:{id:20}}})};
}
test('adds all unique photos beyond the three thumbnail slots, removes and re-adds',async()=>{
  const t=setup([1,2,3,4,5,6,1]);await t.click();
  assert.deepEqual(t.calls[0],{id:20,body:{included:true,fileIds:[1,2,3,4,5,6]}});
  assert.equal(t.toasts[0],'已加入成长册');
  await t.click();assert.deepEqual(t.calls[1].body,{included:false,fileIds:[]});
  await t.click();assert.equal(t.calls[2].body.fileIds.length,6);
});
test('double click sends one update',async()=>{
  const t=setup();await Promise.all([t.click(),t.click()]);assert.equal(t.calls.length,1);assert.equal(t.page.inclusionBusy,false);
});
test('text-only submission still has an inclusion action',async()=>{
  const t=setup([]);await t.click();assert.deepEqual(t.calls[0].body,{included:true,fileIds:[]});assert.equal(t.toasts[0],'已加入成长册');
});
test('failed update leaves current inclusion unchanged',async()=>{
  const t=setup();co.setBookInclusion=async()=>{throw {userMessage:'保存失败'};};
  await t.click();assert.equal(t.page.data.visible[0].included,false);assert.equal(t.toasts[0],'保存失败');assert.equal(t.page.inclusionBusy,false);
});
test('a post removed by filtering is not updated by its old position',async()=>{
  const t=setup();t.page.data.visible=[{id:99,included:false,fileIds:[9]}];await t.click();assert.equal(t.calls.length,0);
});
