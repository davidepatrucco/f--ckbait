#!/usr/bin/env node
// build-brand.mjs <brand> [--out dist]
// Compila una build brandizzata da una sola codebase (extension/) + brand pack
// (brands/<brand>/). Output deterministico in dist/<brand>/. LemonSqueezer resta
// il brand di riferimento: `node scripts/build-brand.mjs lemonsqueezer` deve
// riprodurre l'estensione corrente (parità).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync, cpSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateBrandConfigJs } from './lib/brand-config-gen.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'extension');

// File condivisi copiati in ogni build (whitelist: niente _old/test/example).
// oauth-config.js è gestito a parte perché è git-ignored (assente in CI): fallback
// a oauth-config.example.js così build/test funzionano senza il file reale.
const SHARED_FILES = ['manifest.json', 'popup.html', 'popup.js', 'service_worker.js', 'content.js', 'browser-polyfill.js', 'summary.html', 'summary.js', 'source-decision.js'];
const ASSET_FILES = ['icon.svg', 'icon-16.png', 'icon-48.png', 'icon-128.png'];
const REQUIRED_OUTPUT = ['manifest.json', 'popup.html', 'popup.js', 'service_worker.js', 'content.js', 'browser-polyfill.js', 'brand-config.js', 'summary.html', 'summary.js', 'source-decision.js',
    'assets/icon-16.png', 'assets/icon-48.png', 'assets/icon-128.png',
    '_locales/en/messages.json', '_locales/it/messages.json'];

const SUPPORTED_BROWSERS = ['chromium', 'firefox'];

// Trasforma il manifest Chromium (MV3, service_worker) nel formato del browser target.
// Chromium (Chrome/Edge/Brave/Arc/Opera): invariato. Firefox: background.scripts +
// browser_specific_settings.gecko (Firefox MV3 usa event page, non service worker).
function applyBrowserManifest(manifest, browser, brandId) {
    if (browser !== 'firefox') return manifest;
    const swFile = manifest.background?.service_worker || 'service_worker.js';
    // Firefox usa un event page: importScripts non è disponibile, quindi le dipendenze
    // (incluso source-decision.js per parseVtt) vanno dichiarate qui.
    manifest.background = { scripts: ['browser-polyfill.js', 'brand-config.js', 'source-decision.js', swFile] };
    manifest.browser_specific_settings = {
        gecko: { id: `${brandId}@bifa.digital`, strict_min_version: '121.0' }
    };
    return manifest;
}

export function buildBrand(brandId, options = {}) {
    // Backward compat: 2º arg stringa = outRoot (target chromium).
    const opts = typeof options === 'string' ? { outRoot: options } : options;
    const outRoot = opts.outRoot || join(ROOT, 'dist');
    const browser = opts.browser || 'chromium';
    if (!SUPPORTED_BROWSERS.includes(browser)) throw new Error(`browser non supportato: ${browser}`);
    const env = opts.env || 'dev';
    if (!['dev', 'staging', 'prod'].includes(env)) throw new Error(`env non supportato: ${env}`);

    const brandDir = join(ROOT, 'brands', brandId);
    const cfgPath = join(brandDir, 'brand.json');
    if (!existsSync(cfgPath)) throw new Error(`brand.json non trovato per "${brandId}" (${cfgPath})`);
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    if (cfg.id !== brandId) throw new Error(`brand.json id (${cfg.id}) != cartella (${brandId})`);

    // chromium mantiene dist/<brand> (parità storica); altri target: dist/<brand>-<browser>.
    const outDir = join(outRoot, browser === 'chromium' ? brandId : `${brandId}-${browser}`);
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(join(outDir, 'assets'), { recursive: true });

    // 1. File condivisi da extension/
    for (const f of SHARED_FILES) {
        const src = join(EXT, f);
        if (!existsSync(src)) throw new Error(`file condiviso mancante: extension/${f}`);
        copyFileSync(src, join(outDir, f));
    }

    // 1b. oauth-config.js (git-ignored): usa il reale se presente, altrimenti l'example.
    const oauthReal = join(EXT, 'oauth-config.js');
    const oauthExample = join(EXT, 'oauth-config.example.js');
    if (existsSync(oauthReal)) copyFileSync(oauthReal, join(outDir, 'oauth-config.js'));
    else if (existsSync(oauthExample)) copyFileSync(oauthExample, join(outDir, 'oauth-config.js'));
    else throw new Error('manca extension/oauth-config.js (e nessun oauth-config.example.js)');

    // 1c. Cataloghi i18n (_locales/<lang>/messages.json): condivisi da tutti i brand.
    //     Senza questa cartella chrome.i18n.getMessage restituisce stringa vuota e la UI
    //     mostrerebbe le chiavi al posto dei testi.
    const localesSrc = join(EXT, '_locales');
    if (!existsSync(localesSrc)) throw new Error('manca extension/_locales');
    cpSync(localesSrc, join(outDir, '_locales'), { recursive: true });
    const locales = readdirSync(join(outDir, '_locales'));
    if (!locales.includes('en')) throw new Error('_locales senza la lingua di default (en)');

    // 2. brand-config.js generato dal brand pack
    writeFileSync(join(outDir, 'brand-config.js'), generateBrandConfigJs(cfg, env));

    // 3. Asset del brand (overlay)
    for (const a of ASSET_FILES) {
        const src = join(brandDir, 'assets', a);
        if (!existsSync(src)) throw new Error(`asset mancante: brands/${brandId}/assets/${a}`);
        copyFileSync(src, join(outDir, 'assets', a));
    }

    // 4. Template del manifest (nome/descrizione/titolo dal brand pack)
    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
    manifest.name = cfg.storeName || cfg.displayName;
    if (cfg.store && cfg.store.summary) manifest.description = cfg.store.summary;
    if (manifest.action) manifest.action.default_title = cfg.storeName || cfg.displayName;
    // key pinnata (opzionale): rende stabile l'extension id nel load-unpacked, così il
    // redirect OAuth https://<id>.chromiumapp.org/ è registrabile una volta. Solo Chromium
    // (Firefox usa browser_specific_settings.gecko.id). Serve SOLO alla distribuzione
    // diretta pre-lancio: nei pacchetti per lo store va omessa (--store), perché l'ID lo
    // assegna lo store e una key nel manifest può far rifiutare l'upload.
    if (cfg.extensionKey && browser === 'chromium' && !opts.store) manifest.key = cfg.extensionKey;
    if (opts.store) delete manifest.key;
    applyBrowserManifest(manifest, browser, brandId);
    writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    // 5. Integrity check
    const missing = REQUIRED_OUTPUT.filter((f) => !existsSync(join(outDir, f)));
    if (missing.length) throw new Error(`build ${brandId} incompleta, mancano: ${missing.join(', ')}`);

    return { brandId, browser, env, outDir, name: manifest.name, version: manifest.version };
}

// CLI: node scripts/build-brand.mjs <brand> [--browser chromium|firefox] [--env dev|staging|prod]
if (import.meta.url === `file://${process.argv[1]}`) {
    const args = process.argv.slice(2);
    const brandId = args.find((a) => !a.startsWith('--'));
    const bIdx = args.indexOf('--browser');
    const browser = bIdx >= 0 ? args[bIdx + 1] : 'chromium';
    const eIdx = args.indexOf('--env');
    const env = eIdx >= 0 ? args[eIdx + 1] : 'dev';
    const store = args.includes('--store');
    if (!brandId) { console.error('uso: node scripts/build-brand.mjs <brand> [--browser chromium|firefox] [--env dev|staging|prod] [--store]'); process.exit(1); }
    try {
        const res = buildBrand(brandId, { browser, env, store });
        console.log(`✓ build "${res.brandId}" [${res.browser}/${res.env}${store ? '/store' : ''}] -> ${res.outDir} (name: "${res.name}", v${res.version})`);
    } catch (e) {
        console.error(`✗ ${e.message}`);
        process.exit(1);
    }
}
