// config-store.mjs — configurazione amministrabile a runtime.
//
// Cosa risolve: prima i parametri si cambiavano solo con una variabile d'ambiente e
// un rilascio. Qui gli override sono persistiti, versionati, validati e leggibili
// senza ridistribuire il codice.
//
// Precedenza: override persistito > variabile d'ambiente > default nel codice.
// Il server resta l'autorità: questi valori sono quelli che il backend applica, e
// `GET /config` pubblica al client esattamente ciò che il server fa rispettare.
//
// Versionamento: ogni scrittura crea una nuova versione (`v<n>`) e aggiorna il
// puntatore `active`. Le versioni precedenti restano leggibili, quindi un cambio
// sbagliato è ricostruibile e reversibile.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'eu-west-1' });
const doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
const TABLE = process.env.CONFIG_TABLE_NAME || 'reading-intelligence-config-dev';
const ACTIVE_KEY = 'active';

// Schema dei parametri modificabili a runtime. Ogni voce dichiara dove si applica,
// il tipo e l'intervallo ammesso: un valore fuori intervallo viene RIFIUTATO, non
// applicato, perché una configurazione sbagliata qui costa soldi o blocca gli utenti.
export const CONFIG_SCHEMA = {
    'plan.free.trialSummaries': { type: 'int', min: 0, max: 100, description: 'Prove gratuite iniziali per brand' },
    'plan.free.dailySummaries': { type: 'int', min: 0, max: 1000, description: 'Riassunti al giorno nel piano free' },
    'transcription.maxActiveJobs': { type: 'int', min: 1, max: 10, description: 'Trascrizioni contemporanee per utente' },
    'transcription.maxJobsPerDay': { type: 'int', min: 1, max: 500, description: 'Trascrizioni al giorno per utente' },
    'transcription.maxMinutesPerDay': { type: 'int', min: 1, max: 6000, description: 'Minuti trascritti al giorno per utente' },
    'content.tooLongChars': { type: 'int', min: 1000, max: 1000000, description: 'Oltre questa lunghezza il contenuto è rifiutato' },
    'content.maxTextChars': { type: 'int', min: 500, max: 1000000, description: 'Caratteri effettivamente riassunti' },
    'content.maxPdfPages': { type: 'int', min: 1, max: 2000, description: 'Pagine massime di un PDF' },
    'media.sttSyncMaxSeconds': { type: 'int', min: 30, max: 3600, description: 'Durata massima per la trascrizione sincrona' },
    'media.sttAsyncMaxSeconds': { type: 'int', min: 60, max: 86400, description: 'Durata massima per la trascrizione asincrona' },
    'media.videoMinSeconds': { type: 'int', min: 0, max: 3600, description: 'Sotto questa durata un video non è "il contenuto"' },
    'rate.perMinute': { type: 'int', min: 1, max: 1000, description: 'Richieste al minuto per utente' },
    'rate.perHour': { type: 'int', min: 1, max: 10000, description: 'Richieste all’ora per utente' },
    'rate.perDay': { type: 'int', min: 1, max: 100000, description: 'Richieste al giorno per utente' },
    'model.premiumWordCount': { type: 'int', min: 100, max: 100000, description: 'Parole oltre cui un premium passa al modello premium' }
};

// Valida un insieme di override. Ritorna { values, errors }: i valori accettati e
// l'elenco dei rifiuti con la ragione. Non lancia: un singolo valore sbagliato non
// deve impedire l'applicazione degli altri.
export function validateConfig(input) {
    const values = {};
    const errors = [];
    for (const [key, raw] of Object.entries(input || {})) {
        const schema = CONFIG_SCHEMA[key];
        if (!schema) { errors.push({ key, reason: 'parametro non modificabile' }); continue; }
        const n = Number(raw);
        if (!Number.isFinite(n)) { errors.push({ key, reason: 'non è un numero' }); continue; }
        if (schema.type === 'int' && !Number.isInteger(n)) { errors.push({ key, reason: 'deve essere intero' }); continue; }
        if (n < schema.min || n > schema.max) {
            errors.push({ key, reason: `fuori intervallo (${schema.min}–${schema.max})` });
            continue;
        }
        values[key] = n;
    }
    return { values, errors };
}

// Coerenza reciproca: alcuni valori non hanno senso in isolamento. Si verifica il
// risultato COMBINATO (override + valori correnti), non i soli override.
export function checkConsistency(merged) {
    const problems = [];
    const v = (k, fallback) => (merged[k] !== undefined ? merged[k] : fallback);
    if (v('content.maxTextChars', 0) > v('content.tooLongChars', Infinity)) {
        problems.push('content.maxTextChars non può superare content.tooLongChars');
    }
    if (v('media.sttSyncMaxSeconds', 0) >= v('media.sttAsyncMaxSeconds', Infinity)) {
        problems.push('media.sttSyncMaxSeconds deve essere minore di media.sttAsyncMaxSeconds');
    }
    if (v('transcription.maxActiveJobs', 0) > v('transcription.maxJobsPerDay', Infinity)) {
        problems.push('transcription.maxActiveJobs non può superare maxJobsPerDay');
    }
    if (v('rate.perMinute', 0) > v('rate.perHour', Infinity) || v('rate.perHour', 0) > v('rate.perDay', Infinity)) {
        problems.push('i rate limit devono crescere da minuto a ora a giorno');
    }
    return problems;
}

// Legge la configurazione attiva. Ritorna null se non esiste (si usano i default).
export async function readActiveConfig() {
    const out = await doc.send(new GetCommand({ TableName: TABLE, Key: { configKey: ACTIVE_KEY } }));
    return out.Item || null;
}

// Scrive una nuova versione e aggiorna il puntatore attivo. La versione precedente
// resta leggibile: un cambio sbagliato si può ricostruire e annullare.
export async function writeConfig(values, updatedBy) {
    const current = await readActiveConfig();
    const version = (Number(current?.version) || 0) + 1;
    const record = {
        version,
        values,
        updatedAt: new Date().toISOString(),
        updatedBy: updatedBy || 'admin'
    };
    // Prima la copia storica, poi il puntatore attivo: se la seconda scrittura
    // fallisce resta comunque traccia della versione tentata.
    await doc.send(new PutCommand({ TableName: TABLE, Item: { configKey: `v${version}`, ...record } }));
    await doc.send(new PutCommand({ TableName: TABLE, Item: { configKey: ACTIVE_KEY, ...record } }));
    return record;
}

export async function listConfigVersions(limit = 20) {
    const out = await doc.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'configKey = :k',
        ExpressionAttributeValues: { ':k': ACTIVE_KEY },
        Limit: 1
    })).catch(() => null);
    // La tabella è a chiave singola: lo storico si elenca con una Scan limitata,
    // accettabile perché le versioni sono poche e l'accesso è solo amministrativo.
    const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
    const scan = await doc.send(new ScanCommand({ TableName: TABLE, Limit: 100 }));
    const versions = (scan.Items || [])
        .filter((i) => String(i.configKey).startsWith('v'))
        .sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0))
        .slice(0, limit)
        .map(({ configKey, version, updatedAt, updatedBy, values }) => ({ configKey, version, updatedAt, updatedBy, values }));
    return { active: out?.Items?.[0]?.version ?? null, versions };
}
