// Salvare un valore dalla dashboard non deve azzerare gli altri override: la nuova
// versione parte da quella attiva (mergeConfigValues), e "Predefinito" toglie la chiave.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ENVIRONMENT ||= 'test';
process.env.AWS_REGION ||= 'eu-west-1';
const { mergeConfigValues } = await import('../lambda/handler.mjs');

test('un valore nuovo si aggiunge agli override esistenti', () => {
    assert.deepEqual(
        mergeConfigValues({ 'plan.free.trialSummaries': 10 }, { 'plan.free.pdf': 1 }),
        { 'plan.free.trialSummaries': 10, 'plan.free.pdf': 1 });
});

test('reset riporta la chiave al predefinito, il resto resta', () => {
    assert.deepEqual(
        mergeConfigValues({ 'plan.free.trialSummaries': 10, 'plan.free.pdf': 1 }, {}, ['plan.free.pdf']),
        { 'plan.free.trialSummaries': 10 });
});

test('nessuna configurazione attiva', () => {
    assert.deepEqual(mergeConfigValues(undefined, { 'rate.perMinute': 5 }), { 'rate.perMinute': 5 });
});
