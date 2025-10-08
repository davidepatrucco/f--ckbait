#!/usr/bin/env node

// Simula quello che succede nella Lambda
import { summarizeWithOpenAI } from './src/openai.mjs';

// Forza ambiente production (come nella Lambda)
process.env.ENVIRONMENT = 'production';
process.env.AWS_REGION = 'eu-west-1';

async function simulateLambda() {
    console.log('🔥 Simulating Lambda behavior with missing OpenAI API key...\n');
    
    try {
        const testText = 'This is a test article to see what happens when OpenAI API key is missing.';
        const summary = await summarizeWithOpenAI(testText, 'https://test.com');
        
        console.log('✅ Success:', summary);
        
    } catch (error) {
        console.log('❌ Lambda would return this error:', error.message);
        console.log('🔍 Error type:', error.constructor.name);
    }
}

simulateLambda();