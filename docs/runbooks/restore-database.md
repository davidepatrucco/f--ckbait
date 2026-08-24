# Runbook — Restore DynamoDB (PITR / Backup)

> Status: **scaffolding**. Verify PITR is enabled per table and confirm table
> names/keys against the live account before executing. Region: `eu-west-1`.

## Tables

| Table | PK / keys | Notes |
|---|---|---|
| `lemonsqueezer-analytics-<env>` | PK `eventId` (S); GSI `TimestampIndex`(timestamp N), `UserEventsIndex`(userId S + timestamp N) | analytics events |
| `lemonsqueezer-summary-cache-<env>` | PK `cache_key` (S) | shared content-hash summary cache (v2) |
| `lemonsqueezer-cache-<env>` | legacy cache | retained during key-schema migration |
| rate-limit table (see SAM) | TTL attr `resetTime` | quota / rate limiting |

All `PAY_PER_REQUEST`, SSE enabled (see `infra/sam-template-simple.yaml`).

## Preconditions

- Confirm PITR status per table:
  ```bash
  aws dynamodb describe-continuous-backups --region eu-west-1 \
    --table-name lemonsqueezer-analytics-<env> \
    --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription'
  ```
- If `PointInTimeRecoveryStatus` != `ENABLED`, PITR restore is **not possible** for
  that table — only on-demand backups (if any) can be used. Enabling PITR now does
  not create retroactive recovery points.

## Enable PITR (if missing)

```bash
aws dynamodb update-continuous-backups --region eu-west-1 \
  --table-name lemonsqueezer-analytics-<env> \
  --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true
```

## Restore procedure (PITR)

DynamoDB PITR restores to a **new table**; it never overwrites the source.

1. Identify the target restore time (UTC, within the retention window, max 35 days).
2. Restore to a new table:
   ```bash
   aws dynamodb restore-table-to-point-in-time --region eu-west-1 \
     --source-table-name lemonsqueezer-analytics-<env> \
     --target-table-name lemonsqueezer-analytics-<env>-restore-$(date -u +%Y%m%d%H%M) \
     --restore-date-time 2026-08-24T09:00:00Z
   ```
   Note: GSIs are recreated on the restored table (billing/throughput inherit
   PAY_PER_REQUEST). Confirm both `TimestampIndex` and `UserEventsIndex` are present
   with `describe-table` before cutover.
3. Validate the restored table (row counts, spot-check recent `eventId`s).
4. Cutover:
   - **Preferred**: point the application at the restored table by updating the
     Lambda env var (`ANALYTICS_TABLE_NAME`) or the CFN parameter, then redeploy.
     Editing `infra/**` is out of scope for this scaffold; coordinate with infra owner.
   - **Alternative**: migrate data from the restored table back into the original,
     then keep the original name.

## Restore from on-demand backup

```bash
aws dynamodb list-backups --region eu-west-1 --table-name lemonsqueezer-analytics-<env>
aws dynamodb restore-table-from-backup --region eu-west-1 \
  --target-table-name lemonsqueezer-analytics-<env>-restore \
  --backup-arn <BACKUP_ARN>
```

## Post-restore

- Update `ANALYTICS_TABLE_NAME` / `CACHE_TABLE_NAME` env if the table name changed.
- Delete the temporary restore table once cutover is confirmed to control cost.
- For cache tables: a restore is rarely needed — the cache can be rebuilt by
  re-generating summaries. Prefer `invalidate-cache.md` over restore for cache data.

## RPO / RTO

- PITR effective RPO: ~5 minutes (DynamoDB continuous backups granularity).
- Restore RTO depends on table size; a restore of a multi-GB table can take tens of
  minutes. See `disaster-recovery.md` for the aggregate RPO<24h / RTO<2h targets.

## Gaps

- PITR enablement per table is **not verified** in this scaffold — confirm before
  relying on it.
- No scheduled on-demand backup plan (AWS Backup) is defined here.
