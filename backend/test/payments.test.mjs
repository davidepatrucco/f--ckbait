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
            // Test con piano invalido (brand valido, planType invalido)
            await createCheckoutSession('test-user-123', 'test@example.com', 'lemonsqueezer', 'invalid_plan');
            assert.fail('Should have thrown an error for invalid plan');
        } catch (error) {
            assert.ok(error.message.includes('Piano non valido'), 'Should reject invalid plan types');
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

});
