/** 已停用手工设置汇总状态：现在接口会按真实评价重算，本脚本仅读取进度。 */
import {createRequire} from 'node:module';
import {installWxStub} from '../../../tools/lib/wx-stub.mjs';
installWxStub();
const require=createRequire(import.meta.url);
const guard=require('../../../miniprogram/utils/guard');
const assess=require('../../../miniprogram/services/assessment');
await guard.requireSession();
const board=await assess.growthRecordBoard();
console.log(JSON.stringify({mode:'read-derived-progress',rows:board.rows.map(r=>({childId:r.childId,states:r.states}))}));
