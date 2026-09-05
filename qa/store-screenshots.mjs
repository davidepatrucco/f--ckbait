// store-screenshots.mjs — genera gli screenshot 1280x800 per la scheda dello store
// caricando l'estensione REALE in Chromium e producendo un riassunto REALE.
//
//   node qa/store-screenshots.mjs <authToken>
//
// Il token è un JWT di un utente premium sull'ambiente a cui punta la build
// (dist/lemonsqueezer). Nessun dato inventato: le schermate mostrano il prodotto
// che gira davvero. Output in store/lemonsqueezer/screenshots/.
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'dist', 'lemonsqueezer');
const OUT = join(ROOT, 'store', 'lemonsqueezer', 'screenshots');
const PROFILE = join(ROOT, 'qa', '.chrome-profile');
const TOKEN = process.argv[2];
const ARTICLE = process.argv[3] || 'https://en.wikipedia.org/wiki/Large_language_model';
const LABEL = process.argv[4] || 'testo';

if (!TOKEN) { console.error('uso: node qa/store-screenshots.mjs <authToken> [articleUrl] [label]'); process.exit(1); }

const shot = async (target, name) => {
    await target.screenshot({ path: join(OUT, name) });
    console.log('  ✓', name);
};

async function main() {
    mkdirSync(OUT, { recursive: true });
    rmSync(PROFILE, { recursive: true, force: true });

    const ctx = await chromium.launchPersistentContext(PROFILE, {
        headless: false, // le estensioni MV3 richiedono un browser con UI
        args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
        viewport: { width: 1280, height: 800 }
    });

    // Il service worker espone l'id dell'estensione e permette di seminare lo storage.
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 30000 });
    const extId = new URL(sw.url()).host;
    console.log('extension id:', extId);

    await sw.evaluate(async (token) => {
        await chrome.storage.local.set({
            authToken: token,
            user: { email: 'demo@bifa.digital', plan: 'premium', name: 'Demo' },
            summaryLanguage: 'it'
        });
    }, TOKEN);

    // 1. Popup dell'estensione, alla sua dimensione naturale. L'email dell'account di
    //    test viene sostituita con una neutra: è un asset pubblico, non deve contenere
    //    l'indirizzo di una persona reale (la UI resta quella vera).
    const popup = await ctx.newPage();
    await popup.setViewportSize({ width: 420, height: 560 });
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    await popup.waitForTimeout(2500);
    await popup.evaluate(() => {
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            if (/@/.test(n.nodeValue || '')) n.nodeValue = n.nodeValue.replace(/[^\s]+@[^\s]+/g, 'demo@bifa.digital');
        }
    });
    const popupPng = (await popup.screenshot()).toString('base64');

    // 2. Riassunto reale su un articolo reale: si pilota il content script con lo
    //    stesso messaggio che invia il popup, così il percorso è quello di produzione.
    const page = await ctx.newPage();
    await page.goto(ARTICLE, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);
    const cleanPagePng = (await page.screenshot({ path: join(OUT, `01-${LABEL}-pagina.png`) })).toString('base64');
    console.log('  ✓', `01-${LABEL}-pagina.png`);

    const tabId = await sw.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({});
        const t = tabs.find((x) => x.url && x.url.startsWith(url.slice(0, 40)));
        return t ? t.id : null;
    }, ARTICLE);
    if (!tabId) throw new Error('tab dell’articolo non trovato');

    await sw.evaluate(async ([id, url]) => {
        await chrome.tabs.sendMessage(id, { action: 'openSummaryModal', url, lang: 'it', summaryProfile: 'standard', squeeze: 20 });
    }, [tabId, ARTICLE]);

    // Attende il riassunto vero (niente dato finto): compare il contenuto o l'errore.
    await page.waitForSelector('#lemonsqueezer-modal .lemonsqueezer-summary-content, #lemonsqueezer-modal .lemonsqueezer-error-message', { timeout: 120000 });
    await page.waitForTimeout(1500);
    const badge = await page.$('#lemonsqueezer-modal .lemonsqueezer-source-badge');
    if (badge) console.log('  → badge fonte:', ((await badge.textContent()) || '').replace(/\s+/g, ' ').trim());
    const errored = await page.$('#lemonsqueezer-modal .lemonsqueezer-error-message');
    if (errored) {
        const msg = await errored.textContent();
        console.warn('  ! la modale mostra un errore/avviso:', (msg || '').trim().slice(0, 120));
    }
    await shot(page, `03-${LABEL}-riassunto.png`);

    // 3. Composizione 1280x800 per lo store: il popup ancorato in alto a destra sopra
    //    la pagina reale, come appare all'utente quando clicca l'icona nella toolbar.
    const composer = await ctx.newPage();
    await composer.setViewportSize({ width: 1280, height: 800 });
    await composer.setContent(`<!doctype html><html><body style="margin:0;width:1280px;height:800px;overflow:hidden;position:relative;background:#fff">
        <img src="data:image/png;base64,${cleanPagePng}" style="position:absolute;inset:0;width:1280px;height:800px;object-fit:cover">
        <div style="position:absolute;inset:0;background:rgba(15,20,30,.28)"></div>
        <img src="data:image/png;base64,${popupPng}" style="position:absolute;top:16px;right:24px;width:420px;border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.45)">
    </body></html>`);
    await composer.waitForTimeout(600);
    await shot(composer, `02-${LABEL}-popup.png`);
    await composer.close();

    await ctx.close();
    console.log('\nOutput in', OUT);
}

main().catch((e) => { console.error('errore:', e.message); process.exit(1); });
