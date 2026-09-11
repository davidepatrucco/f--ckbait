// Piano free: N prove gratuite iniziali, poi il limite giornaliero.
//
// Il rischio che questi test coprono: le prove e la quota giornaliera sono due
// contatori distinti e l'ordine conta. Se si confondono, un utente puo' restare
// bloccato pur avendo prove disponibili, oppure ottenere riassunti illimitati.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canUserSummarize, getEntitlement } from '../src/auth.mjs';
import { getFreeTrial, getFreeLimit } from '../src/brands.mjs';

const future = new Date(Date.now() + 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();
const u = (ent) => ({ id: 'u1', entitlements: { lemonsqueezer: ent } });

test('un utente nuovo ha le prove iniziali del brand', () => {
    const ent = getEntitlement({ id: 'nuovo' }, 'lemonsqueezer');
    assert.equal(ent.trialRemaining, getFreeTrial('lemonsqueezer'));
    assert.ok(ent.trialRemaining > 1, 'le prove devono essere piu' + ' di una, altrimenti non aggiungono nulla al limite giornaliero');
});

test('con prove disponibili si riassume anche se la quota giornaliera è esaurita', () => {
    const user = u({ plan: 'free', trial_remaining: 3, usage_used: 1, usage_limit: 1, usage_reset_date: future });
    const res = canUserSummarize(user, 'lemonsqueezer');
    assert.equal(res.canSummarize, true);
    assert.equal(res.usingTrial, true);
    assert.equal(res.trialRemaining, 3);
});

test('esaurite le prove subentra il limite giornaliero', () => {
    const bloccato = u({ plan: 'free', trial_remaining: 0, usage_used: 1, usage_limit: 1, usage_reset_date: future });
    assert.equal(canUserSummarize(bloccato, 'lemonsqueezer').canSummarize, false);

    const libero = u({ plan: 'free', trial_remaining: 0, usage_used: 0, usage_limit: 1, usage_reset_date: future });
    assert.equal(canUserSummarize(libero, 'lemonsqueezer').canSummarize, true);
    assert.notEqual(canUserSummarize(libero, 'lemonsqueezer').usingTrial, true, 'qui non si usa una prova');
});

test('le prove non si ricaricano al reset giornaliero', () => {
    // Periodo scaduto: la quota riparte, ma le prove restano a zero.
    const user = u({ plan: 'free', trial_remaining: 0, usage_used: 1, usage_limit: 1, usage_reset_date: past });
    const ent = getEntitlement(user, 'lemonsqueezer');
    assert.equal(ent.trialRemaining, 0, 'le prove sono una tantum');
    assert.equal(canUserSummarize(user, 'lemonsqueezer').canSummarize, true, 'ma la quota giornaliera si e\' resettata');
});

test('il premium ignora sia prove sia quota', () => {
    const user = u({ plan: 'premium', trial_remaining: 0, usage_used: 999, usage_limit: 1, usage_reset_date: future });
    const res = canUserSummarize(user, 'lemonsqueezer');
    assert.equal(res.canSummarize, true);
    assert.notEqual(res.usingTrial, true);
});

test('entitlement senza il campo: le prove valgono come non usate', () => {
    // Utenti creati prima di questa funzione: ricevono comunque le prove, una volta.
    const user = u({ plan: 'free', usage_used: 0, usage_limit: 1, usage_reset_date: future });
    assert.equal(getEntitlement(user, 'lemonsqueezer').trialRemaining, getFreeTrial('lemonsqueezer'));
});

test('le prove sono indipendenti per brand', () => {
    const user = {
        id: 'u1',
        entitlements: {
            lemonsqueezer: { plan: 'free', trial_remaining: 0, usage_used: 1, usage_limit: 1, usage_reset_date: future },
            scout: { plan: 'free', trial_remaining: 5, usage_used: 1, usage_limit: 1, usage_reset_date: future }
        }
    };
    assert.equal(canUserSummarize(user, 'lemonsqueezer').canSummarize, false);
    assert.equal(canUserSummarize(user, 'scout').canSummarize, true);
});

test('coerenza delle soglie: le prove superano il limite giornaliero', () => {
    for (const brand of ['lemonsqueezer', 'scout', 'signal', 'briefly', 'nobull']) {
        assert.ok(getFreeTrial(brand) >= getFreeLimit(brand), `${brand}: prove (${getFreeTrial(brand)}) sotto il limite giornaliero`);
    }
});
