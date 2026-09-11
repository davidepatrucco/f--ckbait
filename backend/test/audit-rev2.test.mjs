// Test comportamentali sui casi riaperti dalla seconda revisione esterna.
// Ognuno riproduce lo scenario segnalato e verifica il comportamento, non la forma
// del codice: i test precedenti su questi punti erano strutturali e non li vedevano.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSubscriptionItem } from '../src/payments.mjs';
import { buildPdfExtractionResult } from '../lambda/handler.mjs';
import { classifyJobs, MAX_MINUTES_PER_DAY } from '../src/transcribe-jobs.mjs';
import { CONTENT_LIMITS, TRANSCRIPTION_LIMITS } from '../src/policy.mjs';

// --- #1 il webhook scriveva un elemento senza la chiave obbligatoria -----------
test('l’elemento abbonamento ha sempre la chiave, con entrambe le convenzioni di nome', () => {
    // Forma del webhook (snake_case): prima produceva subscriptionId undefined.
    const fromWebhook = buildSubscriptionItem('u1', {
        brand: 'scout', stripe_subscription_id: 'sub_123', status: 'active'
    });
    assert.equal(fromWebhook.subscriptionId, 'sub_123', 'chiave di ordinamento mancante');
    assert.equal(fromWebhook.brand, 'scout');

    // Forma della verifica checkout (camelCase).
    const fromVerify = buildSubscriptionItem('u1', {
        brand: 'signal', stripeSubscriptionId: 'sub_456', status: 'active'
    });
    assert.equal(fromVerify.subscriptionId, 'sub_456');
    assert.equal(fromVerify.brand, 'signal');
});

test('senza id o brand la scrittura viene rifiutata, non eseguita a metà', () => {
    // Fallire rumorosamente e' preferibile a scrivere un elemento non valido DOPO
    // aver promosso l'utente a premium.
    assert.throws(() => buildSubscriptionItem('u1', { brand: 'scout' }), /id abbonamento mancante/);
    assert.throws(() => buildSubscriptionItem('u1', { stripeSubscriptionId: 's' }), /brand mancante/);
    assert.throws(() => buildSubscriptionItem(null, { brand: 'scout', stripeSubscriptionId: 's' }), /userId mancante/);
});

// --- #2 il brand salvato era sempre quello di default -------------------------
test('il brand dell’acquisto viene conservato, non sostituito dal default', () => {
    for (const brand of ['scout', 'signal', 'briefly', 'nobull']) {
        const item = buildSubscriptionItem('u1', { brand, stripeSubscriptionId: 'sub_x' });
        assert.equal(item.brand, brand, `acquisto ${brand} salvato come ${item.brand}`);
        assert.notEqual(item.brand, 'lemonsqueezer');
    }
});

// --- #4 il percorso sincrono risultava a consumo zero -------------------------
test('i minuti vengono contati anche senza segmenti (percorso sincrono)', () => {
    const now = Date.parse('2026-01-01T12:00:00.000Z');
    const at = (m) => new Date(now - m * 60000).toISOString();
    // Job sincroni: nessun `chunks`, ma `minutesUsed` scritto dall'handler.
    const sincroni = Array.from({ length: 20 }, (_, i) => ({
        status: 'done', createdAt: at(i + 1), minutesUsed: 3
    }));
    const { last24h, minutes } = classifyJobs(sincroni, now);
    assert.equal(last24h, 20);
    assert.equal(minutes, 60, '20 trascrizioni sincrone non possono valere 0 minuti');
    assert.ok(minutes > 0, 'era esattamente il difetto: consumo invisibile');
});

test('minutesUsed prevale sui segmenti quando entrambi sono presenti', () => {
    const now = Date.now();
    const item = { status: 'done', createdAt: new Date(now - 1000).toISOString(), chunks: 18, minutesUsed: 7 };
    assert.equal(classifyJobs([item], now).minutes, 7, 'il dato esplicito deve vincere sulla stima');
});

test('i job vecchi senza minutesUsed restano contati tramite i segmenti', () => {
    const now = Date.now();
    const legacy = { status: 'done', createdAt: new Date(now - 1000).toISOString(), chunks: 3 };
    const expected = (3 * TRANSCRIPTION_LIMITS.segmentSeconds) / 60;
    assert.equal(classifyJobs([legacy], now).minutes, expected);
});

test('il tetto sui minuti intercetta cio’ che i tetti sui job non vedono', () => {
    const now = Date.now();
    // Due soli job, ben sotto il tetto giornaliero sui job, ma oltre quello sui minuti.
    const items = [
        { status: 'done', createdAt: new Date(now - 1000).toISOString(), minutesUsed: 180 },
        { status: 'done', createdAt: new Date(now - 2000).toISOString(), minutesUsed: 180 }
    ];
    const { last24h, minutes } = classifyJobs(items, now);
    assert.equal(last24h, 2);
    assert.ok(minutes > MAX_MINUTES_PER_DAY, `${minutes} minuti devono superare il tetto di ${MAX_MINUTES_PER_DAY}`);
});

// --- #5 il PDF veniva tagliato in silenzio ------------------------------------
test('un PDF oltre la soglia dichiara la parzialità', () => {
    // Il caso segnalato: una pagina, 59.999 caratteri, nessun indicatore.
    const text = 'a'.repeat(59999);
    const res = buildPdfExtractionResult(text, 'doc');
    assert.equal(res.truncated, true, 'il taglio non puo’ essere silenzioso');
    assert.equal(res.characters, 59999, 'il conteggio originale deve essere esposto');
    assert.equal(res.usedCharacters, CONTENT_LIMITS.maxTextChars);
    assert.equal(res.text.length, CONTENT_LIMITS.maxTextChars);
});

test('un PDF entro la soglia non dichiara parzialità', () => {
    const res = buildPdfExtractionResult('a'.repeat(1000), 'doc');
    assert.equal(res.truncated, false);
    assert.equal(res.characters, 1000);
    assert.equal(res.usedCharacters, 1000);
});

test('il confine della soglia è trattato correttamente', () => {
    const limit = CONTENT_LIMITS.maxTextChars;
    assert.equal(buildPdfExtractionResult('a'.repeat(limit), 'd').truncated, false, 'esattamente al limite: completo');
    assert.equal(buildPdfExtractionResult('a'.repeat(limit + 1), 'd').truncated, true, 'un carattere oltre: parziale');
});

test('input vuoto o assente non produce una risposta apparentemente valida', () => {
    for (const input of ['', null, undefined]) {
        const res = buildPdfExtractionResult(input, 'd');
        assert.equal(res.characters, 0);
        assert.equal(res.truncated, false);
    }
});

// --- #3 la cancellazione account non deve dichiararsi riuscita a metà ---------
test('i dati locali non si cancellano se un annullamento non è riuscito', async () => {
    const { canDeleteLocalData } = await import('../src/payments.mjs');
    // Scenario segnalato: Stripe fallisce, ma utente e record venivano cancellati e
    // la risposta era 200, lasciando un addebito attivo e nessun riferimento.
    assert.equal(canDeleteLocalData({ canceledOnStripe: 0, deleted: 0, errors: ['sub_1'], retryable: [] }), false);
    assert.equal(canDeleteLocalData({ canceledOnStripe: 0, deleted: 0, errors: [], retryable: ['sub_1'] }), false);
    // Nessun abbonamento da annullare, o tutti annullati: si puo' procedere.
    assert.equal(canDeleteLocalData({ canceledOnStripe: 0, deleted: 0, errors: [], retryable: [] }), true);
    assert.equal(canDeleteLocalData({ canceledOnStripe: 2, deleted: 2, errors: [], retryable: [] }), true);
    // Risultato assente: non si procede (meglio un ritentativo che un addebito).
    assert.equal(canDeleteLocalData(null), false);
    assert.equal(canDeleteLocalData(undefined), false);
});
