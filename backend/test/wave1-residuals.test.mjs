import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatUserFromDynamoDB } from '../src/dynamodb.mjs';
import { getEntitlement, canUserSummarize } from '../src/auth.mjs';
import { buildAnalyticsEvent } from '../src/analytics.mjs';
import { createRateLimitKey } from '../src/rate-limit.mjs';

describe('E01-009/010 legacy user compatibility (shim)', () => {
    const future = new Date(Date.now() + 30 * 86400000).toISOString();

    it('reads a legacy flat-attribute user into the lemonsqueezer entitlement', () => {
        const legacy = { id: 'u1', email: 'a@b.c', plan: 'free', usage_used: 7, usage_limit: 10, usage_reset_date: future };
        const user = formatUserFromDynamoDB(legacy);
        assert.ok(user.entitlements.lemonsqueezer, 'entitlement lemonsqueezer sintetizzato');
        const ent = getEntitlement(user, 'lemonsqueezer');
        assert.equal(ent.usage.used, 7);
        assert.equal(ent.usage.limit, 10);
        assert.equal(canUserSummarize(user, 'lemonsqueezer').canSummarize, true);
    });

    it('legacy user at limit cannot summarize (no free reset from migration)', () => {
        const legacy = { id: 'u2', email: 'a@b.c', plan: 'free', usage_used: 10, usage_limit: 10, usage_reset_date: future };
        const user = formatUserFromDynamoDB(legacy);
        assert.equal(canUserSummarize(user, 'lemonsqueezer').canSummarize, false);
    });

    it('legacy premium user stays premium', () => {
        const legacy = { id: 'u3', email: 'a@b.c', plan: 'premium', usage_used: 999, usage_limit: 10, usage_reset_date: future };
        const user = formatUserFromDynamoDB(legacy);
        assert.equal(getEntitlement(user, 'lemonsqueezer').plan, 'premium');
        assert.equal(canUserSummarize(user, 'lemonsqueezer').canSummarize, true);
    });
});

describe('E06-007/008 analytics privacy (no raw content)', () => {
    const event = buildAnalyticsEvent({
        brandId: 'scout', userId: 'u1', userEmail: 'a@b.c', userPlan: 'free',
        url: 'https://example.com/some/article', title: 'A title', language: 'it',
        charsInput: 5000, charsOutput: 400, durationMs: 1200,
        browser: 'browser-extension', clientVersion: '1.3.2', success: true
    });

    it('contains required metadata fields', () => {
        assert.equal(event.brand_id, 'scout');
        assert.equal(event.url_domain, 'example.com');
        assert.equal(event.chars_input, 5000);
        assert.equal(event.chars_output, 400);
        assert.equal(event.client_version, '1.3.2');
        assert.equal(event.browser, 'browser-extension');
    });

    it('never includes raw page content or summary text', () => {
        const keys = Object.keys(event);
        for (const forbidden of ['text', 'summary', 'content', 'body', 'transcript', 'bullets', 'output']) {
            assert.ok(!keys.includes(forbidden), `analytics non deve contenere "${forbidden}"`);
        }
        // Solo conteggi numerici per la dimensione del contenuto.
        assert.equal(typeof event.chars_input, 'number');
        assert.equal(typeof event.chars_output, 'number');
    });
});

describe('E05-004 rate-limit key is brand-aware', () => {
    it('legacy key (no brand) is unchanged in format', () => {
        const k = createRateLimitKey('apikey', 'minute');
        assert.match(k, /^apikey#minute#/);
    });

    it('brand key includes the brand and differs per brand', () => {
        const scout = createRateLimitKey('apikey', 'minute', 'scout');
        const lemon = createRateLimitKey('apikey', 'minute', 'lemonsqueezer');
        assert.match(scout, /^apikey#scout#minute#/);
        assert.notEqual(scout, lemon);
    });
});
