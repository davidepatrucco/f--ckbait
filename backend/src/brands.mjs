// brands.mjs - Registry di configurazione multi-brand (MVP, config-driven).
// Regola: "Shared identity, independent commercial lifecycle per brand".
// Il brand seleziona configurazione (prompt, schema output, quota, prezzi).
// Nessuna logica di business brand-specifica: solo dati di configurazione.

// Free = 1 summary/giorno (reset giornaliero, vedi getNextResetDate in auth.mjs).
import { PLAN_POLICY } from './policy.mjs';

const FREE_LIMIT_DEFAULT = PLAN_POLICY.free.dailySummaries;
// Prove gratuite iniziali, consumate PRIMA che entri in vigore il limite giornaliero:
// 1 riassunto al giorno e' troppo ruvido per chi installa l'estensione e deve capire
// se gli serve. Una tantum per brand, non si ricaricano.
const FREE_TRIAL_DEFAULT = PLAN_POLICY.free.trialSummaries;

export const DEFAULT_BRAND = 'lemonsqueezer';

export const BRANDS = {
    lemonsqueezer: {
        id: 'lemonsqueezer',
        displayName: 'LemonSqueezer',
        site: 'https://lemonsqueezer.app',
        promptProfile: 'summary.standard',
        outputSchema: 'summary',
        defaultMode: 'standard',
        freeLimit: FREE_LIMIT_DEFAULT,
        freeTrial: FREE_TRIAL_DEFAULT,
        stripe: {
            monthlyPriceKey: 'STRIPE_LEMONSQUEEZER_PREMIUM_MONTHLY_PRICE_ID',
            yearlyPriceKey: 'STRIPE_LEMONSQUEEZER_PREMIUM_YEARLY_PRICE_ID'
        }
    },
    scout: {
        id: 'scout',
        displayName: 'Scout',
        site: 'https://bifa.digital/scout',
        promptProfile: 'scout.evaluate',
        outputSchema: 'attention',
        defaultMode: 'standard',
        freeLimit: FREE_LIMIT_DEFAULT,
        freeTrial: FREE_TRIAL_DEFAULT,
        stripe: {
            monthlyPriceKey: 'STRIPE_SCOUT_PREMIUM_MONTHLY_PRICE_ID',
            yearlyPriceKey: 'STRIPE_SCOUT_PREMIUM_YEARLY_PRICE_ID'
        }
    },
    signal: {
        id: 'signal',
        displayName: 'Signal',
        site: 'https://bifa.digital/signal',
        promptProfile: 'signal.insights',
        outputSchema: 'insights',
        defaultMode: 'standard',
        freeLimit: FREE_LIMIT_DEFAULT,
        freeTrial: FREE_TRIAL_DEFAULT,
        stripe: {
            monthlyPriceKey: 'STRIPE_SIGNAL_PREMIUM_MONTHLY_PRICE_ID',
            yearlyPriceKey: 'STRIPE_SIGNAL_PREMIUM_YEARLY_PRICE_ID'
        }
    },
    briefly: {
        id: 'briefly',
        displayName: 'Briefly',
        site: 'https://bifa.digital/briefly',
        promptProfile: 'briefly.brief',
        outputSchema: 'brief',
        defaultMode: 'standard',
        freeLimit: FREE_LIMIT_DEFAULT,
        freeTrial: FREE_TRIAL_DEFAULT,
        stripe: {
            monthlyPriceKey: 'STRIPE_BRIEFLY_PREMIUM_MONTHLY_PRICE_ID',
            yearlyPriceKey: 'STRIPE_BRIEFLY_PREMIUM_YEARLY_PRICE_ID'
        }
    },
    nobull: {
        id: 'nobull',
        displayName: 'NoBull',
        site: 'https://bifa.digital/nobull',
        promptProfile: 'nobull.noise',
        outputSchema: 'noise',
        defaultMode: 'standard',
        freeLimit: FREE_LIMIT_DEFAULT,
        freeTrial: FREE_TRIAL_DEFAULT,
        stripe: {
            monthlyPriceKey: 'STRIPE_NOBULL_PREMIUM_MONTHLY_PRICE_ID',
            yearlyPriceKey: 'STRIPE_NOBULL_PREMIUM_YEARLY_PRICE_ID'
        }
    }
};

export function isValidBrand(id) {
    return typeof id === 'string' && Object.prototype.hasOwnProperty.call(BRANDS, id);
}

export function resolveBrandId(rawId) {
    return isValidBrand(rawId) ? rawId : DEFAULT_BRAND;
}

export function getBrand(id) {
    return BRANDS[id] || BRANDS[DEFAULT_BRAND];
}

// Sito pubblico del brand: origine delle pagine di ritorno del checkout e dei legali.
// Lemon ha un dominio proprio; gli altri restano su bifa.digital/<brand> finche' non
// superano la review dello store (un dominio ciascuno costa e ha senso solo per chi lancia).
export function getBrandSite(id) {
    return getBrand(id).site;
}

export function getFreeLimit(id) {
    return getBrand(id).freeLimit;
}
// Prove gratuite iniziali del brand (0 = disattivate).
export function getFreeTrial(brandId) {
    const b = BRANDS[brandId] || BRANDS[DEFAULT_BRAND];
    return Number.isFinite(b?.freeTrial) ? b.freeTrial : FREE_TRIAL_DEFAULT;
}


export function listBrands() {
    return Object.keys(BRANDS);
}
