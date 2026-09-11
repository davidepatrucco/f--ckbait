// transcribe-jobs.mjs — stato dei job di trascrizione asincrona (video lunghi/HLS).
//
// Perché un job e non una chiamata sincrona: API Gateway chiude a 29s, mentre
// scaricare + segmentare + trascrivere un video da 30' richiede minuti. L'API
// crea il job e ritorna subito; il worker (Lambda separata, timeout 15') lo esegue;
// il client fa polling su GET /transcribe-job.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, QueryCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import { TRANSCRIPTION_LIMITS } from './policy.mjs';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'eu-west-1' });
const doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
const TABLE = process.env.TRANSCRIBE_JOBS_TABLE_NAME || 'reading-intelligence-transcribe-jobs-dev';
const TTL_SECONDS = 24 * 3600; // il transcript è cache di breve durata, non archivio

export const JOB_STATUS = { PENDING: 'pending', RUNNING: 'running', DONE: 'done', ERROR: 'error' };

export async function createJob({ userId, brandId, mediaUrl, mediaKind, lang }) {
    const jobId = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await doc.send(new PutCommand({
        TableName: TABLE,
        Item: {
            jobId,
            userId,
            brandId: brandId || null,
            mediaUrl,
            mediaKind: mediaKind || 'file',
            lang: lang || 'it',
            status: JOB_STATUS.PENDING,
            createdAt: new Date().toISOString(),
            ttl: now + TTL_SECONDS
        }
    }));
    return { jobId, status: JOB_STATUS.PENDING };
}

// Limiti anti-abuso. La trascrizione ha un costo per minuto: senza un tetto, un
// singolo account (o un token rubato) puo' accodare job illimitati.
export const MAX_ACTIVE_JOBS = TRANSCRIPTION_LIMITS.maxActiveJobs;
export const MAX_JOBS_PER_DAY = TRANSCRIPTION_LIMITS.maxJobsPerDay;
export const MAX_MINUTES_PER_DAY = TRANSCRIPTION_LIMITS.maxMinutesPerDay;
// Oltre questa eta' un job pending/running e' considerato morto (il worker ha timeout
// a 15'): senza questa finestra, un worker crashato bloccherebbe l'utente per sempre.
const STALE_AFTER_MS = TRANSCRIPTION_LIMITS.staleAfterMs;

// Classificazione PURA dei job letti dall'indice: separata dall'accesso a DynamoDB
// per poter essere verificata senza infrastruttura.
export function classifyJobs(items, now = Date.now()) {
    let active = 0;
    let last24h = 0;
    let minutes = 0;
    for (const item of items || []) {
        last24h++;
        // Minuti gia' trascritti: i segmenti hanno durata nota, quindi il consumo si
        // ricava senza dover misurare il media.
        const chunks = Number(item.chunks) || 0;
        if (chunks) minutes += (chunks * TRANSCRIPTION_LIMITS.segmentSeconds) / 60;
        const isOpen = item.status === JOB_STATUS.PENDING || item.status === JOB_STATUS.RUNNING;
        const age = now - Date.parse(item.createdAt || 0);
        if (isOpen && age < STALE_AFTER_MS) active++;
    }
    return { active, last24h, minutes: Math.round(minutes) };
}

// Conta i job dell'utente nelle ultime 24h, distinguendo quelli ancora attivi.
export async function countUserJobs(userId, now = Date.now()) {
    const since = new Date(now - 24 * 3600 * 1000).toISOString();
    let ExclusiveStartKey;
    let active = 0;
    let last24h = 0;
    let minutes = 0;
    do {
        const out = await doc.send(new QueryCommand({
            TableName: TABLE,
            IndexName: 'UserJobsIndex',
            KeyConditionExpression: 'userId = :u AND createdAt >= :since',
            ExpressionAttributeValues: { ':u': userId, ':since': since },
            ExclusiveStartKey
        }));
        // `chunks` non e' proiettato sull'indice (la proiezione di un GSI esistente
        // non si puo' modificare in place), quindi si legge dalla tabella con una
        // sola BatchGet sui job trovati: sono pochi per definizione (tetto giornaliero).
        const ids = (out.Items || []).map((i) => i.jobId).filter(Boolean).slice(0, 100);
        let detailed = out.Items || [];
        if (ids.length) {
            try {
                const batch = await doc.send(new BatchGetCommand({
                    RequestItems: {
                        [TABLE]: {
                            Keys: ids.map((jobId) => ({ jobId })),
                            ProjectionExpression: 'jobId, #s, createdAt, chunks',
                            ExpressionAttributeNames: { '#s': 'status' }
                        }
                    }
                }));
                const full = batch.Responses?.[TABLE] || [];
                if (full.length) detailed = full;
            } catch (e) {
                console.warn('lettura dettagli job fallita, minuti non conteggiati:', e?.message);
            }
        }
        const page = classifyJobs(detailed, now);
        active += page.active;
        last24h += page.last24h;
        minutes += page.minutes;
        ExclusiveStartKey = out.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return { active, last24h, minutes };
}

// Prende in carico il job in modo esclusivo. Lambda asincrona puo' consegnare lo
// STESSO evento piu' di una volta (at-least-once, anche senza errori): senza questo
// lucchetto il video verrebbe scaricato e trascritto due volte, pagandolo due volte.
// Ritorna false se un'altra invocazione lo ha gia' preso o se e' gia' concluso.
export async function claimJob(jobId) {
    try {
        await doc.send(new UpdateCommand({
            TableName: TABLE,
            Key: { jobId },
            UpdateExpression: 'SET #s = :running, startedAt = :now',
            ConditionExpression: 'attribute_exists(jobId) AND #s = :pending',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':running': JOB_STATUS.RUNNING, ':pending': JOB_STATUS.PENDING, ':now': new Date().toISOString() }
        }));
        return true;
    } catch (error) {
        if (error.name === 'ConditionalCheckFailedException') return false;
        throw error;
    }
}

export async function getJob(jobId) {
    if (!jobId || typeof jobId !== 'string') return null;
    const out = await doc.send(new GetCommand({ TableName: TABLE, Key: { jobId } }));
    return out.Item || null;
}

// Aggiornamento parziale: solo i campi passati (status/progress/transcript/code).
export async function updateJob(jobId, fields) {
    const allowed = ['status', 'progress', 'transcript', 'code', 'error', 'chunks', 'durationSeconds', 'partial', 'coverage'];
    const sets = [];
    const names = {};
    const values = {};
    for (const key of allowed) {
        if (fields[key] === undefined) continue;
        sets.push(`#${key} = :${key}`);
        names[`#${key}`] = key;
        values[`:${key}`] = fields[key];
    }
    if (!sets.length) return;
    sets.push('#updatedAt = :updatedAt');
    names['#updatedAt'] = 'updatedAt';
    values[':updatedAt'] = new Date().toISOString();
    await doc.send(new UpdateCommand({
        TableName: TABLE,
        Key: { jobId },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values
    }));
}

// Vista pubblica del job: mai esporre mediaUrl (può contenere token firmati) né
// il record di un altro utente (l'ownership è verificata dal chiamante).
export function publicJobView(job) {
    if (!job) return null;
    return {
        jobId: job.jobId,
        status: job.status,
        progress: job.progress || null,
        transcript: job.status === JOB_STATUS.DONE ? (job.transcript || '') : undefined,
        // La parzialita' va esposta: un riassunto su una trascrizione incompleta
        // deve poterlo dire all'utente.
        partial: job.status === JOB_STATUS.DONE ? Boolean(job.partial) : undefined,
        coverage: job.status === JOB_STATUS.DONE && job.partial ? job.coverage : undefined,
        code: job.status === JOB_STATUS.ERROR ? (job.code || 'TRANSCRIPTION_FAILED') : undefined
    };
}
