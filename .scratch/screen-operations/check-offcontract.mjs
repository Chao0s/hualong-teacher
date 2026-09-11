// 验 Q4 的前提：扫 services/*.js 与 utils/*.js，有多少次 api.* 调用的路径**不在契约里**。
// 生成器现在 `if (!op || !op.operationId) continue` —— 这类调用被静默丢掉，
// 于是 /pages 的「客户端调了、契约没有」那一桶恒为 0。这个脚本量的就是这个桶该有多少。
import { readdirSync, readFileSync } from 'node:fs';
import { loadSpec, operations } from '../../tools/openapi-source.mjs';

const norm = (p) => p.replace(/\{[^}]+\}/g, '{*}').replace(/\/+$/, '');
const ops = operations(loadSpec());
const paths = new Set(ops.map((o) => norm(o.path)));

const dirs = ['miniprogram/services', 'miniprogram/utils'];
const unknown = [];
let total = 0;
for (const dir of dirs) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = readFileSync(`${dir}/${f}`, 'utf8').replace(/\r\n/g, '\n');
    const consts = new Map();
    for (const m of src.matchAll(/const\s+(\w+)\s*=\s*(?:'|"|`)(\/[^'"`]*)(?:'|"|`)/g)) consts.set(m[1], m[2]);
    for (const m of src.matchAll(/\bapi\.(get|post|put|patch|del|getPage|getRoster)\s*\(\s*(?:'|"|`)([^'"`]*)(?:'|"|`)/g)) {
      total++;
      if (!paths.has(norm(m[2]))) unknown.push(`${dir}/${f}:${m[1].toUpperCase()} ${m[2]}`);
    }
    for (const m of src.matchAll(/\bapi\.(get|post|put|patch|del|getPage|getRoster)\s*\(\s*(\w+)/g)) {
      total++;
      const p = consts.get(m[2]);
      if (p && !paths.has(norm(p))) unknown.push(`${dir}/${f}:${m[1].toUpperCase()} ${p}`);
    }
    for (const m of src.matchAll(/\bapi\.request\s*\(\s*(?:'|")([A-Z]+)(?:'|"),\s*(?:'|")([^'"]*)(?:'|")/g)) {
      total++;
      if (!paths.has(norm(m[2]))) unknown.push(`${dir}/${f}:${m[1]} ${m[2]}`);
    }
  }
}
console.log(`扫到调用点 ${total} 个；路径不在契约里的 ${unknown.length} 个`);
for (const u of unknown) console.log('  ' + u);
