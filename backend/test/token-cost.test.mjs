import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateCost } from '../src/openai.mjs';
import { buildAnalyticsEvent } from '../src/analytics.mjs';

describe('E13-005 token & cost tracking', () => {
    it('estimateCost prices gpt-5-nano and returns 0 for unknown models', () => {
        // gpt-5-nano: $0.05/1M input + $0.40/1M output → 1000*0.05e-6 + 2000*0.40e-6
        assert.equal(estimateCost('gpt-5-nano', 1000, 2000), 0.00085);
        assert.equal(estimateCost('unknown-model', 999999, 999999), 0);
    });

    it('analytics event carries token counts and cost estimate', () => {
        const ev = buildAnalyticsEvent({
            brandId: 'signal', userId: 'u', charsInput: 100, charsOutput: 20,
            inputTokens: 4120, outputTokens: 780, costEstimate: 0
        });
        assert.equal(ev.input_tokens, 4120);
        assert.equal(ev.output_tokens, 780);
        assert.equal(ev.cost_estimate, 0);
        assert.equal(typeof ev.input_tokens, 'number');
    });

    it('token fields default to 0 when absent', () => {
        const ev = buildAnalyticsEvent({ userId: 'u' });
        assert.equal(ev.input_tokens, 0);
        assert.equal(ev.output_tokens, 0);
        assert.equal(ev.cost_estimate, 0);
    });
});
