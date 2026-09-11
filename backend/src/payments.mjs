// payments.mjs - Gestione pagamenti Stripe per piano premium

import Stripe from 'stripe';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { updateUserPlan } from './dynamodb.mjs';
import { getBrand, isValidBrand, DEFAULT_BRAND } from './brands.mjs';
import { SecretsManager } from './secrets.mjs';
import { logEvent } from './analytics.mjs';

// Configurazione
const secretsManager = new SecretsManager();

// Configurazione DynamoDB
const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'eu-west-1'
});
const docClient = DynamoDBDocumentClient.from(client);

const PAYMENTS_TABLE = process.env.PAYMENTS_TABLE_NAME || 'reading-intelligence-payments-dev';
// Gli abbonamenti vivono nella LORO tabella, con chiave composta userId+subscriptionId.
// Prima venivano scritti nella tabella dei pagamenti usando `user_id` come chiave: quella
// tabella ha invece chiave `paymentId`, quindi ogni scrittura falliva con
// ValidationException e la persistenza degli abbonamenti non ha mai funzionato.
// La chiave composta permette anche piu' abbonamenti per utente, uno per brand.
const SUBSCRIPTIONS_TABLE = process.env.SUBSCRIPTIONS_TABLE_NAME || 'reading-intelligence-subscriptions-dev';

// Client Stripe (chiave segreta globale) + prodotti per-brand (price id per brand).
let stripeClient;
// TTL sui price_id (come pricingCache): dopo un aggiornamento SSM (es. E18-005) il
// container non serve price_id stantii per il checkout oltre la finestra.
const brandProductsCache = new Map(); // brandId -> { at, products }
const BRAND_PRODUCTS_TTL_MS = 5 * 60 * 1000;

async function getStripeClient() {
    if (!stripeClient) {
        const stripeSecretKey = await secretsManager.getSecret('STRIPE_SECRET_KEY');
        stripeClient = new Stripe(stripeSecretKey);
    }
    return stripeClient;
}

// Fallback di display usato SOLO se il Price non è ancora su Stripe (es. prima di E18-005).
// Unico posto dove vive un importo hardcoded; Stripe resta la fonte quando i Price esistono.
const PRICING_FALLBACK = { currency: 'eur', monthly: 199, yearly: 1499 };

/**
 * Prodotti Stripe di uno specifico brand (price id letti dalle chiavi SSM del brand).
 * "Independent commercial lifecycle per brand": ogni brand ha i suoi price id.
 */
async function getBrandProducts(brandId) {
    const cached = brandProductsCache.get(brandId);
    if (cached && Date.now() - cached.at < BRAND_PRODUCTS_TTL_MS) return cached.products;
    const brand = getBrand(brandId);
    const monthlyPriceId = await secretsManager.getSecret(brand.stripe.monthlyPriceKey);
    const yearlyPriceId = await secretsManager.getSecret(brand.stripe.yearlyPriceKey);
    const products = {
        premium_monthly: { price_id: monthlyPriceId, interval: 'month' },
        premium_yearly: { price_id: yearlyPriceId, interval: 'year' }
    };
    brandProductsCache.set(brandId, { at: Date.now(), products });
    return products;
}

// Cache prezzi (display) con TTL: gli importi vengono da Stripe (fonte unica).
const pricingCache = new Map(); // brandId -> { at, data }
const PRICING_TTL_MS = 5 * 60 * 1000;

/**
 * Prezzi di display per un brand, letti da Stripe (unit_amount reale del Price).
 * Fallback a PRICING_FALLBACK se il Price non esiste ancora (source='fallback').
 * Single-source: sito ed estensione leggono da qui (via GET /pricing).
 */
export async function getBrandPricing(brandId) {
    const cached = pricingCache.get(brandId);
    if (cached && Date.now() - cached.at < PRICING_TTL_MS) return cached.data;

    const products = await getBrandProducts(brandId);
    const stripe = await getStripeClient();
    const fromStripe = async (priceId, fallbackAmount, interval) => {
        try {
            const p = await stripe.prices.retrieve(priceId);
            if (p && typeof p.unit_amount === 'number') {
                return { amount: p.unit_amount, currency: p.currency, interval: p.recurring?.interval || interval, source: 'stripe' };
            }
        } catch { /* price inesistente/placeholder */ }
        return { amount: fallbackAmount, currency: PRICING_FALLBACK.currency, interval, source: 'fallback' };
    };
    const [monthly, yearly] = await Promise.all([
        fromStripe(products.premium_monthly.price_id, PRICING_FALLBACK.monthly, 'month'),
        fromStripe(products.premium_yearly.price_id, PRICING_FALLBACK.yearly, 'year')
    ]);
    // `configured` dice se ENTRAMBI i prezzi vengono davvero da Stripe. Serve al
    // client per non mostrare una CTA di acquisto che finirebbe in errore: senza
    // price id il checkout risponde 500 ("You must provide one of price...").
    const configured = monthly.source === 'stripe' && yearly.source === 'stripe';
    const data = { brand: brandId, monthly, yearly, configured };
    pricingCache.set(brandId, { at: Date.now(), data });
    return data;
}

/**
 * Compat: alcune funzioni usano solo il client. Restituisce { stripe }.
 */
async function initializeStripe() {
    return { stripe: await getStripeClient() };
}

/**
 * Ricava il brand da metadata Stripe (session/subscription). Default: LemonSqueezer
 * (retrocompatibile con record creati prima del multi-brand).
 */
export function resolveStripeBrand(obj) {
    const b = obj?.metadata?.brand;
    return isValidBrand(b) ? b : DEFAULT_BRAND;
}

/**
 * Crea sessione di checkout Stripe
 */
export async function createCheckoutSession(userId, userEmail, brand = DEFAULT_BRAND, planType = 'premium_monthly') {
    try {
        if (!isValidBrand(brand)) {
            throw new Error(`Brand non valido: ${brand}`);
        }
        // Valida il piano PRIMA di chiamare Stripe/secrets (input validation up-front).
        if (!['premium_monthly', 'premium_yearly'].includes(planType)) {
            throw new Error(`Piano non valido: ${planType}`);
        }
        const stripe = await getStripeClient();
        const products = await getBrandProducts(brand);

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
                brand,
                plan_type: planType
            },
            success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: cancelUrl,
            allow_promotion_codes: true,
            billing_address_collection: 'auto',
            subscription_data: {
                metadata: {
                    user_id: userId,
                    brand,
                    plan_type: planType
                }
            }
        });

        // Salva sessione temporanea per tracking
        await saveCheckoutSession(userId, session.id, planType);

        // Display (importo/valuta) dalla fonte unica (Stripe via getBrandPricing).
        const pricing = await getBrandPricing(brand);
        const disp = planType === 'premium_yearly' ? pricing.yearly : pricing.monthly;
        return {
            sessionId: session.id,
            url: session.url,
            planType,
            amount: disp.amount,
            currency: disp.currency,
            interval: disp.interval
        };

    } catch (error) {
        console.error('Error creating checkout session:', error);
        throw new Error('Errore creazione sessione pagamento: ' + error.message);
    }
}

/**
 * Verifica stato sessione di checkout
 */
export async function verifyCheckoutSession(sessionId, expectedUserId) {
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
        // La sessione deve appartenere a chi chiama: senza questo vincolo, conoscere
        // un sessionId altrui bastava per modificare il piano di quell'utente.
        if (expectedUserId && userId !== expectedUserId) {
            return { success: false, reason: 'session_owner_mismatch' };
        }

        // Ottieni dettagli subscription
        const subscription = session.subscription;

        // Il pagamento originario "paid" non basta: una sessione vecchia puo'
        // riferirsi a un abbonamento poi annullato o scaduto. Lo stato commerciale
        // deve derivare dall'abbonamento CORRENTE, non dalla sessione.
        const ACTIVE = ['active', 'trialing', 'past_due'];
        if (!subscription || !ACTIVE.includes(subscription.status)) {
            return { success: false, reason: 'subscription_not_active', status: subscription?.status || 'none' };
        }
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

        // Aggiorna il piano del brand corretto a premium
        const brand = resolveStripeBrand(session);
        await updateUserPlan(userId, brand, 'premium', {
            subscriptionStatus: subscription.status,
            stripeCustomerId: customer.id,
            stripeSubscriptionId: subscription.id
        });

        return {
            success: true,
            userId,
            brand,
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
export async function getUserSubscription(userId, brandId = DEFAULT_BRAND) {
    try {
        // Un utente puo' avere un abbonamento per ciascun brand: senza il filtro,
        // acquistare un secondo brand "sostituiva" il primo agli occhi del codice.
        const response = await docClient.send(new QueryCommand({
            TableName: SUBSCRIPTIONS_TABLE,
            KeyConditionExpression: 'userId = :u',
            ExpressionAttributeValues: { ':u': userId }
        }));
        const items = (response.Items || []).filter((i) => (i.brand || DEFAULT_BRAND) === brandId);
        if (!items.length) return null;
        // Il piu' recente: l'ultimo aggiornato vince.
        items.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
        return items[0];
    } catch (error) {
        console.error('Error getting user subscription:', error);
        throw new Error('Errore recupero subscription utente');
    }
}

/**
 * Cancella subscription
 */
export async function cancelSubscription(userId, brandId = DEFAULT_BRAND) {
    try {
        const { stripe } = await initializeStripe();

        const subscription = await getUserSubscription(userId, brandId);
        if (!subscription) {
            throw new Error('Subscription non trovata');
        }

        // Cancella su Stripe
        await stripe.subscriptions.update(subscription.stripe_subscription_id, {
            cancel_at_period_end: true
        });

        // Aggiorna status nel database
        await updateSubscriptionStatus(userId, 'canceled', brandId);

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
export async function reactivateSubscription(userId, brandId = DEFAULT_BRAND) {
    try {
        const { stripe } = await initializeStripe();

        const subscription = await getUserSubscription(userId, brandId);
        if (!subscription) {
            throw new Error('Subscription non trovata');
        }

        // Riattiva su Stripe
        await stripe.subscriptions.update(subscription.stripe_subscription_id, {
            cancel_at_period_end: false
        });

        // Aggiorna status nel database
        await updateSubscriptionStatus(userId, 'active', brandId);

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

/**
 * Cancella il record subscription dell'utente (best-effort, per cancellazione account).
 */
export async function deleteUserSubscription(userId) {
    // Cancellare l'account deve interrompere anche gli addebiti: prima venivano
    // rimossi solo i record locali (per giunta dalla tabella sbagliata), quindi
    // l'abbonamento restava attivo su Stripe e l'utente continuava a pagare.
    const result = { canceledOnStripe: 0, deleted: 0, errors: [] };
    let items = [];
    try {
        const res = await docClient.send(new QueryCommand({
            TableName: SUBSCRIPTIONS_TABLE,
            KeyConditionExpression: 'userId = :u',
            ExpressionAttributeValues: { ':u': userId }
        }));
        items = res.Items || [];
    } catch (error) {
        console.warn('Impossibile elencare gli abbonamenti da cancellare:', error.message);
        result.errors.push('list');
        return result;
    }

    for (const item of items) {
        const subId = item.subscriptionId || item.stripe_subscription_id;
        if (subId) {
            try {
                const { stripe } = await initializeStripe();
                // cancel() immediato: l'account non esiste piu', non ha senso
                // lasciarlo attivo fino a fine periodo.
                await stripe.subscriptions.cancel(subId);
                result.canceledOnStripe++;
            } catch (error) {
                // Un abbonamento gia' annullato o inesistente non e' un errore.
                if (!/No such subscription|already canceled/i.test(String(error.message))) {
                    console.error(`Cancellazione Stripe fallita per ${subId}:`, error.message);
                    result.errors.push(subId);
                }
            }
        }
        try {
            await docClient.send(new DeleteCommand({
                TableName: SUBSCRIPTIONS_TABLE,
                Key: { userId, subscriptionId: item.subscriptionId }
            }));
            result.deleted++;
        } catch (error) {
            console.warn('Cancellazione record locale fallita:', error.message);
            result.errors.push('local');
        }
    }
    return result;
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
            TableName: SUBSCRIPTIONS_TABLE,
            Item: {
                userId,
                subscriptionId: subscriptionData.stripeSubscriptionId,
                brand: subscriptionData.brand || DEFAULT_BRAND,
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

async function updateSubscriptionStatus(userId, status, brandId = DEFAULT_BRAND) {
    try {
        // Serve la chiave composta: si recupera l'abbonamento del brand e si aggiorna
        // quello. Prima l'update usava `user_id` su una tabella con chiave `paymentId`.
        const current = await getUserSubscription(userId, brandId);
        if (!current || !current.subscriptionId) {
            console.warn(`updateSubscriptionStatus: nessun abbonamento per ${userId}/${brandId}`);
            return;
        }
        await docClient.send(new UpdateCommand({
            TableName: SUBSCRIPTIONS_TABLE,
            Key: { userId, subscriptionId: current.subscriptionId },
            UpdateExpression: 'SET #s = :s, updated_at = :u',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':s': status, ':u': new Date().toISOString() }
        }));
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
    const brand = resolveStripeBrand(session);

    if (!userId) {
        console.error('Missing user ID in checkout session');
        return;
    }

    console.log(`Processing upgrade for user ${userId} (brand ${brand}) to plan ${planType}`);

    try {
        // updateUserPlan e la PUT del record sono idempotenti: un evento webhook
        // duplicato non causa doppio addebito né stato incoerente (E08-010).
        console.log('Calling updateUserPlan...');
        await updateUserPlan(userId, brand, 'premium', {
            subscriptionStatus: 'active',
            stripeSubscriptionId: session.subscription
        });
        console.log('updateUserPlan completed successfully');

        // Funnel: conversione a premium (best-effort, metadati soltanto).
        await logEvent({
            eventType: 'subscription_activated', source: 'server',
            userId, userPlan: 'premium', brandId: brand
        });

        // Salva record subscription
        const subscriptionData = {
            user_id: userId,
            brand,
            // Stesso nome letto da cancelSubscription/reactivate: prima il webhook
            // scriveva `subscription_id` mentre la cancellazione cercava
            // `stripe_subscription_id`, quindi non trovava mai l'abbonamento.
            stripe_subscription_id: session.subscription,
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
    const brand = resolveStripeBrand(subscription);

    if (userId) {
        await updateSubscriptionStatus(userId, subscription.status, brand);

        // Se subscription scaduta, downgrade a free SOLO per il brand interessato
        if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') {
            await updateUserPlan(userId, brand, 'free', { subscriptionStatus: subscription.status });
        }
    }
}

async function handleSubscriptionDeleted(subscription) {
    console.log('Subscription deleted:', subscription.id);
    const userId = subscription.metadata?.user_id;
    const brand = resolveStripeBrand(subscription);

    if (userId) {
        await updateUserPlan(userId, brand, 'free', { subscriptionStatus: 'deleted' });
        await updateSubscriptionStatus(userId, 'deleted', brand);
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
    // Delega alla stessa funzione: prima esistevano due scritture divergenti, una
    // delle quali usava un nome di campo diverso per l'id dell'abbonamento.
    await saveSubscription(userId, subscriptionData);
}
