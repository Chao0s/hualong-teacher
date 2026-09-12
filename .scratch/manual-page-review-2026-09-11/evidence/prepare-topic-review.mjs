/** Prepare isolated manual topic/material fixtures and verify real writes without changing user records. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {installWxStub} from '../../../tools/lib/wx-stub.mjs';
installWxStub();const require=createRequire(import.meta.url);
const book=require('../../../miniprogram/services/growth-book');
const co=require('../../../miniprogram/services/co-education');
const guard=require('../../../miniprogram/utils/guard');
const auth=require('../../../miniprogram/utils/auth');
const time=require('../../../miniprogram/utils/time');
const file=new URL('./topic-review.local.json',import.meta.url);
let existing;try{existing=JSON.parse(await readFile(file,'utf8'));}catch(err){if(err.code!=='ENOENT')throw err;}
if(existing){console.log('Existing fixture manifest retained; do not recreate user-edited test material.');}
else {
  await guard.requireSession();const ctx=await auth.refreshContext();
  const comp=await book.ensureCompilation();assert.equal(comp.locked,false,'need an editable current compilation');
  const before=await co.weeklyCoverage();const topicsBefore=await book.listTopics();
  const topics=[],sources=[],materials=[];let retained=false;
  try {
    const testName=`Topic probe ${randomUUID().slice(0,8)}`;
    const temp=await book.createTopic(testName);topics.push(temp.time_topic_id);
    await book.renameTopic(temp.time_topic_id,testName+' renamed');
    assert.equal((await book.listTopics()).find(t=>t.id===temp.time_topic_id).title,testName+' renamed');
    await book.deleteTopic(temp.time_topic_id);topics.pop();
    assert.equal((await book.listTopics()).length,topicsBefore.length);
    let targetName='审核归类目标';let suffix=2;
    while(topicsBefore.some(t=>t.title===targetName))targetName=`审核归类目标${suffix++}`;
    const target=await book.createTopic(targetName);topics.push(target.time_topic_id);
    const child=(await co.classRoster())[0];assert.ok(child);
    const date=time.addLocalDays(ctx.school_today,-7);assert.ok(date>=ctx.current_term.start_date);
    for(const title of ['审核素材·归类','审核素材·移出']) {
      const source=await co.publish({title,content:'在园时光管理专用测试素材，可用于归类或移出核对。',date,childIds:[child.childId],fileIds:[]});
      sources.push(source.moment_id);
      const material=await book.addMoment(source.moment_id);
      materials.push({title,momentId:source.moment_id,materialId:material.growth_material_id});
    }
    const first=materials[0];await book.assignTopic([first.materialId],target.time_topic_id);
    assert.equal((await book.listMaterials(book.SOURCE_MOMENT)).find(m=>m.id===first.materialId).topicId,target.time_topic_id);
    await book.assignTopic([first.materialId],null);
    assert.equal((await book.listMaterials(book.SOURCE_MOMENT)).find(m=>m.id===first.materialId).topicId,null);
    const second=materials[1];await book.removeMaterial(second.materialId);
    assert.ok((await co.getMoment(second.momentId)).id,'removing material preserves source activity');
    assert.ok(!(await book.listMaterials(book.SOURCE_MOMENT)).some(m=>m.id===second.materialId));
    const restored=await book.addMoment(second.momentId);second.materialId=restored.growth_material_id;
    assert.deepEqual(await co.weeklyCoverage(),before,'past-week sources preserve current weekly progress');
    const board=await book.loadTimeManage();
    assert.ok(materials.every(m=>board.ungrouped.some(row=>row.id===m.materialId)));
    await writeFile(file,JSON.stringify({targetTopicId:target.time_topic_id,targetTopicName:targetName,materials,sourceDate:date,
      topicCount:board.topicCount,activityCount:board.activityCount,ungroupedCount:board.ungroupedCount},null,2));
    retained=true;console.log('PASS: topic create/rename/delete; assign/undo; remove preserves source; re-add; current week unchanged. Two dedicated materials retained ungrouped for manual review.');
  } finally {
    if(!retained){for(const id of sources)await co.remove(id);for(const id of topics)await book.deleteTopic(id);}
  }
}
