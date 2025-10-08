// handler.mjs - Entry point per AWS Lambda - Updated 2025-09-28 with stats
import { summarizeWithOpenAI } from '../src/openai.mjs';
import { validateSubscription } from '../src/subscription.mjs';
import { checkRateLimit } from '../src/rate-limit.mjs';
import { fetchWebContent } from '../src/web-fetcher.mjs';
import { loginWithGoogle, verifyAuthToken, requireAuth, canUserSummarize, incrementUsage } from '../src/auth.mjs';
import { logSummaryEvent, getUserStats, getGlobalStats, getTrendingDomains } from '../src/analytics.mjs';
import { getCachedSummary, setCachedSummary, shouldCacheUrl, getCacheStats, cleanExpiredCache } from '../src/cache.mjs';
import { 
    createCheckoutSession, 
    verifyCheckoutSession, 
    handleStripeWebhook,
    getUserSubscription,
    cancelSubscription,
    reactivateSubscription 
} from '../src/payments.mjs';

// Configurazione CORS
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,x-api-key',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

// Risposta CORS per preflight
const corsResponse = {
    statusCode: 200,
    headers: corsHeaders,
    body: ''
};

// Funzione per creare una risposta JSON
function createResponse(statusCode, body, additionalHeaders = {}) {
    return {
        statusCode,
        headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            ...additionalHeaders
        },
        body: JSON.stringify(body)
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

// Handler per l'endpoint /summarize
export async function summarizeHandler(event) {
    console.log('Request:', JSON.stringify(event, null, 2));
    
    try {
        // Gestione preflight CORS
        if (event.httpMethod === 'OPTIONS') {
            return corsResponse;
        }
        
        // Solo POST è supportato
        if (event.httpMethod !== 'POST') {
            return createResponse(405, {
                error: 'Metodo non supportato. Usa POST.'
            });
        }
        
        // Verifica presenza API key
        const apiKey = event.headers['x-api-key'] || event.headers['X-Api-Key'];
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
        
        // Per la versione semplificata, saltiamo subscription e rate limiting
        // In futuro qui andrà la validazione subscription completa
        // const isValidSubscription = await validateSubscription(apiKey);
        // if (!isValidSubscription) {
        //     return createResponse(403, {
        //         error: 'Subscription non valida o scaduta'
        //     });
        // }
        
        // Rate limiting semplificato (per ora solo log)
        // try {
        //     await checkRateLimit(apiKey);
        // } catch (rateLimitError) {
        //     return createResponse(429, {
        //         error: 'Rate limit superato. Riprova più tardi.',
        //         retryAfter: 60
        //     });
        // }
        
        console.log(`Processing request for API key: ${apiKey.substring(0, 8)}...`)
        
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
            apiKeyPrefix: apiKey.substring(0, 8) + '...'
        });
        
        return createResponse(200, {
            success: true,
            summary: summary.summary,
            bullets: summary.bullets,
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
            return corsResponse;
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

        // Verifica limiti piano
        const usageCheck = canUserSummarize(user);
        if (!usageCheck.canSummarize) {
            return createResponse(429, { 
                error: usageCheck.reason, 
                code: 'USAGE_LIMIT_EXCEEDED',
                resetDate: usageCheck.resetDate
            });
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

        const language = body.lang || 'it';

        // 🚀 CONTROLLO CACHE PRIMA DEL PROCESSING
        if (shouldCacheUrl(body.url)) {
            console.log('🔍 [CACHE] Checking cache for URL...');
            const cacheStartTime = Date.now();
            
            const cachedSummary = await getCachedSummary(body.url, language);
            const cacheCheckTime = Date.now() - cacheStartTime;
            
            if (cachedSummary) {
                console.log('✅ [CACHE] Cache HIT! Returning cached summary');
                console.log('⚡ [TIMING] Cache check took:', cacheCheckTime, 'ms');
                
                // Incrementa contatore utilizzo
                user = await incrementUsage(user);
                
                const totalTime = Date.now() - startTime;
                
                // Log analytics per cache hit
                try {
                    await logSummaryEvent({
                        userId: user.id,
                        userEmail: user.email,
                        userPlan: user.plan,
                        url: body.url,
                        title: cachedSummary.title,
                        language: language,
                        charsInput: 0, // Non disponibile per cache hit
                        charsOutput: cachedSummary.summary.length,
                        durationMs: totalTime,
                        userAgent: event.headers?.['User-Agent'],
                        success: true
                    });
                } catch (analyticsError) {
                    console.warn('Analytics logging failed:', analyticsError.message);
                }
                
                return createResponse(200, {
                    summary: cachedSummary.summary,
                    readingTimeMinutes: cachedSummary.readingTimeMinutes,
                    wordsCount: cachedSummary.wordsCount,
                    stats: cachedSummary.stats,
                    url: body.url,
                    title: cachedSummary.title,
                    cached: true,
                    cachedAt: cachedSummary.cachedAt,
                    cacheHits: cachedSummary.cacheHits,
                    user: {
                        usage: user.usage,
                        plan: user.plan
                    }
                });
            } else {
                console.log('❌ [CACHE] Cache MISS - proceeding with normal processing');
                console.log('⚡ [TIMING] Cache check took:', cacheCheckTime, 'ms');
            }
        } else {
            console.log('🚫 [CACHE] URL not cacheable - proceeding with normal processing');
        }
        
        console.log('🌐 [TIMING] Starting fetch for URL:', body.url);
        const fetchStartTime = Date.now();
        
        // Fetch del contenuto della pagina
        const { text, title } = await fetchWebContent(body.url);
        const fetchTime = Date.now() - fetchStartTime;
        console.log('⚡ [TIMING] Web fetch took:', fetchTime, 'ms');
        
        if (!text || text.length < 50) {
            return createResponse(400, {
                error: 'Non è possibile estrarre contenuto sufficiente da questo URL',
                code: 'INSUFFICIENT_CONTENT'
            });
        }
        
        console.log(`📄 [TIMING] Extracted ${text.length} characters from URL`);
        
        const openaiStartTime = Date.now();
        console.log('🤖 [TIMING] Starting OpenAI call...');
        const summary = await summarizeWithOpenAI({
            url: body.url,
            title: title,
            text: text,
            language: body.lang || 'it'
        });
        const openaiTime = Date.now() - openaiStartTime;
        console.log('⚡ [TIMING] OpenAI call took:', openaiTime, 'ms');
        
        console.log('Summary object received:', JSON.stringify(summary, null, 2));
        
        if (!summary || !summary.text) {
            console.error('Summary object is invalid:', summary);
            return createResponse(500, {
                error: 'Risposta OpenAI non valida',
                code: 'INVALID_OPENAI_RESPONSE'
            });
        }
        
        // Incrementa contatore utilizzo
        user = await incrementUsage(user);

        // 💾 SALVA IN CACHE SE POSSIBILE
        if (shouldCacheUrl(body.url)) {
            console.log('💾 [CACHE] Saving to cache...');
            try {
                const processingTime = Date.now() - startTime;
                await setCachedSummary(body.url, language, {
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
                userPlan: user.plan,
                url: body.url,
                title: title || 'Contenuto web',
                language: language,
                charsInput: text.length,
                charsOutput: summary.text.length,
                durationMs: analyticsTime,
                userAgent: event.headers?.['User-Agent'],
                success: true
            });
        } catch (analyticsError) {
            console.warn('Analytics logging failed:', analyticsError.message);
            // Non fallire il riassunto per errori analytics
        }
        
        const totalTime = Date.now() - startTime;
        console.log('🏁 [TIMING] Total request time:', totalTime, 'ms');
        console.log('📊 [TIMING] Breakdown - Fetch:', fetchTime, 'ms, OpenAI:', openaiTime, 'ms, Other:', totalTime - fetchTime - openaiTime, 'ms');
        
        return createResponse(200, {
            summary: summary.text,
            readingTimeMinutes: summary.readingTimeMinutes,
            wordsCount: summary.wordsCount,
            stats: summary.stats,
            url: body.url,
            title: title || 'Contenuto web',
            user: {
                usage: user.usage,
                plan: user.plan
            }
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



// Handler per health check
export async function healthHandler(event) {
    return createResponse(200, {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
}

// Handler per statistiche utente
export async function userStatsHandler(event) {
    try {
        if (event.httpMethod === 'OPTIONS') {
            return corsResponse;
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
            return corsResponse;
        }
        
        if (event.httpMethod !== 'GET') {
            return createResponse(405, { error: 'Metodo non supportato. Usa GET.' });
        }

        // Verifica autenticazione admin (per ora qualsiasi utente autenticato)
        const user = await requireAuth(event);
        
        // TODO: In futuro aggiungere controllo admin role
        // if (user.role !== 'admin') {
        //     return createResponse(403, { error: 'Accesso riservato agli admin' });
        // }
        
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
            return corsResponse;
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
            return corsResponse;
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
            return corsResponse;
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
            return corsResponse;
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

        const checkoutSession = await createCheckoutSession(user.id, user.email, planType);
        
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
            return corsResponse;
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
export async function stripeWebhookHandler(event) {
    try {
        const signature = event.headers['stripe-signature'];
        if (!signature) {
            return createResponse(400, { error: 'Missing Stripe signature' });
        }

        const result = await handleStripeWebhook(event.body, signature);
        
        return createResponse(200, result);
        
    } catch (error) {
        console.error('Error in stripeWebhookHandler:', error);
        return createResponse(400, { error: 'Webhook verification failed: ' + error.message });
    }
}

// Handler per ottenere subscription utente
export async function getUserSubscriptionHandler(event) {
    try {
        if (event.httpMethod === 'OPTIONS') {
            return corsResponse;
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
            return corsResponse;
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
    console.log('Event:', JSON.stringify(event, null, 2));
    
    const path = event.path || event.rawPath;
    
    switch (path) {
        case '/summarize':
            return await summarizeHandler(event);
        case '/summarize-url':
            return await summarizeUrlHandler(event);
        case '/auth/login':
            return await authLoginHandler(event);
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
        default:
            return createResponse(404, {
                error: 'Endpoint non trovato',
                availableEndpoints: [
                    '/summarize', 
                    '/summarize-url', 
                    '/auth/login', 
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
                    '/health'
                ]
            });
    }
}