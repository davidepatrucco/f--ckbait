// Prompt profile: briefly.brief (Briefly). "Che contesto mi manca".
import { outputLanguageName } from './languages.mjs';
import { UNTRUSTED_NOTE, fenceUntrusted } from './untrusted.mjs';

export function buildPrompt(content, language = 'it') {
    const outputLanguage = outputLanguageName(language);
    const sourceLabel = content.sourceType === 'video' ? 'Trascrizione video' : 'Contenuto pagina web';

    const systemPrompt = `Sei un analista che produce brief esecutivi contestuali. Usa solo la fonte fornita, senza inventare. I campi testuali vanno scritti in ${outputLanguage}. Rispondi esclusivamente con un oggetto JSON valido secondo lo schema, senza testo extra. ${UNTRUSTED_NOTE}`;

    const userPrompt = `Titolo: ${content.title}
URL: ${content.url}

Produci un brief esecutivo come oggetto JSON con:
- strategic_importance: una frase sull'importanza strategica
- what_happened: array di sviluppi principali
- why_it_matters: array sul perché è rilevante
- background: array di contesto pregresso utile
- alternative_views: array di letture/contraddizioni alternative (può essere vuoto)
- watch_next: array di domande aperte / cosa monitorare

${sourceLabel}:
${fenceUntrusted(content.text)}`;

    return { systemPrompt, userPrompt };
}
