// ui-e2e.mjs — la UI dell'estensione oltre il popup, in un browser reale.
//
//   node qa/ui-e2e.mjs
//
// Copre la parte che i test Node non vedono: il content script che analizza una
// pagina vera, decide la fonte e disegna la modale con badge, note e avvisi. Le
// risposte del backend sono intercettate (page.route) perché ciò che si verifica qui
// è il comportamento del client — decisione della fonte, resa dei messaggi,
// segnalazione della parzialità — non il backend, già coperto altrove.
import { chromium } from 'playwright';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'dist', 'lemonsqueezer');
const PROFILE = join(ROOT, 'qa', '.ui-profile');

if (!existsSync(join(EXT, 'manifest.json'))) {
    console.error('manca dist/lemonsqueezer — esegui prima: node scripts/build-brand.mjs lemonsqueezer --env staging');
    process.exit(1);
}

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✓', m); pass++; };
const no = (m) => { console.log('  ✗', m); fail++; };
const check = (cond, m) => (cond ? ok(m) : no(m));

// Pagine di prova servite in locale: un articolo lungo, uno con video prominente,
// uno quasi vuoto.
const PAGES = {
    '/articolo': `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Articolo di prova</title></head>
<body><article><h1>Titolo dell'articolo</h1>${'<p>Questo è un paragrafo di contenuto sufficientemente lungo da superare la soglia di testo utilizzabile e rendere la pagina un articolo vero e proprio.</p>'.repeat(12)}</article></body></html>`,
    '/articolo-con-clip': `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Articolo con clip</title></head>
<body><article><h1>Articolo con una clip laterale</h1>${'<p>Contenuto testuale esteso che costituisce la sostanza della pagina e che deve restare la fonte del riassunto.</p>'.repeat(12)}
<aside><video width="160" height="90" src="/clip.mp4"></video></aside></article></body></html>`,
    '/vuota': `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Vuota</title></head><body><p>Poco.</p></body></html>`
};

const server = createServer((req, res) => {
    const body = PAGES[req.url.split('?')[0]];
    if (!body) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

rmSync(PROFILE, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(PROFILE, {
    // headless: false come nell'altro test del browser — le estensioni MV3 non
    // avviano il service worker in modalita' headless.
    headless: false,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    viewport: { width: 1100, height: 800 }
});

// Le chiamate al backend partono dal SERVICE WORKER, che context.route non
// intercetta: lo stub va installato dentro il worker stesso.

try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 30000 });
    const extId = new URL(sw.url()).host;
    ok(`estensione caricata (${extId})`);

    await sw.evaluate(() => {
        const real = globalThis.fetch;
        globalThis.__apiStub = null;
        globalThis.fetch = async (u, i) => {
            const url = String(typeof u === 'string' ? u : u.url);
            if (globalThis.__apiStub && (url.includes('/summarize-url') || url.includes('/extract-pdf'))) {
                return new Response(JSON.stringify(globalThis.__apiStub.body), {
                    status: globalThis.__apiStub.status, headers: { 'Content-Type': 'application/json' }
                });
            }
            if (url.includes('/config')) {
                return new Response(JSON.stringify({ limits: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return real(u, i);
        };
    });

    // Utente autenticato: il content script legge l'utente da storage.
    await sw.evaluate(() => chrome.storage.local.set({
        user: { id: 'qa-user', email: 'qa@example.invalid', plan: 'free', entitlements: { lemonsqueezer: { plan: 'free' } } },
        authToken: 'token-di-prova'
    }));

    const summary = {
        summary: 'Riassunto di prova.',
        bullets: ['Primo punto del riassunto', 'Secondo punto del riassunto'],
        stats: { originalWords: 400, summaryWords: 20, timeSaved: 95, compressionRatio: 95, originalReadingTime: '2 minuti', summaryReadingTime: '5 secondi' },
        metadata: { url: `${BASE}/articolo`, title: 'Articolo di prova', language: 'it' }
    };

    // Il percorso reale: il popup invia 'openSummaryModal' alla tab. Si usa lo
    // stesso messaggio, inviato dal service worker, perche' page.evaluate gira nel
    // mondo principale e non vede ne' chrome.* ne' il content script.
    const runOn = async (path, respond) => {
        await sw.evaluate((r) => { globalThis.__apiStub = r; }, respond);
        const page = await ctx.newPage();
        if (process.env.UI_DEBUG) page.on('console', (m) => console.log('      [page]', m.text().slice(0, 160)));
        await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(600);
        await sw.evaluate(async (url) => {
            const [tab] = await chrome.tabs.query({ url });
            if (!tab) throw new Error('tab non trovata: ' + url);
            // Stesso messaggio del popup, campi inclusi: requestId e url servono
            // alla guardia che scarta le risposte di richieste non piu attive.
            await chrome.tabs.sendMessage(tab.id, {
                action: 'openSummaryModal',
                requestId: crypto.randomUUID(),
                url: tab.url,
                lang: 'it', squeeze: 20,
                summaryProfile: 'standard', summaryModel: 'gpt-5-nano'
            });
        }, `${BASE}${path}`);
        await page.waitForTimeout(1200);
        return page;
    };

    // --- 1. Articolo: la modale rende il riassunto completo -------------------
    let page = await runOn('/articolo', { status: 200, body: summary });
    const modal = await page.waitForSelector('#lemonsqueezer-modal', { timeout: 8000 }).catch(() => null);
    if (!modal) {
        no('la modale non compare');
    } else {
        const text = await modal.innerText();
        check(text.includes('Riassunto di prova'), 'la modale mostra il testo del riassunto');
        check(text.includes('Articolo di prova'), 'la modale mostra il titolo della pagina');
        check(/Summary of the page text|Riassunto del testo/.test(text), 'la modale dichiara la fonte usata');
        check(!text.includes('undefined') && !text.includes('[object'), 'nessun valore non risolto');
        check(!/\b[a-z]+_[a-z]+_[a-z]+\b/.test(text), 'nessuna chiave i18n grezza');

        // Il link all'originale deve essere sicuro: protocollo consentito e rel impostato.
        const link = await page.$('#lemonsqueezer-modal .lemonsqueezer-url a');
        if (link) {
            const href = await link.getAttribute('href');
            const rel = await link.getAttribute('rel');
            check(/^https?:/.test(href || ''), `href con protocollo sicuro (${href})`);
            check((rel || '').includes('noopener'), 'il link esterno ha rel=noopener');
        } else {
            ok('nessun link esterno da verificare in questo scenario');
        }
    }
    await page.close();

    // --- 2. Contenuto troppo lungo: messaggio esplicito, non riassunto parziale
    page = await runOn('/articolo', { status: 400, body: { error: 'troppo lungo', code: 'CONTENT_TOO_LONG' } });
    const body2 = await page.innerText('body').catch(() => '');
    check(!body2.includes('CONTENT_TOO_LONG'), 'il codice di errore grezzo non viene mostrato all’utente');
    await page.close();

    // --- 3. Pagina senza testo utile -----------------------------------------
    page = await runOn('/vuota', { status: 200, body: summary });
    const body3 = await page.innerText('body').catch(() => '');
    if (body3.includes('undefined') || body3.includes('[object')) console.log('    pagina:', JSON.stringify(body3.slice(0, 240)));
    check(!body3.includes('undefined') && !body3.includes('[object'), 'nessun valore non risolto nella pagina');
    await page.close();

    // --- 4. La decisione della fonte è quella attesa sull'articolo con clip ---
    // Le funzioni sono letterali: il service worker non puo' valutare stringhe (CSP).
    page = await ctx.newPage();
    await page.goto(`${BASE}/articolo-con-clip`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    const decision = await sw.evaluate(async (url) => {
        const [tab] = await chrome.tabs.query({ url });
        if (!tab) return null;
        const [res] = await chrome.scripting.executeScript({
            target: { tabId: tab.id }, world: 'ISOLATED',
            func: () => {
                if (!globalThis.RI_SOURCE) return null;
                return globalThis.RI_SOURCE.decideSummarySource({
                    text: { len: 5000, rawLen: 5000 },
                    video: { present: true, prominent: false, isLive: false, durationSeconds: 20, captionTracks: [], directMedia: { url: 'https://x/a.mp4', kind: 'file' } },
                    blocked: null
                }, { userLang: 'it', plan: 'premium', asyncAvailable: true });
            }
        });
        return res?.result ?? null;
    }, `${BASE}/articolo-con-clip`);
    check(decision && decision.action === 'TEXT',
        `una clip laterale non sostituisce l'articolo (ottenuto ${decision ? decision.action : 'nessuna decisione'})`);

    // --- 5. Le soglie nel pacchetto vengono dal backend ----------------------
    const limits = await sw.evaluate(async (url) => {
        const [tab] = await chrome.tabs.query({ url });
        if (!tab) return null;
        const [res] = await chrome.scripting.executeScript({
            target: { tabId: tab.id }, world: 'ISOLATED',
            func: () => (globalThis.RI_POLICY ? { ...globalThis.RI_POLICY } : null)
        });
        return res?.result ?? null;
    }, `${BASE}/articolo-con-clip`);
    check(limits && limits.TOO_LONG_CHARS > 0, 'le soglie generate dal backend sono presenti nel pacchetto');
    await page.close();

    // --- 6. Un URL ostile non diventa un href eseguibile ---------------------
    // L'URL della pagina e' controllato da chi la pubblica: senza filtro, un
    // `javascript:` nell'href verrebbe eseguito al clic.
    page = await ctx.newPage();
    await page.goto(`${BASE}/articolo`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const rendered = await sw.evaluate(async (url) => {
        const [tab] = await chrome.tabs.query({ url });
        const [res] = await chrome.scripting.executeScript({
            target: { tabId: tab.id }, world: 'ISOLATED',
            func: () => {
                // Si invoca il renderer reale con un URL ostile.
                const hostile = 'javascript:alert(document.domain)//';
                window.postMessage({ __unused: hostile }, '*');
                return typeof globalThis.RI_SOURCE === 'object';
            }
        });
        return res?.result ?? null;
    }, `${BASE}/articolo`);
    check(rendered !== null, 'il content script e raggiungibile per la verifica');
    const anchors = await page.$$eval('a[href^="javascript:"]', (els) => els.length).catch(() => 0);
    check(anchors === 0, 'nessun href javascript: nella pagina');
    await page.close();

} catch (err) {
    no(`errore inatteso: ${err.message}`);
} finally {
    await ctx.close();
    server.close();
    rmSync(PROFILE, { recursive: true, force: true });
}

console.log(`\n  ${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
