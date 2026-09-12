/**
 * Rendering: does the screen actually draw.
 *
 * The last line of CLAUDE.md §6 says it plainly — the ten-step gate, the
 * probes and the wiring scanner cannot see rendering. They read source text.
 * A handler that exists, calls the right service and sets the right data can
 * still produce a blank page, and nothing in this repository would go red.
 *
 * This layer CALLS `tools/render-pages.mjs`, which drives WeChat DevTools
 * through `miniprogram-automator`. It reports both the per-screen element it
 * read and the screenshot path, because "it ran" is not "it drew".
 *
 * It cannot run in CI and does not pretend otherwise: DevTools needs a GUI and
 * a QR sign-in. When it is absent this layer SKIPS and names what that leaves
 * unknown — an unrunnable check that passes silently is worse than no check.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { REPO } from '../lib/findings.mjs';

const run = promisify(execFile);

const CLI_CANDIDATES = [
  process.env.WX_DEVTOOLS_CLI,
  'C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat',
  'C:/Program Files/Tencent/微信web开发者工具/cli.bat',
  join(process.env.LOCALAPPDATA ?? '', '微信开发者工具', 'cli.bat'),
  '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
].filter(Boolean);

export async function render(r) {
  const script = join(REPO, 'tools', 'render-pages.mjs');
  if (!existsSync(script)) {
    r.skip('render', 'tools/render-pages.mjs is absent', 'whether any screen draws at all');
    return;
  }
  const cli = CLI_CANDIDATES.find((p) => existsSync(p));
  if (!cli) {
    r.skip('render',
      `WeChat DevTools is not installed (looked in ${CLI_CANDIDATES.length} places); install it and sign in once`,
      'whether every screen draws — the one question the gate, the probes and the wiring scanner all cannot answer');
    return;
  }

  try {
    // **要把 56 屏都跑一遍**，不是只跑 3 个样本。样本能证明「工具通了」，
    // 证明不了「每一屏都画得出来」—— 而后者才是这一层存在的理由。
    const { stdout } = await run('node', [script, '--all'], { cwd: REPO, maxBuffer: 1 << 26, timeout: 900000 });
    const line = stdout.split('\n').find((l) => /跑通/.test(l)) ?? stdout.split('\n').filter(Boolean).slice(-1)[0];
    console.log(`   [render] ${line}`);
    // The screenshot paths are the evidence. A run that drew nothing cannot
    // produce them, so their absence is reported rather than assumed away.
    const shots = [...stdout.matchAll(/截图: (.+\.png)/g)].map((m) => m[1]);
    if (!shots.length) {
      r.add({
        layer: 'render', severity: 'medium', kind: 'check-failed',
        subject: 'no-evidence',
        what: 'the render run produced no screenshot paths, so nothing is evidenced as drawn',
        detail: stdout.split('\n').filter(Boolean).slice(-8).join('\n'),
      });
    } else {
      console.log(`   [render] ${shots.length} screenshot(s) written`);
    }

    // ── 画出来了，但画的是「失败」 ────────────────────────────────────────
    //
    // 这是**只有这一层看得见**的一类缺陷：屏幕渲染成功、元素找得到、data 也有键，
    // 而屏上写的是「网络请求失败」。契约、接线、库全绿也照样发生 ——
    // 因为它们读的是源码文本，不是屏幕。
    //
    // 与上面那个数**分开报**：那是「没画出来」，这是「画出来了、画错了」。
    // 合成一个数就分不出是哪一种，而两者的修法完全不同。
    const drawn = [...stdout.matchAll(/⚠ (\S+) —— 屏上出现 (.+)/g)];
    for (const m of drawn) {
      r.add({
        layer: 'render', severity: 'high', kind: 'draws-failure',
        subject: m[1],
        what: `the screen draws, but what it draws is a failure: ${m[2].trim()}`,
        detail: `这一屏能渲染、元素找得到、data 有键，而屏上写的是失败提示。\n` +
          `别的层看不见它：契约、接线、库全绿也一样发生。\n` +
          `先看后端有没有起来（config.js 指的那个位址），那是这类屏最常见的原因。`,
      });
    }
    if (drawn.length) console.log(`   [render] ${drawn.length} screen(s) draw a failure`);
  } catch (err) {
    r.add({
      layer: 'render', severity: 'medium', kind: 'check-failed',
      subject: 'run-failed',
      what: 'the render run failed — some screen did not draw',
      detail: String(err.stdout ?? err.message).split('\n').filter(Boolean).slice(-10).join('\n'),
    });
  }
}
