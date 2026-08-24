// Registry degli output schema. Il brand seleziona lo schema via config
// (brands.mjs -> outputSchema). Ogni schema espone parse() e opzionale responseFormat.
import * as summary from './summary.mjs';
import * as scout from './scout.mjs';

const REGISTRY = {
    summary,
    attention: scout
};

export const DEFAULT_SCHEMA = 'summary';

export function getSchema(name) {
    return REGISTRY[name] || REGISTRY[DEFAULT_SCHEMA];
}

export function listSchemas() {
    return Object.keys(REGISTRY);
}
