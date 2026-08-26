import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canUserSummarize } from '../src/auth.mjs';
import { getFreeLimit, listBrands } from '../src/brands.mjs';

const future = new Date(Date.now() + 3600_000).toISOString();
const past = new Date(Date.now() - 3600_000).toISOString();

describe('A3 quota free = 1/giorno', () => {
    it('freeLimit = 1 per tutti i brand', () => {
        for (const b of listBrands()) assert.equal(getFreeLimit(b), 1, `freeLimit ${b}`);
    });
    it('free con 1 uso nel giorno corrente → bloccato (limite giornaliero)', () => {
        const user = { entitlements: { scout: { plan: 'free', usage_used: 1, usage_limit: 1, usage_reset_date: future } } };
        const r = canUserSummarize(user, 'scout');
        assert.equal(r.canSummarize, false);
        assert.match(r.reason, /giornaliero/);
    });
    it('free con 0 usi → consentito', () => {
        const user = { entitlements: { scout: { plan: 'free', usage_used: 0, usage_limit: 1, usage_reset_date: future } } };
        assert.equal(canUserSummarize(user, 'scout').canSummarize, true);
    });
    it('periodo scaduto (resetDate passato) → riparte da 0, consentito', () => {
        const user = { entitlements: { scout: { plan: 'free', usage_used: 1, usage_limit: 1, usage_reset_date: past } } };
        assert.equal(canUserSummarize(user, 'scout').canSummarize, true);
    });
    it('premium → sempre consentito', () => {
        const user = { entitlements: { scout: { plan: 'premium', usage_used: 999, usage_limit: 1, usage_reset_date: future } } };
        assert.equal(canUserSummarize(user, 'scout').canSummarize, true);
    });
});
