// dynamodb.test.mjs - Test per il modulo DynamoDB

import { describe, it, before } from 'node:test';
import assert from 'node:assert';

describe('DynamoDB Module Tests', () => {
    it('should import DynamoDB functions correctly', async () => {
        const { 
            getUserById, 
            createUser, 
            formatUserFromDynamoDB 
        } = await import('../src/dynamodb.mjs');
        
        assert.strictEqual(typeof getUserById, 'function', 'getUserById should be a function');
        assert.strictEqual(typeof createUser, 'function', 'createUser should be a function');
        assert.strictEqual(typeof formatUserFromDynamoDB, 'function', 'formatUserFromDynamoDB should be a function');
    });

    it('should format user data correctly', async () => {
        const { formatUserFromDynamoDB } = await import('../src/dynamodb.mjs');
        
        const dynamoUser = {
            id: 'test123',
            email: 'test@example.com',
            name: 'Test User',
            picture: 'https://example.com/pic.jpg',
            plan: 'free',
            usage_used: 5,
            usage_limit: 10,
            usage_reset_date: '2025-10-01T00:00:00.000Z',
            created_at: '2025-09-01T00:00:00.000Z',
            last_login: '2025-09-29T10:00:00.000Z'
        };

        const formattedUser = formatUserFromDynamoDB(dynamoUser);

        assert.strictEqual(formattedUser.id, 'test123');
        assert.strictEqual(formattedUser.email, 'test@example.com');
        assert.strictEqual(formattedUser.plan, 'free');
        assert.strictEqual(formattedUser.usage.used, 5);
        assert.strictEqual(formattedUser.usage.limit, 10);
        assert.strictEqual(formattedUser.usage.resetDate, '2025-10-01T00:00:00.000Z');
    });

    it('should handle null user data', async () => {
        const { formatUserFromDynamoDB } = await import('../src/dynamodb.mjs');
        
        const result = formatUserFromDynamoDB(null);
        assert.strictEqual(result, null);
        
        const result2 = formatUserFromDynamoDB(undefined);
        assert.strictEqual(result2, null);
    });
});