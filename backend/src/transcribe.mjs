// transcribe.mjs — trascrizione audio/video generica (Tier-1 MVP).
// Scarica un media da URL diretto (mp4/webm/m4a/mp3…) e lo trascrive con OpenAI
// (nessun ffmpeg: l'API accetta i container video ed estrae l'audio). La trascrizione
// risultante viene poi riusata dal path video esistente di /summarize-url.
//
// Limiti MVP (sincroni, sotto i 29s di API Gateway):
//  - solo URL http(s) diretti e pubblici (guard SSRF condiviso);
//  - dimensione <= MAX_MEDIA_BYTES (limite OpenAI 25MB);
//  - niente HLS/DASH (.m3u8), niente blob:/DRM → gestiti a monte (estensione) o rifiutati.
// Fase 2 (non qui): ffmpeg + chunking + job async per video lunghi e HLS.
import { toFile } from 'openai';
import { getOpenAIClient } from './openai.mjs';
import { assertPublicUrl } from './web-fetcher.mjs';

const MAX_MEDIA_BYTES = 24 * 1024 * 1024; // < 25MB (hard limit OpenAI)
const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
const FETCH_TIMEOUT_MS = 20000;

// Content-type accettati (estrazione audio lato OpenAI). octet-stream ammesso solo se
// l'estensione del path è nota.
const ALLOWED_CONTENT_TYPES = new Set([
    'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac',
    'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg', 'audio/flac',
    'application/ogg', // .ogg/.oga sono spesso serviti così
    'video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v', 'video/ogg'
]);
const EXT_TO_NAME = {
    mp3: 'audio.mp3', mpeg: 'audio.mp3', mpga: 'audio.mp3', m4a: 'audio.m4a', aac: 'audio.aac',
    wav: 'audio.wav', webm: 'media.webm', ogg: 'audio.ogg', oga: 'audio.ogg', flac: 'audio.flac',
    mp4: 'media.mp4', m4v: 'media.mp4', mov: 'media.mov'
};

function extOf(urlStr) {
    try {
        const p = new URL(urlStr).pathname.toLowerCase();
        const m = p.match(/\.([a-z0-9]{2,4})$/);
        return m ? m[1] : '';
    } catch { return ''; }
}

// True se il media è trascrivibile in base a content-type o, per octet-stream/vuoto,
// all'estensione del path. Pura, testabile.
export function isAllowedMedia(contentType, urlStr) {
    const ct = (contentType || '').split(';')[0].trim().toLowerCase();
    if (ALLOWED_CONTENT_TYPES.has(ct)) return true;
    if (ct === '' || ct === 'application/octet-stream' || ct === 'binary/octet-stream') {
        return Boolean(EXT_TO_NAME[extOf(urlStr)]);
    }
    return false;
}

// Nome file (con estensione corretta) richiesto dall'API OpenAI per dedurre il formato.
export function fileNameFor(urlStr, contentType) {
    const byExt = EXT_TO_NAME[extOf(urlStr)];
    if (byExt) return byExt;
    const ct = (contentType || '').split(';')[0].trim().toLowerCase();
    if (ct.startsWith('audio/')) return 'audio.mp3';
    if (ct.startsWith('video/')) return 'media.mp4';
    return 'media.mp4';
}

// Scarica il media applicando guard SSRF, allowlist e cap dimensione (anche in assenza
// di Content-Length, leggendo a stream e abortendo oltre il limite).
export async function downloadMedia(mediaUrl) {
    let url;
    try { url = new URL(mediaUrl); } catch { const e = new Error('URL non valido'); e.code = 'INVALID_MEDIA_URL'; throw e; }
    if (!['http:', 'https:'].includes(url.protocol)) { const e = new Error('Protocollo non supportato'); e.code = 'INVALID_MEDIA_URL'; throw e; }
    await assertPublicUrl(url); // SSRF: lancia su host locali/privati

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
        res = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { Accept: 'audio/*,video/*,*/*' } });
    } catch (err) {
        clearTimeout(timer);
        const e = new Error(`Download media fallito: ${err.message}`); e.code = 'MEDIA_FETCH_FAILED'; throw e;
    }
    try {
        if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.code = 'MEDIA_FETCH_FAILED'; throw e; }
        const contentType = res.headers.get('content-type') || '';
        if (!isAllowedMedia(contentType, mediaUrl)) { const e = new Error(`Formato non supportato (${contentType || 'ignoto'})`); e.code = 'UNSUPPORTED_MEDIA'; throw e; }
        const declared = Number(res.headers.get('content-length') || 0);
        if (declared && declared > MAX_MEDIA_BYTES) { const e = new Error('Media troppo grande'); e.code = 'MEDIA_TOO_LARGE'; throw e; }

        // Lettura con cap difensivo (Content-Length può mancare o mentire).
        const reader = res.body.getReader();
        const chunks = []; let total = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > MAX_MEDIA_BYTES) { try { await reader.cancel(); } catch { /* noop */ } const e = new Error('Media troppo grande'); e.code = 'MEDIA_TOO_LARGE'; throw e; }
            chunks.push(value);
        }
        return { buffer: Buffer.concat(chunks), contentType, filename: fileNameFor(mediaUrl, contentType), bytes: total };
    } finally {
        clearTimeout(timer);
    }
}

// Scarica e trascrive. Ritorna { text, model, bytes }. Lancia errori con .code per il mapping HTTP.
export async function transcribeMedia(mediaUrl) {
    const { buffer, filename, bytes } = await downloadMedia(mediaUrl);
    const client = await getOpenAIClient();
    const file = await toFile(buffer, filename);
    let text;
    try {
        const out = await client.audio.transcriptions.create({ file, model: TRANSCRIBE_MODEL, response_format: 'text' });
        text = typeof out === 'string' ? out : (out?.text || '');
    } catch (err) {
        const e = new Error(`Trascrizione fallita: ${err.message}`); e.code = 'TRANSCRIPTION_FAILED'; throw e;
    }
    text = (text || '').trim();
    if (text.length < 20) { const e = new Error('Nessun parlato riconosciuto nel media'); e.code = 'NO_SPEECH'; throw e; }
    return { text, model: TRANSCRIBE_MODEL, bytes };
}

export const _test = { MAX_MEDIA_BYTES, TRANSCRIBE_MODEL, extOf };
