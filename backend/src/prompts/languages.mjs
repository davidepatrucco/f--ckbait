// Lingue di output supportate per i prompt (condivise tra i profili).
export const OUTPUT_LANGUAGES = { it: 'italiano', en: 'English', es: 'español', fr: 'français', de: 'Deutsch' };

export function outputLanguageName(lang) {
    return OUTPUT_LANGUAGES[lang] || OUTPUT_LANGUAGES.it;
}
