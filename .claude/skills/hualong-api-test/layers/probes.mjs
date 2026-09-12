/**
 * probes —— the 18 probe scripts, plus the backend's seven authorisation groups.
 *
 * These are the layer that answers "does the client actually work against a
 * running server". Everything above reads text; these make requests. They were
 * designed as a layer and were never wired in, so the only way to run them was
 * to remember all eighteen names and the authz invocation.
 *
 * ## They do not start the stack
 *
 * A probe needs a live testdata server. When one is not answering this layer
 * SKIPS and prints the four commands that raise it, rather than starting
 * containers it may not own. An unrunnable check that passes silently is worse
 * than no check.
 *
 * ## A probe that says nothing is a finding
 *
 * The summary line is `N 项通过，M 项失败`, and it is the probe's verdict. A probe
 * that exits without printing one has not answered anything — and until
 * 2026-09-12 several did exactly that while exiting 0.
 *
 * The cause was `setTimeout(...).unref()`. An unref'd timer does not keep the
 * event loop alive, so when the first awaited promise never settles, Node exits
 * with code 0 and prints nothing. `probe-session` is the clearest case: it was
 * written to catch a **deadlock**, its own header explains that a deadlock looks
 * like "never returns", and the unref'd timeout made it blind to precisely that.
 * Removing the unref made it report two failed checks, including a 15-second
 * hang. Any probe that exceeds its budget without speaking is reported here.
 */
import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { REPO } from '../lib/findings.mjs';

const run = promisify(execFile);
const BACKEND = join(REPO, '..', 'hualong-backend');

/** The testdata server the probes talk to. `miniprogram/config.js` points here. */
const LOCAL_API = 'http://127.0.0.1:3860/api/v1';

/** One probe's ceiling. The probes carry their own watchdogs; this is the outer bound. */
const PROBE_TIMEOUT_MS = 120_000;

/** The scoreboard convention. `probe-assessment` and 13 others write exactly this. */
const SUMMARY = /(\d+)\s*项通过[，,]\s*(\d+)\s*项失败/;

/**
 * The other convention: `PASS: <what it checked>` as the last line.
 *
 * Three probes use it — `probe-growth-record`, `probe-home-school-progress`,
 * `probe-teacher-evaluation` — and they are not broken. Reading only the
 * scoreboard format made them look silent, which is its own kind of wrong: a
 * check reported as dead when it is alive sends someone to fix nothing.
 */
const PASS_LINE = /^PASS:\s*\S/;

const invoke = async (cmd, args, cwd, needsShell = false) => {
  try {
    const { stdout, stderr } = await run(cmd, args, { cwd, maxBuffer: 1 << 26, shell: needsShell, timeout: PROBE_TIMEOUT_MS });
    return { code: 0, out: `${stdout}\n${stderr}` };
  } catch (err) {
    return { code: err.code ?? 1, out: `${err.stdout ?? ''}\n${err.stderr ?? ''}`, killed: err.killed === true };
  }
};

export async function probes(r) {
  // ── is there a server to probe? ──────────────────────────────────────────
  let up = false;
  try {
    const res = await fetch(`${LOCAL_API}/`, { signal: AbortSignal.timeout(3000) });
    up = res.status > 0;
  } catch { /* nothing is listening */ }

  if (!up) {
    r.skip('probes', `no testdata server answering ${LOCAL_API}`,
      'whether the client works against a live server — the one question a text reading cannot answer');
    console.log('   [probes] raise it, then re-run this layer:');
    console.log('     docker start hl-pg   # 127.0.0.1:5432, 60 children');
    console.log('     cd ../hualong-backend/db/testdata && node server/server.mjs');
    return;
  }

  // ── the probes ───────────────────────────────────────────────────────────
  const dir = join(REPO, 'tools');
  const files = readdirSync(dir).filter((f) => /^probe-.*\.mjs$/.test(f)).sort();
  let passed = 0;
  let failed = 0;
  const silent = [];

  for (const file of files) {
    const name = file.replace(/\.mjs$/, '');
    const { code, out, killed } = await invoke('node', [join(dir, file)], REPO);
    const m = SUMMARY.exec(out);
    const passLine = out.split('\n').map((l) => l.trim()).find((l) => PASS_LINE.test(l));

    // **没说话才算静默。** 两种约定都认，否则把活着的检查报成死的。
    if (!m && !passLine) {
      silent.push({ name, code, killed });
      continue;
    }

    if (m) {
      const [ok, bad] = [Number(m[1]), Number(m[2])];
      passed += ok;
      failed += bad;
      if (bad > 0) {
        const failing = out.split('\n').filter((l) => /^\s+-\s/.test(l)).slice(0, 5).join('\n');
        // `check-failed` 是 medium 一级：它说「这一支的断言没过」，但从摘要看不出
        // 属哪一类（exposure？data-loss？）。要升级成 high 就得先知道是哪一类。
        r.add({
          layer: 'probes', severity: 'medium', kind: 'check-failed',
          subject: name,
          what: `${name}: ${bad} of ${ok + bad} checks failed against the live server`,
          detail: failing || out.split('\n').filter(Boolean).slice(-6).join('\n'),
        });
      }
    }

    console.log(`   [probes/${name}] ${m ? m[0] : passLine}${code !== 0 ? ` (exit ${code})` : ''}`);
  }

  for (const s of silent) {
    // **静默的探针 = `stale-expectation`**，不是 `check-failed`。
    // 它没在报「检查失败」，它在报「**这条检查已经不再检查任何东西**」——
    // 与「登记表还指着一个不存在的东西」是同一类，所以是 high。
    r.add({
      layer: 'probes', severity: 'high', kind: 'stale-expectation',
      subject: s.name,
      what: `${s.name} produced no verdict line, so it checked nothing`,
      detail: `exit ${s.code}${s.killed ? ', killed at the bound' : ''} with no verdict.\n` +
        `两種已知成因：\n` +
        `  1. \`setTimeout(...).unref()\` —— unref 的计时器不让事件循环活着，\n` +
        `     于是首个 await 永不 settle 时进程静默 exit 0。\n` +
        `  2. 这支探针不用 scoreboard（用 node:assert、末尾印一行 PASS），\n` +
        `     同样会静默退出。\n` +
        `判据：它没说话，就等于它没回答。`,
    });
  }

  // ── the backend's authorisation groups ───────────────────────────────────
  const authz = join(BACKEND, 'db', 'testdata', 'authz-tests', 'run.mjs');
  const az = await invoke('node', [authz, '--base', LOCAL_API], join(BACKEND, 'db', 'testdata'));
  const azSummary = az.out.split('\n').filter((l) => /^\| [A-G] /.test(l)).join('\n');
  if (az.code !== 0) {
    r.add({
      layer: 'probes', severity: 'high', kind: 'exposure',
      subject: 'authz',
      what: 'the authorisation suite is red — a role reached something it must not',
      detail: azSummary || az.out.split('\n').filter(Boolean).slice(-8).join('\n'),
    });
  } else {
    // 表格四列是：组 | 探针 | 通过 | 未通过。要四个都抓，否则 `167/334` 读起来
    // 像「334 里的 167」，而它其实是「167 支探针，167 通过」两个数相加。
    const totals = [...az.out.matchAll(/\|\s*([A-G])\s*[^|]*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/g)]
      .map((x) => `${x[1]} ${x[3]}/${x[2]}`).join(' · ');
    console.log(`   [probes/authz] ${totals ? `${totals} (通过的/探针数，全部应有 0 未通过)` : 'passed'}`);
  }

  console.log(`   [probes] ${files.length} probe(s): ${passed} checks passed, ${failed} failed, ${silent.length} silent`);
}
