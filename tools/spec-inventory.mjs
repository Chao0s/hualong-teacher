/**
 * Prints what the contract actually contains, and writes the machine-readable
 * form the mock and the test suites read.
 *
 * Run:  npm run spec:inventory
 *
 * The counts are the point. AGENTS.md quotes "126 paths / 149 operations"; if
 * this disagrees, the prose is stale and the file wins.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpec, operations, specPath } from './openapi-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '.report');

const spec = loadSpec();
const rows = operations(spec);
const paths = Object.keys(spec.paths || {});
const schemas = Object.keys(spec.components?.schemas || {});

const byRole = new Map();
for (const r of rows) {
  for (const role of r.roles.length ? r.roles : ['(未标注)']) {
    byRole.set(role, (byRole.get(role) || 0) + 1);
  }
}

const teacher = rows.filter((r) => r.roles.includes('teacher'));
const blocked = rows.filter((r) => r.blockedOn.length > 0);
const publicOps = rows.filter((r) => r.isPublic);
// Roleless AND not public is the real defect: the authorization primitive has
// nothing to evaluate, so such an operation can never be reached safely.
const unroled = rows.filter((r) => r.roles.length === 0 && !r.isPublic);

console.log(`契约文件：${specPath()}`);
console.log('');
console.log('| 计数项 | 值 |');
console.log('| --- | --- |');
console.log(`| 路径 paths | ${paths.length} |`);
console.log(`| 操作 operations | ${rows.length} |`);
console.log(`| 模式 schemas | ${schemas.length} |`);
console.log(`| 教师端可达操作 | ${teacher.length} |`);
console.log(`| 登录前公开操作（security: []） | ${publicOps.length} |`);
console.log(`| 被 GAPS 阻断的操作 | ${blocked.length} |`);
console.log(`| 无角色且非公开的操作（缺陷） | ${unroled.length} |`);
console.log('');
console.log('| 角色 | 操作数 |');
console.log('| --- | --- |');
for (const [role, n] of [...byRole].sort((a, b) => b[1] - a[1])) {
  console.log(`| ${role} | ${n} |`);
}

if (unroled.length) {
  console.log('');
  console.log('缺陷：既无 x-hualong-roles 又非 security: [] 的操作，授权原语无从判定：');
  for (const r of unroled) console.log(`  ${r.method} ${r.path}`);
}

if (blocked.length) {
  console.log('');
  console.log('被阻断的操作（x-hualong-blocked-on，闭合前不可实作）：');
  for (const r of blocked) console.log(`  ${r.method} ${r.path}  <- ${r.blockedOn.join(', ')}`);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  resolve(OUT_DIR, 'operations.json'),
  `${JSON.stringify({ generatedFrom: specPath(), counts: {
    paths: paths.length, operations: rows.length, schemas: schemas.length,
    teacher: teacher.length, public: publicOps.length,
    blocked: blocked.length, unroled: unroled.length,
  }, operations: rows }, null, 2)}\n`,
);
console.log('');
console.log(`写出：${resolve(OUT_DIR, 'operations.json')}`);
