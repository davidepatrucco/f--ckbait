// /auth/login e /auth/register passano dal rate limit per email, fail closed.
// Con DynamoDB irraggiungibile il rate limit non e' verificabile: la risposta deve
// essere 429, non un tentativo di login (che darebbe 400/401).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.AWS_ENDPOINT_URL_DYNAMODB = 'http://127.0.0.1:9';
process.env.AWS_ACCESS_KEY_ID ||= 'x';
process.env.AWS_SECRET_ACCESS_KEY ||= 'x';
process.env.AWS_MAX_ATTEMPTS = '1';

const { handler } = await import('../lambda/handler.mjs');

for (const path of ['/auth/login', '/auth/register']) {
    test(`${path}: rate limit prima delle credenziali`, async () => {
        const res = await handler({
            path, httpMethod: 'POST', headers: {},
            body: JSON.stringify({ email: 'a@example.com', password: 'x'.repeat(12) })
        });
        assert.equal(res.statusCode, 429);
        assert.equal(JSON.parse(res.body).code, 'RATE_LIMITED');
    });
}
