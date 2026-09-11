import { readFileSync } from 'node:fs';
const L = readFileSync('G:/My Drive/Workplace/China KG Platform/hualong-backend/db/spec/operation-eli10.tsv', 'utf8').replace(/\r\n/g, '\n').trim().split('\n');
const H = L[0].split('\t');
const rows = L.slice(1).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [H[i], v ?? ''])));
const keys = ['getSession', 'getFileUrl', 'listResources', 'createReviewAction', 'listOrgChildren',
  'updateSchoolBookSection', 'precheckClassBooks', 'getResolvedBookManifest', 'getBookPage',
  'autosaveBookMaterial', 'submitTeacherMessage'];
for (const k of keys) {
  const r = rows.find((x) => x[H[0]] === k);
  if (!r) { console.log('### ' + k + ' —— 不在表里'); continue; }
  console.log('### ' + k);
  console.log('  幹嘛   ' + r['幹嘛']);
  console.log('  怎麼走 ' + r['怎麼走']);
}
