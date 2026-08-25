// model-router.mjs — cost-aware model routing (PM #3A).
//
// Il prezzo del prodotto è slegato dal modello: il router sceglie il modello per
// RUOLO (economy/premium), non hardcoded. Regole:
//   - Free            → sempre ECONOMY
//   - Premium         → ECONOMY quando basta; PREMIUM solo se il contenuto lo richiede
//   - Fallback        → PREMIUM solo su errore/qualità insufficiente (gestito in openai.mjs)
//
// Modelli configurabili via env (unica fonte di verità dei prezzi: MODEL_COSTS_JSON in openai.mjs):
//   ECONOMY_MODEL, PREMIUM_MODEL, PREMIUM_WORDCOUNT_THRESHOLD
//
// Deprecazione gpt-5-nano (2026-12-10): dopo la data l'ECONOMY passa a gpt-5.4-nano
// (NON a luna: luna è il tier premium). Così l'economy resta economico e il margine
// ad alto volume non collassa. Vedi design/unit-economics-*.

export const NANO_DEPRECATION_MS = Date.parse('2026-12-10T00:00:00Z');

// Soglia (parole) oltre la quale un utente Premium viene instradato al modello premium.
export const PREMIUM_WORDCOUNT = Number(process.env.PREMIUM_WORDCOUNT_THRESHOLD || 6000);

export function economyModel(now = Date.now()) {
    // Precedenza: ECONOMY_MODEL > SUMMARY_MODEL (override legacy) > default per data.
    if (process.env.ECONOMY_MODEL) return process.env.ECONOMY_MODEL;
    if (process.env.SUMMARY_MODEL) return process.env.SUMMARY_MODEL;
    return now >= NANO_DEPRECATION_MS ? 'gpt-5.4-nano' : 'gpt-5-nano';
}

export function premiumModel() {
    return process.env.PREMIUM_MODEL || 'gpt-5.6-luna';
}

export function tierModels(now = Date.now()) {
    return { economy: economyModel(now), premium: premiumModel() };
}

// Modelli accettati come override esplicito dal client/harness.
export function allowedModels(now = Date.now()) {
    const { economy, premium } = tierModels(now);
    return new Set([economy, premium, 'gpt-5-nano', 'gpt-5.4-nano', 'gpt-5.6-luna']);
}

// Guard anti-degrado: economy non deve mai coincidere col premium in silenzio.
export function assertTierSanity(now = Date.now()) {
    const { economy, premium } = tierModels(now);
    if (economy === premium) {
        console.warn('[ROUTER] economy === premium: routing degenerato, controlla ECONOMY_MODEL/PREMIUM_MODEL');
    }
    if (economy === 'gpt-5-nano' && now >= NANO_DEPRECATION_MS) {
        console.warn('[ROUTER] ECONOMY=gpt-5-nano oltre la deprecazione (2026-12-10): imposta ECONOMY_MODEL');
    }
}

/**
 * Sceglie il modello per una richiesta di summary.
 * @param {object} p
 * @param {string} [p.requestedModel] override esplicito (onorato solo se ammesso)
 * @param {string} [p.plan] 'free' | 'premium' (o piani premium-like)
 * @param {number} [p.wordCount] parole del contenuto sorgente
 * @param {number} [p.now] timestamp (per test)
 * @returns {string} model id
 */
export function selectSummaryModel({ requestedModel, plan, wordCount = 0, now = Date.now() } = {}) {
    const { economy, premium } = tierModels(now);
    if (requestedModel && allowedModels(now).has(requestedModel)) return requestedModel;
    const isPremiumPlan = typeof plan === 'string' && plan !== 'free' && plan !== '';
    if (isPremiumPlan && wordCount >= PREMIUM_WORDCOUNT) return premium;
    return economy;
}

// Target di fallback quando l'output economy è inutilizzabile.
export function fallbackModel(now = Date.now()) {
    return premiumModel(now);
}
