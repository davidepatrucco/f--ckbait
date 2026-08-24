#!/usr/bin/env node
// generate-legal.mjs <brand> — genera legal/<brand>/{privacy-policy,terms}.html dai
// template LemonSqueezer, sostituendo il nome prodotto con quello del brand.
// Titolare/entità (Bifa SRLS) e contatto restano invariati.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEGAL = join(ROOT, 'legal');

export function generateLegal(brandId) {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'brands', brandId, 'brand.json'), 'utf8'));
    const store = cfg.storeName || cfg.displayName;
    const out = join(LEGAL, brandId);
    mkdirSync(out, { recursive: true });
    for (const file of ['privacy-policy.html', 'terms.html']) {
        let html = readFileSync(join(LEGAL, file), 'utf8');
        html = html.split('LemonSqueezer — TL;DR').join(store)
            .split('LemonSqueezer').join(cfg.displayName);
        writeFileSync(join(out, file), html);
    }
    return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const brandId = process.argv[2];
    if (!brandId) { console.error('uso: node legal/generate-legal.mjs <brand>'); process.exit(1); }
    console.log('✓', generateLegal(brandId));
}
