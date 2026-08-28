// rate-limit.mjs - Gestione del rate limiting
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

// Inizializza client DynamoDB
const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'eu-west-1'
});
const docClient = DynamoDBDocumentClient.from(client);

// Il template passa RATE_LIMIT_TABLE_NAME (convenzione *_TABLE_NAME come gli altri
// moduli). RATE_LIMIT_TABLE resta come override legacy. Fallback = pattern reale
// (con -<env>), NON 'rate-limits' che non è nella policy IAM → AccessDenied → 429.
const RATE_LIMIT_TABLE = process.env.RATE_LIMIT_TABLE_NAME || process.env.RATE_LIMIT_TABLE || 'reading-intelligence-rate-limit-dev';

// Configurazione rate limiting
const RATE_LIMITS = {
    // Rate limit per minuto
    perMinute: {
        window: 60 * 1000, // 1 minuto in ms
        limit: 10 // 10 richieste per minuto
    },
    // Rate limit per ora
    perHour: {
        window: 60 * 60 * 1000, // 1 ora in ms
        limit: 100 // 100 richieste per ora
    },
    // Rate limit per giorno
    perDay: {
        window: 24 * 60 * 60 * 1000, // 1 giorno in ms
        limit: 500 // 500 richieste per giorno
    }
};

// Funzione per creare una chiave per il rate limiting (opzionalmente per-brand).
export function createRateLimitKey(apiKey, window, brand = '') {
    const now = new Date();
    let timeWindow;
    
    switch (window) {
        case 'minute':
            timeWindow = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
            break;
        case 'hour':
            timeWindow = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
            break;
        case 'day':
            timeWindow = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
            break;
        default:
            throw new Error('Invalid time window');
    }
    
    // Il segmento brand è aggiunto solo se presente: chiavi legacy (senza brand) invariate.
    const brandSeg = brand ? `${brand}#` : '';
    return `${apiKey}#${brandSeg}${window}#${timeWindow}`;
}

// Funzione per verificare e aggiornare il rate limit per una finestra temporale
async function checkAndUpdateRateLimit(apiKey, window, config, brand = '') {
    try {
        const key = createRateLimitKey(apiKey, window, brand);
        const now = new Date();
        const ttl = Math.floor((now.getTime() + config.window) / 1000); // TTL in secondi
        
        // Prova ad aggiornare il contatore
        const result = await docClient.send(new UpdateCommand({
            TableName: RATE_LIMIT_TABLE,
            Key: {
                userId: key
            },
            UpdateExpression: 'ADD #count :inc SET #ttl = :ttl, #lastUpdated = :now',
            ExpressionAttributeNames: {
                '#count': 'count',
                '#ttl': 'resetTime',
                '#lastUpdated': 'lastUpdated'
            },
            ExpressionAttributeValues: {
                ':inc': 1,
                ':ttl': ttl,
                ':now': now.toISOString()
            },
            ReturnValues: 'ALL_NEW'
        }));
        
        const count = result.Attributes.count;
        
        if (count > config.limit) {
            throw new Error(`Rate limit exceeded for ${window}: ${count}/${config.limit}`);
        }
        
        return {
            window,
            count,
            limit: config.limit,
            remaining: config.limit - count
        };
        
    } catch (error) {
        if (error.name === 'ResourceNotFoundException') {
            // La tabella non esiste, per ora logga e continua
            console.warn('Rate limit table not found, skipping rate limiting');
            return {
                window,
                count: 1,
                limit: config.limit,
                remaining: config.limit - 1
            };
        }
        
        throw error;
    }
}

// Funzione principale per verificare tutti i rate limits
export async function checkRateLimit(apiKey, brand = '') {
    try {
        const results = {};

        // Verifica rate limit per minuto/ora/giorno (chiave per-brand se brand fornito)
        results.minute = await checkAndUpdateRateLimit(apiKey, 'minute', RATE_LIMITS.perMinute, brand);
        results.hour = await checkAndUpdateRateLimit(apiKey, 'hour', RATE_LIMITS.perHour, brand);
        results.day = await checkAndUpdateRateLimit(apiKey, 'day', RATE_LIMITS.perDay, brand);
        
        // Log del rate limiting
        console.log('Rate limit check:', {
            apiKey: apiKey.substring(0, 8) + '...',
            minute: `${results.minute.count}/${results.minute.limit}`,
            hour: `${results.hour.count}/${results.hour.limit}`,
            day: `${results.day.count}/${results.day.limit}`
        });
        
        return results;
        
    } catch (error) {
        console.error('Rate limit check failed:', error);
        // CRITICAL: Fail closed - deny request if rate limiting cannot be verified
        // This prevents abuse if the rate limiting service is unavailable
        throw new Error('Rate limiting service unavailable - request denied for safety');
    }
}

// Funzione per ottenere lo stato attuale del rate limiting senza incrementare
export async function getRateLimitStatus(apiKey) {
    try {
        const results = {};
        const now = new Date();
        
        for (const [window, config] of Object.entries(RATE_LIMITS)) {
            const windowName = window.replace('per', '').toLowerCase();
            const key = createRateLimitKey(apiKey, windowName);
            
            const result = await docClient.send(new GetCommand({
                TableName: RATE_LIMIT_TABLE,
                Key: {
                    userId: key
                }
            }));
            
            const count = result.Item?.count || 0;
            results[windowName] = {
                count,
                limit: config.limit,
                remaining: Math.max(0, config.limit - count)
            };
        }
        
        return results;
        
    } catch (error) {
        console.error('Error getting rate limit status:', error);
        return null;
    }
}

// Funzione per resettare i rate limits di un utente (per debug/admin)
export async function resetRateLimits(apiKey) {
    try {
        const windows = ['minute', 'hour', 'day'];
        const results = [];
        
        for (const window of windows) {
            const key = createRateLimitKey(apiKey, window);
            
            try {
                await docClient.send(new UpdateCommand({
                    TableName: RATE_LIMIT_TABLE,
                    Key: {
                        userId: key
                    },
                    UpdateExpression: 'SET #count = :zero',
                    ExpressionAttributeNames: {
                        '#count': 'count'
                    },
                    ExpressionAttributeValues: {
                        ':zero': 0
                    }
                }));
                
                results.push({ window, reset: true });
            } catch (error) {
                results.push({ window, reset: false, error: error.message });
            }
        }
        
        return results;
        
    } catch (error) {
        console.error('Error resetting rate limits:', error);
        throw error;
    }
}