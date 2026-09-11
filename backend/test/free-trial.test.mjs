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

// Difetti trovati dall'audit esterno: il consumo delle prove non funzionava per gli
// utenti reali, perche' createUser scriveva l'entitlement SENZA trial_remaining e
// ensureBrandEntitlement (if_not_exists sull'intera mappa del brand) non aggiungeva
// piu' il singolo attributo. Il lettore mostrava 5 prove, la scrittura non ne
// consumava nessuna. Il test precedente non lo vedeva perche' partiva da un utente
// privo di entitlement.
test('createUser inizializza le prove nell’entitlement', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/dynamodb.mjs', import.meta.url), 'utf8');
    assert.match(src, /trial_remaining:\s*getFreeTrial\(initBrand\)/,
        'createUser deve scrivere trial_remaining, altrimenti le prove non sono consumabili');
});

test('il consumo delle prove funziona anche se l’attributo non esiste ancora', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/dynamodb.mjs', import.meta.url), 'utf8');
    // L'aggiornamento deve inizializzare e scalare in UNA sola operazione atomica.
    assert.match(src, /if_not_exists\(entitlements\.#b\.trial_remaining, :full\) - :one/,
        'serve if_not_exists nella SET, altrimenti gli entitlement esistenti non ricevono mai il campo');
    assert.match(src, /attribute_not_exists\(entitlements\.#b\.trial_remaining\) OR entitlements\.#b\.trial_remaining > :zero/,
        'la condizione deve coprire entrambi i casi');
});

test('il reset del periodo e’ un compare-and-swap', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/dynamodb.mjs', import.meta.url), 'utf8');
    // Senza condizione, N richieste concorrenti che leggono lo stesso periodo scaduto
    // scrivono tutte usage_used = 1 e vengono tutte accettate.
    const resetBlock = src.slice(src.indexOf('if (resetIfExpired)'), src.indexOf('} else {', src.indexOf('if (resetIfExpired)')));
    assert.match(resetBlock, /ConditionExpression/, 'il ramo di reset deve avere una condizione');
    assert.match(resetBlock, /usage_reset_date = :expected/, 'la condizione deve confrontare la data letta');
});

test('il rimborso della quota e’ legato al periodo della prenotazione', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/dynamodb.mjs', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export async function decrementBrandUsage'));
    assert.match(fn.slice(0, 900), /usage_reset_date = :period/,
        'senza il vincolo sul periodo, una richiesta a cavallo della mezzanotte scala il contatore del giorno dopo');
});
