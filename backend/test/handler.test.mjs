import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../lambda/handler.mjs';

describe('HTTP router', () => {
    it('serves health without external services', async () => {
        const response = await handler({ path: '/health', httpMethod: 'GET', headers: {} });
        assert.equal(response.statusCode, 200);
        assert.equal(JSON.parse(response.body).status, 'healthy');
        assert.equal(response.headers['Cache-Control'], 'no-store');
    });

    it('returns a JSON 404 for unknown routes', async () => {
        const response = await handler({ path: '/unknown', httpMethod: 'GET', headers: {} });
        assert.equal(response.statusCode, 404);
        assert.equal(JSON.parse(response.body).error, 'Endpoint non trovato');
    });
});
