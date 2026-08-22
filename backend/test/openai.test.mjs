// test/openai.test.mjs - Test per il modulo OpenAI
import { strict as assert } from 'assert';
import { test, describe } from 'node:test';
import { summarizeWithOpenAI, testOpenAIConnection, buildSummaryPlan, getSummaryModel } from '../src/openai.mjs';

describe('OpenAI Module Tests', () => {
    test('should size summaries from source length and selected target', () => {
        const webPlan = buildSummaryPlan({
            text: Array(1001).fill('word').join(' '),
            sourceType: 'web',
            summaryProfile: 'standard'
        });
        assert.equal(webPlan.targetWords, 100);
        assert.equal(webPlan.savingsPercent, 90);

        const videoPlan = buildSummaryPlan({
            text: 'short transcript is irrelevant when duration is supplied',
            sourceType: 'video',
            videoDurationSeconds: 20 * 60,
            summaryProfile: 'ultra'
        });
        assert.equal(videoPlan.sourceEquivalentWords, 4400);
        assert.equal(videoPlan.targetWords, 220);
        assert.equal(videoPlan.savingsPercent, 95);
        assert.equal(buildSummaryPlan({ text: 'one two three' }).profile, 'standard');
        assert.equal(typeof getSummaryModel(), 'string');
    });
    test('should validate input parameters', async () => {
        const content = {
            url: 'https://example.com',
            title: 'Test Page',
            text: 'Short text', // Troppo breve
            language: 'it'
        };
        
        try {
            await summarizeWithOpenAI(content);
            assert.fail('Should have thrown an error for short text');
        } catch (error) {
            assert(error.message.includes('troppo breve'));
        }
    });
    
    test('should handle missing OpenAI API key', async () => {
        // Salva la chiave originale
        const originalKey = process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_API_KEY;
        
        const content = {
            url: 'https://example.com',
            title: 'Test Page',
            text: 'This is a longer text that should be sufficient for testing the validation logic of the summarization function.',
            language: 'it'
        };
        
        try {
            await summarizeWithOpenAI(content);
            assert.fail('Should have thrown an error for missing API key');
        } catch (error) {
            assert(error.message.includes('OPENAI_API_KEY'));
        } finally {
            // Ripristina la chiave
            if (originalKey) {
                process.env.OPENAI_API_KEY = originalKey;
            }
        }
    });
    
    test('should test OpenAI connection (if API key is available)', async () => {
        if (!process.env.OPENAI_API_KEY) {
            console.log('Skipping OpenAI connection test - no API key');
            return;
        }
        
        const result = await testOpenAIConnection();
        assert(typeof result === 'object');
        assert(typeof result.success === 'boolean');
        assert(typeof result.timestamp === 'string');
    });
});
