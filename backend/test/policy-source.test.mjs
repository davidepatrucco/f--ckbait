// La configurazione deve avere UNA fonte.
//
// Problema che questi test impediscono di ripresentarsi: gli stessi numeri vivevano
// in piu' file (80.000 in tre, 120.000 in quattro) e il browser applicava soglie
// proprie, scollegate dal backend. Cambiare una policy richiedeva sapere quali copie
// aggiornare, e una copia dimenticata produceva un comportamento incoerente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CONTENT_LIMITS, MEDIA_LIMITS, TRANSCRIPTION_LIMITS, PLAN_POLICY, publicLimits, SUPPORTED_ENV } from '../src/policy.mjs';
import { generatePolicyJs } from '../../scripts/lib/policy-gen.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('le soglie del browser derivano dalla fonte unica', () => {
    // Si esegue il file generato + quello spedito, esattamente come nel pacchetto.
    const sandbox = createContext({});
    runInContext(generatePolicyJs(), sandbox);
    runInContext(read('extension/source-decision.js'), sandbox);
    const C = sandbox.RI_SOURCE.CONSTANTS;
    const expected = publicLimits();
    for (const [key, value] of Object.entries(expected)) {
        if (C[key] === undefined) continue; // non tutte le chiavi sono usate dalla decisione
        assert.equal(C[key], value, `${key}: il browser usa ${C[key]}, la fonte dice ${value}`);
    }
    assert.equal(C.TOO_LONG_CHARS, CONTENT_LIMITS.tooLongChars);
    assert.equal(C.MAX_TRANSCRIPT_CHARS, CONTENT_LIMITS.maxTranscriptChars);
});

test('un cambio nella fonte si propaga al browser', () => {
    // Falsificazione della propagazione: si genera con un valore diverso e si
    // verifica che il browser lo adotti. Se il file generato venisse ignorato,
    // resterebbe il numero scritto nel sorgente.
    const sandbox = createContext({});
    runInContext('globalThis.RI_POLICY = { TOO_LONG_CHARS: 12345, MIN_TEXT: 777 };', sandbox);
    runInContext(read('extension/source-decision.js'), sandbox);
    assert.equal(sandbox.RI_SOURCE.CONSTANTS.TOO_LONG_CHARS, 12345);
    assert.equal(sandbox.RI_SOURCE.CONSTANTS.MIN_TEXT, 777);
});

test('senza il file generato restano valori sensati (nessun crash)', () => {
    const sandbox = createContext({});
    runInContext(read('extension/source-decision.js'), sandbox);
    const C = sandbox.RI_SOURCE.CONSTANTS;
    assert.ok(C.TOO_LONG_CHARS > 0 && C.MAX_TRANSCRIPT_CHARS > 0);
});

test('i moduli del backend non ridichiarano le soglie', () => {
    // Un numero letterale reintrodotto in questi file sarebbe una seconda fonte.
    const checks = [
        ['backend/src/web-fetcher.mjs', /(?:MAX_TEXT_CHARS|TOO_LONG_CHARS|MAX_PDF_PAGES)\s*=\s*(?:parseInt|Number)?\(?\s*process\.env/],
        ['backend/src/transcribe.mjs', /MAX_MEDIA_BYTES\s*=\s*\d/],
        ['backend/src/transcribe-jobs.mjs', /MAX_(ACTIVE_JOBS|JOBS_PER_DAY)\s*=\s*Number\(process\.env/],
        ['backend/lambda/transcribe-worker.mjs', /(?:SEGMENT_SECONDS|MAX_SEGMENTS|CONCURRENCY)\s*=\s*Number\(process\.env/]
    ];
    for (const [file, forbidden] of checks) {
        assert.ok(!forbidden.test(read(file)), `${file} ridichiara una soglia invece di importarla da policy.mjs`);
    }
});

test('le soglie sono coerenti fra loro', () => {
    assert.ok(CONTENT_LIMITS.maxTextChars <= CONTENT_LIMITS.tooLongChars,
        'il testo usato non puo’ superare la soglia di rifiuto');
    assert.ok(CONTENT_LIMITS.minUsableChars < CONTENT_LIMITS.richTextChars);
    assert.ok(MEDIA_LIMITS.sttSyncMaxSeconds < MEDIA_LIMITS.sttAsyncMaxSeconds);
    assert.ok(MEDIA_LIMITS.videoMinSeconds < MEDIA_LIMITS.sttSyncMaxSeconds);
    assert.ok(TRANSCRIPTION_LIMITS.maxActiveJobs <= TRANSCRIPTION_LIMITS.maxJobsPerDay);
    // Il worker non deve poter produrre piu' segmenti di quanti ne accetti il limite.
    const maxAsyncSegments = Math.ceil(MEDIA_LIMITS.sttAsyncMaxSeconds / TRANSCRIPTION_LIMITS.segmentSeconds);
    assert.ok(TRANSCRIPTION_LIMITS.maxSegments >= maxAsyncSegments,
        `maxSegments (${TRANSCRIPTION_LIMITS.maxSegments}) non copre ${MEDIA_LIMITS.sttAsyncMaxSeconds}s a segmenti da ${TRANSCRIPTION_LIMITS.segmentSeconds}s`);
    assert.ok(PLAN_POLICY.free.trialSummaries >= PLAN_POLICY.free.dailySummaries);
});

test('ogni variabile d’ambiente dichiarata e’ effettivamente letta da policy.mjs', () => {
    const src = read('backend/src/policy.mjs');
    const missing = SUPPORTED_ENV.filter((name) => !src.includes(`'${name}'`));
    assert.deepEqual(missing, [], `dichiarate ma non lette: ${missing.join(', ')}`);
});

// L'assessor ha rilevato un buco nella soluzione precedente: generare i valori al
// build inserisce i DEFAULT, non gli override d'ambiente attivi sull'ambiente
// distribuito. Il server deve restare l'autorita'.
test('i limiti del server sovrascrivono quelli generati al build', () => {
    const sandbox = createContext({});
    runInContext(generatePolicyJs(), sandbox);
    runInContext(read('extension/source-decision.js'), sandbox);
    const RI = sandbox.RI_SOURCE;
    assert.equal(typeof RI.applyServerLimits, 'function', 'manca il punto di allineamento');

    const before = RI.CONSTANTS.TOO_LONG_CHARS;
    const applied = RI.applyServerLimits({ TOO_LONG_CHARS: 12345, MIN_TEXT: 999 });
    assert.equal(applied, true);
    assert.equal(RI.CONSTANTS.TOO_LONG_CHARS, 12345, 'il valore del server deve prevalere');
    assert.equal(RI.CONSTANTS.MIN_TEXT, 999);
    assert.notEqual(RI.CONSTANTS.TOO_LONG_CHARS, before);
});

test('valori non validi dal server vengono ignorati, non applicati', () => {
    const sandbox = createContext({});
    runInContext(generatePolicyJs(), sandbox);
    runInContext(read('extension/source-decision.js'), sandbox);
    const RI = sandbox.RI_SOURCE;
    const original = RI.CONSTANTS.TOO_LONG_CHARS;
    for (const bad of [null, undefined, {}, { TOO_LONG_CHARS: 'molti' }, { TOO_LONG_CHARS: -1 }, { TOO_LONG_CHARS: 0 }]) {
        RI.applyServerLimits(bad);
    }
    assert.equal(RI.CONSTANTS.TOO_LONG_CHARS, original, 'un valore non valido non deve corrompere la soglia');
});

test('nessun letterale duplicato resta nei punti segnalati', () => {
    // L'assessor aveva trovato numeri ancora scritti a mano nell'handler PDF.
    const handler = read('backend/lambda/handler.mjs');
    assert.ok(!/MAX_CLIENT_TEXT = 50000/.test(handler), 'MAX_CLIENT_TEXT ridichiarato');
    assert.ok(!/PDF_UPLOAD_MAX_BYTES = 3\.5 \* 1024/.test(handler), 'limite upload PDF ridichiarato');
    assert.ok(!/text\.length > 80000/.test(handler), 'soglia TOO_LONG ridichiarata');
    const popup = read('extension/popup.js');
    assert.ok(/RI_POLICY/.test(popup), 'il popup deve leggere il limite dalla fonte');
});
