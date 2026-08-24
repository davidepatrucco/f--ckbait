import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPromptBuilder, listPromptProfiles } from '../src/prompts/index.mjs';
import { getSchema, listSchemas } from '../src/schemas/index.mjs';
import { getBrand } from '../src/brands.mjs';
import { coerceBullets } from '../src/openai.mjs';

const planStub = { profile: 'standard', savingsPercent: 80, targetWords: 100, bulletCount: 3 };

describe('prompt registry & builders', () => {
    it('routes profiles and defaults to summary.standard', () => {
        assert.equal(typeof getPromptBuilder('summary.standard'), 'function');
        assert.equal(getPromptBuilder('does.not.exist'), getPromptBuilder('summary.standard'));
        assert.ok(listPromptProfiles().includes('scout.evaluate'));
    });

    it('summary prompt: no "JSON" in system prompt (regression), contains source + target', () => {
        const { systemPrompt, userPrompt } = getPromptBuilder('summary.standard')(
            { title: 'T', url: 'https://x/y', text: 'body text here', sourceType: 'web' }, 'it', planStub);
        assert.doesNotMatch(systemPrompt, /JSON/i);
        assert.match(userPrompt, /body text here/);
        assert.match(userPrompt, /100 parole/);
    });

    it('summary prompt localizes the comments bullet label', () => {
        const content = { title: 'T', url: 'u', text: 'x', sourceType: 'video', videoDurationSeconds: 600, description: 'desc', comments: ['nice', 'bad'] };
        const it = getPromptBuilder('summary.standard')(content, 'it', planStub).userPrompt;
        const en = getPromptBuilder('summary.standard')(content, 'en', planStub).userPrompt;
        assert.match(it, /💬 Commenti:/);
        assert.match(en, /💬 Comments:/);
        assert.match(it, /Descrizione del video/);
    });

    it('scout prompt asks for the attention JSON fields', () => {
        const { systemPrompt, userPrompt } = getPromptBuilder('scout.evaluate')(
            { title: 'T', url: 'u', text: 'x', sourceType: 'web' }, 'en');
        assert.match(systemPrompt, /JSON/i);
        for (const f of ['attention_score', 'recommendation', 'novelty', 'importance', 'credibility', 'reasons']) {
            assert.match(userPrompt, new RegExp(f));
        }
    });
});

describe('schema registry', () => {
    it('lists and routes schemas; brand config points to real schemas', () => {
        assert.ok(listSchemas().includes('attention'));
        assert.equal(getBrand('scout').outputSchema, 'attention');
        assert.equal(getBrand('scout').promptProfile, 'scout.evaluate');
        assert.equal(getBrand('bogus').outputSchema, 'summary'); // default brand
    });
});

describe('summary schema parser (adversarial)', () => {
    const parse = getSchema('summary').parse;

    it('handles a raw JSON object followed by a trailing comment line', () => {
        const raw = '{\n"bullets": [\n"• Fact one.",\n"• Fact two."\n],\n"max_word_count": 774\n}\n💬 Commenti: sentiment cauto.';
        const b = parse(raw);
        assert.deepEqual(b.slice(0, 2), ['Fact one.', 'Fact two.']);
        assert.ok(b.some((x) => x.startsWith('💬 Commenti:')));
        assert.ok(!b.some((x) => /max_word_count|"bullets"|^[{}\[\]]/.test(x)));
    });

    it('handles singular {bullet}, {summary}, arrays, prose, empty', () => {
        assert.deepEqual(parse('{"bullet":"Solo uno"}'), ['Solo uno']);
        assert.deepEqual(parse('{"summary":"Uno. Due."}'), ['Uno.', 'Due.']);
        assert.deepEqual(parse('["a","b"]'), ['a', 'b']);
        assert.deepEqual(parse('• one\n• two'), ['one', 'two']);
        assert.deepEqual(parse(''), []);
    });

    it('is identical to the re-exported coerceBullets', () => {
        const sample = '{"bullets":["x","y"]}';
        assert.deepEqual(coerceBullets(sample), parse(sample));
    });
});

describe('scout schema parser (adversarial)', () => {
    const parse = getSchema('attention').parse;

    it('normalizes a valid object', () => {
        const out = parse('{"attention_score":72,"recommendation":"read_now","novelty":50,"importance":60,"credibility":80,"reasons":["a","b"]}');
        assert.equal(out.attention_score, 72);
        assert.equal(out.recommendation, 'read_now');
        assert.deepEqual(out.reasons, ['a', 'b']);
    });

    it('clamps out-of-range scores and normalizes recommendation casing', () => {
        const out = parse('{"attention_score":150,"recommendation":"READ NOW","novelty":-5,"importance":9999,"credibility":50,"reasons":[]}');
        assert.equal(out.attention_score, 100);
        assert.equal(out.novelty, 0);
        assert.equal(out.importance, 100);
        assert.equal(out.recommendation, 'read_now');
    });

    it('invalid recommendation falls back to skim; reasons string is split', () => {
        const out = parse('{"attention_score":40,"recommendation":"maybe","reasons":"one. two."}');
        assert.equal(out.recommendation, 'skim');
        assert.deepEqual(out.reasons, ['one.', 'two.']);
    });

    it('parses JSON embedded in surrounding text', () => {
        const out = parse('Here is my evaluation:\n{"attention_score":10,"recommendation":"ignore","reasons":["meh"]}\nThanks!');
        assert.equal(out.attention_score, 10);
        assert.equal(out.recommendation, 'ignore');
    });

    it('missing fields get safe defaults', () => {
        const out = parse('{"reasons":["only reason"]}');
        assert.equal(out.attention_score, 0);
        assert.equal(out.recommendation, 'skim');
        assert.equal(out.credibility, 0);
    });

    it('returns null for non-JSON or non-object', () => {
        assert.equal(parse('just some prose, no json'), null);
        assert.equal(parse('["a","b"]'), null);
        assert.equal(parse(''), null);
    });
});
