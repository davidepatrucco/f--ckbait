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
