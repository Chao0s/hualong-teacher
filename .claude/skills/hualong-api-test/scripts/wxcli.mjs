/**
 * 直接起微信开发者工具的 CLI，**不經過 cli.bat**。
 *
 * 為什麼不用 cli.bat：從 bash 起 .bat 時，安裝路徑 `C:\Program Files (x86)\...`
 * 會被空白拆開（`'C:\Program' is not recognized`）。用陣列參數直接 spawn，
 * 不經過任何 shell，那次拆解就不會發生。
 *
 * 內容逐字抄 cli.bat 做過的事：
 *   ELECTRON_RUN_AS_NODE=1
 *   <electron.exe> -e <BOOTSTRAP_JS> <cli/index.js> <args...>
 *
 * stdio 全部 inherit —— **CLI 從控制台讀**，不是從管道。所以這個腳本必須在 pty 裡跑。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const DIR = 'C:\\Program Files (x86)\\Tencent\\微信web开发者工具';
const EXE = `${DIR}\\微信开发者工具.exe`;
const CLI = `${DIR}\\resources\\app.asar.unpacked\\js\\common\\cli\\index.js`;

// 逐字抄自 cli.bat 的 BOOTSTRAP_JS
const BOOTSTRAP_JS = "const e=process.argv[1],a=process.argv.slice(2).filter(function(x){return x!=='--electron'});if(!process.env.cwd)process.env.cwd=process.cwd();process.argv=[process.execPath,'--ms-enable-electron-run-as-node',e,'--electron'].concat(a);require(e)";

for (const [label, p] of [['electron', EXE], ['cli.js', CLI]]) {
  if (!existsSync(p)) { console.error(`  ✗ 找不到 ${label}: ${p}`); process.exit(1); }
}

const args = process.argv.slice(2);
console.log(`  起：${EXE}`);
console.log(`  参数：${args.join(' ') || '(无)'}`);

const child = spawn(EXE, ['-e', BOOTSTRAP_JS, CLI, ...args], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});

child.on('exit', (code) => { console.log(`\n  子行程退出，code=${code}`); process.exit(code ?? 0); });
child.on('error', (e) => { console.error(`  ✗ ${e.message}`); process.exit(1); });
