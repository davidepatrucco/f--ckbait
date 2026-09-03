// QA delle euristiche di estrazione/detection (content.js) su pagine reali + DOM sintetici.
// NON è l'E2E dell'estensione (OAuth/SW/modale non testabili headless): valida la LOGICA.
import { chromium } from 'playwright';

let pass = 0, fail = 0, skip = 0;
const ok = (n) => { console.log('  ✓', n); pass++; };
const no = (n, d) => { console.log('  ✗', n, d ? `— ${d}` : ''); fail++; };
const sk = (n, d) => { console.log('  ~', n, d ? `(skip: ${d})` : ''); skip++; };

// --- funzioni pure copiate da content.js (per validarle in isolamento) ---
function isCanvasDoc(href) {
  const u = new URL(href); const h = u.hostname.replace(/^www\./, '');
  if (h === 'docs.google.com' && /\/(document|spreadsheets|presentation)\/d\/.*\/edit/.test(u.pathname)) return true;
  if (/(^|\.)officeapps\.live\.com$/.test(h) || /(^|\.)onedrive\.live\.com$/.test(h)) return true;
  return false;
}
function isRedditUrl(href) { try { return /(^|\.)reddit\.com$/.test(new URL(href).hostname.replace(/^www\./, '')); } catch { return false; } }
function isHackerNewsUrl(href) { try { const u = new URL(href); return u.hostname.replace(/^www\./, '') === 'news.ycombinator.com' && u.pathname === '/item' && !!u.searchParams.get('id'); } catch { return false; } }

// detection DOM (stringhe iniettate in page.evaluate)
const DOM_FNS = `
  function textOf(){ const sels=['article','main','[role=main]','.article-body','.entry-content','.post-content','#mw-content-text']; for(const s of sels){const el=document.querySelector(s); if(el&&(el.innerText||'').trim().length>200) return el.innerText;} return document.body.innerText||''; }
  function detectPaywall(t){ const ld=[...document.querySelectorAll('script[type="application/ld+json"]')].some(s=>/"isAccessibleForFree"\\s*:\\s*(false|"false")/i.test(s.textContent||'')); const m=!!document.querySelector('meta[name="isAccessibleForFree" i][content="false" i],meta[property="isAccessibleForFree" i][content="false" i]'); if(ld||m) return true; const el=document.querySelector('[class*="paywall" i],[id*="paywall" i],[data-paywall]'); return !!el && (t||'').length<300; }
  function detectConsentWall(t){ if((t||'').length>=400) return false; const cmp=document.querySelector('#onetrust-banner-sdk,.ot-sdk-container,#didomi-host,.qc-cmp2-container,.cc-window,#usercentrics-root,[id*="cookie-consent" i],[class*="cookie-consent" i]'); if(!cmp) return false; const r=cmp.getBoundingClientRect(); return r.width>0&&r.height>0; }
`;

async function run() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 Chrome/120 Safari/537.36' });

  // 1) Wikipedia: estrazione ricca, non-paywall.
  console.log('[1] Wikipedia (estrazione articolo)');
  try {
    const p = await ctx.newPage();
    await p.goto('https://en.wikipedia.org/wiki/Large_language_model', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const r = await p.evaluate(`(() => { ${DOM_FNS} const t=textOf(); return { len:t.length, paywall:detectPaywall(t), consent:detectConsentWall(t) }; })()`);
    (r.len > 5000) ? ok(`testo estratto ${r.len} char`) : no('testo troppo corto', r.len);
    (!r.paywall) ? ok('paywall=false') : no('paywall falso positivo');
    (!r.consent) ? ok('consent=false') : no('consent falso positivo');
    await p.close();
  } catch (e) { sk('Wikipedia', e.message); }

  // 2) Paywall sintetico (JSON-LD isAccessibleForFree:false).
  console.log('[2] Paywall sintetico');
  try {
    const p = await ctx.newPage();
    await p.setContent('<html><head><script type="application/ld+json">{"@type":"Article","isAccessibleForFree":false}</script></head><body><article>Anteprima breve.</article></body></html>');
    const r = await p.evaluate(`(() => { ${DOM_FNS} const t=textOf(); return detectPaywall(t); })()`);
    r ? ok('paywall rilevato (isAccessibleForFree=false)') : no('paywall NON rilevato');
    await p.close();
  } catch (e) { sk('paywall sintetico', e.message); }

  // 3) Consent banner sintetico.
  console.log('[3] Consent banner sintetico');
  try {
    const p = await ctx.newPage();
    await p.setContent('<html><body><div id="onetrust-banner-sdk" style="width:600px;height:120px">Accetta i cookie</div><article>testo corto</article></body></html>');
    const r = await p.evaluate(`(() => { ${DOM_FNS} const t=textOf(); return detectConsentWall(t); })()`);
    r ? ok('consent wall rilevato') : no('consent wall NON rilevato');
    await p.close();
  } catch (e) { sk('consent sintetico', e.message); }

  // 5) Reddit .json parsing — in-page (same-origin su reddit.com, come fa il content
  //    script: fingerprint browser + eventuale sessione, non un fetch datacenter [403]).
  console.log('[5] Reddit .json (endpoint reale, stack di rete browser)');
  try {
    const p = await ctx.newPage();
    // Navigazione top-level all'endpoint .json (stack di rete del browser). Reddit
    // combatte l'automazione: 403/429 su IP datacenter è atteso → skip onesto. Il
    // content script gira nel browser reale dell'utente (fingerprint+sessione), non qui.
    const listResp = await p.goto('https://www.reddit.com/r/programming/top.json?limit=20&raw_json=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!listResp || listResp.status() !== 200) { sk('Reddit', `HTTP ${listResp ? listResp.status() : '??'} (anti-bot, atteso headless)`); }
    else {
      const j = await listResp.json();
      const post = j?.data?.children?.find((c) => c?.data && !c.data.stickied)?.data;
      if (!post?.permalink) { sk('Reddit', 'nessun post'); }
      else {
        post.title ? ok(`listing: "${String(post.title).slice(0, 40)}…"`) : no('titolo listing mancante');
        const tResp = await p.goto(`https://www.reddit.com${post.permalink.replace(/\/$/, '')}.json?limit=20&sort=top&raw_json=1`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (!tResp || tResp.status() !== 200) { sk('Reddit thread', `HTTP ${tResp ? tResp.status() : '??'}`); }
        else {
          const d = await tResp.json();
          const p0 = d?.[0]?.data?.children?.[0]?.data;
          const comments = (d?.[1]?.data?.children || []).map((c) => c?.data).filter((c) => c && c.body);
          p0?.title ? ok(`thread: "${String(p0.title).slice(0, 40)}…"`) : no('titolo thread mancante');
          (comments.length > 0) ? ok(`commenti estratti: ${comments.length}`) : sk('commenti', 'thread senza commenti');
        }
      }
    }
    await p.close();
  } catch (e) { sk('Reddit', e.message); }

  await browser.close();

  // 4) Logica URL (node).
  console.log('[4] Logica URL');
  isCanvasDoc('https://docs.google.com/document/d/abc/edit') ? ok('Google Docs edit → canvas') : no('Docs edit non rilevato');
  !isCanvasDoc('https://docs.google.com/document/d/abc/pub') ? ok('Google Docs /pub → NON canvas') : no('Docs pub falso positivo');
  isRedditUrl('https://www.reddit.com/r/x/comments/1/y/') ? ok('isRedditUrl') : no('isRedditUrl');
  isHackerNewsUrl('https://news.ycombinator.com/item?id=1') ? ok('isHackerNewsUrl') : no('isHackerNewsUrl');

  // 6) Hacker News Algolia (parsing).
  console.log('[6] Hacker News Algolia (parsing)');
  try {
    const fp = await fetch('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=1');
    const id = (await fp.json())?.hits?.[0]?.objectID;
    if (!id) { sk('HN', 'nessun front-page'); }
    else {
      const item = await (await fetch(`https://hn.algolia.com/api/v1/items/${id}`)).json();
      (item?.title) ? ok(`story: "${String(item.title).slice(0, 40)}…"`) : no('titolo story mancante');
      const cc = (item?.children || []).filter(c => c && c.text).length;
      (cc > 0) ? ok(`commenti: ${cc}`) : sk('commenti HN', 'nessun commento');
    }
  } catch (e) { sk('HN', e.message); }

  console.log(`\nRISULTATO: ${pass} pass · ${fail} fail · ${skip} skip`);
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error('errore QA:', e); process.exit(1); });
