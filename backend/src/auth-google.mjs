// auth-google.mjs - Google OAuth authentication endpoint con Code Flow + PKCE
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { SecretsManager } from './secrets.mjs';
import { getUserByEmail, createUser } from './dynamodb.mjs';
import * as jose from 'jose';

const secretsManager = new SecretsManager();

/**
 * Verifica Google OAuth code e restituisce JWT per l'app
 * Implementa OAuth2 Authorization Code Flow + PKCE
 */
export async function handleGoogleAuth(event) {
    try {
        const body = JSON.parse(event.body || '{}');
        const { code, code_verifier, redirect_uri } = body;
        
        if (!code || !code_verifier || !redirect_uri) {
            return createResponse(400, { error: 'Parametri mancanti (code, code_verifier, redirect_uri)' });
        }
        
        console.log('[AUTH] Ricevuto code, scambio con Google...');
        
        // Ottieni credenziali Google da Secrets Manager
        const GOOGLE_WEB_CLIENT_ID = await secretsManager.getSecret('GOOGLE_WEB_CLIENT_ID');
        const GOOGLE_WEB_CLIENT_SECRET = await secretsManager.getSecret('GOOGLE_WEB_CLIENT_SECRET');
        
        console.log('[AUTH] Starting Google authorization-code exchange');
        
        // STEP 1: Scambio authorization code → tokens
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                client_id: GOOGLE_WEB_CLIENT_ID,
                client_secret: GOOGLE_WEB_CLIENT_SECRET,
                redirect_uri,
                code_verifier
            })
        });
        
        if (!tokenResponse.ok) {
            console.error('[AUTH] Token exchange failed:', tokenResponse.status);
            return createResponse(401, { error: 'Token exchange failed' });
        }
        
        const tokenData = await tokenResponse.json();
        const { id_token, access_token } = tokenData;
        
        if (!id_token) {
            console.error('[AUTH] ID token mancante nella risposta');
            return createResponse(401, { error: 'ID token assente' });
        }
        
        console.log('[AUTH] Token ottenuti, verifica ID token...');
        
        // STEP 2: Verifica ID token JWT con chiavi pubbliche Google
        const JWKS = jose.createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
        const { payload } = await jose.jwtVerify(id_token, JWKS, {
            issuer: ['https://accounts.google.com', 'accounts.google.com'],
            audience: GOOGLE_WEB_CLIENT_ID
        });
        
        const email = payload.email;
        if (!email || payload.email_verified === false) {
            console.error('[AUTH] Email non verificata');
            return createResponse(401, { error: 'Email non verificata' });
        }
        
        let name = payload.name;
        let picture = payload.picture;
        let sub = payload.sub;
        
        console.log('[AUTH] ID token verificato per:', email);
        
        // STEP 3: (Opzionale) Ottieni info aggiornate da userinfo endpoint
        if (access_token) {
            try {
                const userInfoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
                    headers: { 'Authorization': `Bearer ${access_token}` }
                });
                if (userInfoResponse.ok) {
                    const userInfoData = await userInfoResponse.json();
                    name = userInfoData.name || name;
                    picture = userInfoData.picture || picture;
                    sub = userInfoData.sub || sub;
                    console.log('[AUTH] UserInfo aggiornato');
                }
            } catch (e) {
                console.warn('[AUTH] UserInfo fetch failed:', e.message);
            }
        }
        
        // STEP 4: Cerca/crea utente in DynamoDB
        let user = await getUserByEmail(email);
        
        if (!user) {
            console.log('[AUTH] Nuovo utente, creazione in DynamoDB...');
            const userId = randomUUID();
            const resetDate = getNextMonthDate();
            
            user = await createUser({
                id: userId,
                email,
                name,
                picture,
                googleId: sub,
                plan: 'free',
                usage: {
                    used: 0,
                    limit: 10,
                    resetDate
                },
                createdAt: new Date().toISOString(),
                lastLogin: new Date().toISOString()
            });
            console.log('[AUTH] Utente creato:', user.id);
        } else {
            console.log('[AUTH] Utente esistente:', user.id);
            // Aggiorna info utente
            user.name = name;
            user.picture = picture;
            user.lastLogin = new Date().toISOString();
            // TODO: update in DynamoDB
        }
        
        // STEP 5: Genera JWT token per autenticazione app
        const jwtSecret = await secretsManager.getSecret('JWT_SECRET');
        const authToken = jwt.sign(
            {
                userId: user.id,
                email: user.email
            },
            jwtSecret,
            { expiresIn: '30d' }
        );
        
        console.log('[AUTH] JWT generato, login completato');
        
        // STEP 6: Restituisci JWT + user info
        return createResponse(200, {
            authToken,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                picture: user.picture,
                plan: user.plan || 'free',
                usage: user.usage || { used: 0, limit: 10 }
            }
        });
        
    } catch (error) {
        console.error('[AUTH] Error in Google auth:', error);
        return createResponse(500, {
            error: 'Errore durante autenticazione',
            details: error.message
        });
    }
}

/**
 * Calcola data reset mensile (primo giorno del prossimo mese)
 */
function getNextMonthDate() {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return nextMonth.toISOString();
}

/**
 * Crea risposta HTTP standard
 */
function createResponse(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store'
        },
        body: JSON.stringify(body)
    };
}
