import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { retention } from '../src/dashboard.mjs';
import { adminMetricsHandler, adminDashboardHandler } from '../lambda/handler.mjs';

describe('#4 dashboard: retention (logica pura)', () => {
    it('D1: coorte per primo giorno, retained se attivo a first+1', () => {
        // u1: giorni 10,11 → retained D1. u2: solo 10 → non retained D1. u3: 10,17 → retained D7.
        const m = new Map([
            ['u1', new Set([10, 11])],
            ['u2', new Set([10])],
            ['u3', new Set([10, 17])]
        ]);
        const d1 = retention(m, 1);
        assert.equal(d1.cohort, 3);
        assert.equal(d1.retainedPct, Number(((1 / 3) * 100).toFixed(1))); // solo u1
        const d7 = retention(m, 7);
        assert.equal(d7.retainedPct, Number(((1 / 3) * 100).toFixed(1))); // solo u3
    });
    it('coorte vuota → retainedPct null', () => {
        assert.equal(retention(new Map(), 1).retainedPct, null);
    });
    it('utenti senza giorni non contano nella coorte', () => {
        const m = new Map([['u1', new Set()], ['u2', new Set([5, 6])]]);
        const d1 = retention(m, 1);
        assert.equal(d1.cohort, 1);
        assert.equal(d1.retainedPct, 100);
    });
});

describe('#4 dashboard: adminMetricsHandler guard', () => {
    it('OPTIONS → 200', async () => {
        const res = await adminMetricsHandler({ httpMethod: 'OPTIONS', headers: {} });
        assert.equal(res.statusCode, 200);
    });
    it('metodo non-GET → 405', async () => {
        const res = await adminMetricsHandler({ httpMethod: 'POST', headers: {} });
        assert.equal(res.statusCode, 405);
    });
    it('senza chiave/token → 401 ADMIN_REQUIRED', async () => {
        const res = await adminMetricsHandler({ httpMethod: 'GET', headers: {} });
        assert.equal(res.statusCode, 401);
        assert.equal(JSON.parse(res.body).code, 'ADMIN_REQUIRED');
    });
    // La shell era servita senza autenticazione: non contiene dati, ma divulga
    // l'esistenza e la forma della dashboard interna. Ora richiede la stessa chiave
    // gia' necessaria per i dati.
    it('adminDashboardHandler senza chiave → 401, nessun HTML della dashboard', async () => {
        const res = await adminDashboardHandler({ httpMethod: 'GET', headers: {} });
        assert.equal(res.statusCode, 401);
        assert.ok(!/Portfolio dashboard/.test(res.body), 'la shell non deve essere servita');
    });

    it('adminDashboardHandler con chiave → HTML + sessione firmata', async () => {
        process.env.DASHBOARD_ADMIN_KEY = 'chiave-di-test';
        const res = await adminDashboardHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: { key: 'chiave-di-test' } });
        assert.equal(res.statusCode, 200);
        assert.match(res.headers['Content-Type'], /text\/html/);
        assert.match(res.body, /Portfolio dashboard/);
        // La pagina rimuove la chiave dall'URL: senza cookie un reload sarebbe 401.
        const cookie = res.headers['Set-Cookie'] || '';
        assert.match(cookie, /adm_session=/, 'sessione non emessa');
        assert.match(cookie, /HttpOnly/);
        assert.match(cookie, /SameSite=Strict/, 'senza SameSite=Strict la sessione sarebbe usabile cross-site');
    });

    it('la sessione firmata vale per un reload, ma non se manomessa', async () => {
        process.env.DASHBOARD_ADMIN_KEY = 'chiave-di-test';
        const first = await adminDashboardHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: { key: 'chiave-di-test' } });
        const token = /adm_session=([^;]+)/.exec(first.headers['Set-Cookie'])[1];

        const reload = await adminDashboardHandler({ httpMethod: 'GET', headers: { cookie: `adm_session=${token}` } });
        assert.equal(reload.statusCode, 200, 'un reload con sessione valida deve funzionare');

        const tampered = await adminDashboardHandler({ httpMethod: 'GET', headers: { cookie: `adm_session=${token.slice(0, -2)}XX` } });
        assert.equal(tampered.statusCode, 401, 'una sessione manomessa deve essere rifiutata');
    });
});
