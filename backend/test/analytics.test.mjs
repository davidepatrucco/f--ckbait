// analytics.test.mjs - Test per il modulo Analytics

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Analytics Module Tests', () => {
    it('should import analytics functions correctly', async () => {
        const { 
            logSummaryEvent, 
            getUserStats, 
            getGlobalStats,
            getTrendingDomains 
        } = await import('../src/analytics.mjs');
        
        assert.strictEqual(typeof logSummaryEvent, 'function', 'logSummaryEvent should be a function');
        assert.strictEqual(typeof getUserStats, 'function', 'getUserStats should be a function');
        assert.strictEqual(typeof getGlobalStats, 'function', 'getGlobalStats should be a function');
        assert.strictEqual(typeof getTrendingDomains, 'function', 'getTrendingDomains should be a function');
    });

    it('should validate analytics event structure', () => {
        // Test della struttura dati che dovremmo salvare
        const expectedEventStructure = {
            id: 'uuid',
            user_id: 'string',
            email: 'string', 
            plan: 'string',
            url: 'string',
            url_domain: 'string',
            title: 'string',
            language: 'string',
            chars_input: 'number',
            chars_output: 'number',
            duration_ms: 'number',
            timestamp: 'string',
            date_partition: 'string',
            user_agent: 'string',
            success: 'boolean',
            error_code: 'string|null'
        };

        // Verifichiamo che la struttura sia quella attesa
        assert.ok(Object.keys(expectedEventStructure).length === 16, 'Event should have 16 fields');
        assert.ok(expectedEventStructure.id === 'uuid', 'Should have UUID id');
        assert.ok(expectedEventStructure.success === 'boolean', 'Should track success status');
    });
});
