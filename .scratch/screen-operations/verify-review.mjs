// 逐条核那 11 条 imprecise 的「事实」是否真在 facts 里。不采信转述。
import { readFileSync } from 'node:fs';
const F = JSON.parse('[' + readFileSync('G:/My Drive/Workplace/China KG Platform/hualong-teacher/.scratch/screen-operations/eli10-facts.jsonl', 'utf8').trim().split('\n').join(',') + ']');
const by = new Map(F.map((r) => [r.key, r]));

const CHECKS = [
  ['getSession', /current_term.{0,12}可为 null|客户端据此提前禁用写入/, 'description'],
  ['getFileUrl', /owner_object/, 'raw'],
  ['getFileUrl', /partner/, 'roles'],
  ['listResources', /规则版本未撤销/, 'description'],
  ['createReviewAction', /review_policy/, 'description'],
  ['createReviewAction', /notify_downloaders/, 'description'],
  ['listOrgChildren', /必须.{0,6}enrollment_status/, 'description'],
  ['updateSchoolBookSection', /F20 之后 d2 可撤回成 d1/, 'description'],
  ['precheckClassBooks', /G93/, 'blockedOn'],
  ['getResolvedBookManifest', /released layout pack/, 'blockedOn'],
  ['getBookPage', /released layout pack/, 'blockedOn'],
  ['autosaveBookMaterial', /section d2 且 collection c2|d2 且 collection c2/, 'description'],
  ['submitTeacherMessage', /Idempotency-Key/, 'description'],
];

let ok = 0, bad = 0;
for (const [key, re, where] of CHECKS) {
  const f = by.get(key);
  if (!f) { console.log(`? ${key} 不在 facts 里`); bad++; continue; }
  const hay = where === 'roles' ? (f.roles || []).join('|')
    : where === 'blockedOn' ? (f.blockedOn || []).join('|')
      : where === 'raw' ? JSON.stringify({ q: f.query, d: f.description })
        : (f.description || '');
  const hit = re.test(hay);
  console.log(`${hit ? '✓' : '✗'} ${key.padEnd(26)} [${where}] ${hit ? '' : '没找到 ' + re}`);
  hit ? ok++ : bad++;
}
console.log(`\n核过 ${CHECKS.length} 条断言，成立 ${ok}，不成立 ${bad}`);
