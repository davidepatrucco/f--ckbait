// Output schema: brief (Briefly). "Che contesto mi manca": brief esecutivo
// multi-sezione. Parser difensivo.
import { tryParseJson, stringList, oneString } from './util.mjs';

export const name = 'brief';

export const responseFormat = {
    type: 'json_schema',
    json_schema: {
        name: 'briefly_brief',
        strict: true,
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['strategic_importance', 'what_happened', 'why_it_matters', 'background', 'alternative_views', 'watch_next'],
            properties: {
                strategic_importance: { type: 'string' },
                what_happened: { type: 'array', items: { type: 'string' } },
                why_it_matters: { type: 'array', items: { type: 'string' } },
                background: { type: 'array', items: { type: 'string' } },
                alternative_views: { type: 'array', items: { type: 'string' } },
                watch_next: { type: 'array', items: { type: 'string' } }
            }
        }
    }
};

export function parse(response) {
    const p = tryParseJson(response);
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    const out = {
        strategic_importance: oneString(p.strategic_importance),
        what_happened: stringList(p.what_happened),
        why_it_matters: stringList(p.why_it_matters),
        background: stringList(p.background),
        alternative_views: stringList(p.alternative_views),
        watch_next: stringList(p.watch_next)
    };
    if (!out.what_happened.length && !out.why_it_matters.length && !out.background.length) return null;
    return out;
}
