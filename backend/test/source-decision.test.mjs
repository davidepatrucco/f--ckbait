// Test della logica di scelta della fonte. Carica il file REALMENTE spedito
// nell'estensione (extension/source-decision.js) in un sandbox vm: nessuna copia
// da tenere sincronizzata.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sandbox = createContext({});
runInContext(readFileSync(join(ROOT, 'extension', 'source-decision.js'), 'utf8'), sandbox);
const RI = sandbox.RI_SOURCE;

const inv = (over = {}) => ({
    text: { len: 0, rawLen: 0, ...(over.text || {}) },
    video: over.video === undefined ? { present: false } : over.video,
    blocked: over.blocked || null
});

test('modulo esportato correttamente', () => {
    assert.equal(typeof RI.decideSummarySource, 'function');
    assert.equal(typeof RI.parseVtt, 'function');
    assert.ok(RI.CONSTANTS.MIN_TEXT > 0);
});

// --- ESAUSTIVITÀ: prodotto cartesiano completo degli input discretizzati ----
test('ogni combinazione di input produce un’azione valida (nessun buco)', () => {
    const textStates = [
        { len: 0, rawLen: 0 },                 // assente
        { len: 120, rawLen: 120 },             // scarso
        { len: 5000, rawLen: 5000 },           // sostanzioso
        { len: 40000, rawLen: 200000 }         // troppo lungo (rawLen oltre soglia)
    ];
    const blockedStates = [null, 'PAYWALL', 'LOGIN_WALL', 'CONSENT_WALL', 'CANVAS_DOC'];
    const videoStates = [];
    videoStates.push({ present: false });
    for (const isLive of [false, true]) {
        for (const tracks of [[], [{ url: 'https://x/en.vtt', lang: 'en', kind: 'captions' }]]) {
            for (const media of [null, { url: 'https://x/a.mp4', kind: 'file' }, { url: 'https://x/a.m3u8', kind: 'hls' }]) {
                for (const duration of [0, 30, 600, 20000]) {
                    for (const prominent of [false, true]) {
                        videoStates.push({ present: true, isLive, captionTracks: tracks, directMedia: media, durationSeconds: duration, prominent });
                    }
                }
            }
        }
    }
    const optionStates = [
        { plan: 'free', userLang: 'it', asyncAvailable: true },
        { plan: 'premium', userLang: 'it', asyncAvailable: true },
        { plan: 'premium', userLang: 'en', asyncAvailable: false },
        { plan: 'free', userLang: 'de', asyncAvailable: false }
    ];

    let combos = 0;
    for (const text of textStates) {
        for (const blocked of blockedStates) {
            for (const video of videoStates) {
                for (const opts of optionStates) {
                    combos++;
                    const out = RI.decideSummarySource(inv({ text, blocked, video }), opts);
                    assert.ok(out && typeof out === 'object', 'decisione non è un oggetto');
                    assert.ok(RI.ACTIONS.includes(out.action), `azione ignota: ${out.action}`);
                    if (out.action === 'UNSUPPORTED') {
                        assert.ok(RI.UNSUPPORTED_CODES.includes(out.code), `codice ignoto: ${out.code}`);
                    }
                    if (out.note) assert.ok(RI.NOTES.includes(out.note), `nota ignota: ${out.note}`);
                    if (out.action === 'VIDEO_CAPTIONS') assert.ok(out.trackUrl, 'VIDEO_CAPTIONS senza trackUrl');
                    if (out.action === 'VIDEO_STT' || out.action === 'VIDEO_STT_ASYNC') assert.ok(out.mediaUrl, 'STT senza mediaUrl');
                }
            }
        }
    }
    assert.ok(combos > 1000, `troppe poche combinazioni testate: ${combos}`);
});

// --- BUCO A: testo + video insieme (caso Lenny) ----------------------------
test('buco A — video prominente con sottotitoli vince sul testo sostanzioso', () => {
    const out = RI.decideSummarySource(inv({
        text: { len: 5000, rawLen: 5000 },
        video: { present: true, prominent: true, isLive: false, durationSeconds: 1800, captionTracks: [{ url: 'https://cdn/en.vtt', lang: 'en', kind: 'captions' }], directMedia: null }
    }), { plan: 'free', userLang: 'it' });
    assert.equal(out.action, 'VIDEO_CAPTIONS');
    assert.equal(out.trackUrl, 'https://cdn/en.vtt');
});

test('buco A — clip breve non ruba la scena all’articolo', () => {
    const out = RI.decideSummarySource(inv({
        text: { len: 5000, rawLen: 5000 },
        video: { present: true, prominent: true, isLive: false, durationSeconds: 20, captionTracks: [{ url: 'https://cdn/en.vtt', lang: 'en' }], directMedia: null }
    }), { plan: 'free', userLang: 'it' });
    assert.equal(out.action, 'TEXT');
    assert.equal(out.note, 'VIDEO_AVAILABLE');
});

test('buco A — video non prominente con articolo ricco: vince il testo', () => {
    const out = RI.decideSummarySource(inv({
        text: { len: 5000, rawLen: 5000 },
        video: { present: true, prominent: false, isLive: false, durationSeconds: 1800, captionTracks: [{ url: 'https://cdn/en.vtt', lang: 'en' }], directMedia: null }
    }), { plan: 'premium', userLang: 'it' });
    assert.equal(out.action, 'TEXT');
});

test('pagina video-only con sottotitoli: sempre video', () => {
    const out = RI.decideSummarySource(inv({
        text: { len: 80, rawLen: 80 },
        video: { present: true, prominent: false, isLive: false, durationSeconds: 600, captionTracks: [{ url: 'https://cdn/it.vtt', lang: 'it' }], directMedia: null }
    }), { plan: 'free', userLang: 'it' });
    assert.equal(out.action, 'VIDEO_CAPTIONS');
});

// --- G: VTT funziona anche con stream protetto (nessun directMedia) --------
test('buco G — sottotitoli usabili anche senza sorgente diretta (DRM/blob)', () => {
    const out = RI.decideSummarySource(inv({
        text: { len: 10, rawLen: 10 },
        video: { present: true, prominent: true, isLive: false, durationSeconds: 3600, captionTracks: [{ url: 'https://cdn/en.vtt', lang: 'en' }], directMedia: null }
    }), { plan: 'free', userLang: 'it' });
    assert.equal(out.action, 'VIDEO_CAPTIONS');
});

// --- D: video lungo senza sottotitoli -------------------------------------
test('buco D — lungo senza sottotitoli va al job asincrono (premium)', () => {
    const out = RI.decideSummarySource(inv({
        text: { len: 10, rawLen: 10 },
        video: { present: true, prominent: true, isLive: false, durationSeconds: 1800, captionTracks: [], directMedia: { url: 'https://x/a.mp4', kind: 'file' } }
    }), { plan: 'premium', userLang: 'it', asyncAvailable: true });
    assert.equal(out.action, 'VIDEO_STT_ASYNC');
});

test('buco D — oltre il limite asincrono: avviso', () => {
    const out = RI.decideSummarySource(inv({
        text: { len: 10, rawLen: 10 },
        video: { present: true, prominent: true, isLive: false, durationSeconds: 20000, captionTracks: [], directMedia: { url: 'https://x/a.mp4', kind: 'file' } }
    }), { plan: 'premium', userLang: 'it', asyncAvailable: true });
    assert.equal(out.action, 'UNSUPPORTED');
    assert.equal(out.code, 'VIDEO_TOO_LONG_NO_CAPTIONS');
});

test('clip breve senza sottotitoli: STT sincrono', () => {
    const out = RI.decideSummarySource(inv({
        text: { len: 10, rawLen: 10 },
        video: { present: true, prominent: true, isLive: false, durationSeconds: 60, captionTracks: [], directMedia: { url: 'https://x/a.mp4', kind: 'file' } }
    }), { plan: 'premium', userLang: 'it' });
    assert.equal(out.action, 'VIDEO_STT');
});

test('HLS non va mai al path sincrono', () => {
    const out = RI.decideSummarySource(inv({
        text: { len: 10, rawLen: 10 },
        video: { present: true, prominent: true, isLive: false, durationSeconds: 60, captionTracks: [], directMedia: { url: 'https://x/a.m3u8', kind: 'hls' } }
    }), { plan: 'premium', userLang: 'it', asyncAvailable: true });
    assert.equal(out.action, 'VIDEO_STT_ASYNC');
});

// --- gating premium --------------------------------------------------------
test('STT su piano free: degrada al testo se sostanzioso', () => {
    const out = RI.decideSummarySource(inv({
        text: { len: 5000, rawLen: 5000 },
        video: { present: true, prominent: true, isLive: false, durationSeconds: 600, captionTracks: [], directMedia: { url: 'https://x/a.mp4', kind: 'file' } }
    }), { plan: 'free', userLang: 'it' });
    assert.equal(out.action, 'TEXT');
    assert.equal(out.note, 'VIDEO_NEEDS_PREMIUM');
});

test('STT su piano free senza testo: avviso premium', () => {
    const out = RI.decideSummarySource(inv({
        text: { len: 10, rawLen: 10 },
        video: { present: true, prominent: true, isLive: false, durationSeconds: 600, captionTracks: [], directMedia: { url: 'https://x/a.mp4', kind: 'file' } }
    }), { plan: 'free', userLang: 'it' });
    assert.equal(out.action, 'UNSUPPORTED');
    assert.equal(out.code, 'PREMIUM_REQUIRED');
});

test('sottotitoli restano gratis (nessun gate premium)', () => {
    const out = RI.decideSummarySource(inv({
        text: { len: 10, rawLen: 10 },
        video: { present: true, prominent: true, isLive: false, durationSeconds: 1800, captionTracks: [{ url: 'https://cdn/en.vtt', lang: 'en' }], directMedia: null }
    }), { plan: 'free', userLang: 'it' });
    assert.equal(out.action, 'VIDEO_CAPTIONS');
});

// --- F: live --------------------------------------------------------------
test('buco F — diretta senza testo: avviso', () => {
    const out = RI.decideSummarySource(inv({
        text: { len: 10, rawLen: 10 },
        video: { present: true, prominent: true, isLive: true, durationSeconds: 0, captionTracks: [{ url: 'https://cdn/en.vtt', lang: 'en' }], directMedia: null }
    }), { plan: 'premium', userLang: 'it' });
    assert.equal(out.action, 'UNSUPPORTED');
    assert.equal(out.code, 'LIVE_STREAM');
});

test('buco F — diretta con articolo ricco: riassume il testo', () => {
    const out = RI.decideSummarySource(inv({
        text: { len: 5000, rawLen: 5000 },
        video: { present: true, prominent: true, isLive: true, durationSeconds: 0, captionTracks: [], directMedia: null }
    }), { plan: 'premium', userLang: 'it' });
    assert.equal(out.action, 'TEXT');
    assert.equal(out.note, 'VIDEO_SKIPPED_LIVE');
});

// --- casi bloccati e testo -------------------------------------------------
test('paywall senza testo: avviso paywall', () => {
    const out = RI.decideSummarySource(inv({ text: { len: 30, rawLen: 30 }, blocked: 'PAYWALL' }), { plan: 'free' });
    assert.equal(out.action, 'UNSUPPORTED');
    assert.equal(out.code, 'PAYWALL');
});

test('testo troppo lungo: avviso TOO_LONG', () => {
    const out = RI.decideSummarySource(inv({ text: { len: 40000, rawLen: 200000 } }), { plan: 'free' });
    assert.equal(out.action, 'UNSUPPORTED');
    assert.equal(out.code, 'TOO_LONG');
});

test('pagina vuota: INSUFFICIENT_CONTENT', () => {
    const out = RI.decideSummarySource(inv({}), { plan: 'free' });
    assert.equal(out.action, 'UNSUPPORTED');
    assert.equal(out.code, 'INSUFFICIENT_CONTENT');
});

test('articolo normale: TEXT', () => {
    const out = RI.decideSummarySource(inv({ text: { len: 5000, rawLen: 5000 } }), { plan: 'free' });
    assert.equal(out.action, 'TEXT');
    assert.equal(out.note, undefined);
});

// --- BUCO C: selezione traccia e correlazione URL -------------------------
test('buco C — selezione traccia per lingua utente', () => {
    const tracks = [
        { url: 'u-de', lang: 'de', kind: 'captions' },
        { url: 'u-en', lang: 'en', kind: 'captions' },
        { url: 'u-it', lang: 'it-IT', kind: 'captions' }
    ];
    assert.equal(RI.pickCaptionTrack(tracks, 'it').url, 'u-it');
    assert.equal(RI.pickCaptionTrack(tracks, 'de').url, 'u-de');
    assert.equal(RI.pickCaptionTrack(tracks, 'fr').url, 'u-it', 'fallback: it prima di en');
    assert.equal(RI.pickCaptionTrack([], 'it'), null);
});

test('buco C — kind descriptions scartato se esistono captions', () => {
    const tracks = [
        { url: 'u-desc', lang: 'it', kind: 'descriptions' },
        { url: 'u-cap', lang: 'en', kind: 'captions' }
    ];
    assert.equal(RI.pickCaptionTrack(tracks, 'it').url, 'u-cap');
});

test('buco C — correlazione VTT per id di pagina (caso Substack reale)', () => {
    const urls = [
        'https://substackcdn.com/video_upload/post/214048522/abc/en.vtt?Expires=1',
        'https://substackcdn.com/video_upload/post/213644454/def/en.vtt?Expires=2',
        'https://substackcdn.com/video_upload/post/211737019/ghi/en.vtt?Expires=3'
    ];
    const page = 'https://www.lennysnewsletter.com/p/gpt-6-astra-is-a-banger-heres-everything?post=214048522';
    const got = RI.correlateVttUrls(urls, page);
    assert.equal(got.length, 1);
    assert.ok(got[0].includes('214048522'));
});

test('buco C — nessuna correlazione possibile: restituisce tutti (il chiamante non indovina)', () => {
    const urls = ['https://x/a.vtt', 'https://x/b.vtt'];
    assert.deepEqual(RI.correlateVttUrls(urls, 'https://x/page-senza-id'), urls);
    assert.deepEqual(RI.correlateVttUrls(['https://x/a.vtt'], 'https://x/p'), ['https://x/a.vtt']);
});

// --- parsing VTT ----------------------------------------------------------
test('parseVtt — cue, timestamp, numeri e header scartati', () => {
    const vtt = `WEBVTT

1
00:00:00.000 --> 00:00:03.500
We are going to the stars today

2
00:00:03.500 --> 00:00:06.200
GPT-6 Astra is live.`;
    assert.equal(RI.parseVtt(vtt), 'We are going to the stars today GPT-6 Astra is live.');
});

test('parseVtt — tag inline, entità e righe ripetute', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.000 align:start position:0%
<v Lenny>Tom &amp; Jerry <c.yellow>rocks</c>

00:00:02.000 --> 00:00:03.000
Tom &amp; Jerry rocks

00:00:03.000 --> 00:00:04.000
fine`;
    assert.equal(RI.parseVtt(vtt), 'Tom & Jerry rocks fine');
});

test('parseVtt — blocchi NOTE/STYLE ignorati', () => {
    const vtt = `WEBVTT

NOTE
questo è un commento

STYLE
::cue { color: red }

00:00:01.000 --> 00:00:02.000
testo vero`;
    assert.equal(RI.parseVtt(vtt), 'testo vero');
});

test('parseVtt — input vuoto/non valido', () => {
    assert.equal(RI.parseVtt(''), '');
    assert.equal(RI.parseVtt(null), '');
    assert.equal(RI.parseVtt('WEBVTT\n\n'), '');
});

test('parseVtt — tollera SRT', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000
prima riga

2
00:00:02,000 --> 00:00:03,000
seconda riga`;
    assert.equal(RI.parseVtt(srt), 'prima riga seconda riga');
});
