// transcribe-jobs.mjs — stato dei job di trascrizione asincrona (video lunghi/HLS).
//
// Perché un job e non una chiamata sincrona: API Gateway chiude a 29s, mentre
// scaricare + segmentare + trascrivere un video da 30' richiede minuti. L'API
// crea il job e ritorna subito; il worker (Lambda separata, timeout 15') lo esegue;
// il client fa polling su GET /transcribe-job.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';

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
export const MAX_ACTIVE_JOBS = Number(process.env.MAX_ACTIVE_TRANSCRIBE_JOBS || 2);
export const MAX_JOBS_PER_DAY = Number(process.env.MAX_TRANSCRIBE_JOBS_PER_DAY || 20);
// Oltre questa eta' un job pending/running e' considerato morto (il worker ha timeout
// a 15'): senza questa finestra, un worker crashato bloccherebbe l'utente per sempre.
const STALE_AFTER_MS = 20 * 60 * 1000;

// Classificazione PURA dei job letti dall'indice: separata dall'accesso a DynamoDB
// per poter essere verificata senza infrastruttura.
export function classifyJobs(items, now = Date.now()) {
    let active = 0;
    let last24h = 0;
    for (const item of items || []) {
        last24h++;
        const isOpen = item.status === JOB_STATUS.PENDING || item.status === JOB_STATUS.RUNNING;
        const age = now - Date.parse(item.createdAt || 0);
        if (isOpen && age < STALE_AFTER_MS) active++;
    }
    return { active, last24h };
}

// Conta i job dell'utente nelle ultime 24h, distinguendo quelli ancora attivi.
export async function countUserJobs(userId, now = Date.now()) {
    const since = new Date(now - 24 * 3600 * 1000).toISOString();
    let ExclusiveStartKey;
    let active = 0;
    let last24h = 0;
    do {
        const out = await doc.send(new QueryCommand({
            TableName: TABLE,
            IndexName: 'UserJobsIndex',
            KeyConditionExpression: 'userId = :u AND createdAt >= :since',
            ExpressionAttributeValues: { ':u': userId, ':since': since },
            ExclusiveStartKey
        }));
        const page = classifyJobs(out.Items, now);
        active += page.active;
        last24h += page.last24h;
        ExclusiveStartKey = out.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return { active, last24h };
}

export async function getJob(jobId) {
    if (!jobId || typeof jobId !== 'string') return null;
    const out = await doc.send(new GetCommand({ TableName: TABLE, Key: { jobId } }));
    return out.Item || null;
}

// Aggiornamento parziale: solo i campi passati (status/progress/transcript/code).
export async function updateJob(jobId, fields) {
    const allowed = ['status', 'progress', 'transcript', 'code', 'error', 'chunks', 'durationSeconds'];
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
        code: job.status === JOB_STATUS.ERROR ? (job.code || 'TRANSCRIPTION_FAILED') : undefined
    };
}
