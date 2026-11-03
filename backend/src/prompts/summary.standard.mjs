// Prompt profile: summary.standard (LemonSqueezer).
// Estratto verbatim da openai.mjs (regression-zero). Nucleo = pagina/trascrizione
// (+ descrizione video); i commenti diventano un singolo bullet finale localizzato.
import { outputLanguageName, languageQualityNote } from './languages.mjs';
import { UNTRUSTED_NOTE, fenceUntrusted } from './untrusted.mjs';

export const COMMENTS_LABEL = { it: 'Commenti', en: 'Comments', es: 'Comentarios', fr: 'Commentaires', de: 'Kommentare' };

export function buildPrompt(content, language = 'it', plan) {
    const outputLanguage = outputLanguageName(language);
    const isVideo = content.sourceType === 'video';
    const sourceLabel = isVideo ? 'Trascrizione video' : 'Contenuto pagina web';
    const description = isVideo && typeof content.description === 'string'
        ? content.description.trim().slice(0, 3000) : '';
    const comments = Array.isArray(content.comments)
        ? content.comments.filter((c) => typeof c === 'string' && c.trim()).slice(0, 40) : [];
    const hasComments = comments.length > 0;

    const systemPrompt = `Sei un riassuntore editoriale rigoroso. ${languageQualityNote(outputLanguage)} Usa solo informazioni presenti nella fonte; elimina pubblicità, menu, footer, ripetizioni e dettagli marginali. ${UNTRUSTED_NOTE}`;

    let userPrompt = `Titolo: ${content.title}
URL: ${content.url}

Obiettivo: profilo ${plan.profile}; lunghezza totale dei bullet circa ${plan.targetWords} parole (non meno di ${Math.round(plan.targetWords * 0.8)}, non più di ${plan.targetWords}): l'utente ha scelto questa lunghezza, rispettala anche se la fonte si potrebbe riassumere in meno. Genera ${plan.bulletCount} bullet di circa ${Math.round(plan.targetWords / plan.bulletCount)} parole ciascuno, meno bullet solo se la fonte è troppo breve.

${sourceLabel}:
${fenceUntrusted(content.text)}`;

    if (description) {
        userPrompt += `

Descrizione del video (fa parte del NUCLEO del riassunto, insieme alla trascrizione):
${fenceUntrusted(description)}`;
    }

    if (hasComments) {
        const commentsLabel = COMMENTS_LABEL[language] || COMMENTS_LABEL.it;
        userPrompt += `

Commenti degli utenti (NON usarli per il nucleo). Sintetizzali in UN SOLO bullet finale, aggiuntivo rispetto ai ${plan.bulletCount} del nucleo, scritto in ${outputLanguage}, che inizi ESATTAMENTE con "${commentsLabel}:" e indichi in breve di cosa si discute e il sentiment prevalente:
${fenceUntrusted(comments.join('\n'))}`;
    }

    return { systemPrompt, userPrompt };
}
