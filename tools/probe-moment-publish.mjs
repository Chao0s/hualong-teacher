/** 发布与删除回归：真实接口/DB、页面处理函数、取消删除、确认删除及两处进度回读。 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFileSync,unlinkSync} from 'node:fs';
import {installWxStub} from './lib/wx-stub.mjs';
import {DB_URL,testdataPath} from './lib/testdata-path.mjs';

installWxStub();
const require=createRequire(import.meta.url);
const config=require('../miniprogram/config');
const base=process.argv.indexOf('--base');if(base>=0) config.env.baseUrl=process.argv[base+1];
assert.equal(config.env.name,'testdata');assert.match(new URL(DB_URL).pathname,/test/i);
const co=require('../miniprogram/services/co-education');
const media=require('../miniprogram/services/media');
const book=require('../miniprogram/services/growth-book');
const {Client}=require(resolve(testdataPath(),'node_modules/pg'));
const {removeObject}=await import(pathToFileURL(resolve(testdataPath(),'server/lib/local-media.mjs')));
const db=new Client(DB_URL);await db.connect();
const filePath=join(tmpdir(),`moment-publish-${randomUUID()}.png`);
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const made=[];const posted=[];const messages=[];const deletedRequests=[];let fileId;
const request=wx.request;
wx.request=opts=>{
  if(opts.method==='DELETE'&&/\/moments\/\d+$/.test(opts.url))deletedRequests.push(opts.url);
  if(opts.method==='POST'&&opts.url.endsWith('/moments')) {
    posted.push(opts.data);
    const success=opts.success;
    opts.success=r=>{if(r.statusCode===201&&r.data.moment_id) made.push(r.data.moment_id);success(r);};
  }
  return request(opts);
};
wx.showToast=({title})=>messages.push(title);
wx.navigateBack=()=>{};
let definition;globalThis.Page=p=>{definition=p;};
require('../miniprogram/pages/home-school-moment-publish/index');
const page={...definition,data:structuredClone(definition.data),setData(update){
  for(const [key,value] of Object.entries(update)) {
    const parts=key.replace(/\[(\d+)\]/g,'.$1').split('.');let target=this.data;
    for(const part of parts.slice(0,-1))target=target[part];target[parts.at(-1)]=value;
  }
}};
function loadPage(path) {
  require(path);
  return {...definition,data:structuredClone(definition.data),setData:page.setData};
}
const feed=loadPage('../miniprogram/pages/home-school-moment-feed/index');
const weekly=loadPage('../miniprogram/pages/home-school-moments/index');
const home=loadPage('../miniprogram/pages/home-school/index');
let baseline,homeBaseline,weeklyBaseline;
try {
  const health=await(await fetch(config.env.baseUrl+'/_health')).json();
  const originalNow=Date.now;
  try {
    Date.now=()=>Date.UTC(2026,8,12,4,0,0);
    await page.onLoad();
    assert.equal(page.data.date,health.today,'page uses server date, not September device date clamped to July');
  } finally {Date.now=originalNow;}
  assert.equal(page.data.error,'');assert.ok(page.data.children.length>=2);
  baseline=await co.weeklyCoverage();
  await home.load();assert.equal(home.data.error,'');
  homeBaseline={rows:structuredClone(home.data.rows),metrics:structuredClone(home.data.metrics)};
  await weekly.load();assert.equal(weekly.data.error,'');weeklyBaseline=structuredClone(weekly.data.rows);
  page.setData({title:`Publish probe ${randomUUID().slice(0,8)}`,content:'Test publication',
    children:page.data.children.map((c,i)=>({...c,checked:i<2}))});
  page.syncSelected();assert.equal(page.data.selectedCount,2);
  const content=page.data.content;
  page.confirmPublish=async()=>false;
  await page.onPublish();assert.equal(posted.length,0);assert.equal(page.data.publishing,false);
  page.confirmPublish=async()=>true;
  page.setData({photos:[{fileId:-1,label:'invalid test photo'}]});
  await page.onPublish();
  assert.equal(made.length,0,'invalid photo publication rolled back');
  assert.equal(page.data.content,content);assert.equal(page.data.selectedCount,2);
  assert.equal(page.data.publishing,false);
  assert.equal(messages.at(-1),co.momentPublishFailureText({details:{field:'file_id'}}));
  assert.ok(messages.every(text=>!String(text).includes('undefined')));
  writeFileSync(filePath,bytes);
  const file=await media.uploadFile(filePath,{usageKey:media.USAGE.IMAGE,byteSize:bytes.length});
  fileId=file.fileId;
  page.setData({date:'2026-07-10',photos:[{fileId,label:'test photo'}]});
  const before=posted.length;
  await Promise.all([page.onPublish(),page.onPublish()]);
  assert.equal(posted.length,before+1,'duplicate tap sends one publication');
  assert.equal(posted.at(-1).moment_date,health.today,'publish refreshes even a stale hidden date');
  assert.equal(made.length,1);
  await page.onPublish();
  assert.equal(posted.length,before+1,'success stays locked until the page leaves');
  assert.deepEqual(posted.at(-1).file_id,[fileId]);
  const detail=await co.getMoment(made[0]);
  assert.deepEqual(detail.fileIds,[fileId]);
  const row=(await db.query('SELECT moment_date::text,publish_status FROM db_moment WHERE moment_id=$1',[made[0]])).rows[0];
  assert.equal(row.moment_date,health.today);assert.equal(row.publish_status,'s3');
  const after=await co.weeklyCoverage();
  const selected=page.selectedChildIds();
  for(const r of after) assert.equal(r.count,baseline.find(b=>b.childId===r.childId).count+Number(selected.includes(r.childId)));
  await home.load();assert.equal(home.data.error,'');
  for(const r of home.data.rows) {
    const count=after.find(b=>b.childId===r.childId).count;
    assert.equal(r.cells[0].state,count>=2?'done':'miss','homepage state follows real weekly count');
  }
  const momentId=made[0];
  feed.setData({moments:[{...detail,id:momentId,title:page.data.title}]});feed.inBook=new Set();
  let confirm=false;const modals=[];
  wx.showModal=opts=>{modals.push(opts);opts.success({confirm,cancel:!confirm});};
  const click={currentTarget:{dataset:{id:momentId}}};
  // 同一张活动卡真实加入/取消移出/移出/重新加入；源记录与周进度始终不变。
  await feed.loadBookState();assert.equal(feed.data.bookStateReady,true);
  await feed.onAddToBook(click);
  assert.ok(feed.inBook.has(momentId),'add marks the card included');
  const materialId=feed.materialByMoment.get(momentId);
  assert.ok(Number.isInteger(materialId),'use material id, not moment id');
  assert.ok((await db.query('SELECT 1 FROM db_growth_material WHERE growth_material_id=$1 AND moment_id=$2',[materialId,momentId])).rows.length);
  const included=(await book.listMaterials(book.SOURCE_MOMENT)).find(m=>m.momentId===momentId);
  assert.equal(included.id,materialId);
  await feed.onAddToBook(click); // confirm=false: cancel removal
  assert.ok(feed.inBook.has(momentId));
  assert.ok((await db.query('SELECT 1 FROM db_growth_material WHERE growth_material_id=$1',[materialId])).rows.length,'cancel retains DB material');
  confirm=true;
  await Promise.all([feed.onAddToBook(click),feed.onAddToBook(click)]);
  assert.equal((await db.query('SELECT 1 FROM db_growth_material WHERE growth_material_id=$1',[materialId])).rows.length,0);
  assert.equal(feed.inBook.has(momentId),false);
  assert.equal(feed.data.moments.length,1,'removing from book keeps feed activity');
  assert.deepEqual((await co.getMoment(momentId)).fileIds,[fileId],'source photos remain');
  assert.deepEqual(await co.weeklyCoverage(),after,'book inclusion has no effect on weekly count');
  await feed.loadBookState();assert.equal(feed.inBook.has(momentId),false,'removed state persists after reload');
  await feed.onAddToBook(click);assert.ok(feed.inBook.has(momentId),'can re-add');
  assert.notEqual(feed.materialByMoment.get(momentId),materialId,'re-add creates a new material registration');
  console.log('PASS: real book add/remove/re-add, cancel, duplicate guard, persisted state, preserved source activity/photos and weekly counts.');
  confirm=false;
  await feed.onDelete(click);
  assert.equal(deletedRequests.length,0,'cancel does not send DELETE');
  assert.equal(feed.data.moments.length,1,'cancel leaves card visible');
  assert.ok((await db.query('SELECT 1 FROM db_moment WHERE moment_id=$1',[momentId])).rows.length);
  assert.deepEqual(await co.weeklyCoverage(),after,'cancel leaves every child count unchanged');
  assert.ok(modals.at(-1).content.includes(page.data.title),'confirmation identifies the correct activity');
  confirm=true;await feed.onDelete(click);
  assert.equal(deletedRequests.length,1,'confirmation sends one DELETE');
  assert.equal(feed.data.moments.length,0,'successful delete removes the card');
  assert.equal(messages.at(-1),'已删除');
  assert.equal((await db.query('SELECT 1 FROM db_moment WHERE moment_id=$1',[momentId])).rows.length,0);
  made.splice(made.indexOf(momentId),1);
  assert.equal((await db.query('SELECT 1 FROM db_moment_upload WHERE moment_id=$1',[momentId])).rows.length,0);
  assert.equal((await db.query("SELECT 1 FROM db_file_ref WHERE owner_object='db_moment' AND owner_id=$1",[momentId])).rows.length,0);
  assert.deepEqual(await co.weeklyCoverage(),baseline,'delete restores selected counts and leaves other children unchanged');
  for(let visit=0;visit<2;visit++) {
    await weekly.load();await home.load();
    assert.equal(weekly.data.error,'');assert.equal(home.data.error,'');
    assert.deepEqual(weekly.data.rows,weeklyBaseline,'weekly page reload restores displayed progress');
    assert.deepEqual({rows:home.data.rows,metrics:home.data.metrics},homeBaseline,'homepage reload restores dots and all three metrics');
  }
  console.log('PASS: publish, cancel/confirm deletion through page handler, DB row/reference removal, selected and unrelated child counts, repeated page reload, homepage states and metrics. Native UI rendering is not tested.');
} finally {
  try {
    for(const id of made) await co.remove(id);
    if(fileId) {
      const deleted=await db.query("DELETE FROM db_file WHERE file_id=$1 AND uploaded_by=$2 AND NOT EXISTS(SELECT 1 FROM db_file_ref WHERE file_id=$1) RETURNING bucket,object_key,storage_provider",[fileId,config.devSubjectId]);
      for(const row of deleted.rows)if(row.storage_provider==='p2')await removeObject(row.bucket,row.object_key);
    }
    if(baseline) assert.deepEqual((await co.weeklyCoverage()).map(r=>[r.childId,r.count]),baseline.map(r=>[r.childId,r.count]),'probe cleanup restores coverage');
    console.log('Probe-created records cleaned up.');
  } finally {
    await db.end();
    try {unlinkSync(filePath);} catch(err){if(err.code!=='ENOENT')throw err;}
  }
}
