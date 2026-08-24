import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBrandId, isValidBrand, getFreeLimit, DEFAULT_BRAND, listBrands } from '../src/brands.mjs';
import { getEntitlement, canUserSummarize } from '../src/auth.mjs';

describe('brands registry', () => {
    it('resolves valid brands and falls back to default', () => {
        assert.equal(resolveBrandId('scout'), 'scout');
        assert.equal(resolveBrandId('bogus'), DEFAULT_BRAND);
        assert.equal(resolveBrandId(undefined), DEFAULT_BRAND);
        assert.equal(isValidBrand('nobull'), true);
        assert.equal(isValidBrand('nope'), false);
        assert.ok(listBrands().includes('lemonsqueezer'));
    });
});

describe('per-brand entitlements', () => {
    const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString();
    const lastMonth = new Date(Date.now() - 86400000).toISOString();

    it('returns a free default when the brand entitlement is absent', () => {
        const ent = getEntitlement({ entitlements: {} }, 'scout');
        assert.equal(ent.plan, 'free');
        assert.equal(ent.usage.used, 0);
        assert.equal(ent.usage.limit, getFreeLimit('scout'));
        assert.equal(ent.exists, false);
    });

    it('maps stored snake_case fields to the entitlement view', () => {
        const user = { entitlements: { scout: { plan: 'premium', usage_used: 3, usage_limit: 10, usage_reset_date: nextMonth } } };
        const ent = getEntitlement(user, 'scout');
        assert.equal(ent.plan, 'premium');
        assert.equal(ent.usage.used, 3);
        assert.equal(ent.exists, true);
    });
});

describe('canUserSummarize (per-brand quota)', () => {
    const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString();
    const past = new Date(Date.now() - 86400000).toISOString();

    it('premium can always summarize', () => {
        const user = { entitlements: { lemonsqueezer: { plan: 'premium', usage_used: 999, usage_limit: 10, usage_reset_date: nextMonth } } };
        assert.equal(canUserSummarize(user, 'lemonsqueezer').canSummarize, true);
    });

    it('free under limit can summarize', () => {
        const user = { entitlements: { lemonsqueezer: { plan: 'free', usage_used: 5, usage_limit: 10, usage_reset_date: nextMonth } } };
        assert.equal(canUserSummarize(user, 'lemonsqueezer').canSummarize, true);
    });

    it('free at limit cannot summarize', () => {
        const user = { entitlements: { lemonsqueezer: { plan: 'free', usage_used: 10, usage_limit: 10, usage_reset_date: nextMonth } } };
        assert.equal(canUserSummarize(user, 'lemonsqueezer').canSummarize, false);
    });

    it('free at limit but expired period can summarize (lazy reset)', () => {
        const user = { entitlements: { lemonsqueezer: { plan: 'free', usage_used: 10, usage_limit: 10, usage_reset_date: past } } };
        assert.equal(canUserSummarize(user, 'lemonsqueezer').canSummarize, true);
    });

    it('quota is independent per brand', () => {
        const user = { entitlements: { lemonsqueezer: { plan: 'free', usage_used: 10, usage_limit: 10, usage_reset_date: nextMonth } } };
        assert.equal(canUserSummarize(user, 'lemonsqueezer').canSummarize, false); // exhausted
        assert.equal(canUserSummarize(user, 'scout').canSummarize, true);          // no entitlement yet -> fresh
    });
});
