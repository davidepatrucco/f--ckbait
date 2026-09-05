// transcribe-worker.mjs — Lambda worker per la trascrizione di video lunghi/HLS.
//
// Invocata in modo asincrono (InvocationType Event) da POST /transcribe-job, con
// timeout lungo (15') e più memoria/CPU della Lambda API. Pipeline:
//   1. ffmpeg legge il media (URL progressivo o playlist HLS .m3u8), scarta il video
//      e produce segmenti audio mono 16 kHz 32 kbps in /tmp (piccoli: ~2,4 MB per
//      10 minuti, ben sotto il limite di 25 MB per file dell'API di trascrizione);
//   2. i segmenti vengono trascritti con concorrenza limitata;
//   3. le trascrizioni sono concatenate in ordine e salvate sul job.
//
// ffmpeg arriva da un layer Lambda (FFMPEG_PATH, default /opt/bin/ffmpeg).
import { spawn } from 'node:child_process';
import { readdir, mkdir, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { toFile } from 'openai';
import { getOpenAIClient } from '../src/openai.mjs';
import { assertPublicUrl } from '../src/web-fetcher.mjs';
import { updateJob, JOB_STATUS } from '../src/transcribe-jobs.mjs';

const FFMPEG = process.env.FFMPEG_PATH || '/opt/bin/ffmpeg';
const WORK_DIR = '/tmp/transcribe';
const SEGMENT_SECONDS = Number(process.env.SEGMENT_SECONDS || 600); // 10 min
const MAX_SEGMENTS = Number(process.env.MAX_SEGMENTS || 18);        // ~3h, allineato al client
const CONCURRENCY = Number(process.env.TRANSCRIBE_CONCURRENCY || 3);
const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
const FFMPEG_TIMEOUT_MS = Number(process.env.FFMPEG_TIMEOUT_MS || 8 * 60 * 1000);

// Codici che il client sa tradurre in un messaggio. Qualunque altro codice (es.
// quelli del provider di trascrizione, come "invalid_value") viene normalizzato:
// un codice sconosciuto arriverebbe in UI senza messaggio.
const CLIENT_CODES = new Set([
    'INVALID_MEDIA_URL', 'BLOCKED_URL', 'UNSUPPORTED_MEDIA', 'MEDIA_TOO_LARGE',
    'MEDIA_FETCH_FAILED', 'NO_SPEECH', 'TRANSCRIPTION_FAILED',
    'VIDEO_TOO_LONG_NO_CAPTIONS', 'FFMPEG_UNAVAILABLE'
]);

function clientCode(code) {
    return CLIENT_CODES.has(code) ? code : 'TRANSCRIPTION_FAILED';
}

function fail(code, message) {
    const e = new Error(message || code);
    e.code = code;
    return e;
}

// Esegue ffmpeg producendo i segmenti audio. Nessuna shell: argomenti passati come
// array, quindi l'URL non è interpretabile come comando.
async function runFfmpeg(mediaUrl, outDir) {
    const args = [
        '-nostdin', '-hide_banner', '-loglevel', 'error',
        '-i', mediaUrl,
        '-vn',                       // scarta il video: serve solo l'audio
        // Una sorgente HLS master espone più rendition audio: senza -map ffmpeg può
        // infilarne più d'una nello stesso mp3, producendo un file che l'API di
        // trascrizione rifiuta ("Audio file might be corrupted or unsupported").
        '-map', '0:a:0',
        '-c:a', 'libmp3lame',
        '-ac', '1', '-ar', '16000', '-b:a', '32k',
        '-f', 'segment', '-segment_time', String(SEGMENT_SECONDS),
        '-reset_timestamps', '1',
        join(outDir, 'part_%03d.mp3')
    ];
    await new Promise((resolve, reject) => {
        const child = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(fail('MEDIA_FETCH_FAILED', 'ffmpeg timeout'));
        }, FFMPEG_TIMEOUT_MS);
        child.stderr.on('data', (d) => { stderr += String(d).slice(0, 2000); });
        child.on('error', (err) => {
            clearTimeout(timer);
            reject(fail('FFMPEG_UNAVAILABLE', `ffmpeg non eseguibile: ${err.message}`));
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) return resolve();
            reject(fail('UNSUPPORTED_MEDIA', `ffmpeg exit ${code}: ${stderr.slice(0, 300)}`));
        });
    });
}

// Segmento più piccolo di così non contiene audio utile (header mp3 e poco altro):
// inviarlo alla trascrizione produce solo un errore "file corrotto".
const MIN_SEGMENT_BYTES = 2048;

async function transcribeSegment(client, path) {
    const info = await stat(path);
    if (info.size < MIN_SEGMENT_BYTES) {
        console.warn(`segmento ignorato (${info.size} byte): ${path}`);
        return '';
    }
    const file = await toFile(createReadStream(path), path.split('/').pop());
    const out = await client.audio.transcriptions.create({ file, model: TRANSCRIBE_MODEL, response_format: 'text' });
    return (typeof out === 'string' ? out : (out?.text || '')).trim();
}

// Trascrive i segmenti con concorrenza limitata, preservando l'ordine.
// Un segmento che fallisce NON fa cadere l'intero job: si perde quella porzione e si
// prosegue. Il job fallisce solo se nessun segmento è stato trascritto.
async function transcribeAll(client, paths, jobId) {
    const results = new Array(paths.length).fill('');
    const failures = [];
    let next = 0;
    let done = 0;
    const workers = new Array(Math.min(CONCURRENCY, paths.length)).fill(0).map(async () => {
        for (;;) {
            const i = next++;
            if (i >= paths.length) return;
            try {
                results[i] = await transcribeSegment(client, paths[i]);
            } catch (err) {
                failures.push({ index: i, message: String(err?.message || '').slice(0, 200) });
                console.warn(`segmento ${i} fallito: ${err?.message}`);
            }
            done++;
            // Progresso best-effort: un errore di update non deve fermare la trascrizione.
            try { await updateJob(jobId, { progress: `${done}/${paths.length}` }); } catch { /* noop */ }
        }
    });
    await Promise.all(workers);
    if (failures.length === paths.length) {
        throw fail('TRANSCRIPTION_FAILED', `tutti i ${paths.length} segmenti falliti: ${failures[0]?.message}`);
    }
    if (failures.length) console.warn(`${failures.length}/${paths.length} segmenti persi`);
    return results;
}

export async function handler(event) {
    const jobId = event?.jobId;
    if (!jobId) {
        console.error('transcribe-worker invocato senza jobId');
        return { ok: false };
    }
    const mediaUrl = event.mediaUrl;
    try {
        await updateJob(jobId, { status: JOB_STATUS.RUNNING, progress: 'download' });

        // Guard SSRF anche qui: il worker è invocato internamente, ma non si fida
        // dell'input (difesa in profondità se un domani l'invocazione cambia sorgente).
        let url;
        try { url = new URL(mediaUrl); } catch { throw fail('INVALID_MEDIA_URL', 'URL non valido'); }
        if (!['http:', 'https:'].includes(url.protocol)) throw fail('INVALID_MEDIA_URL', 'Protocollo non supportato');
        try { await assertPublicUrl(url); } catch (e) { throw fail('BLOCKED_URL', e.message); }

        await rm(WORK_DIR, { recursive: true, force: true });
        await mkdir(WORK_DIR, { recursive: true });

        await runFfmpeg(mediaUrl, WORK_DIR);

        const files = (await readdir(WORK_DIR)).filter((f) => f.endsWith('.mp3')).sort();
        if (!files.length) throw fail('NO_SPEECH', 'nessun segmento audio prodotto');
        if (files.length > MAX_SEGMENTS) throw fail('VIDEO_TOO_LONG_NO_CAPTIONS', `${files.length} segmenti oltre il limite`);
        // Diagnostica: una dimensione anomala spiega subito un rifiuto del provider.
        const sizes = await Promise.all(files.map(async (f) => (await stat(join(WORK_DIR, f))).size));
        console.log(`segmenti: ${files.length} — byte: ${sizes.join(', ')}`);

        await updateJob(jobId, { chunks: files.length, progress: `0/${files.length}` });

        const client = await getOpenAIClient();
        const parts = await transcribeAll(client, files.map((f) => join(WORK_DIR, f)), jobId);
        const transcript = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

        if (transcript.length < 20) throw fail('NO_SPEECH', 'nessun parlato riconosciuto');

        await updateJob(jobId, {
            status: JOB_STATUS.DONE,
            transcript: transcript.slice(0, 120000), // limite accettato da /summarize-url
            progress: `${files.length}/${files.length}`
        });
        return { ok: true, chunks: files.length, characters: transcript.length };
    } catch (error) {
        console.error('transcribe-worker error:', error?.code || '', error?.message);
        try {
            await updateJob(jobId, { status: JOB_STATUS.ERROR, code: clientCode(error?.code), error: String(error?.message || '').slice(0, 300) });
        } catch (e) {
            console.error('impossibile aggiornare il job in errore:', e?.message);
        }
        return { ok: false };
    } finally {
        await rm(WORK_DIR, { recursive: true, force: true }).catch(() => {});
    }
}
