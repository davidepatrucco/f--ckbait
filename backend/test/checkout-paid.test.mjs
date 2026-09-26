// checkout.session.completed con payment_status 'unpaid' non deve concedere premium.
// Il test non ha accesso a DynamoDB: se il guard mancasse, handleCheckoutCompleted
// tenterebbe saveSubscription e l'handler lancerebbe.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.STRIPE_WEBHOOK_SECRET ||= 'whsec_unit';
process.env.ENVIRONMENT ||= 'test';
process.env.AWS_REGION ||= 'eu-west-1';
// Endpoint irraggiungibile: nessuna chiamata reale ad AWS se il guard non regge.
process.env.AWS_ENDPOINT_URL_DYNAMODB = 'http://127.0.0.1:9';
process.env.AWS_ACCESS_KEY_ID ||= 'x';
process.env.AWS_SECRET_ACCESS_KEY ||= 'x';

const payments = await import('../src/payments.mjs');
payments.providers.stripe = async () => ({
    webhooks: { constructEvent: (body) => JSON.parse(body) }
});

const event = (payment_status) => JSON.stringify({
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', client_reference_id: 'u1', subscription: 'sub_1', customer: 'cus_1', payment_status, metadata: { brand: 'lemonsqueezer' } } }
});

test('sessione unpaid: nessun upgrade, nessuna scrittura', async () => {
    const res = await payments.handleStripeWebhook(event('unpaid'), 'sig');
    assert.equal(res.received, true);
});

test('sessione paid: tenta la scrittura (qui fallisce per assenza di DB)', async () => {
    await assert.rejects(payments.handleStripeWebhook(event('paid'), 'sig'));
});
