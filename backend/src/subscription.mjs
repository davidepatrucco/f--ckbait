// subscription.mjs - Gestione delle subscription (versione semplificata per uso privato)
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

// Inizializza client DynamoDB
const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'eu-west-1'
});
const docClient = DynamoDBDocumentClient.from(client);

const SUBSCRIPTIONS_TABLE = process.env.SUBSCRIPTIONS_TABLE || 'reading-intelligence-subscriptions';

// Funzione per validare una subscription (versione semplificata)
export async function validateSubscription(apiKey) {
    try {
        // Per la versione privata, accettiamo qualsiasi API key che inizia con 'sk-'
        // In futuro questo sarà sostituito con la logica Stripe completa
        if (!apiKey || !apiKey.startsWith('sk-')) {
            return false;
        }
        
        // Verifica se l'API key esiste nella tabella
        const result = await docClient.send(new GetCommand({
            TableName: SUBSCRIPTIONS_TABLE,
            Key: {
                apiKey: apiKey
            }
        }));
        
        if (!result.Item) {
            // Se non esiste, crea una subscription di default per uso privato
            await createDefaultSubscription(apiKey);
            return true;
        }
        
        const subscription = result.Item;
        
        // Verifica se la subscription è attiva
        if (subscription.status !== 'active') {
            return false;
        }
        
        // Verifica se non è scaduta
        if (subscription.expiresAt && new Date(subscription.expiresAt) < new Date()) {
            return false;
        }
        
        return true;
        
    } catch (error) {
        console.error('Error validating subscription:', error);
        return false;
    }
}

// Funzione per creare una subscription di default per uso privato
async function createDefaultSubscription(apiKey) {
    try {
        const subscription = {
            apiKey: apiKey,
            status: 'active',
            plan: 'private',
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 anno
            requestsLimit: 1000, // 1000 richieste al mese
            requestsUsed: 0,
            lastResetAt: new Date().toISOString()
        };
        
        await docClient.send(new PutCommand({
            TableName: SUBSCRIPTIONS_TABLE,
            Item: subscription,
            ConditionExpression: 'attribute_not_exists(apiKey)'
        }));
        
        console.log('Created default subscription for:', apiKey.substring(0, 8) + '...');
        
    } catch (error) {
        if (error.name !== 'ConditionalCheckFailedException') {
            console.error('Error creating default subscription:', error);
            throw error;
        }
        // Se la subscription esiste già, va bene
    }
}

// Funzione per ottenere i dettagli di una subscription
export async function getSubscriptionDetails(apiKey) {
    try {
        const result = await docClient.send(new GetCommand({
            TableName: SUBSCRIPTIONS_TABLE,
            Key: {
                apiKey: apiKey
            }
        }));
        
        return result.Item || null;
        
    } catch (error) {
        console.error('Error getting subscription details:', error);
        return null;
    }
}

// Funzione per aggiornare l'uso di una subscription
export async function updateSubscriptionUsage(apiKey) {
    try {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        
        const result = await docClient.send(new UpdateCommand({
            TableName: SUBSCRIPTIONS_TABLE,
            Key: {
                apiKey: apiKey
            },
            UpdateExpression: 'ADD requestsUsed :inc SET lastUsedAt = :now, #monthStart = if_not_exists(#monthStart, :monthStart)',
            ExpressionAttributeNames: {
                '#monthStart': 'monthStart'
            },
            ExpressionAttributeValues: {
                ':inc': 1,
                ':now': now.toISOString(),
                ':monthStart': monthStart.toISOString()
            },
            ReturnValues: 'ALL_NEW'
        }));
        
        return result.Attributes;
        
    } catch (error) {
        console.error('Error updating subscription usage:', error);
        throw error;
    }
}

// Funzione per resettare il contatore mensile se necessario
export async function resetMonthlyUsageIfNeeded(apiKey) {
    try {
        const subscription = await getSubscriptionDetails(apiKey);
        
        if (!subscription) {
            return false;
        }
        
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastReset = new Date(subscription.lastResetAt || subscription.createdAt);
        
        // Se siamo in un nuovo mese, resetta il contatore
        if (lastReset < monthStart) {
            await docClient.send(new UpdateCommand({
                TableName: SUBSCRIPTIONS_TABLE,
                Key: {
                    apiKey: apiKey
                },
                UpdateExpression: 'SET requestsUsed = :zero, lastResetAt = :now, #monthStart = :monthStart',
                ExpressionAttributeNames: {
                    '#monthStart': 'monthStart'
                },
                ExpressionAttributeValues: {
                    ':zero': 0,
                    ':now': now.toISOString(),
                    ':monthStart': monthStart.toISOString()
                }
            }));
            
            console.log('Reset monthly usage for:', apiKey.substring(0, 8) + '...');
            return true;
        }
        
        return false;
        
    } catch (error) {
        console.error('Error resetting monthly usage:', error);
        return false;
    }
}

// Funzione per verificare se la subscription ha superato il limite
export async function hasExceededLimit(apiKey) {
    try {
        // Prima resetta se necessario
        await resetMonthlyUsageIfNeeded(apiKey);
        
        const subscription = await getSubscriptionDetails(apiKey);
        
        if (!subscription) {
            return true; // Se non esiste, considera come limite superato
        }
        
        return subscription.requestsUsed >= subscription.requestsLimit;
        
    } catch (error) {
        console.error('Error checking usage limit:', error);
        return true; // In caso di errore, nega l'accesso per sicurezza
    }
}