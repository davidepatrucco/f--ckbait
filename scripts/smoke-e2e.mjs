#!/usr/bin/env node
// smoke-e2e.mjs <baseUrl> — gate di promozione tra ambienti (dev→staging→prod).
// Verifica il contratto pubblico del backend senza dipendenze esterne né costi LLM:
// /health, /analytics/event (valido→persist, event_type/brand/JSON invalidi→400).
// Exit != 0 su qualunque asserzione fallita (blocca la pipeline).
//
// Env opzionali:
//   SMOKE_BRAND (default scout) · SMOKE_TIMEOUT_MS (default 20000)

const base = (process.argv[2] || process.env.SMOKE_BASE_URL || '').replace(/\/$/, '');
if (!base) { console.error('uso: node scripts/smoke-e2e.mjs <baseUrl>'); process.exit(2); }
const BRAND = process.env.SMOKE_BRAND || 'scout';
const TIMEOUT = Number(process.env.SMOKE_TIMEOUT_MS || 20000);

let failures = 0;
function check(name, cond, detail) {
    if (cond) { console.log(`  ✓ ${name}`); }
    else { console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); failures++; }
}

async function req(method, path, { headers = {}, body } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
        const res = await fetch(base + path, {
            method,
            headers: { 'Content-Type': 'application/json', ...headers },
            body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
            signal: ctrl.signal
        });
        const text = await res.text();
        let json = null; try { json = JSON.parse(text); } catch { /* raw */ }
        return { status: res.status, json, text };
    } finally { clearTimeout(t); }
}

async function main() {
    console.log(`smoke/E2E → ${base} (brand=${BRAND})`);

    // 1) /health
    console.log('[health]');
    const h = await req('GET', '/health');
    check('HTTP 200', h.status === 200, `status ${h.status}`);
    check('status healthy', h.json?.status === 'healthy', JSON.stringify(h.json).slice(0, 120));
    check('espone brands', Array.isArray(h.json?.brands) && h.json.brands.length >= 1);
    check('architectureVersion presente', typeof h.json?.architectureVersion === 'string');

    // 2) /analytics/event — evento valido → persistito
    console.log('[analytics/event: valido]');
    const ok = await req('POST', '/analytics/event', { headers: { 'X-Brand': BRAND }, body: { event_type: 'extension_installed', url: 'https://example.com/smoke' } });
    check('HTTP 200', ok.status === 200, `status ${ok.status}`);
    check('logged:true + event_id', ok.json?.logged === true && !!ok.json?.event_id, JSON.stringify(ok.json).slice(0, 160));
    check('brand echo corretto', ok.json?.brand === BRAND);

    // 3) event_type non valido → 400 INVALID_REQUEST
    console.log('[analytics/event: event_type invalido]');
    const bad = await req('POST', '/analytics/event', { headers: { 'X-Brand': BRAND }, body: { event_type: 'totally_bogus' } });
    check('HTTP 400', bad.status === 400, `status ${bad.status}`);
    check('code INVALID_REQUEST', bad.json?.code === 'INVALID_REQUEST', JSON.stringify(bad.json).slice(0, 120));

    // 4) brand non valido → 400 INVALID_BRAND
    console.log('[analytics/event: brand invalido]');
    const badBrand = await req('POST', '/analytics/event', { headers: { 'X-Brand': 'notabrand' }, body: { event_type: 'extension_opened' } });
    check('HTTP 400', badBrand.status === 400, `status ${badBrand.status}`);
    check('code INVALID_BRAND', badBrand.json?.code === 'INVALID_BRAND', JSON.stringify(badBrand.json).slice(0, 120));

    // 5) JSON malformato → 400 INVALID_JSON
    console.log('[analytics/event: JSON malformato]');
    const badJson = await req('POST', '/analytics/event', { headers: { 'X-Brand': BRAND }, body: '{bad json' });
    check('HTTP 400', badJson.status === 400, `status ${badJson.status}`);
    check('code INVALID_JSON', badJson.json?.code === 'INVALID_JSON', JSON.stringify(badJson.json).slice(0, 120));

    console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} asserzioni fallite`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('errore smoke:', e?.message || e); process.exit(1); });
