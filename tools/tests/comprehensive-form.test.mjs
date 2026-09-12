import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const assess=require('../../miniprogram/services/assessment');
let definition;
globalThis.Page=p=>{definition=p;};
globalThis.wx={showToast:()=>{}};
require('../../miniprogram/pages/comprehensive-assessment-form/index');
const detail=(childId=1,score=3)=>({childId,domains:[
  {id:'H',open:false,items:[{id:'H1',score,rated:true}]},
  {id:'L',open:false,items:[{id:'L1',score:0,rated:false}]},
],avg:'3',progressHint:'1/2',state:'draft'});
function page() {
  return {...definition,childEpoch:1,data:{...structuredClone(definition.data),childId:1,domains:detail().domains},setData(update){
    for(const [key,value] of Object.entries(update)) {
      const parts=key.replace(/\[(\d+)\]/g,'.$1').split('.');
      let target=this.data;for(const part of parts.slice(0,-1)) target=target[part];
      target[parts.at(-1)]=value;
    }
  }};
}
const tap=(di=0,score=4)=>({currentTarget:{dataset:{di,ii:0,score}}});
test('save retains latest manually chosen expansion state',async()=>{
  const p=page();p.data.domains[0].open=true;
  let finish,started;const ready=new Promise(r=>{started=r;});
  assess.scoreItem=()=>new Promise(r=>{finish=r;started();});
  const saving=p.onScoreTap(tap());await ready;
  p.onToggleDomain({currentTarget:{dataset:{di:1}}});
  finish(detail());await saving;
  assert.deepEqual(p.data.domains.map(d=>d.open),[true,true]);
  assert.equal(p.data.pendingWrites,0);
});
test('failed save rolls back score without collapsing',async()=>{
  const p=page();p.data.domains[1].open=true;
  assess.scoreItem=async()=>{throw new Error('offline');};
  await p.onScoreTap(tap(1));
  assert.equal(p.data.domains[1].open,true);
  assert.equal(p.data.domains[1].items[0].rated,false);
});
test('rapid clicks save in order and keep the final score',async()=>{
  const p=page();p.data.domains[0].open=true;
  const calls=[];let active=0;
  assess.scoreItem=async(child,id,score)=>{
    active++;assert.equal(active,1);calls.push(score);
    await new Promise(r=>setTimeout(r,5));active--;return detail(child,Number(score));
  };
  await Promise.all([p.onScoreTap(tap(0,2)),p.onScoreTap(tap(0,5))]);
  assert.deepEqual(calls,[2,5]);assert.equal(p.data.domains[0].items[0].score,5);
  assert.equal(p.data.domains[0].open,true);
});
test('old child response cannot replace another child page',async()=>{
  const p=page();let finish,started;const ready=new Promise(r=>{started=r;});
  assess.scoreItem=()=>new Promise(r=>{finish=r;started();});
  const saving=p.onScoreTap(tap());await ready;
  p.childEpoch++;p.data.childId=2;p.data.domains=detail(2,1).domains;
  finish(detail(1,5));await saving;
  assert.equal(p.data.childId,2);assert.equal(p.data.domains[0].items[0].score,1);
});
