#!/usr/bin/env node
// measure-unit-economics.mjs — costo reale per summary, per brand.
//
// Due sorgenti:
//   --source sample    (default) esegue summary reali sul corpus di misura (spesa OpenAI reale)
//   --source analytics aggrega gli eventi summary_completed gia' registrati (via aws cli)
//
// Per ogni brand riporta: n, token medi in/out, costo medio/summary a prezzi nano e luna,
// proiezione a 100/500/1.000 summary, e margine LORDO LLM a ipotesi prezzo/volume.
// Il costo NON dipende dal prezzo del prodotto: qui misuriamo il COGS lato LLM.
//
// Requisiti sample: OPENAI_API_KEY nell'ambiente (lo script lo prende da SSM se assente,
// vedi wrapper run-measure-unit-economics.sh). AWS creds per --source analytics.
//
// Uso:
//   OPENAI_API_KEY=... node scripts/measure-unit-economics.mjs --source sample --lang it
//   node scripts/measure-unit-economics.mjs --source analytics --table reading-intelligence-analytics-dev

import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { summarizeWithOpenAI, estimateCost } from '../backend/src/openai.mjs';
import { listBrands } from '../backend/src/brands.mjs';
import { CORPUS } from './fixtures/unit-economics-corpus.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, def) {
    const i = process.argv.indexOf('--' + name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const SOURCE = arg('source', 'sample');
const LANG = arg('lang', 'it');
const TABLE = arg('table', 'reading-intelligence-analytics-dev');
const REGION = arg('region', process.env.AWS_REGION || 'eu-west-1');
const PRICE = Number(arg('price', '4.99'));      // ipotesi prezzo mensile premium
const VOLUME = Number(arg('volume', '100'));      // ipotesi summary/utente/mese
const MODELS = ['gpt-5-nano', 'gpt-5.6-luna'];

const money = (n) => '$' + n.toFixed(6);
const money2 = (n) => '€' + n.toFixed(2);

// Aggregatore per brand
function newAgg() { return { n: 0, inTok: 0, outTok: 0, fails: 0, samples: [] }; }

async function collectSample() {
    const brands = listBrands(); // array di id (stringhe)
    const agg = {};
    for (const b of brands) agg[b] = newAgg();
    console.error(`sample: ${brands.length} brand × ${CORPUS.length} testi = ${brands.length * CORPUS.length} chiamate OpenAI (lang=${LANG})`);
    for (const b of brands) {
        for (const doc of CORPUS) {
            try {
                const res = await summarizeWithOpenAI({
                    text: doc.text, brand: b, language: LANG,
                    title: `${doc.domain} ${doc.sizeClass}`, url: `https://example.com/${doc.id}`
                });
                const u = res.usage || {};
                const inT = Number(u.input_tokens || 0), outT = Number(u.output_tokens || 0);
                agg[b].n++; agg[b].inTok += inT; agg[b].outTok += outT;
                agg[b].samples.push({ doc: doc.id, words: doc.words, in: inT, out: outT });
                console.error(`  ${b}/${doc.id}: in=${inT} out=${outT}`);
            } catch (e) {
                agg[b].fails++;
                console.error(`  ${b}/${doc.id}: FAIL ${e?.message || e}`);
            }
        }
    }
    return agg;
}

function collectAnalytics() {
    // Scan paginato via aws cli (evita dipendenze aws-sdk dallo scripts/).
    const agg = {};
    let startKey = null;
    do {
        const args = ['dynamodb', 'scan', '--table-name', TABLE, '--region', REGION,
            '--filter-expression', 'event_type = :t',
            '--expression-attribute-values', '{":t":{"S":"summary_completed"}}',
            '--projection-expression', 'brand_id, input_tokens, output_tokens',
            '--output', 'json'];
        if (startKey) args.push('--exclusive-start-key', JSON.stringify(startKey));
        const out = JSON.parse(execFileSync('aws', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
        for (const it of out.Items || []) {
            const b = it.brand_id?.S || 'unknown';
            agg[b] = agg[b] || newAgg();
            const inT = Number(it.input_tokens?.N || 0), outT = Number(it.output_tokens?.N || 0);
            agg[b].n++; agg[b].inTok += inT; agg[b].outTok += outT;
        }
        startKey = out.LastEvaluatedKey || null;
    } while (startKey);
    return agg;
}

function report(agg) {
    const rows = [];
    for (const [brand, a] of Object.entries(agg)) {
        if (a.n === 0) { rows.push({ brand, n: 0 }); continue; }
        const avgIn = a.inTok / a.n, avgOut = a.outTok / a.n;
        const costPer = {}; const proj = {}; const margin = {};
        for (const m of MODELS) {
            costPer[m] = estimateCost(m, avgIn, avgOut);
            proj[m] = { 100: costPer[m] * 100, 500: costPer[m] * 500, 1000: costPer[m] * 1000 };
            const costUser = costPer[m] * VOLUME;
            margin[m] = { costUser, grossPct: PRICE > 0 ? ((PRICE - costUser) / PRICE) * 100 : null };
        }
        rows.push({ brand, n: a.n, fails: a.fails || 0, avgIn: Math.round(avgIn), avgOut: Math.round(avgOut), costPer, proj, margin });
    }

    // Markdown per il PM
    let md = `# Unit economics (COGS LLM) — sorgente: ${SOURCE}\n\n`;
    md += `Ipotesi margine: prezzo premium ${money2(PRICE)}/mese · volume ${VOLUME} summary/utente/mese. `;
    md += `Il margine è LORDO lato LLM (esclude infra AWS, fee Stripe).\n\n`;
    md += `| brand | n | avg in tok | avg out tok | $/summary nano | $/summary luna | margine% nano | margine% luna |\n`;
    md += `|---|---|---|---|---|---|---|---|\n`;
    for (const r of rows) {
        if (!r.n) { md += `| ${r.brand} | 0 | — | — | — | — | — | — |\n`; continue; }
        md += `| ${r.brand} | ${r.n} | ${r.avgIn} | ${r.avgOut} | ${money(r.costPer['gpt-5-nano'])} | ${money(r.costPer['gpt-5.6-luna'])} | ${r.margin['gpt-5-nano'].grossPct?.toFixed(1)}% | ${r.margin['gpt-5.6-luna'].grossPct?.toFixed(1)}% |\n`;
    }
    md += `\n## Proiezione costo totale (nano / luna)\n`;
    md += `| brand | 100 | 500 | 1000 |\n|---|---|---|---|\n`;
    for (const r of rows) {
        if (!r.n) continue;
        const n = r.proj['gpt-5-nano'], l = r.proj['gpt-5.6-luna'];
        md += `| ${r.brand} | ${money(n[100])} / ${money(l[100])} | ${money(n[500])} / ${money(l[500])} | ${money(n[1000])} / ${money(l[1000])} |\n`;
    }
    return { rows, md };
}

async function main() {
    const agg = SOURCE === 'analytics' ? collectAnalytics() : await collectSample();
    const { rows, md } = report(agg);
    const stamp = new Date().toISOString().slice(0, 10);
    const outDir = join(ROOT, 'design');
    mkdirSync(outDir, { recursive: true });
    const jsonPath = join(outDir, `unit-economics-${SOURCE}-${stamp}.json`);
    const mdPath = join(outDir, `unit-economics-${SOURCE}-${stamp}.md`);
    writeFileSync(jsonPath, JSON.stringify({ source: SOURCE, lang: LANG, price: PRICE, volume: VOLUME, models: MODELS, rows }, null, 2));
    writeFileSync(mdPath, md);
    console.log('\n' + md);
    console.log(`\nScritti:\n  ${jsonPath}\n  ${mdPath}`);
    const totalCalls = rows.reduce((s, r) => s + (r.n || 0), 0);
    if (SOURCE === 'sample') console.error(`\nchiamate riuscite: ${totalCalls}`);
    if (totalCalls === 0) { console.error('ATTENZIONE: nessun dato. In analytics servono eventi summary_completed reali.'); process.exit(2); }
}

main().catch(e => { console.error('errore:', e?.stack || e); process.exit(1); });
