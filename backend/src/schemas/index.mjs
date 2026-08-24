// Registry degli output schema. Il brand seleziona lo schema via config
// (brands.mjs -> outputSchema). Ogni schema espone parse() e opzionale responseFormat.
import * as summary from './summary.mjs';
import * as scout from './scout.mjs';
import * as signal from './signal.mjs';
import * as nobull from './nobull.mjs';
import * as briefly from './briefly.mjs';

const REGISTRY = {
    summary,
    attention: scout,
    insights: signal,
    noise: nobull,
    brief: briefly
};

export const DEFAULT_SCHEMA = 'summary';

export function getSchema(name) {
    return REGISTRY[name] || REGISTRY[DEFAULT_SCHEMA];
}

export function listSchemas() {
    return Object.keys(REGISTRY);
}
