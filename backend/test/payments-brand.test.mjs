import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStripeBrand, createCheckoutSession } from '../src/payments.mjs';
import { getBrand } from '../src/brands.mjs';

describe('E08 payments — brand resolution from Stripe metadata', () => {
    it('resolves the brand from session/subscription metadata', () => {
        assert.equal(resolveStripeBrand({ metadata: { brand: 'scout' } }), 'scout');
        assert.equal(resolveStripeBrand({ metadata: { brand: 'lemonsqueezer' } }), 'lemonsqueezer');
    });

    it('defaults to lemonsqueezer for missing/invalid brand (legacy-safe)', () => {
        assert.equal(resolveStripeBrand({ metadata: {} }), 'lemonsqueezer');
        assert.equal(resolveStripeBrand({}), 'lemonsqueezer');
        assert.equal(resolveStripeBrand(null), 'lemonsqueezer');
        assert.equal(resolveStripeBrand({ metadata: { brand: 'bogus' } }), 'lemonsqueezer');
    });

    it('a Scout purchase resolves to scout (not lemonsqueezer)', () => {
        // Simula i metadata che createCheckoutSession scrive per Scout.
        const session = { metadata: { user_id: 'u1', brand: 'scout', plan_type: 'premium_monthly' } };
        assert.equal(resolveStripeBrand(session), 'scout');
        assert.notEqual(resolveStripeBrand(session), 'lemonsqueezer');
    });
});

describe('E08 payments — per-brand Stripe config & validation', () => {
    // Difetto reale trovato in produzione: lemonsqueezer usava le chiavi CONDIVISE
    // legacy (STRIPE_PREMIUM_*), che puntavano a prezzi vecchi e sbagliati — il
    // brand mostrava 9,99 EUR/anno come mensile. Il test ora fissa la proprieta'
    // che conta: ogni brand ha chiavi proprie e nessuna e' condivisa con altri.
    it('ogni brand ha chiavi SSM proprie e distinte, nessuna condivisa', () => {
        const brands = ['lemonsqueezer', 'scout', 'signal', 'briefly', 'nobull'];
        const seen = new Map();
        for (const b of brands) {
            const { monthlyPriceKey, yearlyPriceKey } = getBrand(b).stripe;
            for (const key of [monthlyPriceKey, yearlyPriceKey]) {
                assert.ok(key, `${b}: chiave mancante`);
                assert.ok(/^STRIPE_[A-Z]+_PREMIUM_(MONTHLY|YEARLY)_PRICE_ID$/.test(key),
                    `${b}: "${key}" non e' una chiave per-brand (le legacy STRIPE_PREMIUM_* sono condivise)`);
                assert.ok(!seen.has(key), `chiave "${key}" condivisa tra ${seen.get(key)} e ${b}`);
                seen.set(key, b);
            }
        }
        assert.equal(seen.size, brands.length * 2, 'ogni brand deve avere due chiavi distinte');
    });

    it('mensile e annuale non sono la stessa chiave', () => {
        for (const b of ['lemonsqueezer', 'scout', 'signal', 'briefly', 'nobull']) {
            const s = getBrand(b).stripe;
            assert.notEqual(s.monthlyPriceKey, s.yearlyPriceKey, `${b}: mensile e annuale puntano alla stessa chiave`);
        }
    });

    it('checkout with an invalid brand is rejected before any Stripe call (E08-012)', async () => {
        await assert.rejects(
            () => createCheckoutSession('u1', 'u1@example.com', 'bogus', 'premium_monthly'),
            /Brand non valido/
        );
    });
});
