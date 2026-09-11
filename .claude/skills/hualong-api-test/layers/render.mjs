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
    const { stdout } = await run('node', [script], { cwd: REPO, maxBuffer: 1 << 26, timeout: 600000 });
    const line = stdout.split('\n').find((l) => /跑通/.test(l)) ?? stdout.split('\n').filter(Boolean).slice(-1)[0];
    console.log(`   [render] ${line}`);
    // The screenshot paths are the evidence. A run that drew nothing cannot
    // produce them, so their absence is reported rather than assumed away.
    const shots = [...stdout.matchAll(/截图: (.+\.png)/g)].map((m) => m[1]);
    if (!shots.length) {
      r.add({
        layer: 'render', severity: 'medium', kind: 'check-failed',
        what: 'the render run produced no screenshot paths, so nothing is evidenced as drawn',
        detail: stdout.split('\n').filter(Boolean).slice(-8).join('\n'),
      });
    } else {
      console.log(`   [render] ${shots.length} screenshot(s) written`);
    }
  } catch (err) {
    r.add({
      layer: 'render', severity: 'medium', kind: 'check-failed',
      what: 'the render run failed — some screen did not draw',
      detail: String(err.stdout ?? err.message).split('\n').filter(Boolean).slice(-10).join('\n'),
    });
  }
}
