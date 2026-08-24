// Output schema: attention (Scout). Valuta se il contenuto merita attenzione.
// Parser difensivo: normalizza/valida qualsiasi output del modello a uno schema stabile.
import { tryParseJson } from './util.mjs';

export const name = 'attention';

const RECOMMENDATIONS = ['read_now', 'skim', 'save', 'ignore'];

// response_format json_schema (strict) per il path strutturato.
export const responseFormat = {
    type: 'json_schema',
    json_schema: {
        name: 'scout_attention',
        strict: true,
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['attention_score', 'recommendation', 'novelty', 'importance', 'credibility', 'reasons'],
            properties: {
                attention_score: { type: 'integer', minimum: 0, maximum: 100 },
                recommendation: { type: 'string', enum: RECOMMENDATIONS },
                novelty: { type: 'integer', minimum: 0, maximum: 100 },
                importance: { type: 'integer', minimum: 0, maximum: 100 },
                credibility: { type: 'integer', minimum: 0, maximum: 100 },
                reasons: { type: 'array', minItems: 1, items: { type: 'string' } }
            }
        }
    }
};

const clampScore = (v) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
};

const normalizeRecommendation = (v) => {
    const s = String(v || '').toLowerCase().trim().replace(/\s+/g, '_');
    return RECOMMENDATIONS.includes(s) ? s : 'skim';
};

const normalizeReasons = (v) => {
    if (Array.isArray(v)) {
        return v.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 6);
    }
    if (typeof v === 'string' && v.trim()) {
        return v.split(/\r?\n+|(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean).slice(0, 6);
    }
    return [];
};

// Ritorna null se non è ricavabile nulla di utile (nessun oggetto JSON valido).
export function parse(response) {
    const parsed = tryParseJson(response);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
    }
    const attention = clampScore(parsed.attention_score);
    return {
        attention_score: attention,
        recommendation: normalizeRecommendation(parsed.recommendation),
        novelty: clampScore(parsed.novelty),
        importance: clampScore(parsed.importance),
        credibility: clampScore(parsed.credibility),
        reasons: normalizeReasons(parsed.reasons)
    };
}
