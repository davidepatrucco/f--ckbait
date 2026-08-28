// cache.mjs - Sistema di caching per riepiloghi

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'crypto';

// Configurazione DynamoDB
const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'eu-west-1'
});
const docClient = DynamoDBDocumentClient.from(client);

const CACHE_TABLE = process.env.CACHE_TABLE_NAME || 'reading-intelligence-summary-cache-dev';
const CACHE_TTL_HOURS = parseInt(process.env.CACHE_TTL_HOURS || '24', 10); // 24 ore default

// v3: invalida i riassunti generati prima dei fix su estrazione client, parsing
// bullet robusto e prompt (le voci v2 potevano contenere JSON grezzo o testo troncato).
const CACHE_VERSION = 'summary-v3';

/**
 * Chiave condivisa ma sicura: la cache dipende dal contenuto effettivo, non
 * soltanto dall'URL. Non salviamo mai il testo nella chiave o nella tabella.
 */
export function buildSummaryCacheKey({
    brandId = 'lemonsqueezer',
    promptProfile = '',
    outputSchema = '',
    text,
    language = 'it',
    summaryProfile = 'standard',
    squeeze = 20,
    model = 'gpt-5-nano',
    sourceType = 'web',
    videoDurationSeconds = 0,
    description = '',
    comments = []
}) {
    const normalizedText = String(text || '').replace(/\s+/g, ' ').trim();
    const contentHash = createHash('sha256').update(normalizedText).digest('hex');
    const keyParts = [
        CACHE_VERSION,
        `b:${brandId}`,
        // Prompt/schema version: cambiarli invalida la cache logica (no output stantii).
        `pp:${promptProfile}`,
        `os:${outputSchema}`,
        contentHash,
        language,
        summaryProfile,
        `sq${Number(squeeze) || 20}`,
        model,
        sourceType,
        Math.round(Number(videoDurationSeconds) || 0)
    ];
    // Gli extra (descrizione video + commenti) cambiano il riassunto, quindi la
    // chiave. Aggiunti solo se presenti: così le voci di cache senza extra (web e
    // video senza commenti) restano valide e non vengono invalidate a tappeto.
    const hasComments = Array.isArray(comments) && comments.length > 0;
    if (description || hasComments) {
        const extras = String(description || '') + '' + (hasComments ? comments.join('') : '');
        keyParts.push('extras:' + createHash('sha256').update(extras).digest('hex'));
    }
    return createHash('sha256').update(keyParts.join('|')).digest('hex');
}

/**
 * Normalizza URL per cache consistente
 */
function normalizeUrl(url) {
    try {
        const urlObj = new URL(url);
        
        // Rimuovi parametri tracking comuni
        const trackingParams = [
            'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
            'fbclid', 'gclid', 'msclkid', 'ref', 'source',
            'campaign_id', 'ad_id', 'creative_id', 'keyword_id',
            '_ga', '_gid', 'mc_cid', 'mc_eid'
        ];
        
        trackingParams.forEach(param => {
            urlObj.searchParams.delete(param);
        });
        
        // Rimuovi fragment
        urlObj.hash = '';
        
        // Normalizza hostname (rimuovi www)
        urlObj.hostname = urlObj.hostname.replace(/^www\./, '');
        
        return urlObj.toString();
    } catch {
        return url; // Se URL non valido, usa originale
    }
}

/**
 * Verifica se esiste un riassunto in cache
 */
export async function getCachedSummary(cacheInput, language = 'it') {
    try {
        const cacheKey = typeof cacheInput === 'string'
            ? buildSummaryCacheKey({ text: cacheInput, language })
            : buildSummaryCacheKey(cacheInput);
        
        const command = new GetCommand({
            TableName: CACHE_TABLE,
            Key: { cache_key: cacheKey }
        });
        
        const response = await docClient.send(command);
        const cachedItem = response.Item;
        
        if (!cachedItem) {
            return null; // Nessun cache
        }
        
        // Verifica se il cache è ancora valido
        const now = new Date();
        const expiresAt = new Date(cachedItem.expires_at);
        
        if (now > expiresAt) {
            // Cache scaduto - rimuovi
            await deleteCachedSummary(cacheKey);
            return null;
        }
        
        // Aggiorna statistiche hit
        await incrementCacheHits(cacheKey);
        
        return {
            summary: cachedItem.summary,
            readingTimeMinutes: cachedItem.reading_time_minutes,
            wordsCount: cachedItem.words_count,
            stats: cachedItem.stats,
            title: cachedItem.title,
            cached: true,
            cachedAt: cachedItem.created_at,
            expiresAt: cachedItem.expires_at,
            cacheHits: (cachedItem.cache_hits || 0) + 1
        };
        
    } catch (error) {
        console.error('Error getting cached summary:', error);
        return null; // Fallback a processing normale
    }
}

/**
 * Salva riassunto in cache
 */
export async function setCachedSummary(cacheInput, summaryData) {
    try {
        const cacheKey = buildSummaryCacheKey(cacheInput);
        const now = new Date();
        const expiresAt = new Date(now.getTime() + (CACHE_TTL_HOURS * 60 * 60 * 1000));
        
        const cacheItem = {
            cache_key: cacheKey,
            cache_version: CACHE_VERSION,
            url: normalizeUrl(cacheInput.url || ''),
            language: cacheInput.language || 'it',
            summary_profile: cacheInput.summaryProfile || 'standard',
            model: cacheInput.model || 'gpt-5-nano',
            source_type: cacheInput.sourceType || 'web',
            video_duration_seconds: Number(cacheInput.videoDurationSeconds) || 0,
            content_hash: createHash('sha256').update(String(cacheInput.text || '').replace(/\s+/g, ' ').trim()).digest('hex'),
            title: summaryData.title,
            summary: summaryData.summary,
            reading_time_minutes: summaryData.readingTimeMinutes,
            words_count: summaryData.wordsCount,
            stats: summaryData.stats,
            created_at: now.toISOString(),
            expires_at: expiresAt.toISOString(),
            ttl: Math.floor(expiresAt.getTime() / 1000), // TTL per DynamoDB
            cache_hits: 0,
            chars_input: summaryData.charsInput || 0,
            processing_time_ms: summaryData.processingTimeMs || 0
        };
        
        const command = new PutCommand({
            TableName: CACHE_TABLE,
            Item: cacheItem
        });
        
        await docClient.send(command);
        
        console.log(`✅ Cache saved (key: ${cacheKey.substring(0, 8)}...)`);
        return cacheKey;
        
    } catch (error) {
        console.error('Error saving cached summary:', error);
        // Non fallire per errori di cache
        return null;
    }
}

/**
 * Incrementa contatore cache hits
 */
async function incrementCacheHits(cacheKey) {
    try {
        const command = new UpdateCommand({
            TableName: CACHE_TABLE,
            Key: { cache_key: cacheKey },
            UpdateExpression: 'ADD cache_hits :increment SET last_accessed = :now',
            ExpressionAttributeValues: {
                ':increment': 1,
                ':now': new Date().toISOString()
            }
        });
        
        await docClient.send(command);
    } catch (error) {
        console.warn('Error incrementing cache hits:', error.message);
    }
}

/**
 * Rimuovi elemento dalla cache
 */
async function deleteCachedSummary(cacheKey) {
    try {
        const command = new DeleteCommand({
            TableName: CACHE_TABLE,
            Key: { cache_key: cacheKey }
        });
        
        await docClient.send(command);
        console.log(`🗑️ Expired cache removed: ${cacheKey.substring(0, 8)}...`);
    } catch (error) {
        console.warn('Error deleting cached summary:', error.message);
    }
}

/**
 * Pulisci cache scaduti (funzione di manutenzione)
 */
export async function cleanExpiredCache() {
    try {
        // DynamoDB TTL dovrebbe gestire automaticamente la pulizia
        // Questa funzione è per pulizia manuale se necessario
        console.log('🧹 Cache cleanup triggered (DynamoDB TTL handles automatic cleanup)');
        return { message: 'Cleanup scheduled via DynamoDB TTL' };
    } catch (error) {
        console.error('Error cleaning expired cache:', error);
        throw new Error('Errore pulizia cache scaduti');
    }
}

/**
 * Ottieni statistiche cache
 */
export async function getCacheStats() {
    try {
        // Per ora ritorniamo statistiche base
        // In futuro si potrebbe implementare con Scan/Query per metriche dettagliate
        const now = new Date();
        
        return {
            cache_ttl_hours: CACHE_TTL_HOURS,
            auto_cleanup: 'DynamoDB TTL enabled',
            current_time: now.toISOString(),
            note: 'Detailed stats require scanning - implement if needed for admin dashboard'
        };
    } catch (error) {
        console.error('Error getting cache stats:', error);
        throw new Error('Errore recupero statistiche cache');
    }
}

/**
 * Invalida cache per dominio specifico
 */
export async function invalidateCache(pattern) {
    try {
        // Implementazione semplificata - in produzione usare DynamoDB Scan con filtro
        console.log(`🚫 Cache invalidation requested for pattern: ${pattern}`);
        
        // Per ora loghiamo la richiesta
        // Una implementazione completa richiederebbe scan della tabella
        return { 
            message: `Cache invalidation scheduled for pattern: ${pattern}`,
            note: 'Full implementation requires table scan - implement if needed'
        };
    } catch (error) {
        console.error('Error invalidating cache:', error);
        throw new Error('Errore invalidazione cache');
    }
}

/**
 * Verifica se un URL dovrebbe essere cachato
 */
export function shouldCacheUrl(url) {
    try {
        const urlObj = new URL(url);
        
        // Non cachare URL con parametri dinamici sensibili
        const dynamicParams = ['token', 'auth', 'session', 'nonce', 'timestamp', 'time'];
        const hasDynamicParams = dynamicParams.some(param => 
            urlObj.searchParams.has(param)
        );
        
        if (hasDynamicParams) {
            return false;
        }
        
        // Non cachare URL troppo lunghi (probabilmente dinamici)
        if (url.length > 2000) {
            return false;
        }
        
        // Non cachare domini specifici se necessario
        const nonCacheableDomains = [
            'localhost',
            '127.0.0.1',
            '192.168.',
            '10.0.',
            '172.16.'
        ];
        
        const isLocalDomain = nonCacheableDomains.some(domain => 
            urlObj.hostname.includes(domain)
        );
        
        if (isLocalDomain) {
            return false;
        }
        
        return true;
    } catch {
        return false; // URL non valido
    }
}
