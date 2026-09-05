// i18n-runtime.mjs — verifica in un browser REALE che ogni lingua venga renderizzata
// correttamente dalla UI dell'estensione.
//
//   node qa/i18n-runtime.mjs
//
// Perché non si usa --lang: su macOS Chrome deriva la lingua dell'interfaccia dalle
// impostazioni di sistema, e né --lang né intl.app_locale nel profilo la cambiano
// (verificato). Il test quindi non prova a pilotare il selettore di locale di Chrome
// (che è codice della piattaforma, non nostro): costruisce per ogni lingua una copia
// dell'estensione che contiene SOLO quel catalogo, con default_locale impostato di
// conseguenza. Chrome è così obbligato a risolvere quella lingua, e si verifica ciò
// che è davvero nostro: che la UI mostri le stringhe del catalogo risolto, senza
// chiavi grezze, senza residui di altre lingue e senza rotture di layout.
import { chromium } from 'playwright';
import { readFileSync, rmSync, mkdirSync, cpSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'dist', 'lemonsqueezer');
const TMP = join(ROOT, 'qa', '.i18n-builds');
const LOCALES = ['en', 'it', 'es', 'fr', 'de'];

if (!existsSync(join(EXT, '_locales'))) {
    console.error('manca dist/lemonsqueezer/_locales — esegui prima: node scripts/build-brand.mjs lemonsqueezer --env staging');
    process.exit(1);
}
const catalog = Object.fromEntries(LOCALES.map((l) => [
    l, JSON.parse(readFileSync(join(EXT, '_locales', l, 'messages.json'), 'utf8'))
]));
const allKeys = Object.keys(catalog.en);

let pass = 0, fail = 0;
const ok = (m) => { console.log('    ✓', m); pass++; };
const no = (m) => { console.log('    ✗', m); fail++; };

// Copia dell'estensione con un solo catalogo: forza la risoluzione su quella lingua.
function buildSingleLocale(lang) {
    const dir = join(TMP, lang);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    cpSync(EXT, dir, { recursive: true });
    rmSync(join(dir, '_locales'), { recursive: true, force: true });
    mkdirSync(join(dir, '_locales', lang), { recursive: true });
    writeFileSync(join(dir, '_locales', lang, 'messages.json'), JSON.stringify(catalog[lang], null, 2));
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    manifest.default_locale = lang;
    delete manifest.key; // due profili con la stessa key darebbero conflitto di id
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return dir;
}

async function checkLocale(lang) {
    console.log(`\n[${lang}]`);
    const extDir = buildSingleLocale(lang);
    const profile = join(TMP, `profile-${lang}`);
    rmSync(profile, { recursive: true, force: true });
    const ctx = await chromium.launchPersistentContext(profile, {
        headless: false,
        args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
        viewport: { width: 420, height: 640 }
    });
    try {
        let [sw] = ctx.serviceWorkers();
        if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 30000 });
        const extId = new URL(sw.url()).host;

        const page = await ctx.newPage();
        await page.goto(`chrome-extension://${extId}/popup.html`);
        await page.waitForTimeout(1800);

        // 1. il catalogo risolto è quello atteso (locale_code vive nel catalogo stesso)
        const htmlLang = await page.getAttribute('html', 'lang');
        (htmlLang === lang)
            ? ok(`catalogo risolto: ${htmlLang}`)
            : no(`catalogo risolto ${htmlLang}, atteso ${lang}`);

        const body = (await page.textContent('body')) || '';

        // 2. le stringhe di QUESTA lingua sono a schermo
        for (const key of ['popup_summarize', 'popup_options', 'popup_output', 'popup_squeeze_label', 'popup_history']) {
            const expected = catalog[lang][key].message;
            body.includes(expected) ? ok(`${key}: "${expected}"`) : no(`${key}: manca "${expected}"`);
        }

        // 3. nessuna chiave grezza (sintomo di catalogo incompleto)
        const leaked = allKeys.filter((k) => new RegExp(`(^|\\s|>)${k}(\\s|<|$)`).test(body));
        leaked.length === 0 ? ok('nessuna chiave grezza') : no(`chiavi grezze: ${leaked.join(', ')}`);

        // 4. nessun testo di un'altra lingua (residui hardcoded)
        const foreign = [];
        for (const other of LOCALES.filter((l) => l !== lang)) {
            for (const key of ['popup_summarize', 'popup_options', 'popup_squeeze_label', 'popup_history']) {
                const otherText = catalog[other][key].message;
                if (otherText === catalog[lang][key].message) continue;
                if (body.includes(otherText)) foreign.push(`${other}/${key}`);
            }
        }
        foreign.length === 0 ? ok('nessun residuo di altre lingue') : no(`testo in lingua sbagliata: ${foreign.join(', ')}`);

        // 4b. Rilevatore GENERICO: qualunque parola tipicamente italiana in una locale
        //     non italiana e' testo hardcoded sfuggito alla migrazione. (Il controllo 4
        //     confronta solo chiavi note e non vedeva le stringhe mai entrate nel catalogo.)
        if (lang !== 'it') {
            const itWords = /\b(riassunt\w+|riassumi|pagina|accedi|effettua|impostazioni|cronologia|opzioni|lingua|appunti|compressione|chiudi|copia|parole|lettura|errore|nessun\w*|questo|questa|utilizzare|ottenere|intelligenti)\b/gi;
            const hits = [...new Set((body.match(itWords) || []))]
                // Alcune parole esistono identiche in piu' lingue: si escludono se
                // compaiono anche nel catalogo della lingua corrente.
                .filter((w) => !JSON.stringify(catalog[lang]).toLowerCase().includes(w.toLowerCase()));
            hits.length === 0 ? ok('nessuna parola italiana residua') : no(`parole italiane hardcoded: ${hits.join(', ')}`);
        }

        // 5. layout: nessun testo tradotto che deborda orizzontalmente dal popup
        const overflow = await page.evaluate(() => {
            const out = [];
            for (const el of document.querySelectorAll('button, label, .login-title, summary, h3')) {
                if (el.scrollWidth > el.clientWidth + 2 && (el.textContent || '').trim()) {
                    out.push(`${el.tagName.toLowerCase()}: "${el.textContent.trim().slice(0, 40)}"`);
                }
            }
            return out;
        });
        overflow.length === 0 ? ok('nessun testo che deborda') : no(`overflow: ${overflow.join(' | ')}`);

        await page.screenshot({ path: join(TMP, `popup-${lang}.png`) });
    } finally {
        await ctx.close();
        rmSync(profile, { recursive: true, force: true });
    }
}

(async () => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    for (const lang of LOCALES) {
        try { await checkLocale(lang); } catch (e) { no(`${lang}: ${e.message}`); }
    }
    console.log(`\nRISULTATO i18n runtime: ${pass} pass · ${fail} fail`);
    console.log(`screenshot per lingua in ${TMP}`);
    process.exit(fail ? 1 : 0);
})();
