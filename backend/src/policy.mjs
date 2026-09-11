// policy.mjs — FONTE UNICA di policy commerciali e limiti tecnici.
//
// Perché esiste: gli stessi numeri vivevano in più punti (80.000 caratteri in tre
// file, 120.000 in quattro, soglie del browser separate da quelle del backend), e
// molte variabili d'ambiente lette dal codice non erano esposte al deploy. Cambiare
// una policy richiedeva sapere quali copie aggiornare, e il browser poteva applicare
// una soglia diversa da quella del server.
//
// Regole:
//  1. Ogni soglia o policy si dichiara QUI, con l'eventuale override d'ambiente.
//  2. Il backend importa da qui, non ridefinisce.
//  3. I valori che servono all'estensione sono in PUBLIC_LIMITS e vengono GENERATI
//     nel pacchetto al build (vedi scripts/lib/policy-gen.mjs): il browser non
//     ridichiara nulla, quindi non può divergere.
//  4. Lo stato dell'utente (consumo, prenotazioni, deroghe) resta sul database:
//     qui ci sono i default, non le copie per-utente.

const num = (envName, fallback) => {
    const raw = process.env[envName];
    const parsed = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
};

// --- Policy commerciali -------------------------------------------------------
// Applicate dal backend; i valori pubblici sono comunicati al client.
export const PLAN_POLICY = {
    free: {
        // Prove iniziali una tantum per brand, consumate prima della quota.
        trialSummaries: num('FREE_TRIAL_BONUS', 5),
        // Quota ricorrente dopo le prove.
        dailySummaries: num('FREE_PLAN_LIMIT', 1),
        transcription: false
    },
    premium: {
        trialSummaries: 0,
        dailySummaries: Infinity,
        transcription: true
    }
};

// Tetti anti-abuso sulla trascrizione (l'unico percorso con costo per minuto).
// Valgono per ENTRAMBI i percorsi, sincrono e asincrono.
export const TRANSCRIPTION_LIMITS = {
    maxActiveJobs: num('MAX_ACTIVE_TRANSCRIBE_JOBS', 2),
    maxJobsPerDay: num('MAX_TRANSCRIBE_JOBS_PER_DAY', 20),
    // Oltre questa età un job aperto è considerato morto (worker con timeout 15').
    staleAfterMs: num('TRANSCRIBE_STALE_AFTER_MS', 20 * 60 * 1000),
    segmentSeconds: num('SEGMENT_SECONDS', 600),
    maxSegments: num('MAX_SEGMENTS', 18),
    concurrency: num('TRANSCRIBE_CONCURRENCY', 3),
    ffmpegTimeoutMs: num('FFMPEG_TIMEOUT_MS', 8 * 60 * 1000)
};

// --- Limiti tecnici -----------------------------------------------------------
// CONTENT_LIMITS è la parte che il browser deve conoscere per decidere PRIMA di
// chiamare il backend: va tenuta allineata per costruzione, non per disciplina.
export const CONTENT_LIMITS = {
    // Testo: sotto MIN_TEXT_USABLE non si riassume; sopra TOO_LONG si rifiuta
    // (scelta di prodotto: nessun riassunto parziale silenzioso).
    minUsableChars: num('MIN_USABLE_CHARS', 50),
    richTextChars: num('RICH_TEXT_CHARS', 400),
    maxTextChars: num('MAX_TEXT_CHARS', 40000),
    tooLongChars: num('TOO_LONG_CHARS', 80000),
    maxClientTextChars: num('MAX_CLIENT_TEXT_CHARS', 50000),
    maxTranscriptChars: num('MAX_TRANSCRIPT_CHARS', 120000),
    maxPdfPages: num('MAX_PDF_PAGES', 50),
    maxPdfUploadBytes: num('MAX_PDF_UPLOAD_BYTES', Math.floor(3.5 * 1024 * 1024))
};

export const MEDIA_LIMITS = {
    maxMediaBytes: num('MAX_MEDIA_BYTES', 24 * 1024 * 1024),
    fetchTimeoutMs: num('MEDIA_FETCH_TIMEOUT_MS', 20000),
    maxRedirects: num('MEDIA_MAX_REDIRECTS', 5),
    // Un video più corto di così non è "il contenuto" della pagina.
    videoMinSeconds: num('VIDEO_MIN_SECONDS', 120),
    // Oltre: serve il percorso asincrono (il sincrono deve stare nei 29s di API GW).
    sttSyncMaxSeconds: num('STT_SYNC_MAX_SECONDS', 300),
    sttAsyncMaxSeconds: num('STT_ASYNC_MAX_SECONDS', 10800)
};

// Sottoinsieme che finisce nel pacchetto dell'estensione. Le chiavi corrispondono a
// quelle usate da source-decision.js: il generatore le scrive, il browser le legge.
export function publicLimits() {
    return {
        MIN_TEXT: CONTENT_LIMITS.richTextChars,
        MIN_TEXT_USABLE: CONTENT_LIMITS.minUsableChars,
        TOO_LONG_CHARS: CONTENT_LIMITS.tooLongChars,
        MAX_TRANSCRIPT_CHARS: CONTENT_LIMITS.maxTranscriptChars,
        MAX_TEXT_CHARS: CONTENT_LIMITS.maxTextChars,
        MAX_PDF_UPLOAD_BYTES: CONTENT_LIMITS.maxPdfUploadBytes,
        VIDEO_MIN_SECONDS: MEDIA_LIMITS.videoMinSeconds,
        STT_SYNC_MAX_SECONDS: MEDIA_LIMITS.sttSyncMaxSeconds,
        STT_ASYNC_MAX_SECONDS: MEDIA_LIMITS.sttAsyncMaxSeconds
    };
}

// Elenco esplicito delle variabili d'ambiente riconosciute: serve al test che
// verifica che siano esposte al deploy, invece di restare override teorici.
export const SUPPORTED_ENV = [
    'FREE_TRIAL_BONUS', 'FREE_PLAN_LIMIT',
    'MAX_ACTIVE_TRANSCRIBE_JOBS', 'MAX_TRANSCRIBE_JOBS_PER_DAY', 'TRANSCRIBE_STALE_AFTER_MS',
    'SEGMENT_SECONDS', 'MAX_SEGMENTS', 'TRANSCRIBE_CONCURRENCY', 'FFMPEG_TIMEOUT_MS',
    'MIN_USABLE_CHARS', 'RICH_TEXT_CHARS', 'MAX_TEXT_CHARS', 'TOO_LONG_CHARS',
    'MAX_CLIENT_TEXT_CHARS', 'MAX_TRANSCRIPT_CHARS', 'MAX_PDF_PAGES', 'MAX_PDF_UPLOAD_BYTES',
    'MAX_MEDIA_BYTES', 'MEDIA_FETCH_TIMEOUT_MS', 'MEDIA_MAX_REDIRECTS',
    'VIDEO_MIN_SECONDS', 'STT_SYNC_MAX_SECONDS', 'STT_ASYNC_MAX_SECONDS'
];
