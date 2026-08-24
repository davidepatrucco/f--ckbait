#!/usr/bin/env node
// package-brand.mjs <brand> — costruisce e impacchetta una build brandizzata in
// dist/<brand>-chrome-<version>.zip (pronta per il Chrome Web Store).
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildBrand } from './build-brand.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function packageBrand(brandId, browser = 'chromium') {
    const { outDir, version } = buildBrand(brandId, { browser });
    const zipPath = join(ROOT, 'dist', `${brandId}-${browser}-${version}.zip`);
    rmSync(zipPath, { force: true });
    // zip del CONTENUTO di dist/<brand>[-browser] (senza la cartella padre)
    execSync(`cd "${outDir}" && zip -r -q "${zipPath}" . -x '*/.DS_Store' -x '.DS_Store'`, { stdio: 'inherit', shell: '/bin/bash' });
    if (!existsSync(zipPath)) throw new Error(`zip non creato: ${zipPath}`);
    return { brandId, browser, zipPath, version };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const args = process.argv.slice(2);
    const brandId = args.find((a) => !a.startsWith('--'));
    const bIdx = args.indexOf('--browser');
    const browser = bIdx >= 0 ? args[bIdx + 1] : 'chromium';
    if (!brandId) { console.error('uso: node scripts/package-brand.mjs <brand> [--browser chromium|firefox]'); process.exit(1); }
    try {
        const res = packageBrand(brandId, browser);
        console.log(`✓ pacchetto "${res.brandId}" [${res.browser}] -> ${res.zipPath}`);
    } catch (e) {
        console.error(`✗ ${e.message}`);
        process.exit(1);
    }
}
