import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { accountDeleteHandler } from '../lambda/handler.mjs';

// La cancellazione effettiva tocca DynamoDB (integration/live). Qui verifichiamo
// routing/guard/envelope senza rete: il path 401 scatta prima di ogni accesso DB.
describe('E14-008 account deletion endpoint', () => {
    it('requires authentication (401 AUTH_REQUIRED) when no token', async () => {
        const res = await accountDeleteHandler({ httpMethod: 'POST', headers: {} });
        assert.equal(res.statusCode, 401);
        const body = JSON.parse(res.body);
        assert.equal(body.code, 'AUTH_REQUIRED');
    });

    it('handles CORS preflight (OPTIONS -> 200)', async () => {
        const res = await accountDeleteHandler({ httpMethod: 'OPTIONS', headers: {} });
        assert.equal(res.statusCode, 200);
    });
});
