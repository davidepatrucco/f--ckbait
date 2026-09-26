// payments-portal.test.mjs - Test per il Customer Portal Stripe (BIF-47)
//
// Limite noto: createPortalSession dipende da una lettura reale da DynamoDB
// (getUserSubscription) senza alcun seam di dependency-injection (a differenza di
// payments.providers.stripe). Questo e' lo stesso limite documentato in
// test/integration/stripe-cycle.test.mjs: il codice non offre modo di simulare
// "nessun customer" o "customer trovato" senza un DB reale raggiungibile, e questa
// suite non puo' chiamare AWS reale. Di conseguenza i due casi "no-customer -> 404"
// e "happy path -> url" NON sono distinguibili qui: entrambi richiedono la stessa
// query DynamoDB, che con endpoint irraggiungibile rifiuta genericamente in ogni
// caso (stesso pattern di test/checkout-paid.test.mjs, "tenta la scrittura (qui
// fallisce per assenza di DB)"). Il test sotto verifica solo che il fallimento
// DB si propaghi (niente crash silenzioso, nessun 404 spurio) e non l'esito atteso
// dal ticket sui due rami applicativi.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.STRIPE_WEBHOOK_SECRET ||= 'whsec_unit';
process.env.ENVIRONMENT ||= 'test';
process.env.AWS_REGION ||= 'eu-west-1';
// Endpoint irraggiungibile: nessuna chiamata reale ad AWS.
process.env.AWS_ENDPOINT_URL_DYNAMODB = 'http://127.0.0.1:9';
process.env.AWS_ACCESS_KEY_ID ||= 'x';
process.env.AWS_SECRET_ACCESS_KEY ||= 'x';

const payments = await import('../src/payments.mjs');
const { handler } = await import('../lambda/handler.mjs');

describe('BIF-47 payments — Customer Portal', () => {
    it('createPortalSession e\' esportata come funzione', () => {
        assert.equal(typeof payments.createPortalSession, 'function');
    });

    it('senza DB raggiungibile la sessione rifiuta (nessun 404/URL spurio)', async () => {
        // Vedi commento in testa al file: non verifica NO_SUBSCRIPTION vs happy path,
        // solo che l'errore si propaghi invece di restituire un risultato inventato.
        await assert.rejects(payments.createPortalSession('u1', 'lemonsqueezer'), (error) => {
            assert.notEqual(error.code, 'NO_SUBSCRIPTION');
            return true;
        });
    });

    it('POST /payments/portal senza Authorization risponde 401', async () => {
        const response = await handler({
            path: '/payments/portal',
            httpMethod: 'POST',
            headers: {},
            body: ''
        });
        assert.equal(response.statusCode, 401);
        assert.equal(JSON.parse(response.body).code, 'AUTH_REQUIRED');
    });
});
