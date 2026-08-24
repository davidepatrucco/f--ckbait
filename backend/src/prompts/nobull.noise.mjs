// Prompt profile: nobull.noise (NoBull). "Quanto è hype".
import { outputLanguageName } from './languages.mjs';

export function buildPrompt(content, language = 'it') {
    const outputLanguage = outputLanguageName(language);
    const sourceLabel = content.sourceType === 'video' ? 'Trascrizione video' : 'Contenuto pagina web';

    const systemPrompt = `Sei un analista che smaschera hype e clickbait distinguendo i fatti dal framing. Giudica solo in base alla fonte, senza inventare accuse non supportate. I campi testuali vanno scritti in ${outputLanguage}. Rispondi esclusivamente con un oggetto JSON valido secondo lo schema, senza testo extra.`;

    const userPrompt = `Titolo: ${content.title}
URL: ${content.url}

Analizza il contenuto e restituisci un oggetto JSON con:
- clickbait_score: intero 0-100
- hype_score: intero 0-100
- information_density: intero 0-100 (quanta sostanza informativa reale)
- facts: array di affermazioni fattuali verificabili presenti nella fonte
- filler_patterns: array di schemi di riempimento/hype rilevati (può essere vuoto)
- framing_note: una frase sul taglio/framing, senza dichiarare inganni senza prove

${sourceLabel}:
${content.text}`;

    return { systemPrompt, userPrompt };
}
