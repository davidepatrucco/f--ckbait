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
  h2 { font-size:15px; margin:32px 0 6px; }
  #cfgt td { vertical-align:middle; }
  #cfgt input[type=number] { width:110px; text-align:right; }
  #cfgt tr.changed td { background:rgba(47,129,247,.08); }
  .tag { font-size:11px; padding:1px 6px; border-radius:999px; border:1px solid var(--line); color:var(--mut); }
  .tag.on { border-color:var(--acc); color:var(--acc); }
  .ok { color:#3fb950; }
  .row { display:flex; gap:10px; align-items:center; margin-top:12px; flex-wrap:wrap; }
  details { margin-top:16px; } summary { cursor:pointer; color:var(--mut); }
  code { font-size:12px; color:var(--mut); }
</style>
</head>
<body>
<header>
  <h1>Portfolio dashboard <span class="pill">interna</span></h1>
  <label>Giorni <input id="days" type="number" value="30" min="1" max="365" style="width:70px"></label>
  <label>Brand <select id="brand"><option value="">All</option></select></label>
  <button class="primary" id="go">Aggiorna</button>
  <button id="setkey" title="Cambia chiave" aria-label="Cambia chiave"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="15" r="4"></circle><path d="M9.5 12.5L20 2M16 6l3 3M19 3l2 2"></path></svg></button>
  <span id="meta" class="pill"></span>
</header>
<main>
  <div id="err" class="err"></div>
  <table id="cmp"><thead><tr><th>Brand</th><th>Activation %</th><th>D7 %</th><th>Summaries/User</th><th>Paid %</th><th>Cost/User $</th></tr></thead><tbody></tbody></table>
  <div id="blocks"></div>

  <h2>Configurazione</h2>
  <p class="muted" style="margin:0">Valori applicati dal server senza rilascio, entro un minuto. Ogni salvataggio crea una versione nello storico. Valori fuori intervallo o incoerenti vengono rifiutati.</p>
  <div id="cfgerr" class="err" style="margin-top:10px"></div>
  <table id="cfgt"><thead><tr><th>Parametro</th><th>Attuale</th><th>Nuovo valore</th><th>Intervallo</th><th></th></tr></thead><tbody></tbody></table>
  <div class="row"><button class="primary" id="cfgsave">Salva modifiche</button><span id="cfgmsg" class="muted"></span></div>
  <details><summary>Storico versioni</summary><table id="cfgh"><thead><tr><th>Versione</th><th>Quando</th><th>Chi</th><th>Valori personalizzati</th></tr></thead><tbody></tbody></table></details>
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
  if(!key()){ $('err').textContent='Chiave admin mancante. Apri l’URL con ?key=... (una volta) oppure premi il pulsante Chiave per incollarla.'; return; }
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
// --- Configurazione a runtime (GET/POST /admin/config) ---
let cfg=null; const resetKeys=new Set();
const esc=(v)=>String(v).replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function loadCfg(){
  $('cfgerr').textContent=''; resetKeys.clear();
  try{
    const res=await fetch('config',{headers:{'X-Admin-Key':key()}});
    const d=await res.json();
    if(!res.ok){ $('cfgerr').textContent=(d&&(d.error||d.code))||('HTTP '+res.status); return; }
    cfg=d;
  }catch(ex){ $('cfgerr').textContent='Errore rete: '+ex.message; return; }
  const tb=$('cfgt').querySelector('tbody'); tb.innerHTML='';
  for(const [k,sc] of Object.entries(cfg.schema)){
    const cur=cfg.effective[k]; const custom=Object.prototype.hasOwnProperty.call(cfg.overrides,k);
    const bool=sc.min===0&&sc.max===1;
    const input=bool
      ? '<label><input type="checkbox" data-k="'+esc(k)+'"'+(cur?' checked':'')+'> attivo</label>'
      : '<input type="number" data-k="'+esc(k)+'" min="'+sc.min+'" max="'+sc.max+'" step="1" value="'+esc(cur)+'">';
    tb.innerHTML+='<tr data-row="'+esc(k)+'"><td>'+esc(sc.description)+'<br><code>'+esc(k)+'</code></td>'+
      '<td>'+(bool?(cur?'sì':'no'):esc(cur))+' '+(custom?'<span class="tag on">personalizzato</span>':'<span class="tag">predefinito</span>')+'</td>'+
      '<td>'+input+'</td><td class="muted">'+sc.min+'–'+sc.max+'</td>'+
      '<td>'+(custom?'<button data-reset="'+esc(k)+'" title="Torna al valore predefinito">Predefinito</button>':'')+'</td></tr>';
  }
  tb.querySelectorAll('[data-k]').forEach((el)=>el.addEventListener('input',()=>{ el.closest('tr').classList.toggle('changed', val(el)!==cfg.effective[el.dataset.k]); }));
  tb.querySelectorAll('[data-reset]').forEach((b)=>b.addEventListener('click',()=>{ resetKeys.add(b.dataset.reset); b.closest('tr').classList.add('changed'); b.textContent='Al salvataggio'; b.disabled=true; }));
  const hb=$('cfgh').querySelector('tbody'); hb.innerHTML='';
  for(const v of (cfg.history||[])){ hb.innerHTML+='<tr><td>v'+esc(v.version)+(v.version===cfg.version?' <span class="tag on">attiva</span>':'')+'</td><td>'+esc(new Date(v.updatedAt).toLocaleString())+'</td><td>'+esc(v.updatedBy||'')+'</td><td><code>'+esc(JSON.stringify(v.values||{}))+'</code></td></tr>'; }
}
function val(el){ return el.type==='checkbox' ? (el.checked?1:0) : Number(el.value); }
async function saveCfg(){
  $('cfgerr').textContent=''; $('cfgmsg').textContent='';
  const values={};
  document.querySelectorAll('#cfgt [data-k]').forEach((el)=>{ const k=el.dataset.k; if(val(el)!==cfg.effective[k]) values[k]=val(el); });
  if(!Object.keys(values).length && !resetKeys.size){ $('cfgmsg').textContent='Nessuna modifica.'; return; }
  const lines=Object.entries(values).map(([k,v])=>k+': '+cfg.effective[k]+' -> '+v).concat([...resetKeys].map((k)=>k+': torna al predefinito'));
  if(!confirm('Applicare in produzione?\\n\\n'+lines.join('\\n'))) return;
  try{
    const res=await fetch('config',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Key':key()},body:JSON.stringify({values,reset:[...resetKeys],updatedBy:'dashboard'})});
    const d=await res.json();
    if(!res.ok){
      const det=(d.errors||[]).map((e)=>e.key+': '+e.reason).concat(d.problems||[]);
      $('cfgerr').textContent=(d.error||('HTTP '+res.status))+(det.length?' — '+det.join('; '):'');
      return;
    }
    await loadCfg();
    $('cfgmsg').innerHTML='<span class="ok">Salvato: versione v'+esc(d.version)+'.</span>';
  }catch(ex){ $('cfgerr').textContent='Errore rete: '+ex.message; }
}
$('cfgsave').addEventListener('click',saveCfg);
$('go').addEventListener('click',load);
$('setkey').addEventListener('click',()=>{ const k=prompt('Chiave admin:'); if(k){ localStorage.setItem('adm_key',k.trim()); load(); loadCfg(); } });
if(key()) { load(); loadCfg(); } else $('err').textContent='Chiave admin mancante. Apri l’URL con ?key=... oppure premi il pulsante Chiave.';
</script>
</body>
</html>`;
}
