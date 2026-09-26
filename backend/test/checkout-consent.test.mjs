// checkout-consent.test.mjs - Test per il consenso Termini/recesso in checkout (BIF-48)
//
// Verifica che createCheckoutSession passi a Stripe consent_collection e custom_text
// per la rinuncia al recesso (Direttiva 2011/83/UE art. 16, lett. m). Stub del client
// Stripe via payments.providers.stripe (stesso seam di test/checkout-paid.test.mjs):
// nessuna chiamata reale a Stripe/AWS.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.ENVIRONMENT ||= 'test';
process.env.AWS_REGION ||= 'eu-west-1';
process.env.STRIPE_LEMONSQUEEZER_PREMIUM_MONTHLY_PRICE_ID ||= 'price_monthly_test';
process.env.STRIPE_LEMONSQUEEZER_PREMIUM_YEARLY_PRICE_ID ||= 'price_yearly_test';
process.env.STRIPE_SUCCESS_URL ||= 'https://example.test/success';
process.env.STRIPE_CANCEL_URL ||= 'https://example.test/cancel';
// Scrittura della sessione di checkout su DB: endpoint irraggiungibile, ma
// saveCheckoutSession ingloba l'errore (solo console.warn), quindi non deve
// far fallire questo test - vedi commento nella funzione in payments.mjs.
process.env.AWS_ENDPOINT_URL_DYNAMODB = 'http://127.0.0.1:9';
process.env.AWS_ACCESS_KEY_ID ||= 'x';
process.env.AWS_SECRET_ACCESS_KEY ||= 'x';

const payments = await import('../src/payments.mjs');

let capturedParams = null;
payments.providers.stripe = async () => ({
    checkout: {
        sessions: {
            create: async (params) => {
                capturedParams = params;
                return { id: 'cs_test_1', url: 'https://checkout.stripe.test/cs_test_1' };
            }
        }
    }
    // niente prices.retrieve: getBrandPricing ricade sul fallback (try/catch interno).
});

describe('BIF-48 checkout — consenso Termini e rinuncia al recesso', () => {
    it('passa consent_collection.terms_of_service = required', async () => {
        await payments.createCheckoutSession('u1', 'user@example.test', 'lemonsqueezer', 'premium_monthly');
        assert.ok(capturedParams, 'stripe.checkout.sessions.create doveva essere chiamato');
        assert.deepEqual(capturedParams.consent_collection, { terms_of_service: 'required' });
    });

    it('passa un custom_text.terms_of_service_acceptance.message non vuoto', async () => {
        capturedParams = null;
        await payments.createCheckoutSession('u1', 'user@example.test', 'lemonsqueezer', 'premium_yearly');
        const message = capturedParams?.custom_text?.terms_of_service_acceptance?.message;
        assert.equal(typeof message, 'string');
        assert.ok(message.length > 0 && message.length <= 1200, `lunghezza fuori range: ${message?.length}`);
    });
});
