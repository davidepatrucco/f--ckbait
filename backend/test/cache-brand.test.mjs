import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSummaryCacheKey } from '../src/cache.mjs';

describe('brand-aware cache key', () => {
    const base = { text: 'same content '.repeat(20), language: 'it', summaryProfile: 'standard', squeeze: 20, model: 'gpt-5-nano', sourceType: 'web' };

    it('same URL/content but different brand yields different keys', () => {
        const lemon = buildSummaryCacheKey({ ...base, brandId: 'lemonsqueezer', promptProfile: 'summary.standard', outputSchema: 'summary' });
        const scout = buildSummaryCacheKey({ ...base, brandId: 'scout', promptProfile: 'scout.evaluate', outputSchema: 'attention' });
        assert.notEqual(lemon, scout);
    });

    it('same brand/content is stable', () => {
        const a = buildSummaryCacheKey({ ...base, brandId: 'lemonsqueezer', promptProfile: 'summary.standard', outputSchema: 'summary' });
        const b = buildSummaryCacheKey({ ...base, brandId: 'lemonsqueezer', promptProfile: 'summary.standard', outputSchema: 'summary' });
        assert.equal(a, b);
    });

    it('changing prompt profile invalidates the key', () => {
        const v1 = buildSummaryCacheKey({ ...base, brandId: 'lemonsqueezer', promptProfile: 'summary.standard', outputSchema: 'summary' });
        const v2 = buildSummaryCacheKey({ ...base, brandId: 'lemonsqueezer', promptProfile: 'summary.standard.v2', outputSchema: 'summary' });
        assert.notEqual(v1, v2);
    });
});
