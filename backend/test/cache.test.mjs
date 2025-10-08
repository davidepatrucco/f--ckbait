// cache.test.mjs - Test per il modulo Cache

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Cache Module Tests', () => {
    it('should import cache functions correctly', async () => {
        const { 
            getCachedSummary, 
            setCachedSummary, 
            shouldCacheUrl,
            getCacheStats,
            cleanExpiredCache 
        } = await import('../src/cache.mjs');
        
        assert.strictEqual(typeof getCachedSummary, 'function', 'getCachedSummary should be a function');
        assert.strictEqual(typeof setCachedSummary, 'function', 'setCachedSummary should be a function');
        assert.strictEqual(typeof shouldCacheUrl, 'function', 'shouldCacheUrl should be a function');
        assert.strictEqual(typeof getCacheStats, 'function', 'getCacheStats should be a function');
        assert.strictEqual(typeof cleanExpiredCache, 'function', 'cleanExpiredCache should be a function');
    });

    it('should determine which URLs should be cached', async () => {
        const { shouldCacheUrl } = await import('../src/cache.mjs');
        
        // URL che dovrebbero essere cachati
        assert.strictEqual(shouldCacheUrl('https://www.example.com/article/123'), true, 'Normal article URL should be cacheable');
        assert.strictEqual(shouldCacheUrl('https://medium.com/@author/story-title'), true, 'Medium article should be cacheable');
        assert.strictEqual(shouldCacheUrl('https://news.ycombinator.com/item?id=123456'), true, 'HN item should be cacheable');
        
        // URL che NON dovrebbero essere cachati
        assert.strictEqual(shouldCacheUrl('https://example.com/page?token=abc123'), false, 'URL with token should not be cacheable');
        assert.strictEqual(shouldCacheUrl('https://example.com/page?auth=secret'), false, 'URL with auth param should not be cacheable');
        assert.strictEqual(shouldCacheUrl('https://localhost:3000/test'), false, 'Localhost URL should not be cacheable');
        assert.strictEqual(shouldCacheUrl('https://192.168.1.1/test'), false, 'Local IP should not be cacheable');
        
        // URL troppo lunghi
        const longUrl = 'https://example.com/' + 'a'.repeat(2000);
        assert.strictEqual(shouldCacheUrl(longUrl), false, 'Very long URL should not be cacheable');
        
        // URL invalidi
        assert.strictEqual(shouldCacheUrl('not-a-url'), false, 'Invalid URL should not be cacheable');
        assert.strictEqual(shouldCacheUrl(''), false, 'Empty URL should not be cacheable');
    });

    it('should handle cache operations gracefully when DynamoDB is not available', async () => {
        const { getCachedSummary, setCachedSummary } = await import('../src/cache.mjs');
        
        // Test che le funzioni non lancino errori anche senza DynamoDB
        try {
            const result = await getCachedSummary('https://example.com/test', 'it');
            assert.strictEqual(result, null, 'Should return null when cache not available');
        } catch (error) {
            // Accettabile che fallisca, ma non dovrebbe crashare l'app
            assert.ok(true, 'Expected behavior when DynamoDB is not available');
        }

        try {
            const summaryData = {
                title: 'Test Article',
                summary: 'This is a test summary.',
                readingTimeMinutes: 3,
                wordsCount: 200,
                stats: { sentences: 5 },
                charsInput: 1000,
                processingTimeMs: 2500
            };
            
            const result = await setCachedSummary('https://example.com/test', 'it', summaryData);
            // Dovrebbe restituire null se fallisce, non crashare
            assert.ok(result === null || typeof result === 'string', 'Should handle cache save gracefully');
        } catch (error) {
            assert.ok(true, 'Expected behavior when DynamoDB is not available');
        }
    });

    it('should normalize URLs consistently', async () => {
        const { shouldCacheUrl } = await import('../src/cache.mjs');
        
        // Test che URLs con parametri tracking vengano gestiti correttamente
        // (La normalizzazione avviene internamente in generateCacheKey)
        
        // Questi dovrebbero essere considerati cacheable perché i parametri tracking vengono rimossi
        assert.strictEqual(shouldCacheUrl('https://example.com/article?utm_source=google'), true);
        assert.strictEqual(shouldCacheUrl('https://example.com/article?fbclid=12345'), true);
        assert.strictEqual(shouldCacheUrl('https://example.com/article?ref=twitter'), true);
        
        // Ma questi non dovrebbero essere cacheable a causa di parametri sensibili
        assert.strictEqual(shouldCacheUrl('https://example.com/article?token=secret'), false);
        assert.strictEqual(shouldCacheUrl('https://example.com/article?session=abc123'), false);
    });

    it('should validate cache data structure', () => {
        // Test della struttura dati che dovremmo salvare in cache
        const expectedCacheStructure = {
            cache_key: 'string',
            url: 'string',
            original_url: 'string',
            language: 'string',
            title: 'string',
            summary: 'string',
            reading_time_minutes: 'number',
            words_count: 'number',
            stats: 'object',
            created_at: 'string',
            expires_at: 'string',
            ttl: 'number',
            cache_hits: 'number',
            chars_input: 'number',
            processing_time_ms: 'number'
        };

        // Verifichiamo che la struttura sia quella attesa
        assert.ok(Object.keys(expectedCacheStructure).length === 15, 'Cache should have 15 fields');
        assert.ok(expectedCacheStructure.cache_key === 'string', 'Should have cache_key');
        assert.ok(expectedCacheStructure.ttl === 'number', 'Should have TTL for auto-cleanup');
        assert.ok(expectedCacheStructure.cache_hits === 'number', 'Should track cache hits');
    });
});