// analytics.mjs - Gestione analytics e metriche

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

// Configurazione DynamoDB
const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'eu-west-1'
});
const docClient = DynamoDBDocumentClient.from(client);

const ANALYTICS_TABLE = process.env.ANALYTICS_TABLE_NAME || 'tldr-analytics';

/**
 * Costruisce l'evento analytics (funzione pura, testabile).
 * PRIVACY: solo metadati (dominio, titolo, conteggi caratteri) — MAI il contenuto
 * grezzo della pagina né il testo del riassunto (E06-007).
 */
// Vocabolario controllato degli event_type (funnel). Server + client.
export const ALLOWED_EVENT_TYPES = new Set([
    'summary_completed', 'summary_failed',
    'extension_installed', 'extension_opened', 'page_detected',
    'login_completed', 'sidepanel_opened', 'result_copied', 'source_opened',
    'paywall_viewed', 'checkout_started', 'subscription_activated'
]);

export function buildAnalyticsEvent(eventData) {
    const now = new Date();
    return {
        // Chiavi allineate allo schema tabella: PK eventId, GSI userId + timestamp(N).
        eventId: uuidv4(),
        userId: eventData.userId,
        timestamp: now.getTime(), // Number (epoch ms) per la GSI
        created_at: now.toISOString(), // ISO leggibile per display/raggruppamenti
        event_type: ALLOWED_EVENT_TYPES.has(eventData.eventType) ? eventData.eventType : 'summary_completed',
        source: eventData.source === 'client' ? 'client' : 'server',
        brand_id: eventData.brandId || 'lemonsqueezer',
        email: eventData.userEmail,
        plan: eventData.userPlan,
        url: eventData.url,
        url_domain: extractDomain(eventData.url),
        title: eventData.title,
        language: eventData.language || 'it',
        chars_input: eventData.charsInput || 0,
        chars_output: eventData.charsOutput || 0,
        input_tokens: eventData.inputTokens || 0,
        output_tokens: eventData.outputTokens || 0,
        cost_estimate: eventData.costEstimate || 0,
        duration_ms: eventData.durationMs || 0,
        date_partition: getDatePartition(), // Per query efficienti
        user_agent: eventData.userAgent,
        browser: eventData.browser || null,
        client_version: eventData.clientVersion || null,
        success: eventData.success !== false,
        error_code: eventData.errorCode || null
    };
}

/**
 * Registra un evento di riassunto
 */
export async function logSummaryEvent(eventData) {
    try {
        const event = buildAnalyticsEvent(eventData);

        const command = new PutCommand({
            TableName: ANALYTICS_TABLE,
            Item: event
        });

        await docClient.send(command);
        return event.eventId;

    } catch (error) {
        console.error('Error logging analytics event:', error);
        // Non fallire il riassunto per errori analytics
        return null;
    }
}

/**
 * Registra un evento di funnel inviato dal client (estensione).
 * Solo metadati: event_type whitelisted, brand, plan; MAI contenuto grezzo.
 * Ritorna null se l'event_type non è nel vocabolario controllato.
 */
export async function logClientEvent({ eventType, userId, userEmail, userPlan, brandId, url, browser, clientVersion }) {
    if (!ALLOWED_EVENT_TYPES.has(eventType)) return null;
    try {
        const event = buildAnalyticsEvent({
            eventType, source: 'client', userId, userEmail, userPlan, brandId,
            url, browser, clientVersion, success: true
        });
        await docClient.send(new PutCommand({ TableName: ANALYTICS_TABLE, Item: event }));
        return event.eventId;
    } catch (error) {
        console.error('Error logging client event:', error);
        return null;
    }
}

/**
 * Ottieni statistiche utente
 */
export async function getUserStats(userId, days = 30) {
    try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        
        const command = new QueryCommand({
            TableName: ANALYTICS_TABLE,
            IndexName: 'UserEventsIndex',
            KeyConditionExpression: 'userId = :userId AND #ts >= :startDate',
            ExpressionAttributeNames: {
                '#ts': 'timestamp'
            },
            ExpressionAttributeValues: {
                ':userId': userId,
                ':startDate': startDate.getTime() // epoch ms (timestamp è Number)
            }
        });

        const response = await docClient.send(command);
        const events = response.Items || [];

        return {
            totalSummaries: events.length,
            successfulSummaries: events.filter(e => e.success).length,
            failedSummaries: events.filter(e => !e.success).length,
            totalCharsProcessed: events.reduce((sum, e) => sum + (e.chars_input || 0), 0),
            avgDuration: events.length > 0 ? 
                events.reduce((sum, e) => sum + (e.duration_ms || 0), 0) / events.length : 0,
            languageBreakdown: getLanguageBreakdown(events),
            domainBreakdown: getDomainBreakdown(events),
            recentActivity: events.slice(-10).map(e => ({
                date: e.created_at || (e.timestamp ? new Date(e.timestamp).toISOString() : null),
                url: e.url,
                domain: e.url_domain,
                duration: e.duration_ms,
                success: e.success
            }))
        };

    } catch (error) {
        console.error('Error getting user stats:', error);
        throw new Error('Errore recupero statistiche utente');
    }
}

/**
 * Ottieni statistiche globali per admin
 */
export async function getGlobalStats(days = 7) {
    try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startPartition = getDatePartition(startDate);

        const command = new ScanCommand({
            TableName: ANALYTICS_TABLE,
            FilterExpression: 'date_partition >= :startPartition',
            ExpressionAttributeValues: {
                ':startPartition': startPartition
            }
        });

        const response = await docClient.send(command);
        const events = response.Items || [];

        const uniqueUsers = new Set(events.map(e => e.userId)).size;
        const freeUsers = new Set(events.filter(e => e.plan === 'free').map(e => e.userId)).size;
        const premiumUsers = new Set(events.filter(e => e.plan === 'premium').map(e => e.userId)).size;

        return {
            totalSummaries: events.length,
            uniqueUsers,
            freeUsers,
            premiumUsers,
            successRate: events.length > 0 ? 
                (events.filter(e => e.success).length / events.length * 100).toFixed(2) : 0,
            avgDuration: events.length > 0 ? 
                events.reduce((sum, e) => sum + (e.duration_ms || 0), 0) / events.length : 0,
            totalCharsProcessed: events.reduce((sum, e) => sum + (e.chars_input || 0), 0),
            languageStats: getLanguageBreakdown(events),
            domainStats: getDomainBreakdown(events),
            dailyBreakdown: getDailyBreakdown(events, days),
            topDomains: getTopDomains(events, 10),
            errorBreakdown: getErrorBreakdown(events)
        };

    } catch (error) {
        console.error('Error getting global stats:', error);
        throw new Error('Errore recupero statistiche globali');
    }
}

/**
 * Ottieni trending domains
 */
export async function getTrendingDomains(days = 7, limit = 20) {
    try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startPartition = getDatePartition(startDate);

        const command = new ScanCommand({
            TableName: ANALYTICS_TABLE,
            FilterExpression: 'date_partition >= :startPartition AND #success = :success',
            ExpressionAttributeNames: {
                '#success': 'success'
            },
            ExpressionAttributeValues: {
                ':startPartition': startPartition,
                ':success': true
            },
            ProjectionExpression: 'url_domain'
        });

        const response = await docClient.send(command);
        const events = response.Items || [];

        const domainCounts = {};
        events.forEach(event => {
            const domain = event.url_domain;
            if (domain) {
                domainCounts[domain] = (domainCounts[domain] || 0) + 1;
            }
        });

        return Object.entries(domainCounts)
            .sort(([,a], [,b]) => b - a)
            .slice(0, limit)
            .map(([domain, count]) => ({ domain, count }));

    } catch (error) {
        console.error('Error getting trending domains:', error);
        throw new Error('Errore recupero domini trending');
    }
}

// Utility functions
function extractDomain(url) {
    try {
        return new URL(url).hostname.replace('www.', '');
    } catch {
        return 'unknown';
    }
}

function getDatePartition(date = new Date()) {
    return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

function getLanguageBreakdown(events) {
    const langs = {};
    events.forEach(e => {
        const lang = e.language || 'unknown';
        langs[lang] = (langs[lang] || 0) + 1;
    });
    return langs;
}

function getDomainBreakdown(events) {
    const domains = {};
    events.forEach(e => {
        const domain = e.url_domain || 'unknown';
        domains[domain] = (domains[domain] || 0) + 1;
    });
    return Object.entries(domains)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .reduce((obj, [domain, count]) => ({ ...obj, [domain]: count }), {});
}

function getDailyBreakdown(events, days) {
    const daily = {};
    
    // Inizializza tutti i giorni a 0
    for (let i = 0; i < days; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        daily[dateStr] = 0;
    }
    
    // Conta eventi per giorno (usa created_at ISO; fallback a timestamp Number)
    events.forEach(e => {
        const iso = e.created_at || (typeof e.timestamp === 'number' ? new Date(e.timestamp).toISOString() : String(e.timestamp || ''));
        const dateStr = iso.split('T')[0];
        if (Object.prototype.hasOwnProperty.call(daily, dateStr)) {
            daily[dateStr]++;
        }
    });
    
    return daily;
}

function getTopDomains(events, limit) {
    const domains = {};
    events.forEach(e => {
        const domain = e.url_domain || 'unknown';
        domains[domain] = (domains[domain] || 0) + 1;
    });
    
    return Object.entries(domains)
        .sort(([,a], [,b]) => b - a)
        .slice(0, limit)
        .map(([domain, count]) => ({ domain, count }));
}

function getErrorBreakdown(events) {
    const errors = {};
    events.filter(e => !e.success).forEach(e => {
        const error = e.error_code || 'unknown_error';
        errors[error] = (errors[error] || 0) + 1;
    });
    return errors;
}