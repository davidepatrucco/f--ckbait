// transcribe-jobs.mjs — stato dei job di trascrizione asincrona (video lunghi/HLS).
//
// Perché un job e non una chiamata sincrona: API Gateway chiude a 29s, mentre
// scaricare + segmentare + trascrivere un video da 30' richiede minuti. L'API
// crea il job e ritorna subito; il worker (Lambda separata, timeout 15') lo esegue;
// il client fa polling su GET /transcribe-job.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
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
