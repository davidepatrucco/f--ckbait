import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    selectSummaryModel, economyModel, premiumModel, fallbackModel,
    tierModels, allowedModels, NANO_DEPRECATION_MS, PREMIUM_WORDCOUNT
} from '../src/model-router.mjs';
import { estimateCost } from '../src/openai.mjs';

const BEFORE = Date.parse('2026-09-01T00:00:00Z'); // pre-deprecazione nano
const AFTER = Date.parse('2027-01-01T00:00:00Z');  // post-deprecazione nano

describe('E?-router: tier economy/premium', () => {
    it('economy = gpt-5-nano prima della deprecazione, gpt-5.4-nano dopo', () => {
        assert.equal(economyModel(BEFORE), 'gpt-5-nano');
        assert.equal(economyModel(AFTER), 'gpt-5.4-nano');
        assert.ok(NANO_DEPRECATION_MS > BEFORE && NANO_DEPRECATION_MS < AFTER);
    });
    it('premium = gpt-5.6-luna', () => {
        assert.equal(premiumModel(), 'gpt-5.6-luna');
        assert.equal(fallbackModel(), 'gpt-5.6-luna');
    });
    it('economy != premium (nessun routing degenerato)', () => {
        const t1 = tierModels(BEFORE), t2 = tierModels(AFTER);
        assert.notEqual(t1.economy, t1.premium);
        assert.notEqual(t2.economy, t2.premium);
    });
});

describe('E?-router: selezione per piano/contenuto', () => {
    it('Free → sempre economy, anche su contenuto lungo', () => {
        assert.equal(selectSummaryModel({ plan: 'free', wordCount: 999999, now: BEFORE }), 'gpt-5-nano');
    });
    it('Premium + contenuto corto → economy', () => {
        assert.equal(selectSummaryModel({ plan: 'premium', wordCount: 100, now: BEFORE }), 'gpt-5-nano');
    });
    it('Premium + contenuto lungo (≥ soglia) → premium', () => {
        assert.equal(selectSummaryModel({ plan: 'premium', wordCount: PREMIUM_WORDCOUNT, now: BEFORE }), 'gpt-5.6-luna');
        assert.equal(selectSummaryModel({ plan: 'premium', wordCount: PREMIUM_WORDCOUNT - 1, now: BEFORE }), 'gpt-5-nano');
    });
    it('piano assente/vuoto trattato come non-premium → economy', () => {
        assert.equal(selectSummaryModel({ wordCount: 999999, now: BEFORE }), 'gpt-5-nano');
        assert.equal(selectSummaryModel({ plan: '', wordCount: 999999, now: BEFORE }), 'gpt-5-nano');
    });
    it('override: free NON forza il premium; premium sì; economy override sempre ok', () => {
        // free che chiede il premium → ignorato (no COGS bypass) → economy
        assert.equal(selectSummaryModel({ requestedModel: 'gpt-5.6-luna', plan: 'free', now: BEFORE }), 'gpt-5-nano');
        // premium che chiede il premium → onorato
        assert.equal(selectSummaryModel({ requestedModel: 'gpt-5.6-luna', plan: 'premium', now: BEFORE }), 'gpt-5.6-luna');
        // override a un modello economy è concesso anche ai free
        assert.equal(selectSummaryModel({ requestedModel: 'gpt-5.4-nano', plan: 'free', now: BEFORE }), 'gpt-5.4-nano');
        // sconosciuto → ignorato
        assert.equal(selectSummaryModel({ requestedModel: 'gpt-4o-mystery', plan: 'free', now: BEFORE }), 'gpt-5-nano');
        assert.ok(allowedModels(BEFORE).has('gpt-5.4-nano'));
    });
});

describe('E?-router: costi dei modelli tier presenti', () => {
    it('estimateCost noto per nano, gpt-5.4-nano, luna (luna corretto a 0.20/1.20)', () => {
        assert.equal(estimateCost('gpt-5-nano', 1_000_000, 1_000_000), 0.45);
        assert.equal(estimateCost('gpt-5.4-nano', 1_000_000, 1_000_000), 1.45);
        assert.equal(estimateCost('gpt-5.6-luna', 1_000_000, 1_000_000), 1.40);
    });
});
