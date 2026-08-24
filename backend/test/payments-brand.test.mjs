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
    it('each brand declares its own SSM price keys', () => {
        assert.equal(getBrand('lemonsqueezer').stripe.monthlyPriceKey, 'STRIPE_PREMIUM_MONTHLY_PRICE_ID');
        assert.equal(getBrand('scout').stripe.monthlyPriceKey, 'STRIPE_SCOUT_PREMIUM_MONTHLY_PRICE_ID');
        assert.notEqual(getBrand('scout').stripe.monthlyPriceKey, getBrand('lemonsqueezer').stripe.monthlyPriceKey);
    });

    it('checkout with an invalid brand is rejected before any Stripe call (E08-012)', async () => {
        await assert.rejects(
            () => createCheckoutSession('u1', 'u1@example.com', 'bogus', 'premium_monthly'),
            /Brand non valido/
        );
    });
});
