import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const co=require('../../miniprogram/services/co-education');
const api=require('../../miniprogram/utils/request');
const book=require('../../miniprogram/services/growth-book');
function setup() {
  api.post=async()=>({compilation_id:2,class_id:1,term_id:'term',enabled_sections:[],compilation_status:'e1',revision:1});
  api.get=async()=>({children:[{child_id:1,book_status:'b1',problems:[]},{child_id:2,book_status:'b2',problems:[]}],content_fingerprint:'test'});
  co.classRoster=async()=>[{childId:1,name:'A'},{childId:2,name:'B'},{childId:3,name:'C'}];
  co.listTasks=async({cursor})=>cursor?{items:[{id:20,termId:'old'}],nextCursor:null}:{items:[{id:10,termId:'term'}],nextCursor:'tasks-next'};
  const row=(id,childId,included,parentIncluded,taskId=10)=>({id,childId,included,parentIncluded,taskId,taskTitle:`Task ${id}`,submittedLabel:'date'});
  co.listCommunityFeed=async({cursor})=>cursor?{items:[row(3,2,true,false),row(4,3,true,false),row(5,1,true,false,20),row(6,99,true,false)],nextCursor:null}
    :{items:[row(1,1,true,false),row(2,1,false,true),row(7,1,false,false)],nextCursor:'posts-next'};
}
test('all pages merged, only current-term effective selections attached to real roster',async()=>{
  setup();const result=await book.loadTaskManage();
  assert.deepEqual(result.children.map(c=>c.id),[1,2,3]);
  assert.deepEqual(result.children[0].tasks.map(t=>t.id),[1,2]);
  assert.equal(result.children[0].tasks[0].canRemove,true);
  assert.equal(result.children[0].tasks[1].canRemove,false);assert.equal(result.children[0].tasks[1].sourceLabel,'家长已收录');
});
test('published books and missing authorization metadata do not offer removal',async()=>{
  setup();const result=await book.loadTaskManage();
  assert.equal(result.children[1].tasks[0].canRemove,false);assert.equal(result.children[2].tasks[0].canRemove,false);
});
test('a failed source rejects the load instead of returning example records',async()=>{
  setup();co.listCommunityFeed=async()=>{throw new Error('offline');};
  await assert.rejects(book.loadTaskManage(),/offline/);
});
test('pagination loops are rejected instead of silently duplicating rows',async()=>{
  setup();co.listTasks=async()=>({items:[],nextCursor:'repeat'});
  await assert.rejects(book.loadTaskManage(),/分页异常/);
});
