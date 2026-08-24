// Estrae la prima struttura JSON bilanciata ({...} o [...]) presente nel testo,
// ignorando testo che la precede o la segue. Rispetta stringhe ed escape.
export function extractFirstJson(text) {
    const s = String(text || '');
    const start = s.search(/[{[]/);
    if (start < 0) return null;
    const open = s[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i += 1) {
        const ch = s[i];
        if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
        } else if (ch === '"') {
            inStr = true;
        } else if (ch === open) {
            depth += 1;
        } else if (ch === close) {
            depth -= 1;
            if (depth === 0) return s.slice(start, i + 1);
        }
    }
    return null;
}

// Helper condivisi per i parser di schema (difensivi verso output non deterministici).
export function clampScore(v) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
}

export function stringList(v, max = 8) {
    if (Array.isArray(v)) {
        return v.map((x) => (typeof x === 'string' ? x : (x?.text || String(x ?? '')))).map((s) => s.trim()).filter(Boolean).slice(0, max);
    }
    if (typeof v === 'string' && v.trim()) {
        return v.split(/\r?\n+|(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean).slice(0, max);
    }
    return [];
}

export function oneString(v) {
    if (typeof v === 'string') return v.trim();
    if (v == null) return '';
    return String(v).trim();
}

// Prova a estrarre un oggetto/array JSON dal testo (diretto o embedded).
export function tryParseJson(text) {
    const s = String(text || '');
    try { return JSON.parse(s); } catch { /* embedded below */ }
    const embedded = extractFirstJson(s);
    if (embedded) {
        try { return JSON.parse(embedded); } catch { /* give up */ }
    }
    return null;
}
