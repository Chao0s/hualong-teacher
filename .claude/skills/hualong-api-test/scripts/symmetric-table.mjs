// 對稱表的第一個樣子：把「原型的意圖」與「客戶端實際調的操作」並排，逐屏看。
// 兩邊現在都有 id（意圖 = data-intent，操作 = operationId），所以擺得出來。
// **這不是最終對稱表** —— 它是給人判斷「這是不是你要的東西」的樣本。
//
// 算 join 的部分**不在這裡**：唯一一份在 `tools/lib/intent-join.mjs`（`joinScreen()`）。
// 從前這一支自己算一份，而 `/pages` 那邊沒有 —— 同一件事兩個算法，其中一個沒人看。
// 現在兩邊共用同一份：終端機印出的數字與 /pages 畫出的意圖行來自同一次計算。
//
// 跑法： node .claude/skills/hualong-api-test/scripts/symmetric-table.mjs [屏名,屏名,...]
import { joinScreen } from '../../../../tools/lib/intent-join.mjs';

const SHOW = (process.argv[2] ?? 'home,growth-book-edit,teacher-monthly-evaluation').split(',');

for (const screen of SHOW) {
  const j = joinScreen(screen);

  console.log(`\n${'='.repeat(78)}`);
  console.log(`屏  ${screen}      主表 ${j.tables || '(未登記)'}`);
  console.log(`意圖 ${j.intents.length} 個 · 操作 ${j.ops.length} 條`);
  console.log('='.repeat(78));

  if (!j.intents.length && !j.ops.length) { console.log('  （兩邊都空）'); continue; }

  console.log(`  ${'意圖（原型有標記的）'.padEnd(34)} ${'次'}  ${'操作（客戶端實際調的）'}`);
  console.log('  ' + '-'.repeat(74));
  for (const { intent, op, offContract } of j.pairs) {
    const left = intent ? intent.id.padEnd(34) : ''.padEnd(34);
    const cnt = intent ? String(intent.n).padStart(2) : '  ';
    let right = '';
    if (op) right = op.operation_id ? `${op.operation_id}${offContract ? '  (契約外)' : ''}` : '(此屏無操作)';
    console.log(`  ${left} ${cnt}  ${right}`);
  }

  console.log(`  -`.repeat(1) + ` 對得上 ${j.matched} · 待配 ${j.unpaired} · 純讀(無觸發) ${j.pureRead}`);
}
