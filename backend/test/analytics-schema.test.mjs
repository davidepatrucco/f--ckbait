import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsEvent } from '../src/analytics.mjs';

describe('E13 analytics event aligned to table schema', () => {
    const ev = buildAnalyticsEvent({
        brandId: 'scout', userId: 'user-123', userEmail: 'a@b.c', userPlan: 'free',
        url: 'https://example.com/x', title: 'T', language: 'it',
        charsInput: 100, charsOutput: 20, durationMs: 500, success: true
    });

    it('uses the table key attribute names (eventId, userId)', () => {
        assert.equal(typeof ev.eventId, 'string');
        assert.ok(ev.eventId.length > 0);
        assert.equal(ev.userId, 'user-123');
        // I vecchi nomi non devono esistere (causavano PutItem falliti).
        assert.ok(!('id' in ev));
        assert.ok(!('user_id' in ev));
    });

    it('timestamp is a Number (GSI type N) with a readable created_at ISO', () => {
        assert.equal(typeof ev.timestamp, 'number');
        assert.ok(ev.timestamp > 0);
        assert.equal(typeof ev.created_at, 'string');
        assert.match(ev.created_at, /\dT\d/); // ISO
    });

    it('success is a real boolean (not always-true)', () => {
        assert.equal(buildAnalyticsEvent({ success: false }).success, false);
        assert.equal(buildAnalyticsEvent({ success: true }).success, true);
        assert.equal(buildAnalyticsEvent({}).success, true); // default
    });

    it('keeps brand tag and metadata', () => {
        assert.equal(ev.brand_id, 'scout');
        assert.equal(ev.url_domain, 'example.com');
        assert.equal(ev.chars_input, 100);
    });
});
