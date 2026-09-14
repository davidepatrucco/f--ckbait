// Flusso OAuth Google completo, contro DynamoDB REALE (staging).
//
// Gli endpoint Google sono sostituiti intercettando globalThis.fetch: è l'unica
// frontiera esterna. Tutto il resto — verifica dei parametri, creazione utente,
// inizializzazione di piano/quota/prove, emissione del JWT — è codice reale su un
// database reale. Il difetto trovato in questa area (signup Google che inizializzava
// 10 utilizzi con reset mensile invece del limite giornaliero del brand) era proprio
// nel contratto di inizializzazione, che un finto database non avrebbe verificato.
//
// Esecuzione: RUN_INTEGRATION=1 npm run test:integration
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const RUN = process.env.RUN_INTEGRATION === '1';
const ENV = process.env.INTEGRATION_ENV || 'staging';
process.env.USERS_TABLE_NAME ||= `reading-intelligence-users-${ENV}`;
process.env.AWS_REGION ||= 'eu-west-1';
// SecretsManager in ambiente locale legge le variabili d'ambiente.
process.env.ENVIRONMENT ||= 'test';
process.env.JWT_SECRET ||= 'segreto-solo-per-il-test-di-integrazione';
process.env.GOOGLE_WEB_CLIENT_ID ||= 'client-id-di-prova.apps.googleusercontent.com';
process.env.GOOGLE_WEB_CLIENT_SECRET ||= 'secret-di-prova';

// L'intercettore va installato PRIMA degli import: jose lega `fetch` al momento
// dell'import, quindi uno stub applicato dopo non verrebbe visto dalla verifica del
// JWKS. Senza questo ordine le prove di rifiuto passerebbero per il motivo sbagliato
// (nessuna chiave raggiungibile), invece che per il controllo che devono esercitare.
const realFetch = globalThis.fetch;
let routes = {};
globalThis.fetch = async (url, init) => {
    const u = String(url);
    for (const [fragment, handler] of Object.entries(routes)) {
        if (u.includes(fragment)) return handler(u, init);
    }
    return realFetch(url, init);
};

const authGoogle = RUN ? await import('../../src/auth-google.mjs') : null;
const dynamo = RUN ? await import('../../src/dynamodb.mjs') : null;
const auth = RUN ? await import('../../src/auth.mjs') : null;
const brands = RUN ? await import('../../src/brands.mjs') : null;

const email = `oauth-itest-${randomUUID()}@example.invalid`;

// L'handler verifica davvero l'id_token (firma, emittente, destinatario) contro il
// JWKS di Google. Per esercitare quel percorso senza indebolirlo si genera una
// coppia di chiavi, si firma un id_token e si serve la chiave pubblica dall'URL del
// JWKS. La verifica resta quella reale: cambia solo chi possiede la chiave.
const jose = RUN ? await import('jose') : null;
let signingKey = null;
let publicJwk = null;

async function ensureKeys() {
    if (signingKey) return;
    const { privateKey, publicKey } = await jose.generateKeyPair('RS256', { extractable: true });
    signingKey = privateKey;
    publicJwk = { ...(await jose.exportJWK(publicKey)), alg: 'RS256', use: 'sig', kid: 'test-key' };
    // La verifica resta quella reale di jose: si sostituisce solo la provenienza
    // della chiave pubblica, non il controllo di firma/emittente/destinatario.
    const localJwks = jose.createLocalJWKSet({ keys: [publicJwk] });
    authGoogle.providers.jwks = () => localJwks;
}

async function signIdToken(overrides = {}) {
    await ensureKeys();
    return new jose.SignJWT({
        email, name: 'OAuth Test', picture: 'https://example.invalid/p.png',
        email_verified: true, ...overrides.claims
    })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(overrides.issuer ?? 'https://accounts.google.com')
        .setAudience(overrides.audience ?? process.env.GOOGLE_WEB_CLIENT_ID)
        .setSubject(overrides.sub ?? 'google-sub-test')
        .setIssuedAt()
        .setExpirationTime(overrides.exp ?? '10m')
        .sign(signingKey);
}

// Risposte di Google: scambio del codice e profilo utente.
async function stubGoogle({ tokenStatus = 200, tokenBody, userInfo, idTokenOptions } = {}) {
    const idToken = tokenStatus === 200 ? await signIdToken(idTokenOptions || {}) : null;
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
        status, headers: { 'Content-Type': 'application/json' }
    });
    routes = {
        'googleapis.com/oauth2/v3/certs': () => json({ keys: [publicJwk] }),
        'oauth2.googleapis.com/token': () => json(tokenBody ?? { access_token: 'at_test', id_token: idToken, expires_in: 3600 }, tokenStatus),
        'openidconnect.googleapis.com/v1/userinfo': () => json(userInfo ?? { sub: 'google-sub-test', email, name: 'OAuth Test', picture: 'https://example.invalid/p.png' })
    };
}

const call = (body) => authGoogle.handleGoogleAuth({
    httpMethod: 'POST', headers: {}, body: JSON.stringify(body)
});

const validBody = { code: 'auth-code', code_verifier: 'verifier-abc', redirect_uri: 'https://abc.chromiumapp.org/' };

after(async () => {
    globalThis.fetch = realFetch;
    routes = {};
    if (!RUN) return;
    const user = await dynamo.getUserByEmail(email).catch(() => null);
    if (user?.id) {
        const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
        const { DynamoDBDocumentClient, DeleteCommand } = await import('@aws-sdk/lib-dynamodb');
        const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));
        await doc.send(new DeleteCommand({ TableName: process.env.USERS_TABLE_NAME, Key: { id: user.id } })).catch(() => {});
    }
});

test('parametri mancanti: rifiuto senza contattare Google', { skip: !RUN && 'RUN_INTEGRATION non impostato' }, async () => {
    let contacted = false;
    routes = { 'googleapis.com': () => { contacted = true; return new Response('{}', { status: 200 }); } };
    for (const body of [{}, { code: 'x' }, { code: 'x', code_verifier: 'y' }]) {
        const res = await call(body);
        assert.equal(res.statusCode, 400, `atteso 400 per ${JSON.stringify(body)}`);
    }
    assert.equal(contacted, false, 'nessuna chiamata a Google con parametri incompleti');
});

test('scambio del codice fallito: errore, nessun utente creato', { skip: !RUN && 'RUN_INTEGRATION non impostato' }, async () => {
    await stubGoogle({ tokenStatus: 400, tokenBody: { error: 'invalid_grant' } });
    const res = await call(validBody);
    assert.ok(res.statusCode >= 400, `atteso errore, ricevuto ${res.statusCode}`);
    assert.equal(await dynamo.getUserByEmail(email), null, 'utente creato nonostante lo scambio fallito');
});

test('primo accesso: utente creato con il piano free del brand', { skip: !RUN && 'RUN_INTEGRATION non impostato' }, async () => {
    await stubGoogle();
    const res = await call(validBody);
    assert.equal(res.statusCode, 200, `login fallito: ${res.body}`);
    const payload = JSON.parse(res.body);
    assert.ok(payload.authToken, 'nessun token emesso');
    // La risposta deve riportare la quota reale, non un valore fisso.
    assert.equal(payload.user.usage.limit, brands.getFreeLimit(brands.DEFAULT_BRAND), 'quota errata nella risposta di login');
    assert.equal(payload.user.trialRemaining, brands.getFreeTrial(brands.DEFAULT_BRAND), 'prove non riportate al client');

    const stored = await dynamo.getUserByEmail(email);
    assert.ok(stored, 'utente non persistito');
    const ent = auth.getEntitlement(dynamo.formatUserFromDynamoDB(stored), brands.DEFAULT_BRAND);

    // Il difetto era qui: 10 utilizzi con reset mensile invece del limite del brand.
    assert.equal(ent.plan, 'free');
    assert.equal(ent.usage.limit, brands.getFreeLimit(brands.DEFAULT_BRAND), 'quota diversa da quella del brand');
    assert.equal(ent.trialRemaining, brands.getFreeTrial(brands.DEFAULT_BRAND), 'prove iniziali non assegnate');

    // Il reset deve essere giornaliero (entro 24h), non mensile.
    const resetIn = new Date(ent.usage.resetDate).getTime() - Date.now();
    assert.ok(resetIn > 0 && resetIn <= 25 * 3600 * 1000, `reset non giornaliero: ${ent.usage.resetDate}`);
});

test('accesso successivo: nessun secondo utente, quota invariata', { skip: !RUN && 'RUN_INTEGRATION non impostato' }, async () => {
    const before = await dynamo.getUserByEmail(email);
    assert.ok(before, 'presuppone il test precedente');

    await stubGoogle();
    const res = await call(validBody);
    assert.equal(res.statusCode, 200);

    const after2 = await dynamo.getUserByEmail(email);
    assert.equal(after2.id, before.id, 'creato un secondo utente per la stessa email');
    const ent = auth.getEntitlement(dynamo.formatUserFromDynamoDB(after2), brands.DEFAULT_BRAND);
    assert.equal(ent.trialRemaining, brands.getFreeTrial(brands.DEFAULT_BRAND), 'le prove non devono essere riassegnate né consumate al login');
});

test('il token emesso è verificabile e non contiene il piano', { skip: !RUN && 'RUN_INTEGRATION non impostato' }, async () => {
    await stubGoogle();
    const res = await call(validBody);
    const { authToken: token } = JSON.parse(res.body);
    const jwt = (await import('jsonwebtoken')).default;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    assert.ok(decoded.userId, 'manca userId nel token');
    // Il piano si rilegge dal database a ogni richiesta: se stesse nel token, un
    // token rubato potrebbe dichiararsi premium.
    assert.equal(decoded.plan, undefined, 'il piano non deve essere nel token');
    assert.equal(decoded.entitlements, undefined, 'gli entitlement non devono essere nel token');
});

test('un id_token con destinatario sbagliato viene rifiutato', { skip: !RUN && 'RUN_INTEGRATION non impostato' }, async () => {
    // Se il controllo dell'audience cadesse, un id_token emesso per un'ALTRA
    // applicazione varrebbe come login su questa.
    await stubGoogle({ idTokenOptions: { audience: 'altra-app.apps.googleusercontent.com' } });
    const res = await call(validBody);
    assert.ok(res.statusCode >= 400, `token di un'altra app accettato (${res.statusCode})`);
});

test('un id_token con emittente sbagliato viene rifiutato', { skip: !RUN && 'RUN_INTEGRATION non impostato' }, async () => {
    await stubGoogle({ idTokenOptions: { issuer: 'https://attaccante.example' } });
    const res = await call(validBody);
    assert.ok(res.statusCode >= 400, `emittente non valido accettato (${res.statusCode})`);
});

test('un id_token scaduto viene rifiutato', { skip: !RUN && 'RUN_INTEGRATION non impostato' }, async () => {
    await stubGoogle({ idTokenOptions: { exp: Math.floor(Date.now() / 1000) - 60 } });
    const res = await call(validBody);
    assert.ok(res.statusCode >= 400, `token scaduto accettato (${res.statusCode})`);
});

test('un id_token firmato con un’altra chiave viene rifiutato', { skip: !RUN && 'RUN_INTEGRATION non impostato' }, async () => {
    await ensureKeys();
    const { privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
    const forged = await new jose.SignJWT({ email, email_verified: true })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer('https://accounts.google.com')
        .setAudience(process.env.GOOGLE_WEB_CLIENT_ID)
        .setSubject('google-sub-test')
        .setIssuedAt().setExpirationTime('10m')
        .sign(privateKey);
    await stubGoogle({ tokenBody: { access_token: 'at_test', id_token: forged, expires_in: 3600 } });
    const res = await call(validBody);
    assert.ok(res.statusCode >= 400, `firma non valida accettata (${res.statusCode})`);
});
