// policy-pdf.test.mjs — PDF è Premium-only.
//
// Perché un file separato: la decisione "può usare PDF?" è nuova e ha proprie
// regole di override. La suite di policy-source.test.mjs copre la coerenza
// strutturale della configurazione; qui si copre il comportamento specifico di
// questo gate.
//
// Limite noto: il test di handler (/extract-pdf → 403 per utente free) richiede
// requireAuth → DynamoDB (stesso limite documentato in payments-portal.test.mjs).
// La decisione è estratta nella funzione pura canUsePdf(entitlement), che viene
// testata qui direttamente. Il test 401 (nessun auth) verifica che il gate sia
// raggiunto solo dopo l'autenticazione.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.STRIPE_WEBHOOK_SECRET ||= 'whsec_unit';
process.env.ENVIRONMENT ||= 'test';
process.env.AWS_REGION ||= 'eu-west-1';
// Endpoint irraggiungibile: nessuna chiamata reale ad AWS.
process.env.AWS_ENDPOINT_URL_DYNAMODB = 'http://127.0.0.1:9';
process.env.AWS_ACCESS_KEY_ID ||= 'x';
process.env.AWS_SECRET_ACCESS_KEY ||= 'x';

const { PLAN_POLICY, applyOverrides } = await import('../src/policy.mjs');
const { canUsePdf, handler } = await import('../lambda/handler.mjs');

describe('PDF policy — valori di default', () => {
    test('piano free: pdf = false di default', () => {
        assert.equal(PLAN_POLICY.free.pdf, false);
    });

    test('piano premium: pdf = true di default', () => {
        assert.equal(PLAN_POLICY.premium.pdf, true);
    });
});

describe('canUsePdf — funzione pura', () => {
    test('utente free → false', () => {
        assert.equal(canUsePdf({ plan: 'free' }), false);
    });

    test('utente premium → true', () => {
        assert.equal(canUsePdf({ plan: 'premium' }), true);
    });

    test('entitlement null o assente → false (default al piano free)', () => {
        assert.equal(canUsePdf(null), false);
        assert.equal(canUsePdf(undefined), false);
        assert.equal(canUsePdf({}), false);
    });

    test('piano sconosciuto → false', () => {
        assert.equal(canUsePdf({ plan: 'gold' }), false);
    });
});

describe('Override runtime plan.free.pdf', () => {
    test('accetta 1 (abilita PDF per il piano free)', () => {
        const saved = PLAN_POLICY.free.pdf;
        try {
            applyOverrides({ 'plan.free.pdf': 1 });
            assert.equal(PLAN_POLICY.free.pdf, true, 'override 1 deve abilitare pdf');
            assert.equal(canUsePdf({ plan: 'free' }), true, 'canUsePdf deve riflettere l\'override');
        } finally {
            PLAN_POLICY.free.pdf = saved;
        }
    });

    test('accetta 0 (mantiene/ripristina il default false)', () => {
        const saved = PLAN_POLICY.free.pdf;
        try {
            applyOverrides({ 'plan.free.pdf': 0 });
            assert.equal(PLAN_POLICY.free.pdf, false, 'override 0 deve disabilitare pdf');
        } finally {
            PLAN_POLICY.free.pdf = saved;
        }
    });

    test('rifiuta stringhe non numeriche (NaN → setter non chiamato)', () => {
        const saved = PLAN_POLICY.free.pdf;
        try {
            // 'plan.free.pdf' inizialmente false; 'yes' → Number('yes')=NaN → scartato.
            applyOverrides({ 'plan.free.pdf': 'yes' });
            assert.equal(PLAN_POLICY.free.pdf, false, 'una stringa non deve modificare il valore');
        } finally {
            PLAN_POLICY.free.pdf = saved;
        }
    });

    test('rifiuta null e undefined', () => {
        const saved = PLAN_POLICY.free.pdf;
        try {
            for (const bad of [null, undefined]) {
                PLAN_POLICY.free.pdf = false;
                applyOverrides({ 'plan.free.pdf': bad });
                assert.equal(PLAN_POLICY.free.pdf, false, `${bad} non deve modificare il valore`);
            }
        } finally {
            PLAN_POLICY.free.pdf = saved;
        }
    });
});

describe('Gate /extract-pdf', () => {
    // Il test 403 (utente free con JWT valido) richiede requireAuth → DynamoDB, che non
    // è raggiungibile in questa suite. La decisione è coperta da canUsePdf qui sopra.
    // Si verifica solo che l'endpoint risponda 401 senza autenticazione (nessun DB).

    test('POST /extract-pdf senza Authorization → 401 AUTH_REQUIRED', async () => {
        const res = await handler({
            path: '/extract-pdf',
            httpMethod: 'POST',
            headers: {},
            body: '{}'
        });
        assert.equal(res.statusCode, 401);
        assert.equal(JSON.parse(res.body).code, 'AUTH_REQUIRED');
    });
});
