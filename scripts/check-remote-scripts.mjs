// Fail when a remote <script src="http(s)://..."> appears in tracked content.
//
// Why this exists: the prototypes once carried a design-tool capture script in
// 51 files. A Mini Program cannot load remote scripts at all, and a prototype
// carrying one silently re-enters the app when markup is copied during
// migration. The failure then surfaces at package time; this check moves it to
// commit time.
//
//   node scripts/check-remote-scripts.mjs            scan the working tree
//   node scripts/check-remote-scripts.mjs --staged   scan staged files (hook)

import { execSync } from 'node:child_process'
import fs from 'node:fs'

const STAGED = process.argv.includes('--staged')
const EXT = /\.(html|js|mjs|json|wxml|wxss|md)$/i
const REMOTE_SCRIPT = /<script[^>]+src\s*=\s*["']https?:\/\//i

const list = STAGED
  ? execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' })
  : execSync('git ls-files', { encoding: 'utf8' })

const offenders = []
for (const f of list.split('\n').map((s) => s.trim()).filter(Boolean)) {
  if (!EXT.test(f) || /^Archive\//.test(f) || /^docs\/Archive\//.test(f)) continue
  let text
  if (STAGED) {
    try { text = execSync(`git show :"${f}"`, { encoding: 'utf8' }) } catch { continue }
  } else {
    if (!fs.existsSync(f)) continue
    text = fs.readFileSync(f, 'utf8')
  }
  if (REMOTE_SCRIPT.test(text)) offenders.push(f)
}

if (offenders.length) {
  console.error('✗ Remote <script src="http..."> found — a Mini Program cannot load remote scripts:')
  offenders.forEach((f) => console.error('   ' + f))
  console.error('Remove the tag. If the file is frozen history, it belongs under Archive/.')
  process.exit(1)
}
console.log(`✓ No remote script references${STAGED ? ' in staged files' : ''}.`)
