// handler.mjs - Handler principale per AWS Lambda
import { summarizeWithOpenAI } from '../src/openai.mjs';
import { validateSubscription } from '../src/subscription.mjs';
import { checkRateLimit } from '../src/rate-limit.mjs';

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
        
        // Per la versione privata, semplifichiamo la validazione
        // In futuro qui andrà la validazione subscription
        // const isValidSubscription = await validateSubscription(apiKey);
        // if (!isValidSubscription) {
        //     return createResponse(403, {
        //         error: 'Subscription non valida o scaduta'
        //     });
        // }
        
        // Rate limiting semplificato (per ora solo log)
        try {
            await checkRateLimit(apiKey);
        } catch (rateLimitError) {
            return createResponse(429, {
                error: 'Rate limit superato. Riprova più tardi.',
                retryAfter: 60
            });
        }
        
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
            summaryBullets: summary.bullets.length,
            apiKeyPrefix: apiKey.substring(0, 8) + '...'
        });
        
        return createResponse(200, {
            success: true,
            summary: summary.summary,
            bullets: summary.bullets,
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

// Handler per health check
export async function healthHandler(event) {
    return createResponse(200, {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
}

// Handler principale (router)
export async function handler(event, context) {
    console.log('Event:', JSON.stringify(event, null, 2));
    
    const path = event.path || event.rawPath;
    
    switch (path) {
        case '/summarize':
            return await summarizeHandler(event);
        case '/health':
            return await healthHandler(event);
        default:
            return createResponse(404, {
                error: 'Endpoint non trovato',
                availableEndpoints: ['/summarize', '/health']
            });
    }
}