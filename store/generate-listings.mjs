#!/usr/bin/env node
// generate-listings.mjs — genera store/<brand>/listing.md per ogni brand, combinando
// dati da brands/<brand>/brand.json (nome, tagline, categoria, URL) con copy tarata
// per posizionamento. Boilerplate condiviso (permessi, privacy) in store/README.md.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Copy per brand: short ≤132 char (limite Chrome Web Store), long, keywords.
const COPY = {
    lemonsqueezer: {
        short: 'TL;DR di qualsiasi pagina in un clic: i punti chiave, senza rumore. Riassunti nella tua lingua.',
        keywords: ['tldr', 'summary', 'riassunto', 'articoli', 'produttività', 'reading'],
        long: `LemonSqueezer riassume qualsiasi articolo o pagina web in pochi secondi: i punti essenziali in bullet, nella lingua che scegli, con un clic.

• Un clic sull'icona → riassunto immediato della pagina attiva
• Bullet chiari e concisi, niente fronzoli
• Lingua di output selezionabile e livello di sintesi regolabile
• Funziona su articoli, blog, documentazione e video YouTube (descrizione + sintesi commenti)

Pensato per chi legge molto e ha poco tempo: capisci se e cosa vale la pena leggere, subito. Il contenuto della pagina viene elaborato al momento per generare il riassunto e non viene rivenduto a terzi.`
    },
    scout: {
        short: 'Vale il tuo tempo? Scout ti dà un punteggio di attenzione della pagina prima di leggerla.',
        keywords: ['attention', 'worth reading', 'triage', 'reading', 'focus', 'produttività'],
        long: `Scout ti dice se un contenuto merita il tuo tempo — prima di leggerlo.

• Punteggio di attenzione della pagina in un clic
• Segnali di novità, densità informativa e affidabilità
• Motivazioni chiare dietro il punteggio
• Decidi in pochi secondi se leggere, salvare o saltare

Per chi affronta troppi articoli al giorno: Scout fa il triage al posto tuo e protegge la tua attenzione. Il contenuto viene analizzato al momento e non viene rivenduto a terzi.`
    },
    signal: {
        short: 'Estrai gli insight che contano da report e articoli lunghi. Signal separa il segnale dal rumore.',
        keywords: ['insights', 'intelligence', 'research', 'report', 'analysis', 'knowledge'],
        long: `Signal trasforma articoli e report lunghi in insight azionabili.

• Insight strutturati: cosa conta davvero, perché, e le implicazioni
• Ideale per ricerca, analisi di mercato, due diligence, rassegne
• Estrae dati, tesi e conclusioni, non solo un riassunto generico
• Output ordinato e citabile

Per professionisti dell'informazione che devono capire in fretta documenti densi. Il contenuto viene elaborato al momento e non viene rivenduto a terzi.`
    },
    briefly: {
        short: 'Executive brief di qualsiasi contenuto: contesto, punti chiave e next step, pronti da condividere.',
        keywords: ['executive', 'brief', 'business', 'meeting', 'summary', 'produttività'],
        long: `Briefly produce un executive brief di qualsiasi articolo o documento.

• Contesto, punti chiave e implicazioni in formato brief
• Tono professionale, pronto da inoltrare o incollare in una nota
• Perfetto prima di una riunione o per aggiornare il team
• Sintesi editoriale, non un elenco meccanico

Per manager e team che devono allinearsi in fretta. Il contenuto viene elaborato al momento e non viene rivenduto a terzi.`
    },
    nobull: {
        short: 'Niente clickbait: NoBull ti dice cosa c’è davvero in una pagina, senza slop e senza giri di parole.',
        keywords: ['anti-clickbait', 'no bs', 'slop', 'honest', 'summary', 'reading'],
        long: `NoBull taglia il clickbait e ti dice cosa c’è davvero in una pagina.

• La sostanza reale, senza esche, hype o riempitivi
• Segnala quando un titolo promette più di quanto il testo mantiene
• Diretto e senza giri di parole
• Ottimo contro slop e contenuti gonfiati

Per chi è stanco di titoli acchiappaclic e articoli vuoti. Il contenuto viene analizzato al momento e non viene rivenduto a terzi.`
    }
};

const SCREENSHOTS = `## Screenshot richiesti (da catturare con l'estensione in esecuzione)
Chrome Web Store: 1280×800 o 640×400 (min 1, max 5). Consigliati 4:
1. Popup del brand aperto su un articolo reale (tema/logo del brand visibili).
2. Risultato: output del brand su un articolo (bullet / attention score / insight / brief / noise).
3. Selettore lingua + livello di sintesi.
4. Esempio su YouTube (descrizione + sintesi commenti) o su una testata nota.
Promo (opzionali): marquee 1400×560, small tile 440×280 — grafica con wordmark + tagline del brand.`;

function generate(brandId) {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'brands', brandId, 'brand.json'), 'utf8'));
    const c = COPY[brandId];
    const out = join(ROOT, 'store', brandId);
    mkdirSync(out, { recursive: true });
    const md = `# Store listing — ${cfg.storeName}

**Nome (store):** ${cfg.storeName}
**Categoria:** ${cfg.store?.category || 'Productivity'}
**Tagline:** ${cfg.tagline || ''}
**Privacy:** ${cfg.urls?.privacy || ''}
**Termini:** ${cfg.urls?.terms || ''}
**Supporto:** ${cfg.urls?.support || ''}

## Descrizione breve (≤132 caratteri)
${c.short}
_(${c.short.length} caratteri)_

## Descrizione dettagliata
${c.long}

## Keywords
${c.keywords.join(', ')}

## Giustificazione permessi (per la review dello store)
- **host \`*://*/*\` / scripting / activeTab**: leggere il testo della pagina attiva quando l'utente chiede un riassunto. Nessuna lettura in background.
- **storage**: salvare token di login e preferenze (lingua, livello di sintesi).
- **identity**: login Google (OAuth) per gestire quota e piano.
- **Dati**: il contenuto della pagina è elaborato al momento per generare l'output; non è venduto a terzi. Sub-processor: OpenAI (elaborazione), AWS (hosting), Google (login), Stripe (pagamenti). Vedi privacy policy.

${SCREENSHOTS}
`;
    writeFileSync(join(out, 'listing.md'), md);
    return { brandId, short: c.short.length };
}

const brands = process.argv.slice(2).filter(a => !a.startsWith('--'));
const list = brands.length ? brands : Object.keys(COPY);
for (const b of list) {
    const r = generate(b);
    const warn = r.short > 132 ? ` ⚠️ short ${r.short}>132` : '';
    console.log('✓', r.brandId, `(short ${r.short})` + warn);
}
