import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pricingHandler } from '../lambda/handler.mjs';

describe('/pricing endpoint (single-source, pubblico)', () => {
    it('OPTIONS → 200 con CORS *', async () => {
        const res = await pricingHandler({ httpMethod: 'OPTIONS', headers: {} });
        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
    });
    it('metodo non-GET → 405', async () => {
        const res = await pricingHandler({ httpMethod: 'POST', headers: {} });
        assert.equal(res.statusCode, 405);
    });
    it('brand non valido → 400 INVALID_BRAND (prima di Stripe)', async () => {
        const res = await pricingHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: { brand: 'bogus' } });
        assert.equal(res.statusCode, 400);
        assert.equal(JSON.parse(res.body).code, 'INVALID_BRAND');
        assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
    });
});
