// Output schema: insights (Signal). "Cosa conta davvero": punteggio di rilevanza,
// takeaway, rischi, opportunità, nota decisionale. Parser difensivo.
import { tryParseJson, clampScore, stringList, oneString } from './util.mjs';

export const name = 'insights';

export const responseFormat = {
    type: 'json_schema',
    json_schema: {
        name: 'signal_insights',
        strict: true,
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['signal_score', 'key_takeaways', 'risks', 'opportunities', 'decision_note'],
            properties: {
                signal_score: { type: 'integer', minimum: 0, maximum: 100 },
                key_takeaways: { type: 'array', items: { type: 'string' } },
                risks: { type: 'array', items: { type: 'string' } },
                opportunities: { type: 'array', items: { type: 'string' } },
                decision_note: { type: 'string' }
            }
        }
    }
};

export function parse(response) {
    const p = tryParseJson(response);
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    const out = {
        signal_score: clampScore(p.signal_score),
        key_takeaways: stringList(p.key_takeaways),
        risks: stringList(p.risks),
        opportunities: stringList(p.opportunities),
        decision_note: oneString(p.decision_note)
    };
    // Utile solo se c'è almeno un contenuto oltre al punteggio.
    if (!out.key_takeaways.length && !out.risks.length && !out.opportunities.length && !out.decision_note) return null;
    return out;
}
