#!/usr/bin/env node
// unit-economics-sensitivity.mjs — sensitivity del margine al volume/utente/mese.
// Legge un report JSON prodotto da measure-unit-economics.mjs (nessuna nuova spesa OpenAI).
// Per ogni brand: cost/user e margine% a volumi dati, + break-even (summary/utente/mese
// che azzera il margine) per nano e luna.
//
// Uso: node scripts/unit-economics-sensitivity.mjs [--report design/unit-economics-sample-YYYY-MM-DD.json]
//                                                  [--price 4.99] [--volumes 100,1000,10000]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function arg(name, def) { const i = process.argv.indexOf('--' + name); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def; }

const REPORT = arg('report', 'design/unit-economics-sample-2026-08-25.json');
const PRICE = Number(arg('price', '4.99'));
const VOLUMES = arg('volumes', '100,1000,10000').split(',').map(Number);
const MODELS = ['gpt-5-nano', 'gpt-5.6-luna'];
const LABEL = { 'gpt-5-nano': 'nano', 'gpt-5.6-luna': 'luna' };

const data = JSON.parse(readFileSync(join(ROOT, REPORT), 'utf8'));
const rows = data.rows.filter(r => r.n);

const money = (n) => '$' + n.toFixed(4);
const pct = (n) => (n >= 0 ? '' : '') + n.toFixed(1) + '%';

let md = `# Sensitivity margine vs volume — prezzo ${PRICE.toFixed(2)}/mese\n\n`;
md += `Costo/summary da \`${REPORT}\`. cost/user = $/summary × volume. `;
md += `Margine LORDO LLM = (prezzo − cost/user) / prezzo. Prezzo in €, costo in $ → margine indicativo (ignora FX/infra/fee).\n\n`;

for (const m of MODELS) {
    md += `## Modello ${LABEL[m]}\n\n`;
    md += `| brand | $/summary | ` + VOLUMES.map(v => `cost/user @${v}`).join(' | ') + ` | ` + VOLUMES.map(v => `margine @${v}`).join(' | ') + ` | break-even (summ/mese) |\n`;
    md += `|---|---|` + VOLUMES.map(() => '---').join('|') + '|' + VOLUMES.map(() => '---').join('|') + '|---|\n';
    for (const r of rows) {
        const c = r.costPer[m];
        const be = c > 0 ? Math.floor(PRICE / c) : Infinity;
        const costs = VOLUMES.map(v => money(c * v));
        const margins = VOLUMES.map(v => pct(((PRICE - c * v) / PRICE) * 100));
        md += `| ${r.brand} | ${money(c)} | ${costs.join(' | ')} | ${margins.join(' | ')} | ${be.toLocaleString('en-US')} |\n`;
    }
    md += `\n`;
}

md += `## Lettura\n`;
md += `- Il cap serve a limitare l'abuso, ma il suo effetto sul margine dipende dal modello.\n`;
md += `- Su **nano** anche 10.000 summary/utente/mese resta profittevole per tutti i brand.\n`;
md += `- Su **luna** il break-even cade tra ~640 e ~1.730 summary/utente/mese: un cap a 10.000\n`;
md += `  NON protegge il margine. O il cap è model-aware/più basso, o il router tiene gli utenti\n`;
md += `  ad alto volume sul modello economico (input diretto per #3A cost-aware router).\n`;

const outMd = join(ROOT, 'design', `unit-economics-sensitivity-${new Date().toISOString().slice(0, 10)}.md`);
writeFileSync(outMd, md);
console.log(md);
console.log('Scritto:', outMd);
