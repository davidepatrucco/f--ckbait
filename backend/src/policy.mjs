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
    ffmpegTimeoutMs: num('FFMPEG_TIMEOUT_MS', 8 * 60 * 1000),
    // Tetto sui MINUTI trascritti al giorno. I limiti su job concorrenti e job/giorno
    // non vincolano la durata: 20 job da 3 ore restano ~20$/giorno per utente.
    maxMinutesPerDay: num('MAX_TRANSCRIBE_MINUTES_PER_DAY', 120)
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

// Rate limiting per utente (protezione di costo trasversale, non per-piano).
export const RATE_LIMITS = {
    perMinute: { window: 60 * 1000, limit: num('RATE_LIMIT_PER_MINUTE', 10) },
    perHour: { window: 60 * 60 * 1000, limit: num('RATE_LIMIT_PER_HOUR', 100) },
    perDay: { window: 24 * 60 * 60 * 1000, limit: num('RATE_LIMIT_PER_DAY', 500) }
};

// Routing dei modelli. Il nome del modello NON e' una policy di prodotto: cambia con
// i listini del fornitore, quindi resta un override d'ambiente con default per data.
export const MODEL_POLICY = {
    // Soglia (parole) oltre cui un utente premium passa al modello premium.
    premiumWordCount: num('PREMIUM_WORDCOUNT_THRESHOLD', 6000)
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
    'MAX_TRANSCRIBE_MINUTES_PER_DAY',
    'MIN_USABLE_CHARS', 'RICH_TEXT_CHARS', 'MAX_TEXT_CHARS', 'TOO_LONG_CHARS',
    'MAX_CLIENT_TEXT_CHARS', 'MAX_TRANSCRIPT_CHARS', 'MAX_PDF_PAGES', 'MAX_PDF_UPLOAD_BYTES',
    'MAX_MEDIA_BYTES', 'MEDIA_FETCH_TIMEOUT_MS', 'MEDIA_MAX_REDIRECTS',
    'VIDEO_MIN_SECONDS', 'STT_SYNC_MAX_SECONDS', 'STT_ASYNC_MAX_SECONDS',
    'RATE_LIMIT_PER_MINUTE', 'RATE_LIMIT_PER_HOUR', 'RATE_LIMIT_PER_DAY',
    'PREMIUM_WORDCOUNT_THRESHOLD'
];

// --- Override amministrabili a runtime ----------------------------------------
// Gli oggetti esportati sopra sono la base (default + variabili d'ambiente). Qui si
// applicano gli override persistiti, che hanno la precedenza. La mutazione in posto
// e' volutamente scelta invece di una firma asincrona: ogni modulo importa questi
// oggetti al caricamento, e cambiare tutte le firme avrebbe significato riscrivere
// mezzo backend per un beneficio nullo. L'aggiornamento avviene una volta per
// invocazione (con cache), quindi non esistono letture parziali a metà richiesta.
const OVERRIDE_TARGETS = {
    'plan.free.trialSummaries': (v) => { PLAN_POLICY.free.trialSummaries = v; },
    'plan.free.dailySummaries': (v) => { PLAN_POLICY.free.dailySummaries = v; },
    'transcription.maxActiveJobs': (v) => { TRANSCRIPTION_LIMITS.maxActiveJobs = v; },
    'transcription.maxJobsPerDay': (v) => { TRANSCRIPTION_LIMITS.maxJobsPerDay = v; },
    'transcription.maxMinutesPerDay': (v) => { TRANSCRIPTION_LIMITS.maxMinutesPerDay = v; },
    'content.tooLongChars': (v) => { CONTENT_LIMITS.tooLongChars = v; },
    'content.maxTextChars': (v) => { CONTENT_LIMITS.maxTextChars = v; },
    'content.maxPdfPages': (v) => { CONTENT_LIMITS.maxPdfPages = v; },
    'media.sttSyncMaxSeconds': (v) => { MEDIA_LIMITS.sttSyncMaxSeconds = v; },
    'media.sttAsyncMaxSeconds': (v) => { MEDIA_LIMITS.sttAsyncMaxSeconds = v; },
    'media.videoMinSeconds': (v) => { MEDIA_LIMITS.videoMinSeconds = v; },
    'rate.perMinute': (v) => { RATE_LIMITS.perMinute.limit = v; },
    'rate.perHour': (v) => { RATE_LIMITS.perHour.limit = v; },
    'rate.perDay': (v) => { RATE_LIMITS.perDay.limit = v; },
    'model.premiumWordCount': (v) => { MODEL_POLICY.premiumWordCount = v; }
};

// Valori di partenza, catturati prima di qualunque override: servono a poter
// TOGLIERE un override senza riavviare il processo.
const BASELINE = Object.fromEntries(Object.keys(OVERRIDE_TARGETS).map((k) => [k, currentValue(k)]));

function currentValue(key) {
    switch (key) {
        case 'plan.free.trialSummaries': return PLAN_POLICY.free.trialSummaries;
        case 'plan.free.dailySummaries': return PLAN_POLICY.free.dailySummaries;
        case 'transcription.maxActiveJobs': return TRANSCRIPTION_LIMITS.maxActiveJobs;
        case 'transcription.maxJobsPerDay': return TRANSCRIPTION_LIMITS.maxJobsPerDay;
        case 'transcription.maxMinutesPerDay': return TRANSCRIPTION_LIMITS.maxMinutesPerDay;
        case 'content.tooLongChars': return CONTENT_LIMITS.tooLongChars;
        case 'content.maxTextChars': return CONTENT_LIMITS.maxTextChars;
        case 'content.maxPdfPages': return CONTENT_LIMITS.maxPdfPages;
        case 'media.sttSyncMaxSeconds': return MEDIA_LIMITS.sttSyncMaxSeconds;
        case 'media.sttAsyncMaxSeconds': return MEDIA_LIMITS.sttAsyncMaxSeconds;
        case 'media.videoMinSeconds': return MEDIA_LIMITS.videoMinSeconds;
        case 'rate.perMinute': return RATE_LIMITS.perMinute.limit;
        case 'rate.perHour': return RATE_LIMITS.perHour.limit;
        case 'rate.perDay': return RATE_LIMITS.perDay.limit;
        case 'model.premiumWordCount': return MODEL_POLICY.premiumWordCount;
        default: return undefined;
    }
}

// Stato dell'override applicato, esposto per diagnostica e per GET /admin/config.
export const POLICY_STATE = { version: null, appliedAt: null, values: {} };

// Applica un insieme di override. I parametri assenti tornano al valore di partenza,
// così rimuovere una voce dalla configurazione la riporta al default senza riavvio.
export function applyOverrides(values = {}, version = null) {
    const applied = {};
    for (const [key, setter] of Object.entries(OVERRIDE_TARGETS)) {
        const next = Object.prototype.hasOwnProperty.call(values, key) ? Number(values[key]) : BASELINE[key];
        if (Number.isFinite(next)) {
            setter(next);
            if (Object.prototype.hasOwnProperty.call(values, key)) applied[key] = next;
        }
    }
    POLICY_STATE.version = version;
    POLICY_STATE.appliedAt = new Date().toISOString();
    POLICY_STATE.values = applied;
    return applied;
}

// Valori effettivi correnti, per l'interfaccia amministrativa.
export function effectiveValues() {
    return Object.fromEntries(Object.keys(OVERRIDE_TARGETS).map((k) => [k, currentValue(k)]));
}

