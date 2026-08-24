#!/usr/bin/env node
// build-brand.mjs <brand> [--out dist]
// Compila una build brandizzata da una sola codebase (extension/) + brand pack
// (brands/<brand>/). Output deterministico in dist/<brand>/. LemonSqueezer resta
// il brand di riferimento: `node scripts/build-brand.mjs lemonsqueezer` deve
// riprodurre l'estensione corrente (parità).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateBrandConfigJs } from './lib/brand-config-gen.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'extension');

// File condivisi copiati in ogni build (whitelist: niente _old/test/example).
const SHARED_FILES = ['manifest.json', 'popup.html', 'popup.js', 'service_worker.js', 'content.js', 'oauth-config.js'];
const ASSET_FILES = ['icon.svg', 'icon-16.png', 'icon-48.png', 'icon-128.png'];
const REQUIRED_OUTPUT = ['manifest.json', 'popup.html', 'popup.js', 'service_worker.js', 'content.js', 'brand-config.js',
    'assets/icon-16.png', 'assets/icon-48.png', 'assets/icon-128.png'];

export function buildBrand(brandId, outRoot = join(ROOT, 'dist')) {
    const brandDir = join(ROOT, 'brands', brandId);
    const cfgPath = join(brandDir, 'brand.json');
    if (!existsSync(cfgPath)) throw new Error(`brand.json non trovato per "${brandId}" (${cfgPath})`);
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    if (cfg.id !== brandId) throw new Error(`brand.json id (${cfg.id}) != cartella (${brandId})`);

    const outDir = join(outRoot, brandId);
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(join(outDir, 'assets'), { recursive: true });

    // 1. File condivisi da extension/
    for (const f of SHARED_FILES) {
        const src = join(EXT, f);
        if (!existsSync(src)) throw new Error(`file condiviso mancante: extension/${f}`);
        copyFileSync(src, join(outDir, f));
    }

    // 2. brand-config.js generato dal brand pack
    writeFileSync(join(outDir, 'brand-config.js'), generateBrandConfigJs(cfg));

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
    writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    // 5. Integrity check
    const missing = REQUIRED_OUTPUT.filter((f) => !existsSync(join(outDir, f)));
    if (missing.length) throw new Error(`build ${brandId} incompleta, mancano: ${missing.join(', ')}`);

    return { brandId, outDir, name: manifest.name, version: manifest.version };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
    const brandId = process.argv[2];
    if (!brandId) { console.error('uso: node scripts/build-brand.mjs <brand>'); process.exit(1); }
    try {
        const res = buildBrand(brandId);
        console.log(`✓ build "${res.brandId}" -> ${res.outDir} (name: "${res.name}", v${res.version})`);
    } catch (e) {
        console.error(`✗ ${e.message}`);
        process.exit(1);
    }
}
