#!/usr/bin/env node
// package-all.mjs — genera i pacchetti PROD di tutti i brand per gli store.
// Per ogni brand: zip Chromium (Chrome Web Store) + zip Firefox (AMO), env=prod.
// Output in dist/<brand>-<browser>-prod-<versione>.zip (dist/ è git-ignored: artefatti).
// Versione = extension/manifest.json (single source, condivisa dai brand).
//
// Uso:  node scripts/package-all.mjs            (tutti i brand)
//       node scripts/package-all.mjs scout signal   (solo alcuni)
import { readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { packageBrand } from './package-brand.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRANDS_DIR = join(ROOT, 'brands');

function allBrands() {
    return readdirSync(BRANDS_DIR).filter((n) => {
        const p = join(BRANDS_DIR, n);
        return statSync(p).isDirectory() && existsSync(join(p, 'brand.json'));
    });
}

const BROWSERS = ['chromium', 'firefox'];
const requested = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const brands = requested.length ? requested : allBrands();

console.log(`Packaging PROD: ${brands.length} brand × ${BROWSERS.length} browser\n`);
const results = [];
let failed = 0;
for (const brand of brands) {
    for (const browser of BROWSERS) {
        try {
            const r = packageBrand(brand, browser, 'prod');
            results.push(r);
            console.log(`  ✓ ${brand} [${browser}] v${r.version} -> ${r.zipPath.replace(ROOT + '/', '')}`);
        } catch (e) {
            failed++;
            console.error(`  ✗ ${brand} [${browser}]: ${e.message}`);
        }
    }
}
console.log(`\n${results.length} pacchetti creati${failed ? `, ${failed} falliti` : ''} (dist/).`);
if (results.length) console.log(`Versione: v${results[0].version}`);
process.exit(failed ? 1 : 0);
