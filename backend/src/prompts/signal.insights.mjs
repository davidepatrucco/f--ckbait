// Prompt profile: signal.insights (Signal). "Cosa conta davvero".
import { outputLanguageName } from './languages.mjs';

export function buildPrompt(content, language = 'it') {
    const outputLanguage = outputLanguageName(language);
    const sourceLabel = content.sourceType === 'video' ? 'Trascrizione video' : 'Contenuto pagina web';

    const systemPrompt = `Sei un analista che estrae il segnale dal rumore per un decisore. Usa solo la fonte fornita, senza inventare. I campi testuali vanno scritti in ${outputLanguage}. Rispondi esclusivamente con un oggetto JSON valido secondo lo schema, senza testo extra.`;

    const userPrompt = `Titolo: ${content.title}
URL: ${content.url}

Analizza il contenuto e restituisci un oggetto JSON con:
- signal_score: intero 0-100 (quanto è rilevante/azionabile)
- key_takeaways: array di 2-5 punti chiave
- risks: array di rischi rilevati (può essere vuoto)
- opportunities: array di opportunità rilevate (può essere vuoto)
- decision_note: una frase con l'implicazione decisionale

${sourceLabel}:
${content.text}`;

    return { systemPrompt, userPrompt };
}
