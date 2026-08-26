// brands.mjs - Registry di configurazione multi-brand (MVP, config-driven).
// Regola: "Shared identity, independent commercial lifecycle per brand".
// Il brand seleziona configurazione (prompt, schema output, quota, prezzi).
// Nessuna logica di business brand-specifica: solo dati di configurazione.

// Free = 1 summary/giorno (reset giornaliero, vedi getNextResetDate in auth.mjs).
const FREE_LIMIT_DEFAULT = parseInt(process.env.FREE_PLAN_LIMIT || '1', 10);

export const DEFAULT_BRAND = 'lemonsqueezer';

export const BRANDS = {
    lemonsqueezer: {
        id: 'lemonsqueezer',
        displayName: 'LemonSqueezer',
        promptProfile: 'summary.standard',
        outputSchema: 'summary',
        defaultMode: 'standard',
        freeLimit: FREE_LIMIT_DEFAULT,
        stripe: {
            monthlyPriceKey: 'STRIPE_PREMIUM_MONTHLY_PRICE_ID',
            yearlyPriceKey: 'STRIPE_PREMIUM_YEARLY_PRICE_ID'
        }
    },
    scout: {
        id: 'scout',
        displayName: 'Scout',
        promptProfile: 'scout.evaluate',
        outputSchema: 'attention',
        defaultMode: 'standard',
        freeLimit: FREE_LIMIT_DEFAULT,
        stripe: {
            monthlyPriceKey: 'STRIPE_SCOUT_PREMIUM_MONTHLY_PRICE_ID',
            yearlyPriceKey: 'STRIPE_SCOUT_PREMIUM_YEARLY_PRICE_ID'
        }
    },
    signal: {
        id: 'signal',
        displayName: 'Signal',
        promptProfile: 'signal.insights',
        outputSchema: 'insights',
        defaultMode: 'standard',
        freeLimit: FREE_LIMIT_DEFAULT,
        stripe: {
            monthlyPriceKey: 'STRIPE_SIGNAL_PREMIUM_MONTHLY_PRICE_ID',
            yearlyPriceKey: 'STRIPE_SIGNAL_PREMIUM_YEARLY_PRICE_ID'
        }
    },
    briefly: {
        id: 'briefly',
        displayName: 'Briefly',
        promptProfile: 'briefly.brief',
        outputSchema: 'brief',
        defaultMode: 'standard',
        freeLimit: FREE_LIMIT_DEFAULT,
        stripe: {
            monthlyPriceKey: 'STRIPE_BRIEFLY_PREMIUM_MONTHLY_PRICE_ID',
            yearlyPriceKey: 'STRIPE_BRIEFLY_PREMIUM_YEARLY_PRICE_ID'
        }
    },
    nobull: {
        id: 'nobull',
        displayName: 'NoBull',
        promptProfile: 'nobull.noise',
        outputSchema: 'noise',
        defaultMode: 'standard',
        freeLimit: FREE_LIMIT_DEFAULT,
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

export function getFreeLimit(id) {
    return getBrand(id).freeLimit;
}

export function listBrands() {
    return Object.keys(BRANDS);
}
