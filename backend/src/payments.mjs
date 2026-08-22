// payments.mjs - Gestione pagamenti Stripe per piano premium

import Stripe from 'stripe';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { updateUserPlan } from './dynamodb.mjs';
import { SecretsManager } from './secrets.mjs';

// Configurazione
const secretsManager = new SecretsManager();

// Configurazione DynamoDB
const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'eu-west-1'
});
const docClient = DynamoDBDocumentClient.from(client);

const PAYMENTS_TABLE = process.env.PAYMENTS_TABLE_NAME || 'tldr-payments';

// Configurazione prodotti Stripe (caricata dinamicamente)
let stripeClient;
let stripeProducts;

/**
 * Inizializza il client Stripe e carica la configurazione
 */
async function initializeStripe() {
    if (!stripeClient) {
        const stripeSecretKey = await secretsManager.getSecret('STRIPE_SECRET_KEY');
        stripeClient = new Stripe(stripeSecretKey);
        
        // Configurazione prodotti Stripe
        const monthlyPriceId = await secretsManager.getSecret('STRIPE_PREMIUM_MONTHLY_PRICE_ID');
        const yearlyPriceId = await secretsManager.getSecret('STRIPE_PREMIUM_YEARLY_PRICE_ID');
        
        stripeProducts = {
            premium_monthly: {
                price_id: monthlyPriceId,
                amount: 999, // €9.99/mese in centesimi
                currency: 'eur',
                interval: 'month'
            },
            premium_yearly: {
                price_id: yearlyPriceId,
                amount: 9999, // €99.99/anno in centesimi  
                currency: 'eur',
                interval: 'year'
            }
        };
    }
    
    return { stripe: stripeClient, products: stripeProducts };
}

/**
 * Crea sessione di checkout Stripe
 */
export async function createCheckoutSession(userId, userEmail, planType = 'premium_monthly') {
    try {
        const { stripe, products } = await initializeStripe();
        
        if (!products[planType]) {
            throw new Error(`Piano non valido: ${planType}`);
        }

        const product = products[planType];
        const successUrl = await secretsManager.getSecret('STRIPE_SUCCESS_URL');
        const cancelUrl = await secretsManager.getSecret('STRIPE_CANCEL_URL');

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price: product.price_id,
                    quantity: 1,
                },
            ],
            mode: 'subscription',
            customer_email: userEmail,
            client_reference_id: userId,
            metadata: {
                user_id: userId,
                plan_type: planType
            },
            success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: cancelUrl,
            allow_promotion_codes: true,
            billing_address_collection: 'auto',
            subscription_data: {
                metadata: {
                    user_id: userId,
                    plan_type: planType
                }
            }
        });

        // Salva sessione temporanea per tracking
        await saveCheckoutSession(userId, session.id, planType);

        return {
            sessionId: session.id,
            url: session.url,
            planType,
            amount: product.amount,
            currency: product.currency,
            interval: product.interval
        };

    } catch (error) {
        console.error('Error creating checkout session:', error);
        throw new Error('Errore creazione sessione pagamento: ' + error.message);
    }
}

/**
 * Verifica stato sessione di checkout
 */
export async function verifyCheckoutSession(sessionId) {
    try {
        const { stripe } = await initializeStripe();
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['subscription', 'customer']
        });

        if (session.payment_status !== 'paid') {
            return {
                success: false,
                status: session.payment_status,
                message: 'Pagamento non completato'
            };
        }

        const userId = session.client_reference_id || session.metadata?.user_id;
        if (!userId) {
            throw new Error('User ID non trovato nella sessione');
        }

        // Ottieni dettagli subscription
        const subscription = session.subscription;
        const customer = session.customer;

        // Salva subscription in database
        await saveSubscription(userId, {
            stripeCustomerId: customer.id,
            stripeSubscriptionId: subscription.id,
            status: subscription.status,
            planType: session.metadata?.plan_type || 'premium_monthly',
            currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
            amount: session.amount_total,
            currency: session.currency
        });

        // Aggiorna piano utente a premium
        await updateUserPlan(userId, 'premium');

        return {
            success: true,
            userId,
            subscriptionId: subscription.id,
            customerId: customer.id,
            status: subscription.status,
            planType: session.metadata?.plan_type,
            currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString()
        };

    } catch (error) {
        console.error('Error verifying checkout session:', error);
        throw new Error('Errore verifica sessione pagamento: ' + error.message);
    }
}

/**
 * Gestisci webhook Stripe
 */
export async function handleStripeWebhook(body, signature) {
    try {
        const { stripe } = await initializeStripe();
        const webhookSecret = await secretsManager.getSecret('STRIPE_WEBHOOK_SECRET');

        // CRITICAL: Always verify webhook signatures - never skip in any environment
        if (!webhookSecret || !signature) {
            throw new Error('STRIPE_WEBHOOK_SECRET not configured or signature missing');
        }

        // Verify webhook signature with raw body
        const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
        return await handleStripeEvent(event);

    } catch (error) {
        console.error('Error handling Stripe webhook:', error);
        throw new Error('Errore gestione webhook Stripe: ' + error.message);
    }
}

async function handleStripeEvent(event) {
    console.log('Stripe webhook event:', event.type);

    switch (event.type) {
        case 'checkout.session.completed':
            await handleCheckoutCompleted(event.data.object);
            break;
        
        case 'customer.subscription.created':
            await handleSubscriptionCreated(event.data.object);
            break;
        
        case 'customer.subscription.updated':
            await handleSubscriptionUpdated(event.data.object);
            break;
        
        case 'customer.subscription.deleted':
            await handleSubscriptionDeleted(event.data.object);
            break;
        
        case 'invoice.payment_succeeded':
            await handlePaymentSucceeded(event.data.object);
            break;
        
        case 'invoice.payment_failed':
            await handlePaymentFailed(event.data.object);
            break;
        
        default:
            console.log(`Unhandled event type: ${event.type}`);
    }

    return { received: true, eventType: event.type };
}

/**
 * Ottieni dettagli subscription utente
 */
export async function getUserSubscription(userId) {
    try {
        const command = new GetCommand({
            TableName: PAYMENTS_TABLE,
            Key: { user_id: userId }
        });

        const response = await docClient.send(command);
        return response.Item || null;

    } catch (error) {
        console.error('Error getting user subscription:', error);
        throw new Error('Errore recupero subscription utente');
    }
}

/**
 * Cancella subscription
 */
export async function cancelSubscription(userId) {
    try {
        const { stripe } = await initializeStripe();

        const subscription = await getUserSubscription(userId);
        if (!subscription) {
            throw new Error('Subscription non trovata');
        }

        // Cancella su Stripe
        await stripe.subscriptions.update(subscription.stripe_subscription_id, {
            cancel_at_period_end: true
        });

        // Aggiorna status nel database
        await updateSubscriptionStatus(userId, 'canceled');

        return {
            success: true,
            message: 'Subscription cancellata. Rimarrà attiva fino alla fine del periodo di fatturazione.',
            cancelAtPeriodEnd: true,
            currentPeriodEnd: subscription.current_period_end
        };

    } catch (error) {
        console.error('Error canceling subscription:', error);
        throw new Error('Errore cancellazione subscription: ' + error.message);
    }
}

/**
 * Riattiva subscription cancellata
 */
export async function reactivateSubscription(userId) {
    try {
        const { stripe } = await initializeStripe();

        const subscription = await getUserSubscription(userId);
        if (!subscription) {
            throw new Error('Subscription non trovata');
        }

        // Riattiva su Stripe
        await stripe.subscriptions.update(subscription.stripe_subscription_id, {
            cancel_at_period_end: false
        });

        // Aggiorna status nel database
        await updateSubscriptionStatus(userId, 'active');

        return {
            success: true,
            message: 'Subscription riattivata con successo.',
            status: 'active'
        };

    } catch (error) {
        console.error('Error reactivating subscription:', error);
        throw new Error('Errore riattivazione subscription: ' + error.message);
    }
}

// --- Funzioni helper ---

async function saveCheckoutSession(userId, sessionId, planType) {
    try {
        const command = new PutCommand({
            TableName: PAYMENTS_TABLE + '_sessions',
            Item: {
                session_id: sessionId,
                user_id: userId,
                plan_type: planType,
                status: 'pending',
                created_at: new Date().toISOString(),
                ttl: Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000) // 24 ore TTL
            }
        });

        await docClient.send(command);
    } catch (error) {
        console.warn('Error saving checkout session:', error.message);
    }
}

async function saveSubscription(userId, subscriptionData) {
    try {
        const command = new PutCommand({
            TableName: PAYMENTS_TABLE,
            Item: {
                user_id: userId,
                stripe_customer_id: subscriptionData.stripeCustomerId,
                stripe_subscription_id: subscriptionData.stripeSubscriptionId,
                status: subscriptionData.status,
                plan_type: subscriptionData.planType,
                current_period_start: subscriptionData.currentPeriodStart,
                current_period_end: subscriptionData.currentPeriodEnd,
                amount: subscriptionData.amount,
                currency: subscriptionData.currency,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }
        });

        await docClient.send(command);
    } catch (error) {
        console.error('Error saving subscription:', error);
        throw error;
    }
}

async function updateSubscriptionStatus(userId, status) {
    try {
        const command = new UpdateCommand({
            TableName: PAYMENTS_TABLE,
            Key: { user_id: userId },
            UpdateExpression: 'SET #status = :status, updated_at = :updatedAt',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':status': status,
                ':updatedAt': new Date().toISOString()
            }
        });

        await docClient.send(command);
    } catch (error) {
        console.error('Error updating subscription status:', error);
        throw error;
    }
}

// --- Webhook handlers ---

async function handleCheckoutCompleted(session) {
    console.log('=== CHECKOUT COMPLETED HANDLER START ===');
    console.log('Session ID:', session.id);
    console.log('Client reference ID:', session.client_reference_id);
    console.log('Metadata:', JSON.stringify(session.metadata));
    console.log('Payment status:', session.payment_status);
    console.log('Status:', session.status);
    
    const userId = session.client_reference_id;
    const planType = session.metadata?.plan_type || 'premium_monthly';
    
    if (!userId) {
        console.error('Missing user ID in checkout session');
        return;
    }
    
    console.log(`Processing upgrade for user ${userId} to plan ${planType}`);
    
    try {
        console.log('Calling updateUserPlan...');
        await updateUserPlan(userId, 'premium');
        console.log('updateUserPlan completed successfully');
        
        // Salva record subscription
        const subscriptionData = {
            user_id: userId,
            subscription_id: session.subscription,
            plan_type: planType,
            status: 'active',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        
        console.log('Saving subscription record...', subscriptionData);
        await saveSubscriptionRecord(userId, subscriptionData);
        console.log('Subscription record saved successfully');
        
        console.log(`User ${userId} upgraded to premium plan: ${planType}`);
        console.log('=== CHECKOUT COMPLETED HANDLER END ===');
        
    } catch (error) {
        console.error('Error processing checkout completion:', error);
        console.error('Error stack:', error.stack);
        throw error;
    }
}

async function handleSubscriptionCreated(subscription) {
    console.log('Subscription created:', subscription.id);
    // Logica già gestita in handleCheckoutCompleted
}

async function handleSubscriptionUpdated(subscription) {
    console.log('Subscription updated:', subscription.id);
    const userId = subscription.metadata?.user_id;
    
    if (userId) {
        await updateSubscriptionStatus(userId, subscription.status);
        
        // Se subscription scaduta, downgrade a free
        if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') {
            await updateUserPlan(userId, 'free');
        }
    }
}

async function handleSubscriptionDeleted(subscription) {
    console.log('Subscription deleted:', subscription.id);
    const userId = subscription.metadata?.user_id;
    
    if (userId) {
        await updateUserPlan(userId, 'free');
        await updateSubscriptionStatus(userId, 'deleted');
    }
}

async function handlePaymentSucceeded(invoice) {
    console.log('Payment succeeded for invoice:', invoice.id);
    // Eventualmente inviare email di conferma
}

async function handlePaymentFailed(invoice) {
    console.log('Payment failed for invoice:', invoice.id);
    // Eventualmente inviare email di avviso
}

/**
 * Salva record subscription nel database
 */
async function saveSubscriptionRecord(userId, subscriptionData) {
    try {
        const command = new PutCommand({
            TableName: PAYMENTS_TABLE,
            Item: subscriptionData
        });

        await docClient.send(command);
        console.log('Subscription record saved for user:', userId);

    } catch (error) {
        console.error('Error saving subscription record:', error);
        throw new Error('Errore salvataggio subscription record');
    }
}
