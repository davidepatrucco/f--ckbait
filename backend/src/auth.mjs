// auth.mjs - Gestione autenticazione e piano freemium

import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import {
    getUserById,
    getUserByEmail,
    createUser,
    updateLastLogin,
    incrementBrandUsage,
    decrementBrandUsage,
    formatUserFromDynamoDB
} from './dynamodb.mjs';
import { getFreeLimit, DEFAULT_BRAND } from './brands.mjs';
import { SecretsManager } from './secrets.mjs';
import { v4 as uuidv4 } from 'uuid';

// Configurazione
const secretsManager = new SecretsManager();
const FREE_PLAN_LIMIT = parseInt(process.env.FREE_PLAN_LIMIT || '1', 10);
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
            // Il reset mensile è per-brand ed è gestito lazy al momento del riassunto.
        }

        // Genera JWT token. Nessun `plan` globale: il piano è per-brand e va letto
        // sempre dal record fresco (regola "no global plan in JWT").
        const jwtSecret = await secretsManager.getSecret('JWT_SECRET');
        const authToken = jwt.sign(
            { userId: user.id, email: user.email },
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
            { userId: newUser.id, email: newUser.email },
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
        const user = formatUserFromDynamoDB(dynamoUser);
        // Reset mensile per-brand: gestito lazy al momento del riassunto.

        const jwtSecret = await secretsManager.getSecret('JWT_SECRET');
        const authToken = jwt.sign(
            { userId: user.id, email: user.email },
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
        
        // Il reset mensile è per-brand ed è gestito lazy in canUserSummarize/incrementUsage.
        return formatUserFromDynamoDB(dynamoUser);
    } catch (error) {
        throw new Error('Token non valido: ' + error.message);
    }
}

/**
 * Restituisce l'entitlement per uno specifico brand (o un default free se assente).
 */
export function getEntitlement(user, brandId) {
    const freeLimit = getFreeLimit(brandId);
    const raw = user?.entitlements?.[brandId];
    if (!raw) {
        return { plan: 'free', usage: { used: 0, limit: freeLimit, resetDate: null }, subscriptionStatus: 'none', exists: false };
    }
    return {
        plan: raw.plan || 'free',
        usage: {
            used: raw.usage_used || 0,
            limit: raw.usage_limit || freeLimit,
            resetDate: raw.usage_reset_date || null
        },
        subscriptionStatus: raw.subscription_status || 'none',
        stripeCustomerId: raw.stripe_customer_id || null,
        stripeSubscriptionId: raw.stripe_subscription_id || null,
        exists: true
    };
}

/**
 * Verifica se l'utente può fare un riassunto per uno specifico brand.
 * Quota indipendente per brand. Reset mensile valutato lazy.
 */
export function canUserSummarize(user, brandId = DEFAULT_BRAND) {
    const ent = getEntitlement(user, brandId);
    if (ent.plan === 'premium') {
        return { canSummarize: true };
    }
    // Se il periodo è scaduto, l'utilizzo effettivo riparte da 0.
    const expired = ent.usage.resetDate && new Date() > new Date(ent.usage.resetDate);
    const effectiveUsed = expired ? 0 : ent.usage.used;
    if (effectiveUsed >= ent.usage.limit) {
        return {
            canSummarize: false,
            reason: 'Limite giornaliero raggiunto',
            resetDate: ent.usage.resetDate
        };
    }
    return { canSummarize: true };
}

/**
 * Incrementa il contatore di utilizzo per uno specifico brand.
 */
export async function incrementUsage(user, brandId = DEFAULT_BRAND) {
    const ent = getEntitlement(user, brandId);
    if (ent.plan === 'premium') {
        return user;
    }
    const expired = ent.usage.resetDate && new Date() > new Date(ent.usage.resetDate);
    // Semina l'entitlement con i valori correnti (continuità per utenti legacy).
    const updated = await incrementBrandUsage(user.id, brandId, {
        seed: {
            plan: ent.plan,
            usage_used: ent.usage.used,
            usage_limit: ent.usage.limit,
            usage_reset_date: ent.usage.resetDate || getNextResetDate(),
            subscription_status: ent.subscriptionStatus,
            stripe_customer_id: ent.stripeCustomerId,
            stripe_subscription_id: ent.stripeSubscriptionId
        },
        resetIfExpired: expired,
        resetDate: getNextResetDate(),
        // Guardia atomica anti-race: non superare il limite (lancia USAGE_LIMIT_REACHED).
        limit: ent.usage.limit
    });
    return formatUserFromDynamoDB(updated);
}

/**
 * Rimborsa un utilizzo prenotato (refund) quando il summary a valle fallisce.
 * No-op per i premium (non consumano quota).
 */
export async function refundUsage(user, brandId = DEFAULT_BRAND) {
    const ent = getEntitlement(user, brandId);
    if (ent.plan === 'premium') return;
    await decrementBrandUsage(user.id, brandId);
}

/**
 * Prossima data di reset della quota free: mezzanotte UTC del giorno successivo
 * (quota giornaliera: 1 summary/giorno).
 */
function getNextResetDate() {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
    return next.toISOString();
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
