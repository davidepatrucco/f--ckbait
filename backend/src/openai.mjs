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
    it: `Sei un esperto riassuntore. Il tuo compito è creare un riassunto ESTREMAMENTE conciso di qualsiasi contenuto web.

REGOLE FONDAMENTALI:
- Il riassunto finale deve essere MASSIMO il 20% delle parole originali (riduzione minima dell'80%)
- Crea 3-4 bullet points chiarissimi
- Ogni bullet deve essere massimo 40-60 parole
- Usa un linguaggio chiaro, diretto e denso di informazioni
- Concentrati SOLO sui punti più importanti e informativi, elimina tutto il resto
- Evita ripetizioni, fluff, contenuti marginali, bait, promozionali o pubblicitari
- Sii spietato: taglia tutto ciò che non è essenziale

Restituisci SOLO i bullet points, uno per riga, preceduti da "• ".`,

    en: `You are an expert summarizer. Your task is to create an EXTREMELY concise summary of any web content.

FUNDAMENTAL RULES:
- Final summary must be MAXIMUM 20% of original word count (minimum 80% reduction)
- Create 3-4 crystal-clear bullet points
- Each bullet must be maximum 40-60 words
- Use clear, direct and information-dense language
- Focus ONLY on the most important and informative points, eliminate everything else
- Avoid repetitions, fluff, marginal content, bait, promotional or advertising content
- Be ruthless: cut everything that isn't essential

Return ONLY the bullet points, one per line, preceded by "• ".`,

    es: `Eres un experto en resúmenes. Tu tarea es crear un resumen EXTREMADAMENTE conciso de cualquier contenido web.

REGLAS FUNDAMENTALES:
- El resumen final debe ser MÁXIMO el 20% de las palabras originales (reducción mínima del 80%)
- Crea 3-4 puntos ultra-claros
- Cada punto debe tener máximo 40-60 palabras
- Usa un lenguaje claro, directo y denso de información
- Concéntrate SOLO en los puntos más importantes e informativos, elimina todo lo demás
- Evita repeticiones, fluff, contenido marginal, bait, promocional o publicitario
- Sé despiadado: corta todo lo que no sea esencial

Devuelve SOLO los puntos, uno por línea, precedidos por "• ".`,

    fr: `Tu es un expert en résumés. Ta tâche est de créer un résumé EXTRÊMEMENT concis de tout contenu web.

RÈGLES FONDAMENTALES:
- Le résumé final doit être MAXIMUM 20% du nombre de mots originaux (réduction minimale de 80%)
- Crée 3-4 points ultra-clairs
- Chaque point doit faire maximum 40-60 mots
- Utilise un langage clair, direct et dense en informations
- Concentre-toi UNIQUEMENT sur les points les plus importants et informatifs, élimine tout le reste
- Évite les répétitions, le fluff, le contenu marginal, le bait, le promotionnel ou publicitaire
- Sois impitoyable: coupe tout ce qui n'est pas essentiel

Retourne SEULEMENT les points, un par ligne, précédés de "• ".`,

    de: `Du bist ein Experte für Zusammenfassungen. Deine Aufgabe ist es, eine EXTREM prägnante Zusammenfassung von jedem Web-Inhalt zu erstellen.

GRUNDREGELN:
- Die finale Zusammenfassung muss MAXIMAL 20% der ursprünglichen Wortanzahl sein (mindestens 80% Reduzierung)
- Erstelle 3-4 ultra-klare Aufzählungspunkte
- Jeder Punkt darf maximal 40-60 Wörter haben
- Verwende klare, direkte und informationsdichte Sprache
- Konzentriere dich NUR auf die wichtigsten und informativsten Punkte, eliminiere alles andere
- Vermeide Wiederholungen, Füllwörter, marginale Inhalte, Bait, werbliche Details
- Sei gnadenlos: schneide alles weg, was nicht essentiell ist

Gib NUR die Punkte zurück, einen pro Zeile, mit "• " vorangestellt.`
};

// Funzione per creare il prompt completo
function createPrompt(content, language = 'it') {
    const systemPrompt = PROMPTS[language] || PROMPTS.it;
    const sourceLabel = content.sourceType === 'video' ? 'Trascrizione video' : 'Contenuto pagina web';
    
    const userPrompt = `Titolo: ${content.title}
URL: ${content.url}

${sourceLabel}:
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
        
        const response = completion.choices[0]?.message?.content;
        
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
        
        // Do not log generated content: it may contain sensitive page data.
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
