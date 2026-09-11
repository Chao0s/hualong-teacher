/**
 * 把每个契约操作的事实导出成 JSONL，供 ELI10 起草用。
 *
 * **起草只准看这份文件。** 它是从 `../hualong-backend/api/openapi.yaml` 与
 * `db/spec/screen-operations.tsv` 直接抽的，一行不多、一行不少：
 * 摘要、已有描述（工程口吻，但准）、请求体字段、成功码、角色、动作键、
 * 管辖范围、被阻断的原因、以及哪些屏幕调它。
 *
 * 这样起草的人（人也好，子代理也好）没有借口去「推测」行为 ——
 * 一句自信的错话比没有更坏。
 *
 *   node .scratch/screen-operations/eli10-facts.mjs   -> eli10-facts.jsonl
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpec, operations, specPath } from '../../tools/openapi-source.mjs';
import { dump } from 'js-yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const BACKEND = resolve(REPO, '..', 'hualong-backend');

const spec = loadSpec();
const text = readFileSync(specPath(), 'utf8');

// 描述全文不在 operations() 里，回契约原文取（它是起草的主要依据，一个字都不能少）
const raw = (() => {
  const doc = dump(spec, { lineWidth: -1 }); // 只为拿到结构；描述另从 yaml 对象读
  return spec;
})();

const ops = operations(spec);

// 哪些屏幕调它（读生成器写出的那份表）
const screenOps = existsSync(join(BACKEND, 'db', 'spec', 'screen-operations.tsv'))
  ? readFileSync(join(BACKEND, 'db', 'spec', 'screen-operations.tsv'), 'utf8')
      .replace(/\r\n/g, '\n').trim().split('\n').slice(1)
      .map((l) => Object.fromEntries(l.split('\t').map((v, i) => [['screen', 'mp_file', 'screen_title', 'state', 'operation_id', 'method', 'path', 'source', 'trigger_wxml', 'trigger_prototype', 'trigger_flag', 'gap', 'notes'][i], v])))
  : [];

const byOp = new Map();
for (const r of screenOps) {
  if (!byOp.has(r.operation_id)) byOp.set(r.operation_id, []);
  byOp.get(r.operation_id).push({ screen: r.screen, title: r.screen_title, state: r.state, trigger: r.trigger_wxml, handler: r.notes });
}

function schemaSummary(name, depth = 0) {
  if (!name || depth > 2) return null;
  const s = spec.components?.schemas?.[name];
  if (!s || s.type !== 'object' || !s.properties) return name;
  return {
    schema: name,
    required: s.required || [],
    props: Object.entries(s.properties).map(([k, v]) => {
      const t = v.type || (v.$ref ? v.$ref.split('/').pop() : v.oneOf ? 'oneOf' : '');
      return `${k}:${t}${v.enum ? `[${v.enum.join('|')}]` : ''}`;
    }),
  };
}

const rows = ops.map((o) => {
  const item = spec.paths[o.path][o.method.toLowerCase()];
  const bodyRef = item.requestBody?.content?.['application/json']?.schema?.$ref?.split('/').pop()
    || item.requestBody?.content?.['application/json']?.schema?.allOf?.[0]?.$ref?.split('/').pop()
    || null;
  // 参数可能是 `$ref: '#/components/parameters/Limit'`。**只认 `p.in` 会把它们全丢掉** ——
  // $ref 的那个对象上没有 `in` 属性。丢掉之后 `Limit`／`Cursor` 就看不见了，起草的人
  // 于是不知道这一条能翻页（listPartyBrands 第一次就是这么漏的）。
  const params = (item.parameters || []).map((p) => {
    if (!p.$ref) return p;
    const name = p.$ref.split('/').pop();
    return (spec.components?.parameters?.[name]) || { name, $ref: name };
  });
  const q = params.filter((p) => p.in === 'query').map((p) => `${p.name}${p.required ? '*' : ''}`);
  const pathParams = params.filter((p) => p.in === 'path').map((p) => p.name);
  const sort = raw.paths[o.path][o.method.toLowerCase()]['x-hualong-sort'] || null;
  const paginated = q.includes('cursor') || q.includes('limit');
  return {
    key: o.operationId,
    method: o.method,
    path: o.path,
    tags: o.tags,
    roles: o.roles,
    isPublic: o.isPublic,
    summary: o.summary,
    description: raw.paths[o.path][o.method.toLowerCase()].description || '',
    successCodes: o.successCodes,
    actions: o.actions,
    scope: raw.paths[o.path][o.method.toLowerCase()]['x-hualong-scope'] || null,
    sort,
    paginated,
    blockedOn: o.blockedOn,
    role: raw.paths[o.path][o.method.toLowerCase()]['x-hualong-roles'] || null,
    pathParams,
    query: q,
    body: schemaSummary(bodyRef),
    callsFromScreens: byOp.get(o.operationId) || [],
  };
});

// 按 tag 分组输出，起草按 tag 批次走
const out = join(HERE, 'eli10-facts.jsonl');
writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

const byTag = new Map();
for (const r of rows) for (const t of r.tags.length ? r.tags : ['(无 tag)']) byTag.set(t, (byTag.get(t) || 0) + 1);
console.log(`写出 ${rows.length} 行 → ${out}`);
console.log('按 tag（小到大）：');
for (const [t, n] of [...byTag.entries()].sort((a, b) => a[1] - b[1])) console.log(`  ${String(n).padStart(3)}  ${t}`);
console.log(`描述为空的 ${rows.filter((r) => !r.description).length} 个；有请求体的 ${rows.filter((r) => r.body).length} 个。`);
