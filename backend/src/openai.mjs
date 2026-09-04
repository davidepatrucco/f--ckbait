// openai.mjs - Modulo per l'integrazione con OpenAI
import OpenAI from 'openai';
import { getSecretsManager } from './secrets.mjs';
import { getBrand } from './brands.mjs';
import { getPromptBuilder } from './prompts/index.mjs';
import { getSchema } from './schemas/index.mjs';
import { selectSummaryModel, economyModel, fallbackModel, assertTierSanity } from './model-router.mjs';

// Client OpenAI lazy: non crearlo all'import per permettere i test che rimuovono la variabile
let openai = null;
let isInitialized = false;

export async function getOpenAIClient() {
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

const SUMMARY_PROFILES = {
    ultra: { savingsPercent: 95 },
    standard: { savingsPercent: 90 },
    detailed: { savingsPercent: 80 }
};
const WORDS_PER_MINUTE = 220;
const MAX_SUMMARY_WORDS = Number.parseInt(process.env.SUMMARY_MAX_WORDS || '800', 10);
const countWords = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;

// Model routing (cost-aware) in model-router.mjs: sceglie economy/premium per ruolo.
// La deprecazione di gpt-5-nano (2026-12-10) sposta l'ECONOMY a gpt-5.4-nano (NON a
// luna, che è il premium). SUMMARY_MODEL forza il default economy (override globale).
assertTierSanity();
const DEFAULT_SUMMARY_MODEL = economyModel();

// Prezzi USD per 1M token (input/output), da pricing OpenAI (ago 2026). Override/aggiunte
// via env MODEL_COSTS_JSON. Modello sconosciuto -> costo 0 (i token restano accurati).
const MODEL_COSTS = {
    'gpt-5-nano': { input: 0.05, output: 0.40 },
    'gpt-5.4-nano': { input: 0.20, output: 1.25 },
    'gpt-5.6-luna': { input: 0.20, output: 1.20 }
};
try {
    if (process.env.MODEL_COSTS_JSON) Object.assign(MODEL_COSTS, JSON.parse(process.env.MODEL_COSTS_JSON));
} catch (e) {
    console.warn('MODEL_COSTS_JSON non valido, ignorato:', e?.message);
}
export function estimateCost(model, inputTokens, outputTokens) {
    const p = MODEL_COSTS[model];
    if (!p) return 0;
    return Number((((inputTokens || 0) / 1e6) * p.input + ((outputTokens || 0) / 1e6) * p.output).toFixed(6));
}
function readUsage(completion) {
    const u = completion?.usage || {};
    return {
        input: u.prompt_tokens ?? u.input_tokens ?? 0,
        output: u.completion_tokens ?? u.output_tokens ?? 0
    };
}

// Compat: onora un override esplicito ammesso, altrimenti il modello economy.
// Il routing per piano/contenuto avviene in summarizeWithOpenAI via selectSummaryModel.
export function getSummaryModel(requestedModel) {
    return selectSummaryModel({ requestedModel });
}

export function buildSummaryPlan(content) {
    const profile = SUMMARY_PROFILES[content.summaryProfile] || SUMMARY_PROFILES.standard;
    const isVideo = content.sourceType === 'video';
    const sourceEquivalentWords = isVideo && Number(content.videoDurationSeconds) > 0
        ? Math.round((Number(content.videoDurationSeconds) / 60) * WORDS_PER_MINUTE)
        : countWords(content.text);
    // squeeze = % del testo originale da mantenere nella sintesi (10/20/50).
    // Se presente ha la priorità: savings = 100 - squeeze. Altrimenti si usa il
    // profilo, con i video meno sintetici (risparmio massimo 75%).
    const squeeze = [10, 20, 50].includes(Number(content.squeeze)) ? Number(content.squeeze) : null;
    const savingsPercent = squeeze !== null
        ? (100 - squeeze)
        : (isVideo ? Math.min(profile.savingsPercent, 75) : profile.savingsPercent);
    const bulletCap = isVideo ? 12 : 8;
    const targetWords = Math.max(1, Math.min(
        MAX_SUMMARY_WORDS,
        Math.floor(sourceEquivalentWords * ((100 - savingsPercent) / 100))
    ));
    return {
        profile: SUMMARY_PROFILES[content.summaryProfile] ? content.summaryProfile : 'standard',
        savingsPercent,
        sourceEquivalentWords,
        targetWords,
        bulletCount: Math.max(1, Math.min(bulletCap, Math.ceil(targetWords / 90)))
    };
}

// Compat: il prompt Lemon vive ora in prompts/summary.standard.mjs.
function createPrompt(content, language = 'it', plan = buildSummaryPlan(content)) {
    return getPromptBuilder('summary.standard')(content, language, plan);
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

// Compat: il parser dei bullet Lemon vive ora in schemas/summary.mjs.
// Re-export per i consumatori/test esistenti.
export function coerceBullets(response) {
    return getSchema('summary').parse(response);
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
        // Routing cost-aware: override esplicito > (Premium + contenuto lungo → premium) > economy.
        // `let` perché il fallback può escalare al premium su output inutilizzabile.
        let model = selectSummaryModel({
            requestedModel: content.model,
            plan: content.plan,
            wordCount: countWords(content.text)
        });
        // Il brand seleziona prompt profile e output schema via config (no if/else brand).
        const brand = getBrand(content.brand);
        const outputSchemaName = brand.outputSchema;
        const promptStartTime = Date.now();
        const { systemPrompt, userPrompt } = getPromptBuilder(brand.promptProfile)(content, content.language, plan);
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
        // Accumula i token di TUTTE le completion (retry/compressione inclusi).
        let inTok = 0;
        let outTok = 0;
        let costAcc = 0;
        // Costo accumulato per-tentativo col modello attivo (corretto anche in caso di escalation).
        const addUsage = (c) => { const u = readUsage(c); inTok += u.input; outTok += u.output; costAcc += estimateCost(model, u.input, u.output); };
        const usagePayload = () => ({ input_tokens: inTok, output_tokens: outTok, cost_estimate: Number(costAcc.toFixed(6)), model });
        // Fallback: escala al premium SOLO quando l'output economy è inutilizzabile.
        const escalateToPremium = (reason) => {
            const premium = fallbackModel();
            if (model !== premium) { console.warn('[ROUTER] fallback → premium', { from: model, reason }); model = premium; }
        };
        const requestCompletion = async (messages, strictSchema = true) => client.chat.completions.create({
            model,
            messages,
            reasoning_effort: 'minimal',
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
            reasoning_effort: 'minimal'
        });
        const readResponseText = (result) => {
            const message = result?.choices?.[0]?.message;
            if (typeof message?.content === 'string') return message.content.trim();
            if (Array.isArray(message?.content)) {
                return message.content.map((part) => part?.text || '').join('').trim();
            }
            return '';
        };

        // Path generico per schemi non-summary (es. Scout "attention"): output
        // strutturato validato dal parser dello schema. Il path Lemon (summary)
        // resta invariato sotto.
        if (outputSchemaName !== 'summary') {
            const schema = getSchema(outputSchemaName);
            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ];
            let genCompletion;
            if (schema.responseFormat) {
                genCompletion = await client.chat.completions.create({
                    model, messages, reasoning_effort: 'minimal', response_format: schema.responseFormat
                });
            } else {
                genCompletion = await requestCompletion(messages, false);
            }
            addUsage(genCompletion);
            let output = schema.parse(readResponseText(genCompletion));
            if (!output) {
                // Output economy inutilizzabile → escala al premium e riprova in JSON mode.
                escalateToPremium('structured-parse-failed');
                genCompletion = schema.responseFormat
                    ? await client.chat.completions.create({ model, messages, reasoning_effort: 'minimal', response_format: schema.responseFormat })
                    : await requestCompletion(messages, false);
                addUsage(genCompletion);
                output = schema.parse(readResponseText(genCompletion));
            }
            if (!output) throw new Error('Risposta OpenAI non utilizzabile');
            const genStats = calculateReadingStats(content.text, '');
            console.log('✅ [TIMING] Structured output generated:', {
                url: content.url, schema: outputSchemaName, brand: content.brand
            });
            return {
                schema: outputSchemaName,
                output,
                usage: usagePayload(),
                stats: {
                    originalWords: genStats.originalWords,
                    originalReadingTime: formatTime(genStats.originalReadingTime)
                }
            };
        }

        // Keep the proven plain-text path as the primary request. Structured
        // output is only a recovery path; it must never block a summary.
        let completion = await requestPlainCompletion([
            { role: 'system', content: `${systemPrompt} Restituisci solo i bullet, uno per riga, preceduti da •.` },
            { role: 'user', content: userPrompt }
        ]);
        addUsage(completion);
        const apiCallTime = Date.now() - apiCallStartTime;
        console.log('⚡ [TIMING] OpenAI API call took:', apiCallTime, 'ms');
        let response = readResponseText(completion);

        // Retry once with the less restrictive JSON mode. This covers transient
        // empty structured-output responses without ever falling back to page metadata.
        if (!response) {
            console.warn('[OPENAI] Empty plain response; retrying JSON mode', {
                finishReason: completion?.choices?.[0]?.finish_reason,
                refusal: completion?.choices?.[0]?.message?.refusal || null
            });
            escalateToPremium('empty-plain');
            completion = await requestCompletion([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ], false);
            addUsage(completion);
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
            addUsage(completion);
            response = readResponseText(completion);
        }
        if (!response) throw new Error('Risposta vuota da OpenAI');

        let bullets = coerceBullets(response);
        if (!bullets.length) throw new Error('Risposta OpenAI non utilizzabile');

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
            addUsage(completion);
            const compressed = coerceBullets(readResponseText(completion));
            if (compressed.length) {
                bullets = compressed;
                summaryText = bullets.map((bullet) => `• ${bullet}`).join('\n');
            }
            // Se la compressione non produce nulla, conserva il primo risultato valido.
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
            usage: usagePayload(),
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
