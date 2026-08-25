// dashboard-page.mjs — shell HTML della dashboard interna (#4), servita same-origin
// da GET /admin/dashboard (i fetch a /admin/metrics non passano da CORS).
// Auth: chiave admin passata via URL (?key=...) o incollata una volta → localStorage →
// header X-Admin-Key. Nessun login, nessun JWT da estrarre. Bookmarkabile.
// Solo metriche MISURATE (niente prezzo/MRR/margine: reintrodotti quando i prezzi
// per-brand saranno decisi, E18-005).

export function dashboardHtml() {
    return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Portfolio dashboard (interna)</title>
<style>
  :root { --bg:#0d1117; --card:#161b22; --line:#30363d; --fg:#e6edf3; --mut:#8b949e; --acc:#2f81f7; --bad:#f85149; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.45 -apple-system,Segoe UI,Roboto,sans-serif; }
  header { padding:16px 20px; border-bottom:1px solid var(--line); display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
  header h1 { font-size:16px; margin:0 12px 0 0; }
  input,select,button { background:var(--card); color:var(--fg); border:1px solid var(--line); border-radius:6px; padding:6px 8px; font:inherit; }
  button { cursor:pointer; }
  button.primary { background:var(--acc); border-color:var(--acc); color:#fff; }
  main { padding:20px; max-width:1200px; margin:0 auto; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:12px; margin-bottom:20px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px; }
  .card h3 { margin:0 0 10px; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--mut); }
  .kv { display:flex; justify-content:space-between; padding:3px 0; }
  .kv b { font-variant-numeric:tabular-nums; }
  table { width:100%; border-collapse:collapse; margin-top:8px; }
  th,td { text-align:right; padding:8px 10px; border-bottom:1px solid var(--line); font-variant-numeric:tabular-nums; }
  th:first-child,td:first-child { text-align:left; }
  .muted { color:var(--mut); }
  .err { color:var(--bad); margin-bottom:12px; }
  .pill { font-size:11px; color:var(--mut); }
</style>
</head>
<body>
<header>
  <h1>Portfolio dashboard <span class="pill">interna</span></h1>
  <label>Giorni <input id="days" type="number" value="30" min="1" max="365" style="width:70px"></label>
  <label>Brand <select id="brand"><option value="">All</option></select></label>
  <button class="primary" id="go">Aggiorna</button>
  <button id="setkey" title="Cambia chiave">🔑</button>
  <span id="meta" class="pill"></span>
</header>
<main>
  <div id="err" class="err"></div>
  <table id="cmp"><thead><tr><th>Brand</th><th>Activation %</th><th>D7 %</th><th>Summaries/User</th><th>Paid %</th><th>Cost/User $</th></tr></thead><tbody></tbody></table>
  <div id="blocks"></div>
</main>
<script>
const $ = (id) => document.getElementById(id);
const fmt = (v, s='') => (v===null||v===undefined) ? '<span class="muted">—</span>' : (v+s);
// Chiave: da ?key=... (poi ripulita dall'URL) oppure da localStorage.
(function(){
  const u=new URL(location.href); const k=u.searchParams.get('key');
  if(k){ localStorage.setItem('adm_key',k); u.searchParams.delete('key'); history.replaceState(null,'',u.toString()); }
})();
function key(){ return localStorage.getItem('adm_key')||''; }
function kv(k,v){ return '<div class="kv"><span class="muted">'+k+'</span><b>'+v+'</b></div>'; }
function block(title, m){
  const a=m.acquisition,e=m.engagement,r=m.retention,mo=m.money;
  return '<div class="card"><h3>'+title+'</h3>'+
    '<div class="grid" style="margin:0">'+
    '<div>'+kv('Install',a.installs)+kv('Open',a.opens)+kv('Login',a.logins)+kv('First-summary users',a.firstSummaryUsers)+kv('Activation %',fmt(a.activationPct,'%'))+'</div>'+
    '<div>'+kv('Summaries',e.summaries)+kv('Active users',e.activeUsers)+kv('Summaries/User',e.summariesPerUser)+kv('Repeat %',fmt(e.repeatPct,'%'))+'</div>'+
    '<div>'+kv('Retention D1',fmt(r.d1,'%'))+kv('Retention D7',fmt(r.d7,'%'))+kv('Retention D30',fmt(r.d30,'%'))+kv('Coorte',r.cohort)+'</div>'+
    '<div>'+kv('Users',mo.totalUsers)+kv('Premium',mo.premiumUsers)+kv('Paid %',fmt(mo.paidPct,'%'))+kv('Checkout avviati',mo.checkoutStarted)+kv('Subscription attivate',mo.subscriptionActivated)+kv('Cost/summary $',mo.cost.perSummary)+kv('Cost/user $',mo.cost.perActiveUser)+'</div>'+
    '</div></div>';
}
async function load(){
  $('err').textContent='';
  if(!key()){ $('err').textContent='Chiave admin mancante. Apri l’URL con ?key=... (una volta) oppure premi 🔑 per incollarla.'; return; }
  const qs=new URLSearchParams({days:$('days').value});
  if($('brand').value) qs.set('brand',$('brand').value);
  let data;
  try{
    const res=await fetch('metrics?'+qs.toString(),{headers:{'X-Admin-Key':key()}});
    data=await res.json();
    if(!res.ok){ $('err').textContent=(data && (data.error||data.code))||('HTTP '+res.status); return; }
  }catch(ex){ $('err').textContent='Errore rete: '+ex.message; return; }
  $('meta').textContent=data.period ? (data.period.days+'g · '+(data.assumptions&&data.assumptions.note||'')) : '';
  if($('brand').options.length===1 && data.comparison){
    for(const c of data.comparison){ const o=document.createElement('option'); o.value=o.textContent=c.brand; $('brand').appendChild(o); }
  }
  const tb=$('cmp').querySelector('tbody'); tb.innerHTML='';
  for(const c of (data.comparison||[])){ tb.innerHTML+='<tr><td>'+c.brand+'</td><td>'+fmt(c.activationPct)+'</td><td>'+fmt(c.d7)+'</td><td>'+c.summariesPerUser+'</td><td>'+fmt(c.paidPct)+'</td><td>'+c.costPerUser+'</td></tr>'; }
  const bl=$('blocks'); bl.innerHTML='';
  if(data.brands){ bl.innerHTML+=block('All (portfolio)',data.all); for(const b of Object.keys(data.brands)) bl.innerHTML+=block(b,data.brands[b]); }
  else if(data.metrics){ bl.innerHTML+=block(data.brand,data.metrics); }
}
$('go').addEventListener('click',load);
$('setkey').addEventListener('click',()=>{ const k=prompt('Chiave admin:'); if(k){ localStorage.setItem('adm_key',k.trim()); load(); } });
if(key()) load(); else $('err').textContent='Chiave admin mancante. Apri l’URL con ?key=... oppure premi 🔑.';
</script>
</body>
</html>`;
}
