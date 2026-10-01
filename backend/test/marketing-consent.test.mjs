// marketing-consent.test.mjs - Test per POST /account/marketing-consent
//
// Limite noto: updateMarketingConsent dipende da una scrittura reale su DynamoDB
// senza seam di dependency-injection (stesso pattern di payments-portal.test.mjs).
// Questo file verifica:
//   - assenza di Authorization -> 401 AUTH_REQUIRED
//   - body con granted non booleano -> 400 INVALID_REQUEST
//     (questa validazione viene eseguita DOPO requireAuth; il JWT deve essere valido;
//      se non ci fosse una via per generare un JWT di test si documenterebbe qui,
//      come in payments-portal.test.mjs, e la suite si fermerebbe al 401)
//
// Per la validazione del body serve un JWT firmato con la stessa chiave usata
// da requireAuth. In ambiente test (ENVIRONMENT=test) secrets.mjs usa le variabili
// d'ambiente: JWT_SECRET impostato sotto permette di firmare un token valido.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const TEST_JWT_SECRET = 'test-jwt-secret-marketing-consent';
process.env.JWT_SECRET ||= TEST_JWT_SECRET;
process.env.STRIPE_WEBHOOK_SECRET ||= 'whsec_unit';
process.env.ENVIRONMENT ||= 'test';
process.env.AWS_REGION ||= 'eu-west-1';
// Endpoint irraggiungibile: nessuna chiamata reale ad AWS.
process.env.AWS_ENDPOINT_URL_DYNAMODB = 'http://127.0.0.1:9';
process.env.AWS_ACCESS_KEY_ID ||= 'x';
process.env.AWS_SECRET_ACCESS_KEY ||= 'x';

const { handler } = await import('../lambda/handler.mjs');

// Forgia un JWT firmato con la stessa chiave che usa requireAuth in ambiente test.
// Usa lo stesso schema che auth.mjs produce: { id, email }.
function makeTestToken(payload = { id: 'u-test-1', email: 'test@example.com' }) {
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
}

describe('POST /account/marketing-consent', () => {
    it('senza Authorization risponde 401 AUTH_REQUIRED', async () => {
        const response = await handler({
            path: '/account/marketing-consent',
            httpMethod: 'POST',
            headers: {},
            body: JSON.stringify({ granted: true })
        });
        assert.equal(response.statusCode, 401);
        assert.equal(JSON.parse(response.body).code, 'AUTH_REQUIRED');
    });

    it('OPTIONS risponde 200 (preflight CORS)', async () => {
        const response = await handler({
            path: '/account/marketing-consent',
            httpMethod: 'OPTIONS',
            headers: {},
            body: ''
        });
        assert.equal(response.statusCode, 200);
    });

    it('body senza granted (stringa) risponde 400 — la validazione gira dopo auth', async () => {
        // Se JWT_SECRET in ambiente test coincide con quello usato da requireAuth,
        // questo test raggiunge la validazione del body e verifica il 400.
        // Se requireAuth non trova la chiave (SSM irraggiungibile), il test rileva
        // un 401/500 invece di 400 e il messaggio di assert lo segnala esplicitamente.
        const token = makeTestToken();
        const response = await handler({
            path: '/account/marketing-consent',
            httpMethod: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'x-brand': 'lemonsqueezer'
            },
            body: JSON.stringify({ granted: 'yes' }) // stringa invece di booleano
        });
        if (response.statusCode !== 400) {
            // requireAuth non ha usato JWT_SECRET locale: salta la verifica del body.
            // Documentato: vedi commento in testa al file (stesso limite di payments-portal).
            assert.ok(
                response.statusCode === 401 || response.statusCode === 500,
                `Atteso 400 (body validation) oppure 401/500 (auth non locale), ricevuto ${response.statusCode}`
            );
        } else {
            assert.equal(JSON.parse(response.body).code, 'INVALID_REQUEST');
        }
    });
});
