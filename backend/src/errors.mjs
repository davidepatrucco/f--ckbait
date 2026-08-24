// errors.mjs - Catalogo centralizzato degli errori API (contract stabile).
// Ogni voce: { status, message }. Il `code` è la chiave (stringa stabile: i client
// possono dipenderne). Non rinominare i codici esistenti senza bump di versione.

export const API_ERRORS = {
    // 400
    INVALID_JSON: { status: 400, message: 'Body della richiesta non valido' },
    MISSING_URL: { status: 400, message: 'URL è richiesto e deve essere una stringa' },
    INVALID_BRAND: { status: 400, message: 'Brand non valido' },
    INVALID_TRANSCRIPT: { status: 400, message: 'Trascrizione non valida' },
    INVALID_VIDEO_DURATION: { status: 400, message: 'Durata video non valida' },
    INSUFFICIENT_CONTENT: { status: 400, message: 'Contenuto insufficiente per il riassunto' },
    // 401 / 403
    AUTH_REQUIRED: { status: 401, message: 'Autenticazione richiesta' },
    // 409
    PAYMENT_BRAND_MISMATCH: { status: 409, message: 'Brand del pagamento non corrispondente' },
    // 422
    YOUTUBE_TRANSCRIPT_REQUIRED: { status: 422, message: 'Trascrizione YouTube non ricevuta dall’estensione' },
    // 429
    USAGE_LIMIT_EXCEEDED: { status: 429, message: 'Limite mensile raggiunto' },
    RATE_LIMITED: { status: 429, message: 'Troppe richieste. Riprova più tardi.' },
    // 5xx
    OUTPUT_SCHEMA_ERROR: { status: 502, message: 'Risposta del modello non valida' },
    INVALID_OPENAI_RESPONSE: { status: 500, message: 'Risposta OpenAI non valida' },
    PROVIDER_UNAVAILABLE: { status: 503, message: 'Servizio di sintesi non disponibile' },
    PROCESSING_ERROR: { status: 500, message: 'Errore nel processare la richiesta' },
    INTERNAL_ERROR: { status: 500, message: 'Errore interno del server' }
};

export function apiErrorStatus(code) {
    return (API_ERRORS[code] || API_ERRORS.INTERNAL_ERROR).status;
}

// Corpo di errore standard: { error, code, ...extra }. `extra.error` sovrascrive il messaggio.
export function apiErrorBody(code, extra = {}) {
    const def = API_ERRORS[code] || API_ERRORS.INTERNAL_ERROR;
    const { error, ...rest } = extra;
    return {
        error: error || def.message,
        code: API_ERRORS[code] ? code : 'INTERNAL_ERROR',
        ...rest
    };
}
