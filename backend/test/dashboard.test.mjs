import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { retention } from '../src/dashboard.mjs';
import { adminMetricsHandler } from '../lambda/handler.mjs';

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
    it('senza auth → 401', async () => {
        const res = await adminMetricsHandler({ httpMethod: 'GET', headers: {} });
        assert.equal(res.statusCode, 401);
        assert.equal(JSON.parse(res.body).code, 'AUTH_REQUIRED');
    });
});
