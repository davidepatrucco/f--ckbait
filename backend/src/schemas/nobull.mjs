// Output schema: noise (NoBull). "Quanto è hype": clickbait/hype/densità informativa,
// fatti distinguibili dal framing. Parser difensivo.
import { tryParseJson, clampScore, stringList, oneString } from './util.mjs';

export const name = 'noise';

export const responseFormat = {
    type: 'json_schema',
    json_schema: {
        name: 'nobull_noise',
        strict: true,
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['clickbait_score', 'hype_score', 'information_density', 'facts', 'filler_patterns', 'framing_note'],
            properties: {
                clickbait_score: { type: 'integer', minimum: 0, maximum: 100 },
                hype_score: { type: 'integer', minimum: 0, maximum: 100 },
                information_density: { type: 'integer', minimum: 0, maximum: 100 },
                facts: { type: 'array', items: { type: 'string' } },
                filler_patterns: { type: 'array', items: { type: 'string' } },
                framing_note: { type: 'string' }
            }
        }
    }
};

export function parse(response) {
    const p = tryParseJson(response);
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    const out = {
        clickbait_score: clampScore(p.clickbait_score),
        hype_score: clampScore(p.hype_score),
        information_density: clampScore(p.information_density),
        facts: stringList(p.facts),
        filler_patterns: stringList(p.filler_patterns),
        framing_note: oneString(p.framing_note)
    };
    if (!out.facts.length && !out.filler_patterns.length && !out.framing_note) return null;
    return out;
}
