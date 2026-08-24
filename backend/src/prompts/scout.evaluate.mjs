// Prompt profile: scout.evaluate (Scout).
// Domanda di prodotto: "vale il mio tempo?". Output = valutazione dell'attenzione,
// NON un riassunto. Prova che il multi-brand non è una skin: schema diverso da Lemon.
import { outputLanguageName } from './languages.mjs';

export function buildPrompt(content, language = 'it') {
    const outputLanguage = outputLanguageName(language);
    const isVideo = content.sourceType === 'video';
    const sourceLabel = isVideo ? 'Trascrizione video' : 'Contenuto pagina web';

    const systemPrompt = `Sei un analista che valuta se un contenuto merita l'attenzione del lettore. Giudica solo in base alla fonte fornita, senza inventare. Le motivazioni (reasons) vanno scritte in ${outputLanguage}. Rispondi esclusivamente con un oggetto JSON valido secondo lo schema richiesto, senza testo aggiuntivo.`;

    const userPrompt = `Titolo: ${content.title}
URL: ${content.url}

Valuta il seguente contenuto e restituisci un oggetto JSON con questi campi:
- attention_score: intero 0-100 (quanto merita attenzione complessivamente)
- recommendation: uno tra "read_now", "skim", "save", "ignore"
- novelty: intero 0-100 (quanto è nuovo/originale)
- importance: intero 0-100 (rilevanza/impatto)
- credibility: intero 0-100 (affidabilità apparente della fonte)
- reasons: array di 2-4 stringhe brevi che spiegano il giudizio

${sourceLabel}:
${content.text}`;

    return { systemPrompt, userPrompt };
}
