// Output schema: summary (LemonSqueezer). Parser tollerante che ricava i bullet
// da qualunque forma il modello restituisca. Logica estratta verbatim da openai.mjs.
import { extractFirstJson } from './util.mjs';

export const name = 'summary';

export function parse(response) {
    const clean = (s) => String(s).replace(/^\s*(?:[•*–-]|\d+[.)])\s*/, '').trim();
    const fromArray = (arr) => arr
        .map((x) => (typeof x === 'string' ? x : (x?.text || x?.bullet || '')))
        .map(clean)
        .filter(Boolean);
    const splitProse = (s) => {
        const byLine = String(s).split(/\r?\n+/).map(clean).filter(Boolean);
        if (byLine.length > 1) return byLine;
        return String(s).split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
    };

    const bulletsFromParsed = (parsed) => {
        if (Array.isArray(parsed)) return fromArray(parsed);
        if (parsed && typeof parsed === 'object') {
            if (Array.isArray(parsed.bullets)) return fromArray(parsed.bullets);
            if (typeof parsed.bullet === 'string') return fromArray([parsed.bullet]);
            if (typeof parsed.summary === 'string') return splitProse(parsed.summary);
            for (const v of Object.values(parsed)) {
                if (Array.isArray(v)) { const b = fromArray(v); if (b.length) return b; }
            }
            const strings = Object.values(parsed).filter((v) => typeof v === 'string' && v.trim());
            if (strings.length) return strings.flatMap(splitProse);
        }
        return [];
    };

    const text = String(response || '');

    let bullets = [];
    try { bullets = bulletsFromParsed(JSON.parse(text)); } catch { /* try substring below */ }
    if (!bullets.length) {
        const embedded = extractFirstJson(text);
        if (embedded) {
            try { bullets = bulletsFromParsed(JSON.parse(embedded)); } catch { /* fall through */ }
        }
    }
    if (!bullets.length) {
        bullets = splitProse(text);
    }

    // Il bullet commenti può arrivare come riga di testo FUORI dal JSON del nucleo.
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (/^💬/.test(trimmed) && !bullets.includes(trimmed)) bullets.push(trimmed);
    }

    return bullets.filter(Boolean);
}
