// auth.mjs - Gestione autenticazione e piano freemium

import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { 
    getUserById, 
    getUserByEmail,
    createUser, 
    updateLastLogin, 
    incrementUserUsage, 
    resetUserUsage,
    formatUserFromDynamoDB 
} from './dynamodb.mjs';
import { SecretsManager } from './secrets.mjs';
import { v4 as uuidv4 } from 'uuid';

// Configurazione
const secretsManager = new SecretsManager();
const FREE_PLAN_LIMIT = parseInt(process.env.FREE_PLAN_LIMIT || '10', 10);
const PASSWORD_MIN_LENGTH = parseInt(process.env.PASSWORD_MIN_LENGTH || '8', 10);

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
 * Registra un utente con email e password
 */
export async function registerWithEmail(email, password, name) {
    try {
        if (!email || !password) {
            throw new Error('Email e password richieste');
        }
        if (password.length < PASSWORD_MIN_LENGTH) {
            throw new Error(`Password troppo corta (min ${PASSWORD_MIN_LENGTH} caratteri)`);
        }

        const existingUser = await getUserByEmail(email);
        if (existingUser) {
            throw new Error('Email già registrata');
        }

        const { hash, salt } = await hashPassword(password);
        const userId = uuidv4();

        const newUser = {
            id: userId,
            email,
            name: name || email,
            picture: null,
            plan: 'free',
            usage: {
                used: 0,
                limit: FREE_PLAN_LIMIT,
                resetDate: getNextResetDate()
            },
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            authProvider: 'password',
            passwordHash: hash,
            passwordSalt: salt
        };

        await createUser(newUser);

        const jwtSecret = await secretsManager.getSecret('JWT_SECRET');
        const authToken = jwt.sign(
            { 
                userId: newUser.id, 
                email: newUser.email,
                plan: newUser.plan 
            },
            jwtSecret,
            { expiresIn: '30d' }
        );

        return {
            ...newUser,
            authToken
        };
    } catch (error) {
        console.error('Error in registerWithEmail:', error);
        throw new Error('Registrazione fallita: ' + error.message);
    }
}

/**
 * Login con email e password
 */
export async function loginWithEmail(email, password) {
    try {
        if (!email || !password) {
            throw new Error('Email e password richieste');
        }

        const dynamoUser = await getUserByEmail(email);
        if (!dynamoUser) {
            throw new Error('Credenziali non valide');
        }

        if (!dynamoUser.password_hash || !dynamoUser.password_salt) {
            throw new Error('Account non abilitato al login con password');
        }

        const isValid = await verifyPassword(password, dynamoUser.password_salt, dynamoUser.password_hash);
        if (!isValid) {
            throw new Error('Credenziali non valide');
        }

        await updateLastLogin(dynamoUser.id);
        let user = formatUserFromDynamoDB(dynamoUser);

        if (new Date() > new Date(user.usage.resetDate)) {
            const newResetDate = getNextResetDate();
            const updatedUser = await resetUserUsage(user.id, newResetDate);
            user = formatUserFromDynamoDB(updatedUser);
        }

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
        console.error('Error in loginWithEmail:', error);
        throw new Error('Login fallito: ' + error.message);
    }
}

/**
 * Login di test (solo per ambienti di sviluppo)
 */

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

async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = await scryptAsync(password, salt);
    return {
        salt: salt.toString('hex'),
        hash: hash.toString('hex')
    };
}

async function verifyPassword(password, saltHex, hashHex) {
    const salt = Buffer.from(saltHex, 'hex');
    const hash = Buffer.from(hashHex, 'hex');
    const derived = await scryptAsync(password, salt);
    if (derived.length !== hash.length) return false;
    return crypto.timingSafeEqual(derived, hash);
}

function scryptAsync(password, salt) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, 64, (err, derivedKey) => {
            if (err) reject(err);
            else resolve(derivedKey);
        });
    });
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
