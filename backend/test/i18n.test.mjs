// Verifica dei cataloghi i18n dell'estensione (_locales) e del loro uso nel codice.
// Il rischio che questi test coprono: una UI che mostra chiavi grezze (o testo vuoto)
// perché una stringa è stata aggiunta al codice ma non ai cataloghi, o tradotta solo
// in alcune lingue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCALES_DIR = join(ROOT, 'extension', '_locales');
const DEFAULT_LOCALE = 'en';
const CODE_FILES = ['content.js', 'popup.js', 'summary.js', 'service_worker.js'];

const locales = readdirSync(LOCALES_DIR).filter((d) => existsSync(join(LOCALES_DIR, d, 'messages.json')));
const catalog = Object.fromEntries(
    locales.map((l) => [l, JSON.parse(readFileSync(join(LOCALES_DIR, l, 'messages.json'), 'utf8'))])
);
const code = Object.fromEntries(
    CODE_FILES.map((f) => [f, readFileSync(join(ROOT, 'extension', f), 'utf8')])
);
const allCode = Object.values(code).join('\n');
const popupHtml = readFileSync(join(ROOT, 'extension', 'popup.html'), 'utf8');

// Chiavi effettivamente richieste dal codice: t('x'), getMessage('x'), data-i18n="x".
function usedKeys() {
    const keys = new Set();
    // Cattura anche le forme con ternario: t(cond ? 'a' : 'b'). Si prendono tutti i
    // literal snake_case che compaiono nella stessa chiamata i18n.
    const callRe = /(?:\bt|getMessage|msg)\(((?:[^()]|\([^()]*\))*)\)/g;
    let call;
    while ((call = callRe.exec(allCode))) {
        // Solo il PRIMO argomento e' la chiave: gli altri sono sostituzioni e testo di
        // fallback, che non devono essere scambiati per chiavi di catalogo.
        const args = call[1];
        let depth = 0;
        let firstArg = args;
        for (let i = 0; i < args.length; i++) {
            const c = args[i];
            if (c === '(' || c === '[' || c === '{') depth++;
            else if (c === ')' || c === ']' || c === '}') depth--;
            else if (c === ',' && depth === 0) { firstArg = args.slice(0, i); break; }
        }
        let lit;
        const litRe = /'([a-z0-9_]+)'/g;
        while ((lit = litRe.exec(firstArg))) keys.add(lit[1]);
    }
    let m;
    const attr = /data-i18n(?:-node|-brand|-placeholder)?="([a-z0-9_]+)"/g;
    while ((m = attr.exec(popupHtml))) keys.add(m[1]);
    // Mappe codice -> chiave (NOTE_KEYS / ERROR_CODE_KEYS / ERROR_PATTERN_KEYS).
    const mapRe = /(?:NOTE_KEYS|ERROR_CODE_KEYS)\s*=\s*\{([\s\S]*?)\n\s{4}\}/g;
    while ((m = mapRe.exec(code['content.js']))) {
        const inner = m[1];
        let e;
        const kv = /'([a-z0-9_]+)'/g;
        while ((e = kv.exec(inner))) keys.add(e[1]);
    }
    const patRe = /ERROR_PATTERN_KEYS\s*=\s*\[([\s\S]*?)\n\s{4}\]/;
    const pm = patRe.exec(code['content.js']);
    if (pm) {
        let e;
        const kv = /'([a-z0-9_]+)'\]/g;
        while ((e = kv.exec(pm[1]))) keys.add(e[1]);
    }
    return keys;
}

const placeholders = (msg) => (String(msg).match(/\$\d/g) || []).sort().join(',');

test('esistono le 5 lingue previste', () => {
    for (const lang of ['en', 'it', 'es', 'fr', 'de']) {
        assert.ok(locales.includes(lang), `manca il catalogo ${lang}`);
    }
});

test('manifest dichiara default_locale coerente', () => {
    const m = JSON.parse(readFileSync(join(ROOT, 'extension', 'manifest.json'), 'utf8'));
    assert.equal(m.default_locale, DEFAULT_LOCALE);
    assert.ok(locales.includes(m.default_locale), 'default_locale senza catalogo');
});

test('ogni voce ha un campo message non vuoto', () => {
    for (const [lang, entries] of Object.entries(catalog)) {
        for (const [key, val] of Object.entries(entries)) {
            assert.ok(val && typeof val.message === 'string', `${lang}/${key}: manca "message"`);
            assert.ok(val.message.trim().length > 0, `${lang}/${key}: message vuoto`);
        }
    }
});

test('tutte le lingue hanno esattamente le stesse chiavi', () => {
    const base = Object.keys(catalog[DEFAULT_LOCALE]).sort();
    for (const lang of locales) {
        const keys = Object.keys(catalog[lang]).sort();
        const missing = base.filter((k) => !keys.includes(k));
        const extra = keys.filter((k) => !base.includes(k));
        assert.deepEqual(missing, [], `${lang}: chiavi mancanti -> ${missing.join(', ')}`);
        assert.deepEqual(extra, [], `${lang}: chiavi in eccesso -> ${extra.join(', ')}`);
    }
});

test('i segnaposto $1/$2 coincidono in tutte le lingue', () => {
    for (const key of Object.keys(catalog[DEFAULT_LOCALE])) {
        const expected = placeholders(catalog[DEFAULT_LOCALE][key].message);
        for (const lang of locales) {
            const got = placeholders(catalog[lang][key].message);
            assert.equal(got, expected, `${lang}/${key}: segnaposto "${got}" invece di "${expected}"`);
        }
    }
});

test('il blocco placeholders è coerente con il default', () => {
    for (const key of Object.keys(catalog[DEFAULT_LOCALE])) {
        const base = catalog[DEFAULT_LOCALE][key].placeholders;
        for (const lang of locales) {
            const got = catalog[lang][key].placeholders;
            assert.deepEqual(got, base, `${lang}/${key}: blocco placeholders diverso dal default`);
        }
    }
});

// Schema di Chrome per messages.json. Violarlo NON produce un errore visibile: Chrome
// scarta l'intero catalogo e getMessage restituisce stringa vuota, quindi la UI mostra
// le chiavi grezze. È esattamente il difetto osservato in produzione.
test('schema Chrome: niente $1 insieme a un blocco placeholders', () => {
    const offenders = [];
    for (const [lang, entries] of Object.entries(catalog)) {
        for (const [key, val] of Object.entries(entries)) {
            const numeric = /\$\d/.test(val.message);
            const named = /\$[a-zA-Z_]+\$/.test(val.message);
            if (val.placeholders && numeric && !named) offenders.push(`${lang}/${key}`);
            if (val.placeholders && !named) offenders.push(`${lang}/${key} (placeholders dichiarati ma mai usati come $nome$)`);
            if (named && !val.placeholders) offenders.push(`${lang}/${key} ($nome$ senza dichiarazione)`);
        }
    }
    assert.deepEqual([...new Set(offenders)], [], `voci non valide per Chrome:\n${[...new Set(offenders)].join('\n')}`);
});

test('nomi delle chiavi validi per Chrome ([A-Za-z0-9_@])', () => {
    const bad = Object.keys(catalog[DEFAULT_LOCALE]).filter((k) => !/^[A-Za-z0-9_@]+$/.test(k));
    assert.deepEqual(bad, [], `chiavi con caratteri non ammessi: ${bad.join(', ')}`);
});

test('ogni chiave usata nel codice esiste nel catalogo', () => {
    const used = usedKeys();
    assert.ok(used.size > 60, `troppe poche chiavi rilevate nel codice (${used.size}): il rilevatore è rotto`);
    const missing = [...used].filter((k) => !(k in catalog[DEFAULT_LOCALE]));
    assert.deepEqual(missing, [], `chiavi usate ma non definite: ${missing.join(', ')}`);
});

test('nessuna chiave definita e mai usata', () => {
    const used = usedKeys();
    const orphans = Object.keys(catalog[DEFAULT_LOCALE]).filter((k) => !used.has(k));
    assert.deepEqual(orphans, [], `chiavi definite ma non usate: ${orphans.join(', ')}`);
});

// Anti-regressione: impedisce di reintrodurre testo hardcoded in ciò che l'utente VEDE.
// Ambito volutamente ristretto ai punti di render (textContent/innerHTML/alert e le
// proprietà label|title|message dei costruttori di UI). Restano fuori — perché non
// raggiungono l'interfaccia — i console.* (log di sviluppo) e i `throw new Error(...)`
// interni, che passano comunque da toUserFacingError prima di essere mostrati.
test('nessuna stringa UI italiana hardcoded nei punti di render', () => {
    const italian = /\b(riassunto|riassumi|pagina|errore|impossibile|questo|questa|nessun|devi|chiudi|copia|copiato|analisi|contenuto|sottotitoli|trascrizione|lettura|parole|risparmiato)\b/i;
    const renderPoint = /(textContent\s*=|innerHTML\s*=|\balert\(|(?:^|[\s{,])(?:label|title|message)\s*:)/;
    const offenders = [];
    for (const [file, src] of Object.entries(code)) {
        src.split('\n').forEach((line, i) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
            if (/console\.(log|warn|error|debug)/.test(trimmed)) return;
            if (!renderPoint.test(trimmed)) return;
            const literals = trimmed.match(/'[^']{6,}'/g) || [];
            for (const m of literals) {
                if (/^'[a-z0-9_]+'$/.test(m)) continue;          // chiave i18n
                if (/^'[a-z-]+(\s*,\s*[a-z-]+)*'$/.test(m)) continue; // selettori CSS
                if (!italian.test(m)) continue;
                offenders.push(`${file}:${i + 1} ${m.slice(0, 70)}`);
            }
        });
    }
    assert.deepEqual(offenders, [], `stringhe UI hardcoded:\n${offenders.join('\n')}`);
});

// I template HTML delle modali: righe con testo letterale (non interpolato) e parole
// italiane significherebbero UI non tradotta.
test('nessun testo italiano letterale nei template HTML della modale', () => {
    const offenders = [];
    const italian = /\b(riassunto|riassumi|chiudi|copia|parole|lettura|risparmiato|errore|contenuto|pagina)\b/i;
    code['content.js'].split('\n').forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//')) return;
        if (!/<\/?(div|span|button|strong|h\d|p)\b/.test(trimmed)) return;
        // Testo tra i tag, escluse le interpolazioni ${...}
        const between = trimmed.replace(/\$\{[^}]*\}/g, '').match(/>([^<>]{4,})</g) || [];
        for (const seg of between) {
            if (italian.test(seg)) offenders.push(`content.js:${i + 1} ${seg.slice(0, 60)}`);
        }
    });
    assert.deepEqual(offenders, [], `testo hardcoded nei template:\n${offenders.join('\n')}`);
});

test('popup.html: ogni data-i18n ha un fallback testuale nel markup', () => {
    // Solo le varianti che sostituiscono l'intero contenuto: per data-i18n-node il
    // testo segue i figli (es. un'icona SVG), quindi non e' adiacente al tag.
    const re = /data-i18n(?:-brand)?="([a-z0-9_]+)"[^>]*>\s*([^<]*)</g;
    let m;
    let checked = 0;
    while ((m = re.exec(popupHtml))) {
        checked++;
        assert.ok(m[2].trim().length > 0, `${m[1]}: nessun testo di fallback nel markup`);
    }
    assert.ok(checked >= 15, `troppi pochi nodi data-i18n verificati (${checked})`);
});
