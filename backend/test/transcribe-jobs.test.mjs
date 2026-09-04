import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicJobView, JOB_STATUS } from '../src/transcribe-jobs.mjs';

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
