import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { API_ERRORS, apiErrorBody, apiErrorStatus } from '../src/errors.mjs';

// Contract: questi codici/stati sono stabili. Un cambio qui è un breaking change API.
const CONTRACT = {
    INVALID_JSON: 400,
    MISSING_URL: 400,
    INVALID_BRAND: 400,
    INSUFFICIENT_CONTENT: 400,
    AUTH_REQUIRED: 401,
    YOUTUBE_TRANSCRIPT_REQUIRED: 422,
    USAGE_LIMIT_EXCEEDED: 429,
    OUTPUT_SCHEMA_ERROR: 502,
    PROCESSING_ERROR: 500,
    INTERNAL_ERROR: 500
};

describe('E12 API error model contract', () => {
    it('all contract codes exist with the expected HTTP status', () => {
        for (const [code, status] of Object.entries(CONTRACT)) {
            assert.ok(API_ERRORS[code], `codice mancante nel catalogo: ${code}`);
            assert.equal(API_ERRORS[code].status, status, `status errato per ${code}`);
            assert.equal(apiErrorStatus(code), status);
        }
    });

    it('every catalog entry has a status and a message', () => {
        for (const [code, def] of Object.entries(API_ERRORS)) {
            assert.equal(typeof def.status, 'number', `${code} senza status`);
            assert.equal(typeof def.message, 'string', `${code} senza message`);
            assert.ok(def.message.length > 0);
        }
    });

    it('apiErrorBody returns {error, code, ...extra} with stable code', () => {
        const b = apiErrorBody('USAGE_LIMIT_EXCEEDED', { brand: 'scout', plan: 'free', resetDate: '2026-09-01' });
        assert.equal(b.code, 'USAGE_LIMIT_EXCEEDED');
        assert.equal(b.brand, 'scout');
        assert.equal(b.plan, 'free');
        assert.equal(b.resetDate, '2026-09-01');
        assert.equal(b.error, API_ERRORS.USAGE_LIMIT_EXCEEDED.message);
    });

    it('extra.error overrides the default message', () => {
        const b = apiErrorBody('INVALID_BRAND', { error: 'custom', brand: 'x' });
        assert.equal(b.error, 'custom');
        assert.equal(b.code, 'INVALID_BRAND');
        assert.equal(b.brand, 'x');
    });

    it('unknown code maps to INTERNAL_ERROR', () => {
        const b = apiErrorBody('NOPE');
        assert.equal(b.code, 'INTERNAL_ERROR');
        assert.equal(apiErrorStatus('NOPE'), 500);
    });
});
