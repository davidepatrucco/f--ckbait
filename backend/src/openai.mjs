// openai.mjs - Modulo per l'integrazione con OpenAI
import OpenAI from 'openai';

// Inizializza client OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Prompt template per le diverse lingue
const PROMPTS = {
    it: `Sei un esperto riassuntore. Il tuo compito è creare un riassunto molto conciso di qualsiasi contenuto web.

REGOLE FONDAMENTALI:
- Crea ESATTAMENTE 3-4 bullet points
- Ogni bullet deve essere massimo 25-30 parole
- Usa un linguaggio chiaro e diretto
- Concentrati sui punti più importanti e informativi
- Evita ripetizioni
- Non includere dettagli marginali o promozionali

Restituisci SOLO i bullet points, uno per riga, preceduti da "• ".`,

    en: `You are an expert summarizer. Your task is to create a very concise summary of any web content.

FUNDAMENTAL RULES:
- Create EXACTLY 3-4 bullet points
- Each bullet must be maximum 25-30 words
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

// Funzione per parsare la risposta e estrarre i bullet points
function parseBulletPoints(response) {
    const text = response.trim();
    
    // Estrai i bullet points
    const bullets = text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => {
            // Rimuovi i marker dei bullet points se presenti
            return line.replace(/^[•\-\*\+]\s*/, '').trim();
        })
        .filter(line => line.length > 10); // Filtra righe troppo corte
    
    // Assicurati di avere 3-4 bullet points
    if (bullets.length < 3) {
        throw new Error('La risposta dell\'AI non contiene abbastanza punti validi');
    }
    
    // Prendi solo i primi 4 se ce ne sono di più
    const finalBullets = bullets.slice(0, 4);
    
    return {
        summary: finalBullets.join('\n'),
        bullets: finalBullets
    };
}

// Funzione principale per il riassunto con OpenAI
export async function summarizeWithOpenAI(content) {
    try {
        // Valida input
        if (!content.text || content.text.length < 50) {
            throw new Error('Contenuto troppo breve per essere riassunto');
        }
        
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY non configurato');
        }
        
        const { systemPrompt, userPrompt } = createPrompt(content, content.language);
        
        console.log('Calling OpenAI with:', {
            model: 'gpt-4o-mini',
            language: content.language,
            contentLength: content.text.length,
            url: content.url
        });
        
        // Chiamata a OpenAI
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
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
            max_tokens: 300,
            temperature: 0.3,
            timeout: 15000 // 15 secondi timeout
        });
        
        const response = completion.choices[0]?.message?.content;
        
        if (!response) {
            throw new Error('Risposta vuota da OpenAI');
        }
        
        console.log('OpenAI response:', response);
        
        // Parsa la risposta
        const result = parseBulletPoints(response);
        
        // Log del risultato (senza contenuto per privacy)
        console.log('Parsed result:', {
            bulletsCount: result.bullets.length,
            avgBulletLength: result.bullets.reduce((sum, b) => sum + b.length, 0) / result.bullets.length
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
        const response = await openai.models.list();
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