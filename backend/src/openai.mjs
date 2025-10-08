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

// Prompt template per le diverse lingue
const PROMPTS = {
    it: `Sei un esperto riassuntore. Il tuo compito è creare un riassunto molto conciso di qualsiasi contenuto web.

REGOLE FONDAMENTALI:
- Crea un summary (200 parole) + 3-4 bullet points
- Ogni bullet deve essere massimo 50-100 parole
- Usa un linguaggio chiaro e diretto
- Concentrati sui punti più importanti e informativi, evita contenuti marginali e bait
- Evita ripetizioni
- Non includere dettagli marginali o promozionali, pubblicitari

Restituisci SOLO i bullet points, uno per riga, preceduti da "• ".`,

    en: `You are an expert summarizer. Your task is to create a very concise summary of any web content.

REGOLE FONDAMENTALI:
- Summarize (200 word) + 3-4 bullet points
- Every bullet must be maximum 50-100 words
- Use clear and direct language
- Focus on the most important and informative points
- Avoid repetitions
- Don't include marginal or promotional details

Return ONLY the bullet points, one per line, preceded by "• ".`,

    es: `Eres un experto en resúmenes. Tu tarea es crear un resumen muy conciso de cualquier contenido web.

REGLAS FUNDAMENTALES:
- Crea EXACTAMENTE 3-4 puntos
- Cada punto debe tener máximo 25-30 palabras
- Usa un lenguaje claro y directo
- Concéntrate en los puntos más importantes e informativos
- Evita repeticiones
- No incluyas detalles marginales o promocionales

Devuelve SOLO los puntos, uno por línea, precedidos por "• ".`,

    fr: `Tu es un expert en résumés. Ta tâche est de créer un résumé très concis de tout contenu web.

RÈGLES FONDAMENTALES:
- Crée EXACTEMENT 3-4 points
- Chaque point doit faire maximum 25-30 mots
- Utilise un langage clair et direct
- Concentre-toi sur les points les plus importants et informatifs
- Évite les répétitions
- N'inclus pas de détails marginaux ou promotionnels

Retourne SEULEMENT les points, un par ligne, précédés de "• ".`,

    de: `Du bist ein Experte für Zusammenfassungen. Deine Aufgabe ist es, eine sehr prägnante Zusammenfassung von jedem Web-Inhalt zu erstellen.

GRUNDREGELN:
- Erstelle GENAU 3-4 Aufzählungspunkte
- Jeder Punkt darf maximal 25-30 Wörter haben
- Verwende klare und direkte Sprache
- Konzentriere dich auf die wichtigsten und informativsten Punkte
- Vermeide Wiederholungen
- Füge keine marginalen oder werblichen Details hinzu

Gib NUR die Punkte zurück, einen pro Zeile, mit "• " vorangestellt.`
};

// Funzione per creare il prompt completo
function createPrompt(content, language = 'it') {
    const systemPrompt = PROMPTS[language] || PROMPTS.it;
    
    const userPrompt = `Titolo: ${content.title}
URL: ${content.url}

Contenuto:
${content.text}

Riassumi questo contenuto seguendo le regole specificate.`;

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
        
        const promptStartTime = Date.now();
        const { systemPrompt, userPrompt } = createPrompt(content, content.language);
        console.log('⚡ [TIMING] Prompt creation took:', Date.now() - promptStartTime, 'ms');
        
        console.log('🚀 [TIMING] Calling OpenAI with:', {
            model: 'gpt-5-nano',
            language: content.language,
            contentLength: content.text.length,
            url: content.url
        });
        
        const apiCallStartTime = Date.now();
        // Chiamata a OpenAI
        const client = await getOpenAIClient();
        const completion = await client.chat.completions.create({
            model: 'gpt-5-nano',
            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                {
                    role: 'user',
                    content: userPrompt
                }
            ],
            max_completion_tokens: 3000,
            reasoning_effort: "low"
        });
        const apiCallTime = Date.now() - apiCallStartTime;
        console.log('⚡ [TIMING] OpenAI API call took:', apiCallTime, 'ms');
        
        console.log('Full OpenAI completion:', JSON.stringify(completion, null, 2));
        
        const response = completion.choices[0]?.message?.content;
        
        console.log('Extracted response:', response);
        console.log('Choices length:', completion.choices?.length);
        console.log('First choice:', completion.choices?.[0]);
        
        if (!response) {
            throw new Error('Risposta vuota da OpenAI');
        }
        
        console.log('OpenAI response:', response);
        
        if (!response) {
            throw new Error('Risposta vuota da OpenAI');
        }
        
        // Calcola statistiche di lettura
        const statsStartTime = Date.now();
        const stats = calculateReadingStats(content.text, response);
        console.log('⚡ [TIMING] Stats calculation took:', Date.now() - statsStartTime, 'ms');
        
        // Restituisce direttamente il testo di OpenAI con le statistiche
        const result = {
            text: response,
            readingTimeMinutes: Math.ceil(stats.summaryReadingTime / 60),
            wordsCount: stats.summaryWords,
            stats: {
                originalWords: stats.originalWords,
                summaryWords: stats.summaryWords,
                timeSaved: stats.timeSaved,
                compressionRatio: stats.compressionRatio,
                originalReadingTime: formatTime(stats.originalReadingTime),
                summaryReadingTime: formatTime(stats.summaryReadingTime)
            }
        };
        
        const totalOpenAITime = Date.now() - startTime;
        console.log('🏁 [TIMING] Total OpenAI function time:', totalOpenAITime, 'ms');
        
        // Log del risultato (senza contenuto per privacy)
        console.log('✅ [TIMING] Summary generated:', {
            url: content.url,
            title: content.title,
            language: content.language,
            textLength: content.text.length,
            summaryBullets: result.text.split('•').length - 1
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