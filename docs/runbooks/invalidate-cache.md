# Runbook — Invalidate Summary Cache

> Status: **scaffolding**. Verify table names and the cache-key scheme against the
> live account. Region: `eu-west-1`.

## Background

The summary cache lives in DynamoDB table `lemonsqueezer-summary-cache-<env>`
(PK `cache_key`, S). The cache key is a SHA-256 derived from, among other inputs,
the constant `CACHE_VERSION` in `backend/src/cache.mjs`:

```
const CACHE_VERSION = 'summary-v3';   // backend/src/cache.mjs
```

The key also mixes in `brand_id`, `promptProfile`, `outputSchema`, content hash,
language, profile, squeeze, model, source type. Because `CACHE_VERSION` and prompt/
schema versions are part of the key, **bumping any of them makes all prior entries
unreachable** without deleting them (logical invalidation).

Legacy table `lemonsqueezer-cache-<env>` is retained during migration. TTL
(`CACHE_TTL_HOURS`, default 24h) also expires entries automatically.

## When to invalidate

- Prompt or output-schema change that would otherwise serve stale summaries.
- A bug that produced malformed cached output (this is exactly why v2→v3 happened;
  see the comment in `cache.mjs`).
- Model change (`OPENAI_MODEL`) — note this already creates a separate cache namespace
  via the key, so an explicit purge may be unnecessary.

## Option A — Logical invalidation via CACHE_VERSION bump (preferred)

Editing `backend/**` is out of scope for this scaffold; coordinate with the backend
owner. The change is:

1. Bump `CACHE_VERSION` (e.g. `summary-v3` → `summary-v4`) in `backend/src/cache.mjs`.
2. Deploy the summarize Lambda.
3. All new requests compute keys with the new version → guaranteed misses on old
   entries → regenerated. Old entries remain until TTL expiry.

Advantages: instant, no data operation, reversible (revert the constant). Old rows
age out via TTL.

## Option B — Physical purge (delete items)

Use when old rows must be removed immediately (cost/compliance) rather than aged out.

There is no partition-scoped delete in DynamoDB; you must scan keys and batch-delete.

1. Snapshot the table (optional safety) — see `restore-database.md`.
2. Scan projecting only the key, then `BatchWriteItem` deletes (25/req), paginated:
   ```bash
   # enumerate keys
   aws dynamodb scan --region eu-west-1 \
     --table-name lemonsqueezer-summary-cache-<env> \
     --projection-expression cache_key \
     --query 'Items[].cache_key.S' --output text
   # then delete-item per key, or BatchWriteItem in batches of 25
   ```
   For a full purge, deleting and recreating the table (via infra) is cheaper than
   scanning a very large table — but table recreation touches `infra/**` (out of
   scope here).
3. Verify item count via `describe-table` (`ItemCount` is eventually consistent) or a
   `Select COUNT` scan.

## Targeted invalidation (single URL / content)

The key is content-hash based, not URL based, and the raw text is never stored. You
cannot reverse a `cache_key` back to a URL. To invalidate one specific item you must
recompute its `cache_key` from the same inputs (brand, prompt profile, schema,
normalized text, language, profile, squeeze, model, source type) using the logic in
`buildSummaryCacheKey`, then `delete-item` by that key.

## Verification

- After a `CACHE_VERSION` bump: issue a request that previously hit cache and confirm
  a fresh generation (higher latency, new `cache_version` on the stored item = new
  value).
- After a purge: `describe-table` item count decreased as expected.

## Gaps

- No admin endpoint or script for cache purge exists in this scaffold.
- `cache_hit` is not recorded in analytics, so hit-rate impact of an invalidation is
  not directly measurable (see `docs/dashboard-spec.md` §1.6).
