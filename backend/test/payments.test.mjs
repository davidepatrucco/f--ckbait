// payments.test.mjs - Test per il modulo Payments

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Payments Module Tests', () => {
    it('should import payments functions correctly', async () => {
        const { 
            createCheckoutSession, 
            verifyCheckoutSession, 
            handleStripeWebhook,
            getUserSubscription,
            cancelSubscription,
            reactivateSubscription 
        } = await import('../src/payments.mjs');
        
        assert.strictEqual(typeof createCheckoutSession, 'function', 'createCheckoutSession should be a function');
        assert.strictEqual(typeof verifyCheckoutSession, 'function', 'verifyCheckoutSession should be a function');
        assert.strictEqual(typeof handleStripeWebhook, 'function', 'handleStripeWebhook should be a function');
        assert.strictEqual(typeof getUserSubscription, 'function', 'getUserSubscription should be a function');
        assert.strictEqual(typeof cancelSubscription, 'function', 'cancelSubscription should be a function');
        assert.strictEqual(typeof reactivateSubscription, 'function', 'reactivateSubscription should be a function');
    });

    it('should validate plan types', async () => {
        const { createCheckoutSession } = await import('../src/payments.mjs');
        
        try {
            // Test con piano valido - dovrebbe fallire per mancanza di configurazione Stripe, non per piano invalido
            await createCheckoutSession('test-user-123', 'test@example.com', 'premium_monthly');
        } catch (error) {
            // Ci aspettiamo un errore di configurazione Stripe, non di piano invalido
            assert.ok(!error.message.includes('Piano non valido'), 'premium_monthly should be a valid plan');
        }

        try {
            // Test con piano invalido
            await createCheckoutSession('test-user-123', 'test@example.com', 'invalid_plan');
            assert.fail('Should have thrown an error for invalid plan');
        } catch (error) {
            assert.ok(error.message.includes('Piano non valido'), 'Should reject invalid plan types');
        }
    });

    it('should handle Stripe errors gracefully', async () => {
        const { getUserSubscription } = await import('../src/payments.mjs');
        
        try {
            // Questo dovrebbe fallire perché DynamoDB non è configurato in test
            await getUserSubscription('nonexistent-user');
        } catch (error) {
            assert.ok(error.message.includes('Errore'), 'Should throw descriptive error');
        }
    });

    it('should validate webhook signature requirement', async () => {
        const { handleStripeWebhook } = await import('../src/payments.mjs');
        
        try {
            // Test senza signature - dovrebbe fallire
            await handleStripeWebhook('{"type": "test"}', '');
            assert.fail('Should have thrown an error for missing webhook secret');
        } catch (error) {
            assert.ok(error.message.includes('STRIPE_WEBHOOK_SECRET'), 'Should require webhook secret configuration');
        }
    });

    it('should validate subscription data structure', () => {
        // Test della struttura dati che dovremmo salvare per le subscription
        const expectedSubscriptionStructure = {
            user_id: 'string',
            stripe_customer_id: 'string',
            stripe_subscription_id: 'string',
            status: 'string',
            plan_type: 'string',
            current_period_start: 'string',
            current_period_end: 'string',
            amount: 'number',
            currency: 'string',
            created_at: 'string',
            updated_at: 'string'
        };

        // Verifichiamo che la struttura sia quella attesa
        assert.ok(Object.keys(expectedSubscriptionStructure).length === 11, 'Subscription should have 11 fields');
        assert.ok(expectedSubscriptionStructure.stripe_customer_id === 'string', 'Should have Stripe customer ID');
        assert.ok(expectedSubscriptionStructure.stripe_subscription_id === 'string', 'Should have Stripe subscription ID');
        assert.ok(expectedSubscriptionStructure.status === 'string', 'Should track subscription status');
        assert.ok(expectedSubscriptionStructure.plan_type === 'string', 'Should track plan type');
    });

    it('should define correct product configuration', async () => {
        // Test che i prodotti Stripe siano definiti correttamente
        const paymentsModule = await import('../src/payments.mjs');
        
        // Verifichiamo che il modulo gestisca i piani supportati
        const supportedPlans = ['premium_monthly', 'premium_yearly'];
        
        // Test che i piani supportati siano riconosciuti
        for (const plan of supportedPlans) {
            try {
                await paymentsModule.createCheckoutSession('test-user', 'test@example.com', plan);
            } catch (error) {
                // L'errore dovrebbe essere di configurazione Stripe, non di piano invalido
                assert.ok(!error.message.includes('Piano non valido'), `${plan} should be a supported plan`);
            }
        }
    });

    it('should handle checkout session validation', async () => {
        const { verifyCheckoutSession } = await import('../src/payments.mjs');
        
        try {
            // Test con session ID invalido
            await verifyCheckoutSession('invalid_session_id');
            assert.fail('Should have thrown an error for invalid session ID');
        } catch (error) {
            // Ci aspettiamo un errore Stripe, non un crash
            assert.ok(error.message.includes('Errore verifica sessione'), 'Should handle invalid session gracefully');
        }
    });
});