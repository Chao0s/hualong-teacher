import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const co=require('../../miniprogram/services/co-education');
let definition;globalThis.Page=p=>{definition=p;};require('../../miniprogram/pages/teacher-monthly-form/index');
function page(){return {...definition,entry:{view:false},roster:[{childId:1},{childId:2}],data:{...structuredClone(definition.data),months:[{key:'2026-05'}]},setData(values){
  for(const [key,value] of Object.entries(values)) {
    const parts=key.replace(/\[(\d+)\]/g,'.$1').split('.');let obj=this.data;
    for(const part of parts.slice(0,-1))obj=obj[part];obj[parts.at(-1)]=value;
  }
}};}
const flush=()=>new Promise(r=>setImmediate(r));
test('late evaluation response cannot restore a previous child selection',async()=>{
  const p=page();let release;
  co.monthEvalRow=({childId})=>childId===1?new Promise(r=>{release=r;}):Promise.resolve(null);
  const old=p.loadExisting();p.setData({childIndex:1});await p.loadExisting();
  release({id:1,status:'e3',statusLabel:'已发布',published:true,text:'old',fileIds:[],photoOwner:{object:'db_month_eval',id:1}});
  await old;assert.equal(p.data.evalId,0);assert.equal(p.data.content,'');assert.equal(p.data.readonly,false);
});
test('late photo response cannot overwrite another selected file',async()=>{
  const p=page();let release;p.evalLoadSeq=1;
  p.setData({imported:[{fileId:11,url:''}],evalPhotoOwner:{object:'db_month_eval',id:1}});
  co.photoUrl=()=>new Promise(r=>{release=r;});p.fillPhotoUrls();
  p.evalLoadSeq=2;p.setData({imported:[{fileId:12,url:''}]});release('http://localhost/_media/old');
  await flush();assert.equal(p.data.imported[0].url,'');
});
test('only actual placeholder images carry the demo label',async()=>{
  const p=page();p.evalLoadSeq=1;
  p.setData({imported:[{fileId:11,url:''},{fileId:12,url:''}],evalPhotoOwner:{object:'db_month_eval',id:1}});
  co.photoUrl=async id=>id===11?'http://localhost/_placeholder/11.png':'http://localhost/_media/opaque';
  p.fillPhotoUrls();await flush();assert.equal(p.data.imported[0].demo,true);assert.equal(p.data.imported[1].demo,false);
});
