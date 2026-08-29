// handler.mjs - Entry point per AWS Lambda - Updated 2025-09-28 with stats
import { summarizeWithOpenAI } from '../src/openai.mjs';
import { selectSummaryModel } from '../src/model-router.mjs';
import { validateSubscription } from '../src/subscription.mjs';
import { checkRateLimit } from '../src/rate-limit.mjs';
import { fetchWebContent } from '../src/web-fetcher.mjs';
import { loginWithGoogle, loginWithEmail, registerWithEmail, verifyAuthToken, requireAuth, canUserSummarize, incrementUsage, refundUsage, getEntitlement } from '../src/auth.mjs';
import { resolveBrandId, isValidBrand, getBrand, listBrands } from '../src/brands.mjs';
import { ARCHITECTURE_VERSION, API_VERSION, ENVIRONMENT } from '../src/config.mjs';
import { apiErrorBody } from '../src/errors.mjs';

// Request id dell'invocazione corrente (Lambda: un'invocazione per container).
// Incluso nell'envelope di ogni risposta per correlazione client/log.
let currentRequestId = null;
import { handleGoogleAuth } from '../src/auth-google.mjs';
import { logSummaryEvent, logClientEvent, logEvent, ALLOWED_EVENT_TYPES, CLIENT_ALLOWED_EVENT_TYPES, getUserStats, getGlobalStats, getTrendingDomains } from '../src/analytics.mjs';
import { computePortfolioMetrics } from '../src/dashboard.mjs';
import { dashboardHtml } from '../src/dashboard-page.mjs';
import { getSecret } from '../src/secrets.mjs';
import { timingSafeEqual } from 'node:crypto';

// Confronto a tempo costante di due stringhe (per la chiave admin).
function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const ab = Buffer.from(a), bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
}
import { getCachedSummary, setCachedSummary, shouldCacheUrl, getCacheStats, cleanExpiredCache } from '../src/cache.mjs';
import { 
    createCheckoutSession, 
    verifyCheckoutSession, 
    handleStripeWebhook,
    getUserSubscription,
    cancelSubscription,
    reactivateSubscription,
    deleteUserSubscription,
    getBrandPricing
} from '../src/payments.mjs';
import { deleteUser } from '../src/dynamodb.mjs';

// Origins are deployment configuration.  Do not ship a fake extension ID or
// fall back to a wildcard: callers from an unlisted web origin receive no CORS
// permission. Chrome extension host permissions do not need a wildcard here.
const ALLOWED_ORIGINS = new Set(
    (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
);

function getCorsHeaders(event) {
    const origin = event.headers?.origin || event.headers?.Origin || '';
    const headers = {
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Brand,X-Client,X-Client-Version',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    };
    if (ALLOWED_ORIGINS.has(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers.Vary = 'Origin';
    }
    return headers;
}

// Factory function to create response handler bound to event
function withRequestId(body) {
    return (body && typeof body === 'object' && !Array.isArray(body))
        ? { request_id: currentRequestId, ...body }
        : body;
}

function createResponseFactory(event) {
    return (statusCode, body, additionalHeaders = {}) => {
        return {
            statusCode,
            headers: {
                ...getCorsHeaders(event),
                'Content-Type': 'application/json',
                ...additionalHeaders
            },
            body: JSON.stringify(withRequestId(body))
        };
    };
}

// Several routed handlers predate createResponseFactory. Keep their responses
// safe and consistent instead of letting them fail with ReferenceError.
function createResponse(statusCode, body, additionalHeaders = {}) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store',
            ...additionalHeaders
        },
        body: JSON.stringify(withRequestId(body))
    };
}

// Funzione per validare il payload
function validatePayload(body) {
    const errors = [];
    
    if (!body.url || typeof body.url !== 'string') {
        errors.push('URL è richiesto e deve essere una stringa');
    }
    
    if (!body.title || typeof body.title !== 'string') {
        errors.push('Title è richiesto e deve essere una stringa');
    }
    
    if (!body.text || typeof body.text !== 'string') {
        errors.push('Text è richiesto e deve essere una stringa');
    }
    
    if (body.text && body.text.length < 50) {
        errors.push('Il testo deve essere di almeno 50 caratteri');
    }
    
    if (body.text && body.text.length > 120000) {
        errors.push('Il testo non può superare i 120.000 caratteri');
    }
    
    const validLanguages = ['it', 'en', 'es', 'fr', 'de'];
    if (body.lang && !validLanguages.includes(body.lang)) {
        errors.push(`Lingua non supportata. Lingue valide: ${validLanguages.join(', ')}`);
    }
    
    return errors;
}

function isYouTubeUrl(value) {
    try {
        const hostname = new URL(value).hostname.replace(/^www\./, '');
        return hostname === 'youtube.com' || hostname === 'm.youtube.com' || hostname === 'youtu.be';
    } catch {
        return false;
    }
}

// Handler per l'endpoint /summarize
export async function summarizeHandler(event) {
    const createResponse = createResponseFactory(event);
    console.log('Summarize request received:', { method: event.httpMethod });

    try {
        // Gestione preflight CORS
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: getCorsHeaders(event),
                body: ''
            };
        }
        
        // Solo POST è supportato
        if (event.httpMethod !== 'POST') {
            return createResponse(405, {
                error: 'Metodo non supportato. Usa POST.'
            });
        }
        
        // Verifica presenza API key
        const apiKey = event.headers?.['x-api-key'] || event.headers?.['X-Api-Key'];
        if (!apiKey) {
            return createResponse(401, {
                error: 'API key mancante. Aggiungi header x-api-key.'
            });
        }
        
        // Parse del body
        let requestBody;
        try {
            requestBody = JSON.parse(event.body || '{}');
        } catch (error) {
            return createResponse(400, {
                error: 'Body JSON non valido'
            });
        }
        
        // Validazione payload
        const validationErrors = validatePayload(requestBody);
        if (validationErrors.length > 0) {
            return createResponse(400, {
                error: 'Dati non validi',
                details: validationErrors
            });
        }
        
        const { url, title, text, lang = 'it' } = requestBody;

        // Rate limiting check - CRITICAL for cost control
        try {
            await checkRateLimit(apiKey, resolveBrandId(event.headers?.['x-brand'] || event.headers?.['X-Brand']));
        } catch (rateLimitError) {
            return createResponse(429, {
                error: 'Rate limit superato. Riprova più tardi.',
                retryAfter: 60
            });
        }
        
        console.log('Processing authenticated summarize request');
        
        // Chiama OpenAI per il riassunto
        const summary = await summarizeWithOpenAI({
            url,
            title,
            text,
            language: lang
        });
        
        // Log per monitoraggio (senza il testo per privacy)
        console.log('Summary generated:', {
            url,
            title,
            language: lang,
            textLength: text.length,
            authenticated: true
        });
        
        return createResponse(200, {
            success: true,
            summary: summary.text,
            bullets: summary.text.split(/\r?\n/).filter(Boolean),
            stats: summary.stats,
            metadata: {
                url,
                title,
                language: lang,
                processedAt: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error in summarizeHandler:', error);
        
        // Gestione errori specifici
        if (error.message.includes('OpenAI')) {
            return createResponse(502, {
                error: 'Errore nel servizio di riassunto. Riprova più tardi.',
                code: 'OPENAI_ERROR'
            });
        }
        
        if (error.message.includes('rate limit')) {
            return createResponse(429, {
                error: 'Troppe richieste. Riprova più tardi.',
                retryAfter: 60
            });
        }
        
        return createResponse(500, {
            error: 'Errore interno del server',
            code: 'INTERNAL_ERROR'
        });
    }
}

// Handler per riassumere URL (con autenticazione)
export async function summarizeUrlHandler(event) {
    const startTime = Date.now();
    console.log('🚀 [TIMING] Handler started at:', new Date().toISOString());
    
    try {
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: getCorsHeaders(event),
                body: ''
            };
        }

        if (event.httpMethod !== 'POST') {
            return createResponse(405, { error: 'Metodo non supportato. Usa POST.' });
        }

        // Verifica autenticazione
        let user;
        try {
            user = await requireAuth(event);
        } catch (authError) {
            return createResponse(401, { error: authError.message, code: 'AUTH_REQUIRED' });
        }

        let body;
        const parseStartTime = Date.now();
        try {
            body = JSON.parse(event.body);
        } catch (error) {
            return createResponse(400, {
                error: 'Body della richiesta non valido',
                code: 'INVALID_JSON'
            });
        }
        console.log('⚡ [TIMING] JSON parse took:', Date.now() - parseStartTime, 'ms');
        
        if (!body.url || typeof body.url !== 'string') {
            return createResponse(400, {
                error: 'URL è richiesto e deve essere una stringa',
                code: 'MISSING_URL'
            });
        }

        // Brand: precedenza X-Brand header > body.brand > default. Quota e piano
        // sono indipendenti per brand. Un brand esplicito ma non valido è rifiutato.
        const rawBrand = event.headers?.['x-brand'] || event.headers?.['X-Brand'] || body.brand;
        if (rawBrand !== undefined && rawBrand !== null && rawBrand !== '' && !isValidBrand(rawBrand)) {
            return createResponse(400, apiErrorBody('INVALID_BRAND', { brand: rawBrand }));
        }
        const brandId = resolveBrandId(rawBrand);

        // Verifica limiti piano (per-brand)
        const usageCheck = canUserSummarize(user, brandId);
        if (!usageCheck.canSummarize) {
            return createResponse(429, apiErrorBody('USAGE_LIMIT_EXCEEDED', {
                error: usageCheck.reason,
                brand: brandId,
                plan: 'free',
                resetDate: usageCheck.resetDate
            }));
        }

        const hasTranscript = typeof body.transcript === 'string';
        // Client-extracted page text: the extension reads the already-rendered DOM
        // in the user's browser and sends the article text. Preferred over the
        // server re-fetch because JSDOM+Readability on large pages exceeded API
        // Gateway's hard 29s limit (HTTP 504) and the re-fetch saw a different page.
        const hasPageText = !hasTranscript && typeof body.text === 'string' && body.text.trim().length >= 50;
        const videoDurationSeconds = Number(body.videoDurationSeconds);
        if (isYouTubeUrl(body.url) && !hasTranscript) {
            return createResponse(422, {
                error: 'Trascrizione YouTube non ricevuta dall’estensione',
                code: 'YOUTUBE_TRANSCRIPT_REQUIRED'
            });
        }
        if (hasTranscript && (body.transcript.length < 50 || body.transcript.length > 120000)) {
            return createResponse(400, {
                error: 'La trascrizione deve contenere tra 50 e 120.000 caratteri',
                code: 'INVALID_TRANSCRIPT'
            });
        }
        if (body.videoDurationSeconds !== undefined && (!Number.isFinite(videoDurationSeconds) || videoDurationSeconds < 1 || videoDurationSeconds > 86400)) {
            return createResponse(400, { error: 'Durata video non valida', code: 'INVALID_VIDEO_DURATION' });
        }

        const language = body.lang || 'it';
        const summaryProfile = ['ultra', 'standard', 'detailed'].includes(body.summaryProfile)
            ? body.summaryProfile
            : 'standard';
        // squeeze = % del testo originale da mantenere nella sintesi (10/20/50). Default 20.
        const squeeze = [10, 20, 50].includes(Number(body.squeeze)) ? Number(body.squeeze) : 20;

        let text;
        let title;
        let fetchTime = 0;
        let videoDescription = '';
        let videoComments = [];
        if (hasTranscript) {
            text = body.transcript.trim();
            title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Video';
            videoDescription = typeof body.description === 'string' ? body.description.trim().slice(0, 5000) : '';
            videoComments = Array.isArray(body.comments)
                ? body.comments.filter((c) => typeof c === 'string' && c.trim()).map((c) => c.trim().slice(0, 500)).slice(0, 50)
                : [];
            console.log('Using client-provided video transcript:', { textLength: text.length, descriptionLength: videoDescription.length, comments: videoComments.length });
        } else if (hasPageText) {
            const MAX_CLIENT_TEXT = 50000;
            text = body.text.trim().slice(0, MAX_CLIENT_TEXT);
            title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Contenuto web';
            console.log('Using client-extracted page text:', { textLength: text.length });
        } else {
            console.log('🌐 [TIMING] Starting fetch for URL:', body.url);
            const fetchStartTime = Date.now();
            ({ text, title } = await fetchWebContent(body.url));
            fetchTime = Date.now() - fetchStartTime;
            console.log('⚡ [TIMING] Web fetch took:', fetchTime, 'ms');
        }
        
        if (!text || text.length < 50) {
            return createResponse(400, {
                error: 'Non è possibile estrarre contenuto sufficiente da questo URL',
                code: 'INSUFFICIENT_CONTENT'
            });
        }
        
        console.log(`📄 [TIMING] Extracted ${text.length} characters from URL`);

        const sourceType = hasTranscript ? 'video' : 'web';
        const brandConfig = getBrand(brandId);
        // Routing cost-aware: piano dell'utente per (brand) + lunghezza contenuto.
        // Calcolato qui così la cache key riflette il modello effettivo.
        const summaryModel = selectSummaryModel({
            requestedModel: body.summaryModel,
            plan: getEntitlement(user, brandId).plan,
            wordCount: text.trim().split(/\s+/).filter(Boolean).length
        });
        const cacheInput = {
            brandId,
            promptProfile: brandConfig.promptProfile,
            outputSchema: brandConfig.outputSchema,
            url: body.url,
            text,
            language,
            summaryProfile,
            squeeze,
            model: summaryModel,
            sourceType,
            videoDurationSeconds: hasTranscript ? videoDurationSeconds : 0,
            description: hasTranscript ? videoDescription : '',
            comments: hasTranscript ? videoComments : []
        };
        // Prenotazione atomica della quota PRIMA di OpenAI (anti-race + anti-abuso costo):
        // se già al limite → 429; refund se il summary a valle fallisce.
        try {
            user = await incrementUsage(user, brandId);
        } catch (e) {
            if (e.code === 'USAGE_LIMIT_REACHED') {
                const entLim = getEntitlement(user, brandId);
                return createResponse(429, apiErrorBody('USAGE_LIMIT_EXCEEDED', {
                    error: 'Limite giornaliero raggiunto', brand: brandId, plan: 'free', resetDate: entLim.usage.resetDate
                }));
            }
            throw e;
        }

        // Cache solo per lo schema summary (Lemon): gli schemi strutturati (es. Scout)
        // hanno un payload diverso e per ora non vengono cache-ati.
        const cacheable = shouldCacheUrl(body.url) && brandConfig.outputSchema === 'summary';
        if (cacheable) {
            const cacheStartTime = Date.now();
            const cachedSummary = await getCachedSummary(cacheInput);
            if (cachedSummary) {
                console.log('✅ [CACHE] Content hash hit:', { elapsedMs: Date.now() - cacheStartTime });
                // Quota già prenotata sopra; il cache-hit consuma la prenotazione.
                const entHit = getEntitlement(user, brandId);
                return createResponse(200, {
                    summary: cachedSummary.summary,
                    readingTimeMinutes: cachedSummary.readingTimeMinutes,
                    wordsCount: cachedSummary.wordsCount,
                    stats: cachedSummary.stats,
                    url: body.url,
                    title: title || cachedSummary.title,
                    sourceType,
                    videoDurationSeconds: hasTranscript ? videoDurationSeconds : undefined,
                    cached: true,
                    cachedAt: cachedSummary.cachedAt,
                    cacheHits: cachedSummary.cacheHits,
                    user: { usage: entHit.usage, plan: entHit.plan }
                });
            }
            console.log('❌ [CACHE] Content hash miss:', { elapsedMs: Date.now() - cacheStartTime });
        }
        
        const openaiStartTime = Date.now();
        console.log('🤖 [TIMING] Starting OpenAI call...');
        let summary;
        try {
            summary = await summarizeWithOpenAI({
                url: body.url,
                title: title,
                text: text,
                language: body.lang || 'it',
                brand: brandId,
                sourceType,
                summaryProfile,
                squeeze,
                model: summaryModel,
                videoDurationSeconds: hasTranscript ? videoDurationSeconds : undefined,
                description: hasTranscript ? videoDescription : undefined,
                comments: hasTranscript ? videoComments : undefined
            });
        } catch (err) {
            // Summary fallito dopo la prenotazione → refund della quota.
            await refundUsage(user, brandId);
            throw err;
        }
        const openaiTime = Date.now() - openaiStartTime;
        console.log('⚡ [TIMING] OpenAI call took:', openaiTime, 'ms');

        console.log('Summary object received:', JSON.stringify(summary, null, 2));

        if (!summary || (!summary.text && !summary.output)) {
            console.error('Summary object is invalid:', summary);
            await refundUsage(user, brandId); // refund: prenotazione non onorata
            return createResponse(500, {
                error: 'Risposta OpenAI non valida',
                code: 'INVALID_OPENAI_RESPONSE'
            });
        }

        // Quota già prenotata prima di OpenAI; qui riflettiamo solo lo stato aggiornato.
        const entitlement = getEntitlement(user, brandId);

        // 💾 SALVA IN CACHE SE POSSIBILE (solo schema summary)
        if (cacheable && summary.text) {
            console.log('💾 [CACHE] Saving to cache...');
            try {
                const processingTime = Date.now() - startTime;
                await setCachedSummary(cacheInput, {
                    title: title || 'Contenuto web',
                    summary: summary.text,
                    readingTimeMinutes: summary.readingTimeMinutes,
                    wordsCount: summary.wordsCount,
                    stats: summary.stats,
                    charsInput: text.length,
                    processingTimeMs: processingTime
                });
                console.log('✅ [CACHE] Successfully cached summary');
            } catch (cacheError) {
                console.warn('⚠️ [CACHE] Failed to save to cache:', cacheError.message);
                // Non fallire per errori di cache
            }
        }

        // Log analytics event
        try {
            const analyticsTime = Date.now() - startTime;
            await logSummaryEvent({
                userId: user.id,
                userEmail: user.email,
                userPlan: entitlement.plan,
                brandId,
                url: body.url,
                title: title || 'Contenuto web',
                language: language,
                charsInput: text.length,
                charsOutput: summary.text ? summary.text.length : JSON.stringify(summary.output || {}).length,
                inputTokens: summary.usage?.input_tokens || 0,
                outputTokens: summary.usage?.output_tokens || 0,
                costEstimate: summary.usage?.cost_estimate || 0,
                durationMs: analyticsTime,
                userAgent: event.headers?.['User-Agent'],
                browser: event.headers?.['x-client'] || event.headers?.['X-Client'],
                clientVersion: event.headers?.['x-client-version'] || event.headers?.['X-Client-Version'],
                success: true
            });
        } catch (analyticsError) {
            console.warn('Analytics logging failed:', analyticsError.message);
            // Non fallire il riassunto per errori analytics
        }
        
        const totalTime = Date.now() - startTime;
        console.log('🏁 [TIMING] Total request time:', totalTime, 'ms');
        console.log('📊 [TIMING] Breakdown - Fetch:', fetchTime, 'ms, OpenAI:', openaiTime, 'ms, Other:', totalTime - fetchTime - openaiTime, 'ms');
        
        // Schema summary (Lemon): risposta legacy invariata. Altri schemi (es. Scout):
        // envelope generico con `output` strutturato.
        const baseResponse = {
            url: body.url,
            title: title || 'Contenuto web',
            sourceType: hasTranscript ? 'video' : 'web',
            videoDurationSeconds: hasTranscript && Number.isFinite(videoDurationSeconds) ? videoDurationSeconds : undefined,
            brand: brandId,
            user: { usage: entitlement.usage, plan: entitlement.plan }
        };
        if (summary.text) {
            return createResponse(200, {
                ...baseResponse,
                summary: summary.text,
                readingTimeMinutes: summary.readingTimeMinutes,
                wordsCount: summary.wordsCount,
                stats: summary.stats
            });
        }
        return createResponse(200, {
            ...baseResponse,
            schema: summary.schema,
            output: summary.output,
            stats: summary.stats
        });
        
    } catch (error) {
        console.error('Error in summarizeUrlHandler:', error);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        
        if (error.message.includes('Failed to fetch')) {
            return createResponse(400, {
                error: 'Non è possibile accedere all\'URL specificato',
                code: 'URL_NOT_ACCESSIBLE'
            });
        }
        
        if (error.message.includes('rate limit')) {
            return createResponse(429, {
                error: 'Troppe richieste. Riprova più tardi.',
                retryAfter: 60
            });
        }
        
        return createResponse(500, {
            error: 'Errore nel processare l\'URL: ' + error.message,
            code: 'PROCESSING_ERROR'
        });
    }
}



// Handler per verificare token di autenticazione
export async function authVerifyHandler(event) {
    try {
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: getCorsHeaders(event),
                body: ''
            };
        }
        
        if (event.httpMethod !== 'POST') {
            return createResponse(405, { error: 'Metodo non supportato. Usa POST.' });
        }
        
        // Estrai token dall'header Authorization
        const authHeader = event.headers['Authorization'] || event.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return createResponse(401, { error: 'Token di autorizzazione mancante' });
        }
        
        const token = authHeader.substring(7);
        
        // Verifica token
        const user = await verifyAuthToken(token);
        
        return createResponse(200, {
            id: user.id,
            email: user.email,
            name: user.name,
            picture: user.picture,
            plan: user.plan,
            usage: user.usage,
            valid: true
        });
        
    } catch (error) {
        console.error('Error in authVerifyHandler:', error);
        return createResponse(401, { 
            error: 'Token non valido: ' + error.message,
            valid: false
        });
    }
}

// Handler per login legacy (placeholder)
export async function authLoginHandler(event) {
    try {
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: getCorsHeaders(event),
                body: ''
            };
        }
        
        if (event.httpMethod !== 'POST') {
            return createResponse(405, { error: 'Metodo non supportato. Usa POST.' });
        }

        let body;
        try {
            body = JSON.parse(event.body || '{}');
        } catch {
            return createResponse(400, { error: 'Body della richiesta non valido', code: 'INVALID_JSON' });
        }

        const { email, password } = body;
        if (!email || !password) {
            return createResponse(400, { error: 'Email e password richieste' });
        }

        const result = await loginWithEmail(email, password);
        const { authToken, ...user } = result;

        return createResponse(200, {
            authToken,
            user
        });
    } catch (error) {
        console.error('Error in authLoginHandler:', error);
        const message = error.message || 'Login fallito';
        const status = message.includes('Credenziali') ? 401 : 400;
        return createResponse(status, { error: message });
    }
}

export async function authRegisterHandler(event) {
    try {
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: getCorsHeaders(event),
                body: ''
            };
        }
        
        if (event.httpMethod !== 'POST') {
            return createResponse(405, { error: 'Metodo non supportato. Usa POST.' });
        }

        let body;
        try {
            body = JSON.parse(event.body || '{}');
        } catch {
            return createResponse(400, { error: 'Body della richiesta non valido', code: 'INVALID_JSON' });
        }

        const { email, password, name } = body;
        if (!email || !password) {
            return createResponse(400, { error: 'Email e password richieste' });
        }

        const result = await registerWithEmail(email, password, name);
        const { authToken, ...user } = result;

        return createResponse(201, {
            authToken,
            user
        });
    } catch (error) {
        console.error('Error in authRegisterHandler:', error);
        return createResponse(400, { error: error.message || 'Registrazione fallita' });
    }
}

// Handler per health check
export async function healthHandler(event) {
    return createResponse(200, {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        architectureVersion: ARCHITECTURE_VERSION,
        apiVersion: API_VERSION,
        environment: ENVIRONMENT,
        brands: listBrands()
    });
}

// Handler cancellazione account (E14-008): rimuove utente + subscription.
// La cronologia è client-side (chrome.storage), non lato server.
export async function accountDeleteHandler(event) {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: getCorsHeaders(event), body: '' };
    }
    let user;
    try {
        user = await requireAuth(event);
    } catch (authError) {
        return createResponse(401, apiErrorBody('AUTH_REQUIRED'));
    }
    try {
        await deleteUserSubscription(user.id); // best-effort (non blocca)
        await deleteUser(user.id);
        console.log('Account deleted:', user.id);
        return createResponse(200, { deleted: true, userId: user.id });
    } catch (error) {
        console.error('Account deletion error:', error.message);
        return createResponse(500, apiErrorBody('INTERNAL_ERROR'));
    }
}

// Handler ingestione eventi funnel dal client (estensione). Solo metadati.
// Auth opzionale: se presente attribuisce all'utente, altrimenti anonimo.
export async function analyticsEventHandler(event) {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: getCorsHeaders(event), body: '' };
    }
    if (event.httpMethod !== 'POST') {
        return createResponse(405, apiErrorBody('INTERNAL_ERROR', { error: 'Metodo non supportato. Usa POST.' }));
    }
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return createResponse(400, apiErrorBody('INVALID_JSON')); }

    if (!CLIENT_ALLOWED_EVENT_TYPES.has(body.event_type)) {
        return createResponse(400, apiErrorBody('INVALID_REQUEST', { error: 'event_type non valido o non consentito dal client', allowed: [...CLIENT_ALLOWED_EVENT_TYPES] }));
    }
    const rawBrand = event.headers?.['x-brand'] || event.headers?.['X-Brand'] || body.brand;
    if (rawBrand && !isValidBrand(rawBrand)) {
        return createResponse(400, apiErrorBody('INVALID_BRAND', { brand: rawBrand }));
    }
    const brandId = resolveBrandId(rawBrand);

    // Auth opzionale
    let user = null;
    try { user = await requireAuth(event); } catch { /* anonimo */ }

    const eventId = await logClientEvent({
        eventType: body.event_type,
        userId: user?.id || null,
        userEmail: user?.email || null,
        userPlan: user ? getEntitlement(user, brandId).plan : null,
        brandId,
        url: typeof body.url === 'string' ? body.url : undefined,
        browser: event.headers?.['x-client'] || event.headers?.['X-Client'],
        clientVersion: event.headers?.['x-client-version'] || event.headers?.['X-Client-Version']
    });
    return createResponse(200, { logged: !!eventId, event_id: eventId, event_type: body.event_type, brand: brandId });
}

// Autorizzazione dashboard: chiave admin (header X-Admin-Key o ?key=) OPPURE JWT admin.
// La chiave (SSM /reading-intelligence/<env>/dashboard-admin-key) rende la dashboard usabile
// con una sola URL bookmarkabile, senza login né estrazione di token.
async function dashboardAuthorized(event) {
    const provided = event.headers?.['x-admin-key'] || event.headers?.['X-Admin-Key'] || event.queryStringParameters?.key;
    if (provided) {
        try { const key = await getSecret('DASHBOARD_ADMIN_KEY'); if (key && safeEqual(provided, key)) return true; }
        catch { /* chiave non configurata */ }
    }
    try { const u = await requireAuth(event); if (u && u.role === 'admin') return true; }
    catch { /* non admin */ }
    return false;
}

// Dashboard interna (#4): metriche portfolio per brand. Gated da chiave admin o JWT admin.
export async function adminMetricsHandler(event) {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: getCorsHeaders(event), body: '' };
    }
    if (event.httpMethod !== 'GET') {
        return createResponse(405, apiErrorBody('INTERNAL_ERROR', { error: 'Metodo non supportato. Usa GET.' }));
    }
    if (!(await dashboardAuthorized(event))) {
        return createResponse(401, { error: 'Chiave admin mancante o non valida', code: 'ADMIN_REQUIRED' });
    }
    const q = event.queryStringParameters || {};
    const days = Math.min(Math.max(parseInt(q.days || '30', 10) || 30, 1), 365);
    const brand = q.brand && isValidBrand(q.brand) ? q.brand : null;

    const metrics = await computePortfolioMetrics({ days });
    if (brand) {
        return createResponse(200, {
            period: metrics.period, assumptions: metrics.assumptions,
            brand, metrics: metrics.brands[brand],
            comparison: metrics.comparison.filter(c => c.brand === brand)
        });
    }
    return createResponse(200, metrics);
}

// Prezzi pubblici (single-source): importi reali da Stripe (fallback finché i Price
// non esistono). Nessun auth; CORS aperto perché letto dal sito marketing cross-origin.
export async function pricingHandler(event) {
    const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,X-Brand'
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
    if (event.httpMethod !== 'GET') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Usa GET' }) };
    const json = (obj) => ({ statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
    // Non esporre `source` (stripe|fallback) nel payload pubblico.
    const pub = (p) => ({ brand: p.brand, monthly: pubPlan(p.monthly), yearly: pubPlan(p.yearly) });
    const pubPlan = (x) => ({ amount: x.amount, currency: x.currency, interval: x.interval });
    try {
        const q = event.queryStringParameters || {};
        if (q.brand) {
            if (!isValidBrand(q.brand)) return { statusCode: 400, headers: cors, body: JSON.stringify(apiErrorBody('INVALID_BRAND', { brand: q.brand })) };
            return json(pub(await getBrandPricing(q.brand)));
        }
        const brands = {};
        for (const b of listBrands()) brands[b] = pub(await getBrandPricing(b));
        return json({ brands });
    } catch (e) {
        console.error('Error in pricingHandler:', e);
        return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Errore recupero prezzi' }) };
    }
}

// Dashboard interna (#4): shell HTML servita same-origin (i fetch a /admin/metrics
// non passano da CORS). La pagina chiede il token admin; nessun dato inline.
export async function adminDashboardHandler(event) {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: getCorsHeaders(event), body: '' };
    }
    return {
        statusCode: 200,
        headers: { ...getCorsHeaders(event), 'Content-Type': 'text/html; charset=utf-8' },
        body: dashboardHtml()
    };
}

// Handler per statistiche utente
export async function userStatsHandler(event) {
    try {
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: getCorsHeaders(event),
                body: ''
            };
        }
        
        if (event.httpMethod !== 'GET') {
            return createResponse(405, { error: 'Metodo non supportato. Usa GET.' });
        }

        // Verifica autenticazione
        const user = await requireAuth(event);
        
        // Ottieni parametri query
        const days = parseInt(event.queryStringParameters?.days || '30', 10);
        
        if (days < 1 || days > 365) {
            return createResponse(400, { error: 'Il parametro days deve essere tra 1 e 365' });
        }
        
        const stats = await getUserStats(user.id, days);
        
        return createResponse(200, {
            stats,
            user: {
                id: user.id,
                email: user.email,
                plan: user.plan
            },
            period: `${days} giorni`
        });
        
    } catch (error) {
        console.error('Error in userStatsHandler:', error);
        
        if (error.message.includes('Token non valido') || error.message.includes('autorizzazione mancante')) {
            return createResponse(401, { error: error.message, code: 'AUTH_REQUIRED' });
        }
        
        return createResponse(500, { error: 'Errore recupero statistiche utente' });
    }
}

// Handler per statistiche globali (admin only)
export async function globalStatsHandler(event) {
    try {
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: getCorsHeaders(event),
                body: ''
            };
        }
        
        if (event.httpMethod !== 'GET') {
            return createResponse(405, { error: 'Metodo non supportato. Usa GET.' });
        }

        // Verifica autenticazione e autorizzazione admin
        const user = await requireAuth(event);

        // Admin authorization check - required for sensitive analytics
        if (user.role !== 'admin') {
            return createResponse(403, {
                error: 'Accesso riservato agli amministratori',
                code: 'ADMIN_REQUIRED'
            });
        }
        
        const days = parseInt(event.queryStringParameters?.days || '7', 10);
        
        if (days < 1 || days > 90) {
            return createResponse(400, { error: 'Il parametro days deve essere tra 1 e 90' });
        }
        
        const stats = await getGlobalStats(days);
        
        return createResponse(200, {
            stats,
            period: `${days} giorni`,
            generated_at: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error in globalStatsHandler:', error);
        
        if (error.message.includes('Token non valido') || error.message.includes('autorizzazione mancante')) {
            return createResponse(401, { error: error.message, code: 'AUTH_REQUIRED' });
        }
        
        return createResponse(500, { error: 'Errore recupero statistiche globali' });
    }
}

// Handler per trending domains
export async function trendingDomainsHandler(event) {
    try {
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: getCorsHeaders(event),
                body: ''
            };
        }
        
        if (event.httpMethod !== 'GET') {
            return createResponse(405, { error: 'Metodo non supportato. Usa GET.' });
        }

        // Endpoint pubblico - no auth required
        const days = parseInt(event.queryStringParameters?.days || '7', 10);
        const limit = parseInt(event.queryStringParameters?.limit || '20', 10);
        
        if (days < 1 || days > 30) {
            return createResponse(400, { error: 'Il parametro days deve essere tra 1 e 30' });
        }
        
        if (limit < 1 || limit > 100) {
            return createResponse(400, { error: 'Il parametro limit deve essere tra 1 e 100' });
        }
        
        const trending = await getTrendingDomains(days, limit);
        
        return createResponse(200, {
            trending_domains: trending,
            period: `${days} giorni`,
            limit,
            generated_at: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error in trendingDomainsHandler:', error);
        return createResponse(500, { error: 'Errore recupero domini trending' });
    }
}

// Handler per statistiche cache
export async function cacheStatsHandler(event) {
    try {
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: getCorsHeaders(event),
                body: ''
            };
        }
        
        if (event.httpMethod !== 'GET') {
            return createResponse(405, { error: 'Metodo non supportato. Usa GET.' });
        }

        // Richiede autenticazione admin (per ora qualsiasi utente autenticato)
        const user = await requireAuth(event);
        
        const stats = await getCacheStats();
        
        return createResponse(200, {
            cache_stats: stats,
            generated_at: new Date().toISOString(),
            generated_by: user.email
        });
        
    } catch (error) {
        console.error('Error in cacheStatsHandler:', error);
        
        if (error.message.includes('Token non valido') || error.message.includes('autorizzazione mancante')) {
            return createResponse(401, { error: error.message, code: 'AUTH_REQUIRED' });
        }
        
        return createResponse(500, { error: 'Errore recupero statistiche cache' });
    }
}

// Handler per pulizia cache
export async function cleanCacheHandler(event) {
    try {
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: getCorsHeaders(event),
                body: ''
            };
        }
        
        if (event.httpMethod !== 'POST') {
            return createResponse(405, { error: 'Metodo non supportato. Usa POST.' });
        }

        // Richiede autenticazione admin
        const user = await requireAuth(event);
        
        const result = await cleanExpiredCache();
        
        return createResponse(200, {
            result,
            cleaned_at: new Date().toISOString(),
            cleaned_by: user.email
        });
        
    } catch (error) {
        console.error('Error in cleanCacheHandler:', error);
        
        if (error.message.includes('Token non valido') || error.message.includes('autorizzazione mancante')) {
            return createResponse(401, { error: error.message, code: 'AUTH_REQUIRED' });
        }
        
        return createResponse(500, { error: 'Errore pulizia cache' });
    }
}

// Handler per creare sessione checkout Stripe
export async function createCheckoutHandler(event) {
    try {
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: getCorsHeaders(event),
                body: ''
            };
        }
        
        if (event.httpMethod !== 'POST') {
            return createResponse(405, { error: 'Metodo non supportato. Usa POST.' });
        }

        // Richiede autenticazione
        const user = await requireAuth(event);
        
        let body;
        try {
            body = JSON.parse(event.body);
        } catch (error) {
            return createResponse(400, { error: 'Body della richiesta non valido', code: 'INVALID_JSON' });
        }

        const planType = body.planType || 'premium_monthly';

        if (!['premium_monthly', 'premium_yearly'].includes(planType)) {
            return createResponse(400, { error: 'Piano non valido. Usa premium_monthly o premium_yearly.' });
        }

        // Brand corrente: checkout crea la subscription del brand giusto (vita commerciale separata).
        const checkoutBrand = resolveBrandId(event.headers?.['x-brand'] || event.headers?.['X-Brand'] || body.brand);
        const checkoutSession = await createCheckoutSession(user.id, user.email, checkoutBrand, planType);
        // Funnel: avvio checkout (best-effort, metadati soltanto).
        await logEvent({
            eventType: 'checkout_started', source: 'server', userId: user.id,
            userEmail: user.email, userPlan: getEntitlement(user, checkoutBrand).plan, brandId: checkoutBrand
        });

        return createResponse(200, {
            checkout_session: checkoutSession,
            user: {
                id: user.id,
                email: user.email,
                currentPlan: user.plan
            }
        });
        
    } catch (error) {
        console.error('Error in createCheckoutHandler:', error);
        
        if (error.message.includes('Token non valido') || error.message.includes('autorizzazione mancante')) {
            return createResponse(401, { error: error.message, code: 'AUTH_REQUIRED' });
        }
        
        return createResponse(500, { error: 'Errore creazione sessione pagamento: ' + error.message });
    }
}

// Handler per verificare sessione checkout
export async function verifyCheckoutHandler(event) {
    try {
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: getCorsHeaders(event),
                body: ''
            };
        }
        
        if (event.httpMethod !== 'POST') {
            return createResponse(405, { error: 'Metodo non supportato. Usa POST.' });
        }

        let body;
        try {
            body = JSON.parse(event.body);
        } catch (error) {
            return createResponse(400, { error: 'Body della richiesta non valido', code: 'INVALID_JSON' });
        }

        if (!body.sessionId) {
            return createResponse(400, { error: 'sessionId richiesto' });
        }

        const verification = await verifyCheckoutSession(body.sessionId);
        
        return createResponse(200, {
            verification,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error in verifyCheckoutHandler:', error);
        return createResponse(500, { error: 'Errore verifica sessione pagamento: ' + error.message });
    }
}

// Handler per webhook Stripe
export const stripeWebhookHandler = async (event) => {
    try {
        console.log('Stripe webhook received');
        
        // Normalizza headers case-insensitive
        const headers = Object.fromEntries(
            Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v])
        );
        
        const signature = headers['stripe-signature'];
        
        if (!signature) {
            console.error('Missing Stripe signature in headers');
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing Stripe signature' })
            };
        }

        // event.body arriva RAW da Function URL - NON modificare
        const rawBody = event.body;
        
        const result = await handleStripeWebhook(rawBody, signature);
        console.log('Stripe webhook processed successfully');
        
        return {
            statusCode: 200,
            body: JSON.stringify(result)
        };
        
    } catch (error) {
        console.error('Error in stripeWebhookHandler:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};

// Handler per ottenere subscription utente
export async function getUserSubscriptionHandler(event) {
    try {
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: getCorsHeaders(event),
                body: ''
            };
        }
        
        if (event.httpMethod !== 'GET') {
            return createResponse(405, { error: 'Metodo non supportato. Usa GET.' });
        }

        // Richiede autenticazione
        const user = await requireAuth(event);
        
        const subscription = await getUserSubscription(user.id);
        
        return createResponse(200, {
            user: {
                id: user.id,
                email: user.email,
                plan: user.plan,
                usage: user.usage
            },
            subscription: subscription || null,
            has_active_subscription: subscription && subscription.status === 'active'
        });
        
    } catch (error) {
        console.error('Error in getUserSubscriptionHandler:', error);
        
        if (error.message.includes('Token non valido') || error.message.includes('autorizzazione mancante')) {
            return createResponse(401, { error: error.message, code: 'AUTH_REQUIRED' });
        }
        
        return createResponse(500, { error: 'Errore recupero subscription: ' + error.message });
    }
}

// Handler per cancellare subscription
export async function cancelSubscriptionHandler(event) {
    try {
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: getCorsHeaders(event),
                body: ''
            };
        }
        
        if (event.httpMethod !== 'POST') {
            return createResponse(405, { error: 'Metodo non supportato. Usa POST.' });
        }

        // Richiede autenticazione
        const user = await requireAuth(event);
        
        const result = await cancelSubscription(user.id);
        
        return createResponse(200, {
            result,
            user: {
                id: user.id,
                email: user.email
            },
            canceled_at: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error in cancelSubscriptionHandler:', error);
        
        if (error.message.includes('Token non valido') || error.message.includes('autorizzazione mancante')) {
            return createResponse(401, { error: error.message, code: 'AUTH_REQUIRED' });
        }
        
        return createResponse(500, { error: 'Errore cancellazione subscription: ' + error.message });
    }
}

// Handler principale (router)
export async function handler(event, context) {
    currentRequestId = event?.requestContext?.requestId || context?.awsRequestId || null;
    console.log('Request received:', { path: event.path || event.rawPath, method: event.httpMethod, requestId: currentRequestId });

    const path = event.path || event.rawPath;
    
    switch (path) {
        case '/summarize':
            return await summarizeHandler(event);
        case '/summarize-url':
            return await summarizeUrlHandler(event);
        case '/auth/google':
            return await handleGoogleAuth(event);
        case '/auth/login':
            return await authLoginHandler(event);
        case '/auth/register':
            return await authRegisterHandler(event);
        case '/auth/verify':
            return await authVerifyHandler(event);
        case '/analytics/user-stats':
            return await userStatsHandler(event);
        case '/analytics/global-stats':
            return await globalStatsHandler(event);
        case '/analytics/trending-domains':
            return await trendingDomainsHandler(event);
        case '/cache/stats':
            return await cacheStatsHandler(event);
        case '/cache/clean':
            return await cleanCacheHandler(event);
        case '/payments/create-checkout':
            return await createCheckoutHandler(event);
        case '/payments/verify-checkout':
            return await verifyCheckoutHandler(event);
        case '/payments/webhook':
            return await stripeWebhookHandler(event);
        case '/payments/subscription':
            return await getUserSubscriptionHandler(event);
        case '/payments/cancel':
            return await cancelSubscriptionHandler(event);
        case '/health':
            return await healthHandler(event);
        case '/account/delete':
            return await accountDeleteHandler(event);
        case '/analytics/event':
            return await analyticsEventHandler(event);
        case '/admin/metrics':
            return await adminMetricsHandler(event);
        case '/admin/dashboard':
            return await adminDashboardHandler(event);
        case '/pricing':
            return await pricingHandler(event);
        default:
            return createResponse(404, {
                error: 'Endpoint non trovato',
                availableEndpoints: [
                    '/summarize', 
                    '/summarize-url',
                    '/auth/google',
                    '/auth/login',
                    '/auth/register',
                    '/auth/verify',
                    '/analytics/user-stats',
                    '/analytics/global-stats', 
                    '/analytics/trending-domains',
                    '/cache/stats',
                    '/cache/clean',
                    '/payments/create-checkout',
                    '/payments/verify-checkout',
                    '/payments/webhook',
                    '/payments/subscription',
                    '/payments/cancel',
                    '/account/delete',
                    '/analytics/event',
                    '/health'
                ]
            });
    }
}
