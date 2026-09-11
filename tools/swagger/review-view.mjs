/**
 * `/review` —— 大檢查的**可寫**版面。
 *
 * 為什麼有它：檢測器只會產出「發現」，判「這是不是問題」的是人。從前那一半只能
 * 在聊天裡講，判完就散掉。這一頁把每一條發現變成一列**可判的**：選一個結論、寫一句話、
 * 存下去 —— 存進 `docs/audit/checker-feedback.tsv`，下次跑檢測時它就帶著你的判斷。
 *
 * 三個規矩寫在畫面上，也寫在這裡：
 *   1. **只有帶穩定 key 的發現能判。** 其餘的標出來並說為什麼，不假裝能判。
 *   2. **判決不是決議。** 表上選了只代表「這條已審、結論是什麼、誰審的」。
 *      要變成正式決議，按原規矩改 `decision.md`／`DECISIONS.md` —— 那裡才寫得出代價。
 *   3. **每次都印出「幾條可判」。** 不可判的發現不能看起來跟可判的一樣。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { navBar } from './nav.mjs';

// 從模組位置推倉根，不用 process.cwd() —— 那要看誰從哪裡起服務，太脆。
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SEV = {
  high: { t: '高', c: '#ad2b2b', bg: '#fde8e6' },
  medium: { t: '中', c: '#9a5a06', bg: '#fdf3e3' },
  low: { t: '低', c: '#55766f', bg: '#eef5f3' },
};

/** 最新的那份報告。不按日期拼檔名 —— 拼錯了會靜默降級成錯的一列。 */
function latestReport(reportDir) {
  if (!existsSync(reportDir)) return null;
  const f = readdirSync(reportDir).filter((x) => x.endsWith('.json')).sort().pop();
  if (!f) return null;
  return { file: f, data: JSON.parse(readFileSync(join(reportDir, f), 'utf8')) };
}

/**
 * `navUrls` 是这一页能到达的全部目的地（键 → 网址），四个路由传的是同一组。
 *
 * @param {{navUrls: object, extra?: Array, omit?: string[]}} links
 */
export function reviewPage({ navUrls, omit = [], extra = [] }) {
  const reportDir = join(REPO, 'tools', '.report', 'api-test');
  const rep = latestReport(reportDir);
  const nav = navBar({ current: 'review', urls: navUrls, omit, title: '检测评审', extra });

  const head = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>检测评审 · 可写</title><style>
:root{--pg:#eef5f3;--card:#fff;--line:#d5e6e2;--line2:#e7f1ef;
--ink:#10302d;--ink2:#35564f;--ink3:#55766f;--link:#0a6472}
*{box-sizing:border-box}
body{margin:0;background:var(--pg);color:var(--ink);font:14px/1.6 -apple-system,"Microsoft YaHei",system-ui,sans-serif}
/* 顶栏的样式跟着顶栏走：唯一一份在 tools/swagger/nav.mjs，四个页面共用。这里不再写第二份。 */
.wrap{max-width:1100px;margin:0 auto;padding:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin:12px 0}
.mut{color:var(--ink3)}
.key{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--ink2);background:#f5faf9;
border:1px solid var(--line2);border-radius:4px;padding:1px 6px;word-break:break-all}
.sev{display:inline-block;font-weight:600;font-size:12px;border-radius:4px;padding:1px 7px;margin-right:8px}
select,input,textarea{font:inherit;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:5px;padding:4px 8px}
textarea{width:100%;min-height:44px;resize:vertical}
.row{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start;margin-top:10px}
button{font:inherit;background:#0a6472;color:#fff;border:0;border-radius:5px;padding:6px 14px;cursor:pointer}
button:hover{background:#0d5a53}
.saved{color:#0b7a4b;font-weight:600}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line2);vertical-align:top}
th{color:var(--ink3);font-weight:600;background:#f5faf9}
.note{background:#f5faf9;border-left:3px solid var(--link);padding:8px 12px;margin:12px 0;color:var(--ink2)}
</style></head><body>
${nav}<div class="wrap">`;

  if (!rep) {
    return head + `<div class="card"><h2>还没有检测报告</h2>
      <p class="mut">先跑一次：<code>node .claude/skills/hualong-api-test/run.mjs</code></p></div></div></body></html>`;
  }

  const { findings = [], skipped = [], reviewability, started } = rep.data;
  const reviewable = findings.filter((f) => f.reviewable);
  const unkeyed = findings.filter((f) => !f.reviewable);

  const rows = reviewable.map((f) => {
    const s = SEV[f.severity] ?? SEV.low;
    return `<tr data-key="${esc(f.key)}">
  <td style="white-space:nowrap"><span class="sev" style="color:${s.c};background:${s.bg}">${s.t}</span></td>
  <td>
    <div><b>${esc(f.layer)}</b> <span class="mut">/ ${esc(f.kind)}</span></div>
    <div>${esc(f.what)}</div>
    <div style="margin-top:5px"><span class="key">${esc(f.key)}</span></div>
    ${f.detail ? `<details style="margin-top:5px"><summary class="mut">细节</summary><pre style="white-space:pre-wrap;font-size:12px;color:var(--ink2)">${esc(f.detail)}</pre></details>` : ''}
  </td>
  <td style="min-width:330px">
    <select class="st" aria-label="结论"><option value="">（未审）</option></select>
    <textarea class="nt" placeholder="理由（一句）"></textarea>
    <div class="row"><button class="sv">保存</button><span class="res mut"></span></div>
  </td>
</tr>`;
  }).join('\n');

  return head + `
<div class="card">
  <h2 style="margin:0 0 6px">检测评审 · 可写</h2>
  <div class="mut">报告 <span class="key">${esc(rep.file)}</span> · 起于 ${esc(started ?? '?')}</div>
  <div style="margin-top:8px">
    <b>${reviewable.length}</b> 条可判 · ${unkeyed.length} 条不可判 · ${skipped.length} 层跳过
  </div>
  <div class="row">
    <label>你的名字 <input id="who" placeholder="写你的 handle，判断要署名" style="width:180px"></label>
    <span class="mut" id="whohint">判断会写进 docs/audit/checker-feedback.tsv</span>
  </div>
</div>

<div class="note">
  <b>表上选的不算决议。</b> 这里只记「这条已审 · 结论是什么 · 谁审的 · 什么时候」。
  要变成正式决议，按原规矩改 <code>decision.md</code>／<code>DECISIONS.md</code> —— 那里才写得出理由与代价。
  两边权威相等的话，以后对不上就没人知道该信谁。
</div>

${reviewable.length ? `<div class="card"><table>
<tr><th>级</th><th>发现</th><th>结论</th></tr>
${rows}
</table></div>` : `<div class="card"><p class="mut">这一轮没有可判的发现。</p></div>`}

${unkeyed.length ? `<div class="card">
  <h3 style="margin-top:0">${unkeyed.length} 条不可判</h3>
  <p class="mut">它们没有稳定主体，所以无法承结论 —— 给它一个 <code>subject</code> 就能判。
     这件事要被数出来：不可判的发现不能看起来跟可判的一样。</p>
  <table><tr><th>层</th><th>说了什么</th></tr>
  ${unkeyed.map((f) => `<tr><td>${esc(f.layer)}/${esc(f.kind)}</td><td>${esc(f.what)}</td></tr>`).join('\n')}
  </table></div>` : ''}

${skipped.length ? `<div class="card">
  <h3 style="margin-top:0">${skipped.length} 层跳过</h3>
  <table><tr><th>层</th><th>为什么跳过</th><th>因此不知道什么</th></tr>
  ${skipped.map((s) => `<tr><td>${esc(s.layer)}</td><td>${esc(s.why)}</td><td>${esc(s.unknown)}</td></tr>`).join('\n')}
  </table></div>` : ''}

<script>
(function(){
  var VOCAB = null, WHO = localStorage.getItem('reviewer') || '';
  var who = document.getElementById('who');
  who.value = WHO;
  who.addEventListener('change', function(){ localStorage.setItem('reviewer', who.value.trim()); });

  // 词表与已有结论都从同一条路由读 —— 一处定义，不在这里抄第二份。
  fetch('/feedback').then(function(r){ return r.json(); }).then(function(j){
    VOCAB = j;
    var opts = j.values.map(function(v){ return '<option value="'+v+'">'+v+' — '+(j.status[v]||'')+'</option>'; }).join('');
    var byKey = {}; j.rows.forEach(function(r){ byKey[r.key] = r; });
    document.querySelectorAll('tr[data-key]').forEach(function(tr){
      var sel = tr.querySelector('.st');
      sel.insertAdjacentHTML('beforeend', opts);
      var ex = byKey[tr.dataset.key];
      if (ex) {
        sel.value = ex.status;
        tr.querySelector('.nt').value = ex.note || '';
        tr.querySelector('.res').innerHTML = '<span class="saved">已判</span> <span class="mut">' +
          (ex.reviewer||'') + ' ' + (ex.updated_at||'') + '</span>';
      }
    });
  });

  document.querySelectorAll('tr[data-key] .sv').forEach(function(btn){
    btn.addEventListener('click', function(){
      var tr = btn.closest('tr[data-key]');
      var status = tr.querySelector('.st').value;
      var note = tr.querySelector('.nt').value.trim();
      var res = tr.querySelector('.res');
      var me = (document.getElementById('who').value || '').trim();
      if (!status) { res.textContent = '先选一个结论'; return; }
      if (!me) { res.textContent = '先写名字 — 判断要署名'; return; }
      res.textContent = '保存中…';
      fetch('/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: tr.dataset.key, status: status, note: note, reviewer: me })
      }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); })
        .then(function(x){
          if (!x.ok) { res.textContent = '没存上：' + (x.j.error || '?'); return; }
          res.innerHTML = '<span class="saved">已存</span> <span class="mut">' + x.j.row.reviewer + ' ' + x.j.row.updated_at + '</span>';
        })
        .catch(function(e){ res.textContent = '没存上：' + e.message; });
    });
  });
})();
</script>
</div></body></html>`;
}
