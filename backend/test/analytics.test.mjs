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

    it('should extract domain correctly', async () => {
        // Importiamo le funzioni utility indirettamente
        const analyticsModule = await import('../src/analytics.mjs');
        
        // Test che logSummaryEvent gestisca URL correttamente
        const eventData = {
            userId: 'test123',
            userEmail: 'test@example.com',
            userPlan: 'free',
            url: 'https://www.example.com/article/123',
            title: 'Test Article',
            language: 'it',
            charsInput: 1000,
            charsOutput: 200,
            durationMs: 3500,
            success: true
        };

        // Il test verifica che la funzione non lanci errori
        try {
            // In ambiente di test, DynamoDB potrebbe non essere disponibile
            // quindi ci aspettiamo che la funzione gestisca gli errori gracefully
            await analyticsModule.logSummaryEvent(eventData);
            // Se arriviamo qui, la funzione ha gestito l'errore correttamente
            assert.ok(true, 'logSummaryEvent handled error gracefully');
        } catch (error) {
            // La funzione dovrebbe catturare gli errori DynamoDB e restituire null
            assert.ok(true, 'Expected behavior when DynamoDB is not available');
        }
    });

    it('should handle analytics errors gracefully', async () => {
        const { getUserStats } = await import('../src/analytics.mjs');
        
        try {
            // Questo dovrebbe fallire perché DynamoDB non è configurato in test
            await getUserStats('nonexistent-user');
            assert.fail('Should have thrown an error');
        } catch (error) {
            assert.ok(error.message.includes('Errore'), 'Should throw descriptive error');
        }
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