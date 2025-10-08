#!/usr/bin/env node

// Test OpenAI con Parameter Store
import { summarizeWithOpenAI } from './src/openai.mjs';

// Forza ambiente production per usare Parameter Store
process.env.ENVIRONMENT = 'production';
process.env.AWS_REGION = 'eu-west-1';

async function testOpenAI() {
    console.log('🤖 Testing OpenAI with Parameter Store...\n');
    
    try {
        const testText = 'This is a longer article about artificial intelligence and machine learning. AI has revolutionized many industries including healthcare, finance, and technology. Machine learning algorithms can process vast amounts of data to identify patterns and make predictions. Deep learning, a subset of machine learning, uses neural networks with multiple layers to solve complex problems. The applications of AI are growing rapidly and transforming how we work and live.';
        
        const summary = await summarizeWithOpenAI(testText, 'https://example.com/ai-article');
        
        console.log('✅ OpenAI Summary Generated:');
        console.log('---');
        console.log(summary);
        console.log('---\n');
        
    } catch (error) {
        console.error('❌ OpenAI Test Failed:', error.message);
    }
}

testOpenAI();