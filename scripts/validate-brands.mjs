#!/usr/bin/env node
// Valida i brand pack (brands/<brand>/brand.json) contro lo schema atteso e la
// coerenza con i registry backend (brand id, prompt profile, output schema).
// Uscita non-zero in caso di errori. Allineato a Doc 17 (Brand Packs) e 18 (Design System).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isValidBrand } from '../backend/src/brands.mjs';
import { listPromptProfiles } from '../backend/src/prompts/index.mjs';
import { listSchemas } from '../backend/src/schemas/index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRANDS_DIR = join(ROOT, 'brands');

const REQUIRED_STRINGS = ['id', 'apiBrand', 'displayName', 'tagline', 'promptProfile', 'outputSchema', 'primaryAction', 'heroMetric'];
const REQUIRED_COLORS = ['primary', 'primary700', 'black', 'white'];
const REQUIRED_ASSETS = ['iconSvg', 'icon16', 'icon48', 'icon128'];

const promptProfiles = new Set(listPromptProfiles());
const schemas = new Set(listSchemas());

let errors = 0;
let warnings = 0;
const fail = (b, m) => { console.error(`✗ [${b}] ${m}`); errors += 1; };
const warn = (b, m) => { console.warn(`⚠ [${b}] ${m}`); warnings += 1; };

const dirs = readdirSync(BRANDS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
if (!dirs.length) fail('-', 'nessun brand pack trovato in brands/');

for (const dir of dirs) {
    const file = join(BRANDS_DIR, dir, 'brand.json');
    if (!existsSync(file)) { fail(dir, 'manca brand.json'); continue; }
    let cfg;
    try { cfg = JSON.parse(readFileSync(file, 'utf8')); }
    catch (e) { fail(dir, `brand.json non è JSON valido: ${e.message}`); continue; }

    for (const k of REQUIRED_STRINGS) {
        if (typeof cfg[k] !== 'string' || !cfg[k].trim()) fail(dir, `campo mancante/non stringa: ${k}`);
    }
    if (cfg.id !== dir) fail(dir, `id (${cfg.id}) diverso dal nome cartella (${dir})`);

    // Coerenza con il backend
    if (cfg.apiBrand && !isValidBrand(cfg.apiBrand)) fail(dir, `apiBrand "${cfg.apiBrand}" non registrato nel backend (brands.mjs)`);
    if (cfg.promptProfile && !promptProfiles.has(cfg.promptProfile)) warn(dir, `promptProfile "${cfg.promptProfile}" non ancora nel registry (fallback a summary.standard)`);
    if (cfg.outputSchema && !schemas.has(cfg.outputSchema)) warn(dir, `outputSchema "${cfg.outputSchema}" non ancora nel registry (fallback a summary)`);

    // Token
    const colors = cfg.tokens?.colors || {};
    for (const c of REQUIRED_COLORS) {
        if (!/^#[0-9A-Fa-f]{6}$/.test(String(colors[c] || ''))) fail(dir, `token colore mancante/non valido: ${c}`);
    }
    if (!cfg.tokens?.radius) fail(dir, 'token radius mancante');
    if (!cfg.tokens?.fontSans) fail(dir, 'token fontSans mancante');

    // Asset (chiavi + esistenza file)
    for (const a of REQUIRED_ASSETS) {
        const rel = cfg.assets?.[a];
        if (!rel) { fail(dir, `asset mancante: ${a}`); continue; }
        if (!existsSync(join(BRANDS_DIR, dir, rel))) fail(dir, `file asset non trovato: ${rel}`);
    }

    // URL
    if (!cfg.urls?.privacy) fail(dir, 'urls.privacy mancante');
    else if (/TODO|example/i.test(cfg.urls.privacy)) warn(dir, 'urls.privacy è un placeholder (da sostituire prima del lancio)');
    if (!cfg.urls?.support) fail(dir, 'urls.support mancante');

    if (!errors) console.log(`✓ [${dir}] brand pack valido`);
}

console.log(`\nBrand pack: ${dirs.length} · errori: ${errors} · warning: ${warnings}`);
process.exit(errors ? 1 : 0);
