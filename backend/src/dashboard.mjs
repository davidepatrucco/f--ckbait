// dashboard.mjs — aggregazione metriche portfolio per la dashboard interna (#4).
// Sorgenti: tabella analytics (eventi funnel) + tabella users (entitlements per brand).
// MVP: Scan+filtro in-memory (volume basso). Per scalare → GSI BrandDateIndex (vedi
// docs/dashboard-spec.md §0.2).
//
// Definizioni metriche (esplicite, per riproducibilità):
// - installs           = count(extension_installed)                      [anonimo]
// - opens              = count(extension_opened)                         [anonimo]
// - logins             = count(login_completed)
// - firstSummaryUsers  = distinct userId con almeno 1 summary_completed
// - summaries          = count(summary_completed)
// - activeUsers        = distinct userId con summary_completed
// - summariesPerUser   = summaries / activeUsers
// - repeatPct          = % activeUsers con >1 summary
// - retention Dk       = % della coorte (per data primo summary) con un summary a giorno +k
// - Money: paidPct/premiumUsers da tabella users; cost da cost_estimate (COGS LLM misurato).
// - activation (comparison) = firstSummaryUsers / installs  (proxy brand-level: install anonimi)

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { listBrands } from './brands.mjs';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'eu-west-1' });
const docClient = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
const ANALYTICS_TABLE = process.env.ANALYTICS_TABLE_NAME || 'reading-intelligence-analytics-dev';
const USERS_TABLE = process.env.USERS_TABLE_NAME || 'reading-intelligence-users-dev';

const DAY_MS = 86400000;

async function scanAll(params) {
    const items = [];
    let ExclusiveStartKey;
    do {
        const out = await docClient.send(new ScanCommand({ ...params, ExclusiveStartKey }));
        items.push(...(out.Items || []));
        ExclusiveStartKey = out.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
}

function dayIndex(datePartition) {
    // 'YYYY-MM-DD' → indice giorno (epoch/DAY). Fallback a NaN se assente.
    const t = Date.parse(datePartition + 'T00:00:00Z');
    return Number.isFinite(t) ? Math.floor(t / DAY_MS) : NaN;
}

function emptyBrandAgg() {
    return {
        installs: 0, opens: 0, logins: 0, checkoutStarted: 0, subscriptionActivated: 0,
        summaries: 0, costTotal: 0,
        userSummaryDays: new Map(), // userId → Set(dayIndex) dei summary
    };
}

// Retention Dk sulla coorte "primo summary": % utenti con un summary a (primoGiorno + k).
export function retention(userSummaryDays, k) {
    let cohort = 0, retained = 0;
    for (const days of userSummaryDays.values()) {
        if (!days.size) continue;
        const first = Math.min(...days);
        cohort++;
        if (days.has(first + k)) retained++;
    }
    return { cohort, retainedPct: cohort ? Number(((retained / cohort) * 100).toFixed(1)) : null };
}

function summarizeBrand(agg, users) {
    const activeUsers = agg.userSummaryDays.size;
    const repeatUsers = [...agg.userSummaryDays.values()].filter(s => s.size > 1).length;
    const totalUsers = users.total;
    const premiumUsers = users.premium;
    const d1 = retention(agg.userSummaryDays, 1);
    const d7 = retention(agg.userSummaryDays, 7);
    const d30 = retention(agg.userSummaryDays, 30);
    const costPerSummary = agg.summaries ? agg.costTotal / agg.summaries : 0;
    const costPerActiveUser = activeUsers ? agg.costTotal / activeUsers : 0;
    const paidPct = totalUsers ? Number(((premiumUsers / totalUsers) * 100).toFixed(1)) : null;
    return {
        acquisition: {
            installs: agg.installs, opens: agg.opens, logins: agg.logins,
            firstSummaryUsers: activeUsers,
            activationPct: agg.installs ? Number(((activeUsers / agg.installs) * 100).toFixed(1)) : null
        },
        engagement: {
            summaries: agg.summaries, activeUsers,
            summariesPerUser: activeUsers ? Number((agg.summaries / activeUsers).toFixed(2)) : 0,
            repeatPct: activeUsers ? Number(((repeatUsers / activeUsers) * 100).toFixed(1)) : null
        },
        retention: { d1: d1.retainedPct, d7: d7.retainedPct, d30: d30.retainedPct, cohort: d1.cohort },
        money: {
            totalUsers, premiumUsers, paidPct,
            checkoutStarted: agg.checkoutStarted, subscriptionActivated: agg.subscriptionActivated,
            cost: {
                total: Number(agg.costTotal.toFixed(6)),
                perSummary: Number(costPerSummary.toFixed(6)),
                perActiveUser: Number(costPerActiveUser.toFixed(6))
            }
        }
    };
}

/**
 * @param {object} opts
 * @param {number} opts.days finestra (default 30)
 */
export async function computePortfolioMetrics({ days = 30 } = {}) {
    const now = Date.now();
    const fromTs = now - days * DAY_MS;

    // Eventi nella finestra (timestamp N). TimestampIndex è HASH-only → Scan+filtro.
    const events = await scanAll({
        TableName: ANALYTICS_TABLE,
        FilterExpression: '#ts >= :from',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: { ':from': fromTs }
    });
    // Utenti + entitlements per brand.
    const userItems = await scanAll({ TableName: USERS_TABLE });

    const brands = listBrands();
    const perBrand = new Map(brands.map(b => [b, emptyBrandAgg()]));
    const brandUsers = new Map(brands.map(b => [b, { total: 0, premium: 0 }]));

    for (const ev of events) {
        const brand = ev.brand_id || 'lemonsqueezer';
        const agg = perBrand.get(brand);
        if (!agg) continue;
        switch (ev.event_type) {
            case 'extension_installed': agg.installs++; break;
            case 'extension_opened': agg.opens++; break;
            case 'login_completed': agg.logins++; break;
            case 'checkout_started': agg.checkoutStarted++; break;
            case 'subscription_activated': agg.subscriptionActivated++; break;
            case 'summary_completed': {
                agg.summaries++;
                agg.costTotal += Number(ev.cost_estimate || 0);
                if (ev.userId) {
                    if (!agg.userSummaryDays.has(ev.userId)) agg.userSummaryDays.set(ev.userId, new Set());
                    const di = dayIndex(ev.date_partition) || Math.floor(Number(ev.timestamp || now) / DAY_MS);
                    agg.userSummaryDays.get(ev.userId).add(di);
                }
                break;
            }
            default: break;
        }
    }

    // Entitlements per brand dalla tabella users (map entitlements[brand].plan).
    for (const u of userItems) {
        const ent = u.entitlements || {};
        for (const b of brands) {
            const e = ent[b];
            if (!e) continue; // utente senza vita commerciale su questo brand
            const bu = brandUsers.get(b);
            bu.total++;
            if (e.plan && e.plan !== 'free') bu.premium++;
        }
    }

    const brandsOut = {};
    const comparison = [];
    for (const b of brands) {
        const m = summarizeBrand(perBrand.get(b), brandUsers.get(b));
        brandsOut[b] = m;
        comparison.push({
            brand: b,
            activationPct: m.acquisition.activationPct,
            d7: m.retention.d7,
            summariesPerUser: m.engagement.summariesPerUser,
            paidPct: m.money.paidPct,
            costPerUser: m.money.cost.perActiveUser
        });
    }

    // Aggregato portfolio (All): somma eventi + unione utenti.
    const allAgg = emptyBrandAgg();
    const allUsers = { total: 0, premium: 0 };
    for (const b of brands) {
        const a = perBrand.get(b);
        allAgg.installs += a.installs; allAgg.opens += a.opens; allAgg.logins += a.logins;
        allAgg.checkoutStarted += a.checkoutStarted; allAgg.subscriptionActivated += a.subscriptionActivated;
        allAgg.summaries += a.summaries; allAgg.costTotal += a.costTotal;
        for (const [uid, set] of a.userSummaryDays) {
            const key = b + ':' + uid; // stesso utente su brand diversi = coorti separate
            allAgg.userSummaryDays.set(key, set);
        }
        const bu = brandUsers.get(b); allUsers.total += bu.total; allUsers.premium += bu.premium;
    }

    return {
        period: { days, from: new Date(fromTs).toISOString(), to: new Date(now).toISOString() },
        assumptions: { note: 'metriche misurate; install/open anonimi → activation = proxy brand-level; cost = COGS LLM' },
        all: summarizeBrand(allAgg, allUsers),
        brands: brandsOut,
        comparison
    };
}
