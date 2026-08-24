// Registry dei prompt profile. Il brand seleziona il profilo via config
// (brands.mjs -> promptProfile). Nessun if/else brand-specifico nel core.
import { buildPrompt as summaryStandard } from './summary.standard.mjs';
import { buildPrompt as scoutEvaluate } from './scout.evaluate.mjs';

const REGISTRY = {
    'summary.standard': summaryStandard,
    'scout.evaluate': scoutEvaluate
};

export const DEFAULT_PROMPT_PROFILE = 'summary.standard';

export function getPromptBuilder(profile) {
    return REGISTRY[profile] || REGISTRY[DEFAULT_PROMPT_PROFILE];
}

export function listPromptProfiles() {
    return Object.keys(REGISTRY);
}
