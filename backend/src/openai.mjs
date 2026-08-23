// openai.mjs - Modulo per l'integrazione con OpenAI
import OpenAI from 'openai';
import { getSecretsManager } from './secrets.mjs';

// Client OpenAI lazy: non crearlo all'import per permettere i test che rimuovono la variabile
let openai = null;
let isInitialized = false;

async function getOpenAIClient() {
    if (openai && isInitialized) return openai;
    
    // Se è ambiente di test/locale, usa variabile d'ambiente
    if (process.env.NODE_ENV === 'test' || process.env.IS_LOCAL) {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY non configurato');
        }
        openai = new OpenAI({ apiKey });
        return openai;
    }
    
    // Altrimenti usa secrets manager
    const secretsManager = getSecretsManager();
    await secretsManager.initialize();
    
    const apiKey = secretsManager.openaiApiKey;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY non configurato');
    }
    
    openai = new OpenAI({ apiKey });
    isInitialized = true;
    return openai;
}

const OUTPUT_LANGUAGES = { it: 'italiano', en: 'English', es: 'español', fr: 'français', de: 'Deutsch' };
const SUMMARY_PROFILES = {
    ultra: { savingsPercent: 95 },
    standard: { savingsPercent: 90 },
    detailed: { savingsPercent: 80 }
};
const WORDS_PER_MINUTE = 220;
const MAX_SUMMARY_WORDS = Number.parseInt(process.env.SUMMARY_MAX_WORDS || '800', 10);
const countWords = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;

const DEFAULT_SUMMARY_MODEL = process.env.SUMMARY_MODEL || 'gpt-5-nano';
const ALLOWED_SUMMARY_MODELS = new Set([DEFAULT_SUMMARY_MODEL, 'gpt-5-nano', 'gpt-5.6-luna']);

export function getSummaryModel(requestedModel) {
    return ALLOWED_SUMMARY_MODELS.has(requestedModel) ? requestedModel : DEFAULT_SUMMARY_MODEL;
}

export function buildSummaryPlan(content) {
    const profile = SUMMARY_PROFILES[content.summaryProfile] || SUMMARY_PROFILES.standard;
    const sourceEquivalentWords = content.sourceType === 'video' && Number(content.videoDurationSeconds) > 0
        ? Math.round((Number(content.videoDurationSeconds) / 60) * WORDS_PER_MINUTE)
        : countWords(content.text);
    const targetWords = Math.max(1, Math.min(
        MAX_SUMMARY_WORDS,
        Math.floor(sourceEquivalentWords * ((100 - profile.savingsPercent) / 100))
    ));
    return {
        profile: SUMMARY_PROFILES[content.summaryProfile] ? content.summaryProfile : 'standard',
        savingsPercent: profile.savingsPercent,
        sourceEquivalentWords,
        targetWords,
        bulletCount: Math.max(1, Math.min(8, Math.ceil(targetWords / 90)))
    };
}

function createPrompt(content, language = 'it', plan = buildSummaryPlan(content)) {
    const outputLanguage = OUTPUT_LANGUAGES[language] || OUTPUT_LANGUAGES.it;
    const sourceLabel = content.sourceType === 'video' ? 'Trascrizione video' : 'Contenuto pagina web';
    const systemPrompt = `Sei un riassuntore editoriale rigoroso. Rispondi esclusivamente con JSON valido secondo lo schema richiesto. Scrivi in ${outputLanguage}. Usa solo informazioni presenti nella fonte; elimina pubblicità, menu, footer, ripetizioni e dettagli marginali.`;
    const userPrompt = `Titolo: ${content.title}
URL: ${content.url}

Obiettivo: profilo ${plan.profile}; massimo ${plan.targetWords} parole totali nei bullet, per un risparmio di tempo di almeno ${plan.savingsPercent}%. Genera fino a ${plan.bulletCount} bullet, meno solo se la fonte è troppo breve.

${sourceLabel}:
${content.text}`;
    return { systemPrompt, userPrompt };
}

// Funzione per calcolare statistiche di lettura
function calculateReadingStats(originalText, summaryText) {
    // Velocità di lettura media: 200-250 parole al minuto (useremo 220)
    const wordsPerMinute = 220;
    const wordsPerSecond = wordsPerMinute / 60;
    
    // Conta le parole (approssimativo ma efficace)
    const countWords = (text) => {
        return text.trim().split(/\s+/).filter(word => word.length > 0).length;
    };
    
    const originalWords = countWords(originalText);
    const summaryWords = countWords(summaryText);
    
    const originalReadingTime = Math.round(originalWords / wordsPerSecond);
    const summaryReadingTime = Math.round(summaryWords / wordsPerSecond);
    const timeSaved = originalReadingTime - summaryReadingTime;
    
    return {
        originalWords,
        summaryWords,
        originalReadingTime, // in secondi
        summaryReadingTime, // in secondi
        timeSaved, // in secondi
        compressionRatio: Math.round((1 - summaryWords / originalWords) * 100) // percentuale
    };
}

// Funzione per formattare il tempo in modo leggibile
function formatTime(seconds) {
    if (seconds < 60) {
        return `${seconds} secondi`;
    } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        if (remainingSeconds === 0) {
            return `${minutes} ${minutes === 1 ? 'minuto' : 'minuti'}`;
        } else {
            return `${minutes}m ${remainingSeconds}s`;
        }
    } else {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${minutes}m`;
    }
}

// Funzione principale per il riassunto con OpenAI
export async function summarizeWithOpenAI(content) {
    const startTime = Date.now();
    console.log('🤖 [TIMING] OpenAI function started');
    
    try {
        // Valida input
        if (!content.text || content.text.length < 50) {
            throw new Error('Contenuto troppo breve per essere riassunto');
        }
        
        const plan = buildSummaryPlan(content);
        const model = getSummaryModel(content.model);
        const promptStartTime = Date.now();
        const { systemPrompt, userPrompt } = createPrompt(content, content.language, plan);
        console.log('⚡ [TIMING] Prompt creation took:', Date.now() - promptStartTime, 'ms');
        
        console.log('🚀 [TIMING] Calling OpenAI with:', {
            model,
            language: content.language,
            contentLength: content.text.length,
            targetWords: plan.targetWords,
            profile: plan.profile
        });
        
        const apiCallStartTime = Date.now();
        // Chiamata a OpenAI
        const client = await getOpenAIClient();
        const requestCompletion = async (messages, strictSchema = true) => client.chat.completions.create({
            model,
            messages,
            // Reasoning models can consume completion tokens before emitting JSON.
            // Keep enough headroom even for very short summaries.
            max_completion_tokens: Math.max(1200, Math.min(4000, plan.targetWords * 6 + 400)),
            response_format: strictSchema ? {
                type: 'json_schema',
                json_schema: {
                    name: 'lemonsqueezer_summary',
                    strict: true,
                    schema: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['bullets'],
                        properties: {
                            bullets: {
                                type: 'array',
                                minItems: 1,
                                maxItems: plan.bulletCount,
                                items: { type: 'string' }
                            }
                        }
                    }
                }
            } : { type: 'json_object' }
        });
        const requestPlainCompletion = async (messages) => client.chat.completions.create({
            model,
            messages,
            max_completion_tokens: 3000
        });
        // Keep the proven plain-text path as the primary request. Structured
        // output is only a recovery path; it must never block a summary.
        let completion = await requestPlainCompletion([
            { role: 'system', content: `${systemPrompt} Restituisci solo i bullet, uno per riga, preceduti da •.` },
            { role: 'user', content: userPrompt }
        ]);
        const apiCallTime = Date.now() - apiCallStartTime;
        console.log('⚡ [TIMING] OpenAI API call took:', apiCallTime, 'ms');
        
        const readResponseText = (result) => {
            const message = result?.choices?.[0]?.message;
            if (typeof message?.content === 'string') return message.content.trim();
            if (Array.isArray(message?.content)) {
                return message.content.map((part) => part?.text || '').join('').trim();
            }
            return '';
        };
        let response = readResponseText(completion);

        // Retry once with the less restrictive JSON mode. This covers transient
        // empty structured-output responses without ever falling back to page metadata.
        if (!response) {
            console.warn('[OPENAI] Empty plain response; retrying JSON mode', {
                finishReason: completion?.choices?.[0]?.finish_reason,
                refusal: completion?.choices?.[0]?.message?.refusal || null
            });
            completion = await requestCompletion([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ], false);
            response = readResponseText(completion);
        }
        if (!response) {
            console.warn('[OPENAI] JSON response still empty; retrying legacy plain-text mode', {
                finishReason: completion?.choices?.[0]?.finish_reason
            });
            completion = await requestPlainCompletion([
                { role: 'system', content: `${systemPrompt} Restituisci solo i bullet, uno per riga, preceduti da •.` },
                { role: 'user', content: userPrompt }
            ]);
            response = readResponseText(completion);
        }
        if (!response) throw new Error('Risposta vuota da OpenAI');
        
        let parsed;
        try { parsed = JSON.parse(response); } catch {
            const plainBullets = response.split(/\n+/).map((line) => line.replace(/^\s*(?:[•*-]|\d+[.)])\s*/, '').trim()).filter(Boolean);
            parsed = { bullets: plainBullets };
        }
        let bullets = Array.isArray(parsed.bullets)
            ? parsed.bullets.map((bullet) => String(bullet).replace(/^\s*[•-]\s*/, '').trim()).filter(Boolean)
            : [];
        if (!bullets.length) throw new Error('OpenAI non ha restituito bullet validi');

        let summaryText = bullets.map((bullet) => `• ${bullet}`).join('\n');
        // Un solo tentativo di compressione se il modello supera il budget.
        if (countWords(summaryText) > plan.targetWords && plan.targetWords >= 20) {
            completion = await requestCompletion([
                { role: 'system', content: systemPrompt },
                {
                    role: 'user',
                    content: `Riduci il seguente riassunto a massimo ${plan.targetWords} parole totali, mantenendo solo i fatti essenziali.\n\n${summaryText}`
                }
            ]);
            response = readResponseText(completion);
            try {
                parsed = JSON.parse(response || '{}');
                bullets = Array.isArray(parsed.bullets)
                    ? parsed.bullets.map((bullet) => String(bullet).replace(/^\s*[•-]\s*/, '').trim()).filter(Boolean)
                    : bullets;
                summaryText = bullets.map((bullet) => `• ${bullet}`).join('\n');
            } catch {
                // Conserva il primo risultato valido: le statistiche mostreranno il risparmio reale.
            }
        }

        // Calcola statistiche di lettura
        const statsStartTime = Date.now();
        const stats = calculateReadingStats(content.text, summaryText);
        console.log('⚡ [TIMING] Stats calculation took:', Date.now() - statsStartTime, 'ms');
        
        // Restituisce direttamente il testo di OpenAI con le statistiche
        const result = {
            text: summaryText,
            readingTimeMinutes: Math.ceil(stats.summaryReadingTime / 60),
            wordsCount: stats.summaryWords,
            stats: {
                originalWords: stats.originalWords,
                summaryWords: stats.summaryWords,
                timeSaved: stats.timeSaved,
                compressionRatio: stats.compressionRatio,
                targetWords: plan.targetWords,
                targetSavingsPercent: plan.savingsPercent,
                targetMet: stats.summaryWords <= plan.targetWords,
                originalReadingTime: formatTime(stats.originalReadingTime),
                summaryReadingTime: formatTime(stats.summaryReadingTime)
            }
        };
        
        const totalOpenAITime = Date.now() - startTime;
        console.log('🏁 [TIMING] Total OpenAI function time:', totalOpenAITime, 'ms');
        
        // Do not log generated content: it may contain sensitive page data.
        console.log('✅ [TIMING] Summary generated:', {
            url: content.url,
            title: content.title,
            language: content.language,
            textLength: content.text.length,
            summaryBullets: bullets.length,
            targetMet: result.stats.targetMet
        });
        
        return result;
        
    } catch (error) {
        console.error('Error in summarizeWithOpenAI:', error);
        
        // Gestione errori specifici di OpenAI
        if (error.code === 'rate_limit_exceeded') {
            throw new Error('Rate limit OpenAI superato');
        }
        
        if (error.code === 'insufficient_quota') {
            throw new Error('Quota OpenAI insufficiente');
        }
        
        if (error.code === 'invalid_api_key') {
            throw new Error('API key OpenAI non valida');
        }
        
        if (error.message && error.message.includes('timeout')) {
            throw new Error('Timeout nella chiamata a OpenAI');
        }
        
        throw new Error(`Errore OpenAI: ${error.message}`);
    }
}

// Funzione per testare la connessione a OpenAI
export async function testOpenAIConnection() {
    try {
        const client = await getOpenAIClient();
        const response = await client.models.list();
        return {
            success: true,
            models: response.data.length,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}
