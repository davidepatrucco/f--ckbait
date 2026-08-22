// dynamodb.mjs - Gestione database utenti con DynamoDB

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

// Configurazione DynamoDB
const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'eu-west-1'
});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.USERS_TABLE_NAME || 'tldr-users';

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
        const command = new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                id: userdata.id,
                email: userdata.email,
                name: userdata.name,
                picture: userdata.picture,
                plan: userdata.plan || 'free',
                auth_provider: userdata.authProvider,
                password_hash: userdata.passwordHash,
                password_salt: userdata.passwordSalt,
                usage_used: userdata.usage?.used || 0,
                usage_limit: userdata.usage?.limit || 10,
                usage_reset_date: userdata.usage?.resetDate,
                created_at: userdata.createdAt,
                last_login: userdata.lastLogin
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
 * Incrementa contatore utilizzo
 */
export async function incrementUserUsage(userId) {
    try {
        const command = new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { id: userId },
            UpdateExpression: 'ADD usage_used :increment',
            ExpressionAttributeValues: {
                ':increment': 1
            },
            ReturnValues: 'ALL_NEW'
        });
        
        const response = await docClient.send(command);
        return response.Attributes;
        
    } catch (error) {
        console.error('Error incrementing usage:', error);
        throw new Error('Errore aggiornamento utilizzo');
    }
}

/**
 * Reset contatore utilizzo mensile
 */
export async function resetUserUsage(userId, newResetDate) {
    try {
        const command = new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { id: userId },
            UpdateExpression: 'SET usage_used = :zero, usage_reset_date = :resetDate',
            ExpressionAttributeValues: {
                ':zero': 0,
                ':resetDate': newResetDate
            },
            ReturnValues: 'ALL_NEW'
        });
        
        const response = await docClient.send(command);
        return response.Attributes;
        
    } catch (error) {
        console.error('Error resetting usage:', error);
        throw new Error('Errore reset utilizzo');
    }
}

/**
 * Aggiorna piano utente (free -> premium)
 */
export async function updateUserPlan(userId, newPlan) {
    try {
        const command = new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { id: userId },
            UpdateExpression: 'SET #plan = :plan',
            ExpressionAttributeNames: {
                '#plan': 'plan'
            },
            ExpressionAttributeValues: {
                ':plan': newPlan
            },
            ReturnValues: 'ALL_NEW'
        });
        
        const response = await docClient.send(command);
        return response.Attributes;
        
    } catch (error) {
        console.error('Error updating user plan:', error);
        throw new Error('Errore aggiornamento piano');
    }
}

/**
 * Converte formato DynamoDB in formato applicazione
 */
export function formatUserFromDynamoDB(dynamoUser) {
    if (!dynamoUser) return null;
    
    return {
        id: dynamoUser.id,
        email: dynamoUser.email,
        name: dynamoUser.name,
        picture: dynamoUser.picture,
        plan: dynamoUser.plan,
        usage: {
            used: dynamoUser.usage_used || 0,
            limit: dynamoUser.usage_limit || 10,
            resetDate: dynamoUser.usage_reset_date
        },
        createdAt: dynamoUser.created_at,
        lastLogin: dynamoUser.last_login
    };
}
