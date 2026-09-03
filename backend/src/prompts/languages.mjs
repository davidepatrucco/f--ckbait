// Lingue di output supportate per i prompt (condivise tra i profili).
export const OUTPUT_LANGUAGES = { it: 'italiano', en: 'English', es: 'español', fr: 'français', de: 'Deutsch' };

export function outputLanguageName(lang) {
    return OUTPUT_LANGUAGES[lang] || OUTPUT_LANGUAGES.it;
}

// Nota di qualità linguistica condivisa tra i profili. Contrasta i difetti visti in QA:
// parole storpiate/inventate (es. "potentiale", "transformative"), termini stranieri non
// tradotti (es. "accountability", "wisdom"), apostrofi/accenti mancanti ("l impersonazione").
export function languageQualityNote(outputLanguage) {
    return `Scrivi in ${outputLanguage} corretto e naturale: ortografia e grammatica impeccabili, inclusi accenti ed elisioni con apostrofo. Non inventare o storpiare parole. Non lasciare termini in altre lingue: traduci sempre in ${outputLanguage}; se un termine tecnico non ha un equivalente diffuso, riportalo tra virgolette seguito da una breve resa in ${outputLanguage}.`;
}
