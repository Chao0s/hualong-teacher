/**
 * 定位 `db/testdata` —— 它在**另一个仓库** `hualong-backend` 里。
 *
 * 探针要从那里 `require` `pg`（本仓库不依赖它：本仓库不连数据库，只有探针连），
 * 也用它的路径推 `dataset.json` 之类的同目录产物。
 *
 * 与 `tools/openapi-source.mjs` 同一套候选表写法，理由也同一条：**本仓库不复制一份**。
 * 一份复制品会悄悄过期，而过期的测试数据比没有测试数据更糟。
 *
 * 用 `HUALONG_TESTDATA=<绝对路径>` 覆盖。
 */

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

const CANDIDATES = [
  process.env.HUALONG_TESTDATA,
  resolve(REPO, '..', 'hualong-backend', 'db', 'testdata'),
].filter(Boolean);

/** @returns {string} `db/testdata` 的绝对路径 */
export function testdataPath() {
  for (const c of CANDIDATES) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    `找不到 db/testdata。已尝试：\n  ${CANDIDATES.join('\n  ')}\n`
    + '设置 HUALONG_TESTDATA=<绝对路径> 指向 hualong-backend/db/testdata。',
  );
}

/** 薄契约服务端连的那个库。与 `server/server.mjs` 的默认值逐字相同。 */
export const DB_URL = process.env.DATABASE_URL
  ?? 'postgres://postgres:postgres@localhost:5432/hualong_test';
