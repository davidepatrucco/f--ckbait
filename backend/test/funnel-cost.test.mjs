import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateCost } from '../src/openai.mjs';
import { buildAnalyticsEvent, ALLOWED_EVENT_TYPES, logClientEvent } from '../src/analytics.mjs';

describe('E13-005 cost estimate (real prices)', () => {
    it('gpt-5-nano: $0.05/1M in + $0.40/1M out', () => {
        assert.equal(estimateCost('gpt-5-nano', 1_000_000, 1_000_000), 0.45);
        assert.equal(estimateCost('gpt-5-nano', 0, 0), 0);
    });
    it('gpt-5.6-luna: $2/1M in + $12/1M out (migrazione post-deprecazione nano)', () => {
        assert.equal(estimateCost('gpt-5.6-luna', 1_000_000, 1_000_000), 14);
        assert.equal(estimateCost('gpt-5.6-luna', 500_000, 100_000), Number((1 + 1.2).toFixed(6)));
    });
    it('modello sconosciuto -> 0 (nessun prezzo inventato)', () => {
        assert.equal(estimateCost('mystery-model', 1_000_000, 1_000_000), 0);
    });
});

describe('E13-006/007 funnel event_type', () => {
    it('vocabolario controllato include install/open/login/paid steps', () => {
        for (const t of ['extension_installed', 'extension_opened', 'login_completed', 'checkout_started', 'subscription_activated', 'summary_completed', 'summary_failed']) {
            assert.ok(ALLOWED_EVENT_TYPES.has(t), `manca event_type ${t}`);
        }
    });
    it('buildAnalyticsEvent default summary_completed / server', () => {
        const e = buildAnalyticsEvent({ userId: 'u' });
        assert.equal(e.event_type, 'summary_completed');
        assert.equal(e.source, 'server');
    });
    it('buildAnalyticsEvent rispetta eventType valido + source client', () => {
        const e = buildAnalyticsEvent({ userId: 'u', eventType: 'login_completed', source: 'client' });
        assert.equal(e.event_type, 'login_completed');
        assert.equal(e.source, 'client');
    });
    it('eventType non valido -> fallback summary_completed', () => {
        assert.equal(buildAnalyticsEvent({ eventType: 'nope' }).event_type, 'summary_completed');
    });
    it('logClientEvent rifiuta event_type non whitelisted (nessuna scrittura)', async () => {
        assert.equal(await logClientEvent({ eventType: 'not_allowed', brandId: 'scout' }), null);
    });
});
