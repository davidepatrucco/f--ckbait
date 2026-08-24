import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema, listSchemas } from '../src/schemas/index.mjs';
import { getPromptBuilder } from '../src/prompts/index.mjs';
import { getBrand, listBrands } from '../src/brands.mjs';

describe('all 5 brands route to a registered prompt profile and output schema', () => {
    it('brand config points to existing registries', () => {
        for (const b of listBrands()) {
            const cfg = getBrand(b);
            const builder = getPromptBuilder(cfg.promptProfile);
            assert.equal(typeof builder, 'function', `${b}: prompt builder mancante`);
            const schema = getSchema(cfg.outputSchema);
            assert.equal(typeof schema.parse, 'function', `${b}: schema parser mancante`);
        }
        for (const s of ['summary', 'attention', 'insights', 'noise', 'brief']) {
            assert.ok(listSchemas().includes(s), `schema ${s} non registrato`);
        }
    });
});

describe('Signal (insights) parser', () => {
    const parse = getSchema('insights').parse;
    it('normalizes a valid object and clamps the score', () => {
        const out = parse('{"signal_score":150,"key_takeaways":["a","b"],"risks":["r"],"opportunities":[],"decision_note":"agire"}');
        assert.equal(out.signal_score, 100);
        assert.deepEqual(out.key_takeaways, ['a', 'b']);
        assert.equal(out.decision_note, 'agire');
    });
    it('accepts takeaways as a string (split) and JSON embedded in text', () => {
        const out = parse('ecco:\n{"signal_score":40,"key_takeaways":"uno. due.","risks":[],"opportunities":[],"decision_note":""}\nfine');
        assert.deepEqual(out.key_takeaways, ['uno.', 'due.']);
    });
    it('returns null on non-JSON or empty-content object', () => {
        assert.equal(parse('nope'), null);
        assert.equal(parse('{"signal_score":50}'), null); // nessun contenuto
    });
});

describe('NoBull (noise) parser', () => {
    const parse = getSchema('noise').parse;
    it('clamps all three scores and keeps facts', () => {
        const out = parse('{"clickbait_score":-5,"hype_score":999,"information_density":50,"facts":["f1"],"filler_patterns":["hype"],"framing_note":"nota"}');
        assert.equal(out.clickbait_score, 0);
        assert.equal(out.hype_score, 100);
        assert.equal(out.information_density, 50);
        assert.deepEqual(out.facts, ['f1']);
    });
    it('null when no facts/filler/framing', () => {
        assert.equal(parse('{"clickbait_score":10,"hype_score":10,"information_density":10,"facts":[],"filler_patterns":[]}'), null);
    });
});

describe('Briefly (brief) parser', () => {
    const parse = getSchema('brief').parse;
    it('builds the multi-section brief', () => {
        const out = parse(JSON.stringify({
            strategic_importance: 'alta',
            what_happened: ['x'], why_it_matters: ['y'], background: ['z'],
            alternative_views: [], watch_next: ['q1', 'q2']
        }));
        assert.equal(out.strategic_importance, 'alta');
        assert.deepEqual(out.what_happened, ['x']);
        assert.deepEqual(out.watch_next, ['q1', 'q2']);
    });
    it('null when core sections are empty', () => {
        assert.equal(parse('{"strategic_importance":"x","what_happened":[],"why_it_matters":[],"background":[]}'), null);
    });
});

describe('prompts list required JSON fields', () => {
    const src = { title: 'T', url: 'u', text: 'body', sourceType: 'web' };
    it('signal prompt', () => {
        const { userPrompt } = getPromptBuilder('signal.insights')(src, 'en');
        for (const f of ['signal_score', 'key_takeaways', 'risks', 'opportunities', 'decision_note']) assert.match(userPrompt, new RegExp(f));
    });
    it('nobull prompt', () => {
        const { userPrompt } = getPromptBuilder('nobull.noise')(src, 'en');
        for (const f of ['clickbait_score', 'hype_score', 'information_density', 'facts', 'filler_patterns', 'framing_note']) assert.match(userPrompt, new RegExp(f));
    });
    it('briefly prompt', () => {
        const { userPrompt } = getPromptBuilder('briefly.brief')(src, 'en');
        for (const f of ['strategic_importance', 'what_happened', 'why_it_matters', 'background', 'watch_next']) assert.match(userPrompt, new RegExp(f));
    });
});
