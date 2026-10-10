#!/usr/bin/env node
// site-texts.mjs — testi del sito <-> foglio Google (CSV).
//
//   node scripts/site-texts.mjs export [file.csv]   JSON del sito -> CSV (da importare nel foglio)
//   node scripts/site-texts.mjs import file.csv     CSV del foglio -> apps/website/i18n/*.json
//
// Il foglio ha una riga per testo e le colonne: key, en, it, es, fr, de.
// L'import rifiuta il file (codice 1, nessuna scrittura) se mancano colonne, se una
// chiave e' ripetuta o se una cella di traduzione e' vuota: un buco non va online.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const I18N = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'website', 'i18n');
export const LANGS = ['en', 'it', 'es', 'fr', 'de'];
const HEADER = ['key', ...LANGS];

// CSV RFC 4180: virgole, virgolette raddoppiate e a capo dentro le celle tra virgolette.
export function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
            else if (c === '"') quoted = false;
            else cell += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') { row.push(cell); cell = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(cell); rows.push(row); row = []; cell = '';
        } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const q = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCsv(dicts) {
    const lines = [HEADER.join(',')];
    for (const key of Object.keys(dicts.en)) lines.push([key, ...LANGS.map((l) => dicts[l][key] ?? '')].map(q).join(','));
    return lines.join('\n') + '\n';
}

export function fromCsv(text) {
    const [head, ...rows] = parseCsv(text);
    const cols = (head || []).map((h) => h.trim().toLowerCase());
    const idx = Object.fromEntries(HEADER.map((h) => [h, cols.indexOf(h)]));
    const errors = [];
    for (const h of HEADER) if (idx[h] < 0) errors.push(`colonna mancante: ${h}`);
    if (errors.length) return { errors };
    const dicts = Object.fromEntries(LANGS.map((l) => [l, {}]));
    rows.forEach((r, n) => {
        const key = (r[idx.key] || '').trim();
        const line = n + 2;
        if (!key) { errors.push(`riga ${line}: chiave vuota`); return; }
        if (key in dicts.en) { errors.push(`riga ${line}: chiave ripetuta ${key}`); return; }
        for (const l of LANGS) {
            const v = (r[idx[l]] || '').trim();
            if (!v) errors.push(`riga ${line} (${key}): manca ${l}`);
            dicts[l][key] = v;
        }
    });
    return { dicts, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const [cmd, file] = process.argv.slice(2);
    if (cmd === 'export') {
        const dicts = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(readFileSync(join(I18N, `${l}.json`), 'utf8'))]));
        const csv = toCsv(dicts);
        if (file) writeFileSync(file, csv); else process.stdout.write(csv);
    } else if (cmd === 'import' && file) {
        const { dicts, errors } = fromCsv(readFileSync(file, 'utf8'));
        if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
        for (const l of LANGS) writeFileSync(join(I18N, `${l}.json`), JSON.stringify(dicts[l], null, 2) + '\n');
        console.log(`ok: ${Object.keys(dicts.en).length} testi x ${LANGS.length} lingue`);
    } else {
        console.error('uso: node scripts/site-texts.mjs export [file.csv] | import file.csv');
        process.exit(1);
    }
}
