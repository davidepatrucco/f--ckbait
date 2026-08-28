// dynamodb.mjs - Gestione database utenti con DynamoDB

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { DEFAULT_BRAND, getFreeLimit } from './brands.mjs';

// Configurazione DynamoDB
const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'eu-west-1'
});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.USERS_TABLE_NAME || 'reading-intelligence-users-dev';

/**
 * Trova utente per ID
 */
export async function getUserById(userId) {
    try {
        const command = new GetCommand({
            TableName: TABLE_NAME,
            Key: { id: userId }
        });
        
        const response = await docClient.send(command);
        return response.Item || null;
        
    } catch (error) {
        console.error('Error getting user from DynamoDB:', error);
        throw new Error('Errore accesso database utenti');
    }
}

/**
 * Trova utente per email
 */
export async function getUserByEmail(email) {
    try {
        // Scan table per email (GSI sarebbe meglio ma per ora va bene)
        const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
        const command = new ScanCommand({
            TableName: TABLE_NAME,
            FilterExpression: 'email = :email',
            ExpressionAttributeValues: {
                ':email': email
            }
        });
        
        const response = await docClient.send(command);
        return response.Items?.[0] || null;
        
    } catch (error) {
        console.error('Error getting user by email:', error);
        throw new Error('Errore accesso database utenti');
    }
}

/**
 * Crea nuovo utente
 */
export async function createUser(userdata) {
    try {
        // Identità condivisa; l'entitlement commerciale è per-brand.
        // Al signup si inizializza l'entitlement del brand di provenienza
        // (default LemonSqueezer). Gli altri brand vengono creati lazy al primo uso.
        const initBrand = userdata.brand || DEFAULT_BRAND;
        const command = new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                id: userdata.id,
                email: userdata.email,
                name: userdata.name,
                picture: userdata.picture,
                auth_provider: userdata.authProvider,
                password_hash: userdata.passwordHash,
                password_salt: userdata.passwordSalt,
                created_at: userdata.createdAt,
                last_login: userdata.lastLogin,
                entitlements: {
                    [initBrand]: {
                        plan: userdata.plan || 'free',
                        usage_used: userdata.usage?.used || 0,
                        usage_limit: userdata.usage?.limit || getFreeLimit(initBrand),
                        usage_reset_date: userdata.usage?.resetDate || null,
                        subscription_status: 'none',
                        stripe_customer_id: null,
                        stripe_subscription_id: null
                    }
                }
            },
            // Non sovrascrivere se l'utente esiste già
            ConditionExpression: 'attribute_not_exists(id)'
        });
        
        await docClient.send(command);
        return userdata;
        
    } catch (error) {
        if (error.name === 'ConditionalCheckFailedException') {
            // Utente già esiste, non è un errore
            return await getUserById(userdata.id);
        }
        console.error('Error creating user in DynamoDB:', error);
        throw new Error('Errore creazione utente');
    }
}

/**
 * Aggiorna ultimo login dell'utente
 */
export async function updateLastLogin(userId) {
    try {
        const command = new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { id: userId },
            UpdateExpression: 'SET last_login = :lastLogin',
            ExpressionAttributeValues: {
                ':lastLogin': new Date().toISOString()
            }
        });
        
        await docClient.send(command);
        
    } catch (error) {
        console.error('Error updating last login:', error);
        throw new Error('Errore aggiornamento accesso');
    }
}

/**
 * Garantisce che esista l'entitlement per-brand (mappa entitlements + brand).
 * Idempotente via if_not_exists. Necessario prima di aggiornare percorsi annidati.
 */
async function ensureBrandEntitlement(userId, brandId, init) {
    await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id: userId },
        UpdateExpression: 'SET entitlements = if_not_exists(entitlements, :empty)',
        ExpressionAttributeValues: { ':empty': {} }
    }));
    await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id: userId },
        UpdateExpression: 'SET entitlements.#b = if_not_exists(entitlements.#b, :init)',
        ExpressionAttributeNames: { '#b': brandId },
        ExpressionAttributeValues: { ':init': init }
    }));
}

/**
 * Incrementa il contatore di utilizzo per uno specifico brand.
 * Gestisce inizializzazione lazy dell'entitlement e reset mensile.
 */
export async function incrementBrandUsage(userId, brandId, { seed, resetIfExpired, resetDate, limit }) {
    try {
        // `seed` = entitlement corrente (per utenti legacy proviene dagli attributi
        // piatti via shim, così il conteggio non riparte da zero). Se l'entitlement
        // esiste già, l'ensure è un no-op (if_not_exists).
        await ensureBrandEntitlement(userId, brandId, {
            plan: seed?.plan || 'free',
            usage_used: seed?.usage_used || 0,
            usage_limit: seed?.usage_limit || getFreeLimit(brandId),
            usage_reset_date: seed?.usage_reset_date || resetDate,
            subscription_status: seed?.subscription_status || 'none',
            stripe_customer_id: seed?.stripe_customer_id || null,
            stripe_subscription_id: seed?.stripe_subscription_id || null
        });

        let UpdateExpression;
        let ConditionExpression;
        const ExpressionAttributeValues = { ':one': 1 };
        if (resetIfExpired) {
            // Nuovo periodo: azzera e conta questo utilizzo come 1.
            UpdateExpression = 'SET entitlements.#b.usage_used = :one, entitlements.#b.usage_reset_date = :reset';
            ExpressionAttributeValues[':reset'] = resetDate;
        } else {
            UpdateExpression = 'SET entitlements.#b.usage_used = if_not_exists(entitlements.#b.usage_used, :zero) + :one';
            ExpressionAttributeValues[':zero'] = 0;
            // Guardia atomica anti-race: non superare il limite anche con richieste
            // concorrenti. Se già al limite → ConditionalCheckFailed → USAGE_LIMIT_REACHED.
            if (typeof limit === 'number') {
                ConditionExpression = 'attribute_not_exists(entitlements.#b.usage_used) OR entitlements.#b.usage_used < :limit';
                ExpressionAttributeValues[':limit'] = limit;
            }
        }

        const response = await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { id: userId },
            UpdateExpression,
            ...(ConditionExpression ? { ConditionExpression } : {}),
            ExpressionAttributeNames: { '#b': brandId },
            ExpressionAttributeValues,
            ReturnValues: 'ALL_NEW'
        }));
        return response.Attributes;
    } catch (error) {
        if (error.name === 'ConditionalCheckFailedException') {
            const e = new Error('USAGE_LIMIT_REACHED');
            e.code = 'USAGE_LIMIT_REACHED';
            throw e;
        }
        console.error('Error incrementing brand usage:', error);
        throw new Error('Errore aggiornamento utilizzo');
    }
}

/**
 * Rimborsa un utilizzo (refund) se il summary a valle fallisce dopo la prenotazione.
 * Best-effort: non scende sotto 0 (ConditionExpression); ignora l'errore di condizione.
 */
export async function decrementBrandUsage(userId, brandId) {
    try {
        await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { id: userId },
            UpdateExpression: 'SET entitlements.#b.usage_used = entitlements.#b.usage_used - :one',
            ConditionExpression: 'entitlements.#b.usage_used > :zero',
            ExpressionAttributeNames: { '#b': brandId },
            ExpressionAttributeValues: { ':one': 1, ':zero': 0 }
        }));
    } catch (error) {
        if (error.name !== 'ConditionalCheckFailedException') {
            console.error('Error refunding brand usage:', error);
        }
    }
}

/**
 * Aggiorna piano/subscription di uno specifico brand (free <-> premium).
 * extra: { subscriptionStatus, stripeCustomerId, stripeSubscriptionId }.
 */
export async function updateUserPlan(userId, brandId, newPlan, extra = {}) {
    try {
        await ensureBrandEntitlement(userId, brandId, {
            plan: 'free',
            usage_used: 0,
            usage_limit: getFreeLimit(brandId),
            usage_reset_date: null,
            subscription_status: 'none',
            stripe_customer_id: null,
            stripe_subscription_id: null
        });

        let UpdateExpression = 'SET entitlements.#b.#plan = :plan';
        const ExpressionAttributeNames = { '#b': brandId, '#plan': 'plan' };
        const ExpressionAttributeValues = { ':plan': newPlan };
        if (extra.subscriptionStatus !== undefined) {
            UpdateExpression += ', entitlements.#b.subscription_status = :ss';
            ExpressionAttributeValues[':ss'] = extra.subscriptionStatus;
        }
        if (extra.stripeCustomerId !== undefined) {
            UpdateExpression += ', entitlements.#b.stripe_customer_id = :sc';
            ExpressionAttributeValues[':sc'] = extra.stripeCustomerId;
        }
        if (extra.stripeSubscriptionId !== undefined) {
            UpdateExpression += ', entitlements.#b.stripe_subscription_id = :sid';
            ExpressionAttributeValues[':sid'] = extra.stripeSubscriptionId;
        }

        const response = await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { id: userId },
            UpdateExpression,
            ExpressionAttributeNames,
            ExpressionAttributeValues,
            ReturnValues: 'ALL_NEW'
        }));
        return response.Attributes;
    } catch (error) {
        console.error('Error updating user plan:', error);
        throw new Error('Errore aggiornamento piano');
    }
}

/**
 * Cancella l'utente (tutti gli entitlement per-brand sono nel record utente).
 * La cronologia è client-side; le subscription sono gestite a parte (payments).
 */
export async function deleteUser(userId) {
    try {
        await docClient.send(new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { id: userId }
        }));
        return { deleted: true };
    } catch (error) {
        console.error('Error deleting user:', error);
        throw new Error('Errore cancellazione utente');
    }
}

/**
 * Converte formato DynamoDB in formato applicazione.
 * Espone `entitlements` (per-brand). Include una proiezione retrocompatibile
 * top-level (plan/usage) sul brand di default, così i consumer legacy che leggono
 * user.plan/user.usage continuano a funzionare (LemonSqueezer invariato).
 */
export function formatUserFromDynamoDB(dynamoUser) {
    if (!dynamoUser) return null;

    let entitlements = dynamoUser.entitlements;
    if (!entitlements || typeof entitlements !== 'object' || Object.keys(entitlements).length === 0) {
        // Shim legacy: utenti pre-multibrand con attributi piatti -> LemonSqueezer.
        entitlements = {
            [DEFAULT_BRAND]: {
                plan: dynamoUser.plan || 'free',
                usage_used: dynamoUser.usage_used || 0,
                usage_limit: dynamoUser.usage_limit || getFreeLimit(DEFAULT_BRAND),
                usage_reset_date: dynamoUser.usage_reset_date || null,
                subscription_status: dynamoUser.subscription_status || 'none',
                stripe_customer_id: dynamoUser.stripe_customer_id || null,
                stripe_subscription_id: dynamoUser.stripe_subscription_id || null
            }
        };
    }

    const def = entitlements[DEFAULT_BRAND] || {};
    return {
        id: dynamoUser.id,
        email: dynamoUser.email,
        name: dynamoUser.name,
        picture: dynamoUser.picture,
        createdAt: dynamoUser.created_at,
        lastLogin: dynamoUser.last_login,
        // role letto fresco dal DB (default 'user'); usato dai gate admin (es. /admin/metrics).
        role: dynamoUser.role || 'user',
        entitlements,
        // Proiezione retrocompatibile (brand di default).
        plan: def.plan || 'free',
        usage: {
            used: def.usage_used || 0,
            limit: def.usage_limit || getFreeLimit(DEFAULT_BRAND),
            resetDate: def.usage_reset_date || null
        }
    };
}
