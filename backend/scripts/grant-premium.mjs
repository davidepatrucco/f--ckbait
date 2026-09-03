#!/usr/bin/env node
// grant-premium.mjs — alza a "premium" (uso illimitato) l'entitlement per-brand di un
// utente, dato l'indirizzo email. Uso: preview interna su staging, così il collega non
// si ferma alla quota free (1/giorno). L'utente DEVE aver già fatto login almeno una
// volta (il record esiste). Usa le credenziali AWS dell'ambiente (tuo profilo).
//
//   node backend/scripts/grant-premium.mjs <email> [--brand lemonsqueezer] [--table ...] [--plan premium]
//
// Deve stare sotto backend/ per risolvere @aws-sdk (Node ESM risolve i bare import dal
// path del modulo, non dalla cwd). Read/write mirato al solo record utente. Idempotente.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--'));
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const brand = opt('brand', 'lemonsqueezer');
const table = opt('table', 'reading-intelligence-users-staging');
const plan = opt('plan', 'premium');
const region = opt('region', process.env.AWS_REGION || 'eu-west-1');

if (!email) {
  console.error('uso: node backend/scripts/grant-premium.mjs <email> [--brand lemonsqueezer] [--table reading-intelligence-users-staging] [--plan premium]');
  process.exit(1);
}

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), { marshallOptions: { removeUndefinedValues: true } });

async function findByEmail() {
  let ExclusiveStartKey; const items = [];
  do {
    const out = await doc.send(new ScanCommand({ TableName: table, FilterExpression: 'email = :e', ExpressionAttributeValues: { ':e': email }, ExclusiveStartKey }));
    items.push(...(out.Items || [])); ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

(async () => {
  const users = await findByEmail();
  if (!users.length) { console.error(`✗ nessun utente con email ${email} nella tabella ${table}. Il collega ha fatto login almeno una volta?`); process.exit(2); }
  if (users.length > 1) { console.error(`✗ ${users.length} utenti con quella email (anomalo). Interrompo.`); process.exit(2); }
  const id = users[0].id;

  // 1) assicura la mappa entitlements e l'entry del brand (senza sovrascrivere se esistono).
  await doc.send(new UpdateCommand({ TableName: table, Key: { id }, UpdateExpression: 'SET entitlements = if_not_exists(entitlements, :empty)', ExpressionAttributeValues: { ':empty': {} } }));
  await doc.send(new UpdateCommand({
    TableName: table, Key: { id },
    UpdateExpression: 'SET entitlements.#b = if_not_exists(entitlements.#b, :init)',
    ExpressionAttributeNames: { '#b': brand },
    ExpressionAttributeValues: { ':init': { plan: 'free', usage_used: 0, usage_limit: 1, usage_reset_date: null } }
  }));
  // 2) setta il piano.
  await doc.send(new UpdateCommand({
    TableName: table, Key: { id },
    UpdateExpression: 'SET entitlements.#b.#p = :plan',
    ExpressionAttributeNames: { '#b': brand, '#p': 'plan' },
    ExpressionAttributeValues: { ':plan': plan }
  }));

  console.log(`✓ ${email} (id=${id}) → entitlements.${brand}.plan = "${plan}" su ${table}`);
})().catch((e) => { console.error('errore:', e.message); process.exit(1); });
