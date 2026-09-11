// Configurazione amministrabile a runtime: validazione, precedenza, coerenza.
//
// Requisito da soddisfare: valori persistiti, versionati, VALIDATI, modificabili
// senza rilascio, pubblicati al client, con il server come autorità. Qui si verifica
// la parte che decide se un cambio è accettabile e che effetto produce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_SCHEMA, validateConfig, checkConsistency } from '../src/config-store.mjs';
import { applyOverrides, effectiveValues, publicLimits, POLICY_STATE } from '../src/policy.mjs';

test('un parametro non dichiarato non e’ modificabile', () => {
    const { values, errors } = validateConfig({ 'qualcosa.inventato': 10 });
    assert.deepEqual(values, {});
    assert.equal(errors.length, 1);
    assert.match(errors[0].reason, /non modificabile/);
});

test('un valore fuori intervallo viene rifiutato, non limitato', () => {
    // Limitare silenziosamente sarebbe peggio: chi amministra crederebbe di aver
    // impostato un valore che il sistema non applica.
    const tooBig = validateConfig({ 'transcription.maxMinutesPerDay': 999999 });
    assert.deepEqual(tooBig.values, {});
    assert.match(tooBig.errors[0].reason, /fuori intervallo/);

    const tooSmall = validateConfig({ 'transcription.maxActiveJobs': 0 });
    assert.deepEqual(tooSmall.values, {});
});

test('tipi non numerici e non interi sono rifiutati', () => {
    assert.match(validateConfig({ 'rate.perMinute': 'molte' }).errors[0].reason, /non è un numero/);
    assert.match(validateConfig({ 'rate.perMinute': 1.5 }).errors[0].reason, /intero/);
});

test('un valore valido viene accettato', () => {
    const { values, errors } = validateConfig({ 'plan.free.trialSummaries': 10, 'rate.perMinute': 20 });
    assert.deepEqual(errors, []);
    assert.deepEqual(values, { 'plan.free.trialSummaries': 10, 'rate.perMinute': 20 });
});

test('ogni voce dello schema ha intervallo e descrizione', () => {
    for (const [key, s] of Object.entries(CONFIG_SCHEMA)) {
        assert.ok(Number.isFinite(s.min) && Number.isFinite(s.max), `${key}: intervallo mancante`);
        assert.ok(s.min < s.max, `${key}: intervallo invertito`);
        assert.ok(s.description && s.description.length > 10, `${key}: descrizione insufficiente`);
    }
});

test('la coerenza reciproca viene verificata sul risultato combinato', () => {
    const base = effectiveValues();
    // Singolarmente validi, insieme incoerenti.
    assert.ok(checkConsistency({ ...base, 'content.maxTextChars': 90000, 'content.tooLongChars': 80000 }).length > 0);
    assert.ok(checkConsistency({ ...base, 'media.sttSyncMaxSeconds': 3600, 'media.sttAsyncMaxSeconds': 600 }).length > 0);
    assert.ok(checkConsistency({ ...base, 'rate.perMinute': 500, 'rate.perHour': 100 }).length > 0);
    assert.deepEqual(checkConsistency(base), [], 'la configurazione corrente deve essere coerente');
});

test('un override si applica e si può rimuovere senza riavvio', () => {
    const before = effectiveValues();
    applyOverrides({ 'content.tooLongChars': 55555, 'plan.free.trialSummaries': 9 }, 7);
    const applied = effectiveValues();
    assert.equal(applied['content.tooLongChars'], 55555);
    assert.equal(applied['plan.free.trialSummaries'], 9);
    assert.equal(POLICY_STATE.version, 7);

    // Rimuovendo la voce si torna al valore di partenza: e' cio' che rende la
    // configurazione reversibile senza un nuovo rilascio.
    applyOverrides({}, 8);
    assert.deepEqual(effectiveValues(), before);
    assert.equal(POLICY_STATE.version, 8);
});

test('l’override raggiunge i limiti pubblicati al client', () => {
    // Il server e' l'autorita': cio' che pubblica deve riflettere l'override attivo.
    applyOverrides({ 'content.tooLongChars': 44444 }, 9);
    assert.equal(publicLimits().TOO_LONG_CHARS, 44444);
    applyOverrides({}, 10);
    assert.notEqual(publicLimits().TOO_LONG_CHARS, 44444);
});

test('un override non valido non altera lo stato', () => {
    const before = effectiveValues();
    // applyOverrides ignora i non-numerici; la validazione a monte li rifiuta prima.
    applyOverrides({ 'content.tooLongChars': 'tanti' }, 11);
    assert.deepEqual(effectiveValues(), before);
});
