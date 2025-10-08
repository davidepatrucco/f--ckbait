// auth.mjs - Gestione autenticazione e piano freemium

import jwt from 'jsonwebtoken';
import { 
    getUserById, 
    createUser, 
    updateLastLogin, 
    incrementUserUsage, 
    resetUserUsage,
    formatUserFromDynamoDB 
} from './dynamodb.mjs';
import { SecretsManager } from './secrets.mjs';

// Configurazione
const secretsManager = new SecretsManager();
const FREE_PLAN_LIMIT = parseInt(process.env.FREE_PLAN_LIMIT || '10', 10);

/**
 * Verifica token Google e crea/aggiorna utente
 */
export async function loginWithGoogle(googleToken) {
    try {
        // Verifica token Google
        const response = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${googleToken}`);
        
        if (!response.ok) {
            throw new Error('Token Google non valido');
        }
        
        const tokenInfo = await response.json();
        
        if (!tokenInfo.email || !tokenInfo.verified_email) {
            throw new Error('Email non verificata');
        }
        
        // Ottieni informazioni profilo utente
        const profileResponse = await fetch(`https://www.googleapis.com/oauth2/v1/userinfo?access_token=${googleToken}`);
        const profile = await profileResponse.json();
        
        const userId = profile.id;
        const userEmail = profile.email;
        
        // Trova utente esistente
        let dynamoUser = await getUserById(userId);
        let user;
        
        if (!dynamoUser) {
            // Crea nuovo utente
            const newUser = {
                id: userId,
                email: userEmail,
                name: profile.name || userEmail,
                picture: profile.picture,
                plan: 'free',
                usage: {
                    used: 0,
                    limit: FREE_PLAN_LIMIT,
                    resetDate: getNextResetDate()
                },
                createdAt: new Date().toISOString(),
                lastLogin: new Date().toISOString()
            };
            
            await createUser(newUser);
            user = newUser;
        } else {
            // Utente esistente - aggiorna ultimo login
            await updateLastLogin(userId);
            user = formatUserFromDynamoDB(dynamoUser);
            
            // Reset usage se è passato il mese
            if (new Date() > new Date(user.usage.resetDate)) {
                const newResetDate = getNextResetDate();
                const updatedUser = await resetUserUsage(userId, newResetDate);
                user = formatUserFromDynamoDB(updatedUser);
            }
        }
        
        // Genera JWT token
        const jwtSecret = await secretsManager.getSecret('JWT_SECRET');
        const authToken = jwt.sign(
            { 
                userId: user.id, 
                email: user.email,
                plan: user.plan 
            },
            jwtSecret,
            { expiresIn: '30d' }
        );
        
        return {
            ...user,
            authToken
        };
        
    } catch (error) {
        console.error('Error in loginWithGoogle:', error);
        throw new Error('Login fallito: ' + error.message);
    }
}

/**
 * Verifica JWT token
 */
export async function verifyAuthToken(token) {
    try {
        const jwtSecret = await secretsManager.getSecret('JWT_SECRET');
        const decoded = jwt.verify(token, jwtSecret);
        const dynamoUser = await getUserById(decoded.userId);
        
        if (!dynamoUser) {
            throw new Error('Utente non trovato');
        }
        
        let user = formatUserFromDynamoDB(dynamoUser);
        
        // Reset usage se è passato il mese
        if (new Date() > new Date(user.usage.resetDate)) {
            const newResetDate = getNextResetDate();
            const updatedUser = await resetUserUsage(decoded.userId, newResetDate);
            user = formatUserFromDynamoDB(updatedUser);
        }
        
        return user;
    } catch (error) {
        throw new Error('Token non valido: ' + error.message);
    }
}

/**
 * Verifica se l'utente può fare un riassunto
 */
export function canUserSummarize(user) {
    if (user.plan === 'premium') {
        return { canSummarize: true };
    }
    
    // Piano free - controlla limiti
    if (user.usage.used >= user.usage.limit) {
        return {
            canSummarize: false,
            reason: 'Limite mensile raggiunto',
            resetDate: user.usage.resetDate
        };
    }
    
    return { canSummarize: true };
}

/**
 * Incrementa il contatore di utilizzo
 */
export async function incrementUsage(user) {
    if (user.plan === 'free') {
        const updatedUser = await incrementUserUsage(user.id);
        return formatUserFromDynamoDB(updatedUser);
    }
    return user;
}

/**
 * Calcola la prossima data di reset (primo giorno del mese successivo)
 */
function getNextResetDate() {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return nextMonth.toISOString();
}

/**
 * Middleware per autenticazione
 */
export async function requireAuth(event) {
    const authHeader = event.headers?.['Authorization'] || event.headers?.['authorization'];
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('Token di autorizzazione mancante');
    }
    
    const token = authHeader.substring(7);
    return await verifyAuthToken(token);
}