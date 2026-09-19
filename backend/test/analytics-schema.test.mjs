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

// Minimizzazione: email + URL completo + titolo, uniti, sono la cronologia di
// navigazione di una persona identificabile e nessuna metrica li usa.
it('buildAnalyticsEvent non conserva email, URL completo né titolo', async () => {
    const { buildAnalyticsEvent, RETENTION_SECONDS } = await import('../src/analytics.mjs');
    const ev = buildAnalyticsEvent({
        eventType: 'summary_completed', userId: 'u1', userEmail: 'persona@example.com',
        url: 'https://example.com/percorso/privato?token=segreto#sezione', title: 'Titolo riservato', brandId: 'scout'
    });
    assert.equal(ev.email, undefined, 'email conservata');
    assert.equal(ev.url, undefined, 'URL completo conservato');
    assert.equal(ev.title, undefined, 'titolo conservato');
    assert.equal(ev.url_domain, 'example.com', 'il dominio serve alle metriche e resta');
    assert.equal(ev.userId, 'u1');
    assert.ok(!JSON.stringify(ev).includes('segreto'), 'un pezzo dell’URL e’ ancora nell’evento');
    // Scadenza: ~13 mesi da ora.
    const inSeconds = ev.ttl - Math.floor(Date.now() / 1000);
    assert.ok(Math.abs(inSeconds - RETENTION_SECONDS) < 5, `ttl fuori scala: ${inSeconds}`);
});
