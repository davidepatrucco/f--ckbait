// Ciclo Stripe completo, contro DynamoDB REALE (staging).
//
// Perché di integrazione e non unitario: i difetti trovati in questa area erano tutti
// nel punto di contatto con il database — chiave assente, tabella sbagliata, nome di
// campo divergente fra scrittura e lettura. Un finto client DynamoDB li avrebbe
// riprodotti tutti e tre senza segnalarli, perché avrei scritto il finto con le stesse
// assunzioni sbagliate del codice.
//
// Stripe è invece sostituito (providers.stripe): non esiste un account di test
// configurato, e ciò che serve verificare è la nostra persistenza, non la loro API.
//
// Esecuzione: RUN_INTEGRATION=1 npm run test:integration
// Senza la variabile i test sono saltati (CI non ha credenziali AWS).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const RUN = process.env.RUN_INTEGRATION === '1';
const ENV = process.env.INTEGRATION_ENV || 'staging';

process.env.SUBSCRIPTIONS_TABLE_NAME ||= `reading-intelligence-subscriptions-${ENV}`;
process.env.PAYMENTS_TABLE_NAME ||= `reading-intelligence-payments-${ENV}`;
process.env.USERS_TABLE_NAME ||= `reading-intelligence-users-${ENV}`;
process.env.AWS_REGION ||= 'eu-west-1';
process.env.ENVIRONMENT ||= 'test';
// Il webhook rifiuta senza secret e senza firma: e' il comportamento voluto, quindi
// il test lo soddisfa invece di aggirarlo.
process.env.STRIPE_WEBHOOK_SECRET ||= 'whsec_test_integrazione';

const payments = RUN ? await import('../../src/payments.mjs') : null;
const dynamo = RUN ? await import('../../src/dynamodb.mjs') : null;

// Stripe simulato: registra le chiamate e restituisce lo stato richiesto dal test.
function fakeStripe(state = {}) {
    const calls = [];
    return {
        calls,
        subscriptions: {
            update: async (id, args) => { calls.push(['update', id, args]); return { id, ...args }; },
            cancel: async (id) => {
                calls.push(['cancel', id]);
                if (state.cancelFails) { const e = new Error('rete non disponibile'); throw e; }
                return { id, status: 'canceled' };
            },
            retrieve: async (id) => ({ id, status: state.status || 'active' })
        },
        checkout: { sessions: { retrieve: async (id) => state.session } },
        // La verifica crittografica della firma appartiene alla libreria Stripe, non
        // al nostro codice: qui si simula l'esito. Cio' che resta nostro — rifiutare
        // quando secret o firma mancano — e' verificato nel test dedicato.
        webhooks: {
            constructEvent: (body, signature, secret) => {
                if (!signature || !secret) throw new Error('firma non valida');
                return JSON.parse(body);
            }
        }
    };
}

const userId = `itest-${randomUUID()}`;
let created = [];

before(async () => {
    if (!RUN) return;
    created = [];
});

after(async () => {
    if (!RUN) return;
    // Pulizia: i record di prova non devono restare su staging.
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, DeleteCommand, QueryCommand } = await import('@aws-sdk/lib-dynamodb');
    const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));
    const out = await doc.send(new QueryCommand({
        TableName: process.env.SUBSCRIPTIONS_TABLE_NAME,
        KeyConditionExpression: 'userId = :u',
        ExpressionAttributeValues: { ':u': userId }
    })).catch(() => ({ Items: [] }));
    for (const item of out.Items || []) {
        await doc.send(new DeleteCommand({
            TableName: process.env.SUBSCRIPTIONS_TABLE_NAME,
            Key: { userId, subscriptionId: item.subscriptionId }
        })).catch(() => {});
    }
    await doc.send(new DeleteCommand({
        TableName: process.env.USERS_TABLE_NAME, Key: { id: userId }
    })).catch(() => {});
});

test('ciclo completo: acquisto -> persistenza -> lettura per brand -> cancellazione', { skip: !RUN && 'RUN_INTEGRATION non impostato' }, async () => {
    const original = payments.providers.stripe;
    const stripe = fakeStripe();
    payments.providers.stripe = async () => stripe;
    try {
        await dynamo.createUser({ id: userId, email: `${userId}@example.invalid`, name: 'Integration', plan: 'free', createdAt: new Date().toISOString(), lastLogin: new Date().toISOString() });

        // 1. Webhook di acquisto completato su SCOUT (non il brand di default):
        //    è il caso in cui il brand veniva perso e l'elemento scritto senza chiave.
        await payments.handleStripeWebhook(JSON.stringify({
            type: 'checkout.session.completed',
            data: { object: {
                id: 'cs_itest_1',
                subscription: 'sub_itest_1',
                customer: 'cus_itest_1',
                client_reference_id: userId,
                metadata: { user_id: userId, brand: 'scout', plan_type: 'premium_monthly' }
            } }
        }), 'sig_test');

        // 2. L'abbonamento è leggibile SUL BRAND GIUSTO.
        const scoutSub = await payments.getUserSubscription(userId, 'scout');
        assert.ok(scoutSub, 'abbonamento non persistito: la scrittura è fallita in silenzio');
        assert.equal(scoutSub.subscriptionId, 'sub_itest_1', 'chiave di ordinamento mancante o errata');
        assert.equal(scoutSub.brand, 'scout', 'il brand dell’acquisto non è stato conservato');
        assert.equal(scoutSub.stripe_subscription_id, 'sub_itest_1', 'il campo letto da cancel/reactivate non corrisponde');

        // 3. Un ALTRO brand non vede quell'abbonamento (indipendenza commerciale).
        const lemonSub = await payments.getUserSubscription(userId, 'lemonsqueezer');
        assert.equal(lemonSub, null, 'l’abbonamento di un brand è visibile da un altro');

        // 4. Un secondo acquisto su un brand diverso NON sovrascrive il primo.
        await payments.handleStripeWebhook(JSON.stringify({
            type: 'checkout.session.completed',
            data: { object: {
                id: 'cs_itest_2', subscription: 'sub_itest_2', customer: 'cus_itest_1',
                client_reference_id: userId,
                metadata: { user_id: userId, brand: 'signal', plan_type: 'premium_yearly' }
            } }
        }), 'sig_test');
        assert.ok(await payments.getUserSubscription(userId, 'signal'), 'secondo brand non persistito');
        assert.ok(await payments.getUserSubscription(userId, 'scout'), 'il primo brand è stato sovrascritto');

        // 5. La cancellazione agisce sull'abbonamento del brand richiesto.
        stripe.calls.length = 0;
        await payments.cancelSubscription(userId, 'scout');
        const canceled = stripe.calls.find((c) => c[0] === 'update' && c[1] === 'sub_itest_1');
        assert.ok(canceled, 'la cancellazione non ha trovato l’abbonamento: id non corrispondente');
        assert.ok(await payments.getUserSubscription(userId, 'signal'), 'cancellare un brand ha toccato l’altro');
    } finally {
        payments.providers.stripe = original;
    }
});

test('cancellazione account: annulla su Stripe e poi rimuove i record', { skip: !RUN && 'RUN_INTEGRATION non impostato' }, async () => {
    const original = payments.providers.stripe;
    const stripe = fakeStripe();
    payments.providers.stripe = async () => stripe;
    try {
        const res = await payments.deleteUserSubscription(userId);
        assert.ok(res.canceledOnStripe >= 1, 'nessun annullamento inviato a Stripe');
        assert.deepEqual(res.retryable, [], 'nessun abbonamento doveva restare in sospeso');
        assert.equal(payments.canDeleteLocalData(res), true, 'i dati locali dovevano poter essere rimossi');
        assert.equal(await payments.getUserSubscription(userId, 'scout'), null, 'record non rimosso');
    } finally {
        payments.providers.stripe = original;
    }
});

test('se Stripe fallisce, i record restano e l’operazione non si dichiara riuscita', { skip: !RUN && 'RUN_INTEGRATION non impostato' }, async () => {
    const original = payments.providers.stripe;
    const stripe = fakeStripe({ cancelFails: true });
    payments.providers.stripe = async () => stripe;
    try {
        // Nuovo abbonamento da cancellare, con Stripe che rifiuta.
        await payments.handleStripeWebhook(JSON.stringify({
            type: 'checkout.session.completed',
            data: { object: {
                id: 'cs_itest_3', subscription: 'sub_itest_3', customer: 'cus_itest_1',
                client_reference_id: userId,
                metadata: { user_id: userId, brand: 'briefly', plan_type: 'premium_monthly' }
            } }
        }), 'sig_test');

        const res = await payments.deleteUserSubscription(userId);
        assert.ok(res.retryable.includes('sub_itest_3') || res.errors.includes('sub_itest_3'),
            'un annullamento fallito deve risultare ritentabile');
        assert.equal(payments.canDeleteLocalData(res), false,
            'i dati locali NON devono essere cancellabili: si perderebbe il riferimento a un addebito attivo');
        assert.ok(await payments.getUserSubscription(userId, 'briefly'),
            'il record è stato rimosso nonostante l’abbonamento sia ancora attivo');
    } finally {
        payments.providers.stripe = original;
    }
});

test('il webhook rifiuta un evento senza firma', { skip: !RUN && 'RUN_INTEGRATION non impostato' }, async () => {
    const original = payments.providers.stripe;
    payments.providers.stripe = async () => fakeStripe();
    try {
        await assert.rejects(
            () => payments.handleStripeWebhook(JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } }), null),
            /firma|signature|WEBHOOK_SECRET/i,
            'un evento senza firma non deve essere elaborato'
        );
    } finally {
        payments.providers.stripe = original;
    }
});
