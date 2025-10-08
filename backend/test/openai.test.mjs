// test/openai.test.mjs - Test per il modulo OpenAI
import { strict as assert } from 'assert';
import { test, describe } from 'node:test';
import { summarizeWithOpenAI, testOpenAIConnection } from '../src/openai.mjs';

describe('OpenAI Module Tests', () => {
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