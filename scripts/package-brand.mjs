#!/usr/bin/env node
// package-brand.mjs <brand> — costruisce e impacchetta una build brandizzata in
// dist/<brand>-chrome-<version>.zip (pronta per il Chrome Web Store).
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildBrand } from './build-brand.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function packageBrand(brandId) {
    const { outDir, version } = buildBrand(brandId);
    const zipPath = join(ROOT, 'dist', `${brandId}-chrome-${version}.zip`);
    rmSync(zipPath, { force: true });
    // zip del CONTENUTO di dist/<brand> (senza la cartella padre)
    execSync(`cd "${outDir}" && zip -r -q "${zipPath}" . -x '*/.DS_Store' -x '.DS_Store'`, { stdio: 'inherit', shell: '/bin/bash' });
    if (!existsSync(zipPath)) throw new Error(`zip non creato: ${zipPath}`);
    return { brandId, zipPath, version };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const brandId = process.argv[2];
    if (!brandId) { console.error('uso: node scripts/package-brand.mjs <brand>'); process.exit(1); }
    try {
        const res = packageBrand(brandId);
        console.log(`✓ pacchetto "${res.brandId}" -> ${res.zipPath}`);
    } catch (e) {
        console.error(`✗ ${e.message}`);
        process.exit(1);
    }
}
