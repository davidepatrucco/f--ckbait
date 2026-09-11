import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicJobView, JOB_STATUS, MAX_ACTIVE_JOBS, MAX_JOBS_PER_DAY, MAX_MINUTES_PER_DAY, classifyJobs } from '../src/transcribe-jobs.mjs';

const job = (over = {}) => ({
    jobId: 'j1',
    userId: 'u1',
    mediaUrl: 'https://cdn/video.mp4?Signature=SECRET&Key-Pair-Id=ABC',
    status: JOB_STATUS.PENDING,
    ...over
});

test('publicJobView non espone mediaUrl né userId', () => {
    const view = publicJobView(job({ status: JOB_STATUS.DONE, transcript: 'testo' }));
    const serialized = JSON.stringify(view);
    assert.ok(!serialized.includes('SECRET'), 'la firma del media è finita nella vista pubblica');
    assert.ok(!serialized.includes('cdn/video.mp4'), 'mediaUrl esposto');
    assert.equal(view.userId, undefined);
});

test('publicJobView espone il transcript solo a job completato', () => {
    assert.equal(publicJobView(job({ status: JOB_STATUS.RUNNING, transcript: 'parziale' })).transcript, undefined);
    assert.equal(publicJobView(job({ status: JOB_STATUS.DONE, transcript: 'finale' })).transcript, 'finale');
});

test('publicJobView espone il codice solo in errore', () => {
    assert.equal(publicJobView(job({ status: JOB_STATUS.RUNNING, code: 'X' })).code, undefined);
    assert.equal(publicJobView(job({ status: JOB_STATUS.ERROR, code: 'NO_SPEECH' })).code, 'NO_SPEECH');
    assert.equal(publicJobView(job({ status: JOB_STATUS.ERROR })).code, 'TRANSCRIPTION_FAILED');
});

test('publicJobView su job assente', () => {
    assert.equal(publicJobView(null), null);
});

test('publicJobView riporta progresso e stato', () => {
    const view = publicJobView(job({ status: JOB_STATUS.RUNNING, progress: '3/12' }));
    assert.equal(view.status, 'running');
    assert.equal(view.progress, '3/12');
    assert.equal(view.jobId, 'j1');
});

test('i limiti anti-abuso hanno valori sensati', () => {
    assert.ok(MAX_ACTIVE_JOBS >= 1 && MAX_ACTIVE_JOBS <= 5, `MAX_ACTIVE_JOBS fuori scala: ${MAX_ACTIVE_JOBS}`);
    assert.ok(MAX_JOBS_PER_DAY >= MAX_ACTIVE_JOBS, 'il tetto giornaliero non puo essere sotto quello di concorrenza');
    assert.ok(MAX_JOBS_PER_DAY <= 100, `MAX_JOBS_PER_DAY troppo alto: ${MAX_JOBS_PER_DAY}`);
});

// classifyJobs distingue i job ancora attivi da quelli morti: un worker crashato
// lascia un job "running" per sempre e, senza finestra di scadenza, bloccherebbe
// l'utente in modo permanente.
test('classifyJobs: solo i job aperti e recenti contano come attivi', () => {
    const now = Date.parse('2026-01-01T12:00:00.000Z');
    const at = (minutesAgo) => new Date(now - minutesAgo * 60000).toISOString();
    const items = [
        { status: 'running', createdAt: at(1) },
        { status: 'pending', createdAt: at(5) },
        { status: 'running', createdAt: at(60) },   // oltre la finestra: considerato morto
        { status: 'done', createdAt: at(2) },
        { status: 'error', createdAt: at(3) }
    ];
    const { active, last24h } = classifyJobs(items, now);
    assert.equal(active, 2, 'solo i due aperti e recenti');
    assert.equal(last24h, 5, 'il totale include anche i conclusi');
});

test('classifyJobs: un worker morto non blocca l’utente per sempre', () => {
    const now = Date.parse('2026-01-01T12:00:00.000Z');
    const stuck = [{ status: 'running', createdAt: new Date(now - 21 * 60000).toISOString() }];
    assert.equal(classifyJobs(stuck, now).active, 0, 'a 21 minuti il job non è più attivo');
    const fresh = [{ status: 'running', createdAt: new Date(now - 19 * 60000).toISOString() }];
    assert.equal(classifyJobs(fresh, now).active, 1, 'a 19 minuti è ancora attivo');
});

test('classifyJobs: input vuoto o assente', () => {
    assert.deepEqual(classifyJobs([], Date.now()), { active: 0, last24h: 0, minutes: 0 });
    assert.deepEqual(classifyJobs(undefined, Date.now()), { active: 0, last24h: 0, minutes: 0 });
});

// Il budget sui MINUTI e' il tetto che mancava: job concorrenti e job/giorno non
// vincolano la durata, quindi 20 job da 3 ore restavano possibili.
test('classifyJobs somma i minuti gia’ trascritti', () => {
    const now = Date.parse('2026-01-01T12:00:00.000Z');
    const at = (m) => new Date(now - m * 60000).toISOString();
    // segmenti da 10 minuti: 3 chunk = 30 minuti, 6 chunk = 60 minuti
    const items = [
        { status: 'done', createdAt: at(30), chunks: 3 },
        { status: 'done', createdAt: at(60), chunks: 6 },
        { status: 'error', createdAt: at(90) }           // senza chunks: non conta
    ];
    assert.equal(classifyJobs(items, now).minutes, 90);
});

test('i minuti non sono limitati dal numero di job', () => {
    // Due soli job possono valere molti piu' minuti del tetto: e' esattamente il
    // caso che i limiti su job/giorno non intercettavano.
    const now = Date.now();
    const items = [
        { status: 'done', createdAt: new Date(now - 1000).toISOString(), chunks: 18 },
        { status: 'done', createdAt: new Date(now - 2000).toISOString(), chunks: 18 }
    ];
    const { last24h, minutes } = classifyJobs(items, now);
    assert.equal(last24h, 2, 'due job soli');
    assert.equal(minutes, 360, 'ma sei ore di audio');
    assert.ok(minutes > MAX_MINUTES_PER_DAY, 'il tetto sui minuti deve intercettarlo');
});

