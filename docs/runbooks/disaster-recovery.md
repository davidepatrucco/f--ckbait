# Runbook — Disaster Recovery

> Status: **scaffolding**. Targets below are objectives; achievability must be
> validated against the live account (PITR enablement, deployment artifacts,
> single-region posture). Region: `eu-west-1`.

## Objectives

- **RPO < 24h** — maximum tolerable data loss. Driven by DynamoDB durability:
  - PITR (if enabled) gives ~5-minute RPO for analytics/cache tables — well within
    the 24h target. **Requires PITR enabled** (see `restore-database.md`; currently
    unverified — this is the main risk to the RPO target).
  - Summary cache is regenerable, so its effective RPO is not user-impacting.
- **RTO < 2h** — maximum tolerable downtime. Driven by: Lambda rollback (minutes),
  DynamoDB restore (minutes to tens of minutes depending on size), config/DNS
  propagation.

## In-scope failure classes

1. Bad deploy (code/config regression).
2. Data corruption / accidental deletion (DynamoDB).
3. Secret compromise.
4. Regional AWS service impairment (eu-west-1).

## 1. Bad deploy — roll back Lambda to previous version (primary path, fastest)

Lambda retains prior versions. Roll back by pointing the alias/trigger to the last
known-good version.

```bash
# list versions (find last known-good)
aws lambda list-versions-by-function --region eu-west-1 \
  --function-name lemonsqueezer-summarize-<env> \
  --query 'Versions[].[Version,LastModified]' --output table

# if using an alias, repoint it (preferred, no integration change)
aws lambda update-alias --region eu-west-1 \
  --function-name lemonsqueezer-summarize-<env> \
  --name <ALIAS> --function-version <GOOD_VERSION>
```

If invocations target `$LATEST` directly (no alias), redeploy the previous artifact.
The repo ships `function.zip`; a known-good artifact can be re-published:
```bash
aws lambda update-function-code --region eu-west-1 \
  --function-name lemonsqueezer-summarize-<env> \
  --zip-file fileb://function.zip --publish
```
Repeat for `lemonsqueezer-stripe-webhook-<env>` if affected. Target RTO for a pure
code rollback: minutes.

> Note on aliases: whether aliases exist is **not verified** in this scaffold. If not,
> add them — alias repointing is the safest, fastest rollback and directly supports
> the RTO target.

## 2. Data corruption / deletion (DynamoDB)

Follow `restore-database.md` (PITR restore-to-new-table, then cutover via
`ANALYTICS_TABLE_NAME` / `CACHE_TABLE_NAME`). For cache tables prefer regeneration
(`invalidate-cache.md`) over restore.

## 3. Secret compromise

Follow `rotate-secrets.md` immediately for the affected parameter(s); treat as SEV1
if it is `jwt-secret`, `openai-api-key`, or a Stripe secret.

## 4. Regional impairment (eu-west-1)

Current posture is **single-region**. There is no active multi-region failover.

- Short impairment: wait for AWS recovery; PITR/backups remain intact.
- Prolonged impairment: rebuild the stack in another region from
  `infra/sam-template-simple.yaml` (SAM deploy with a new region), restore DynamoDB
  from backups if cross-region copies exist. **Gap**: no cross-region backup copy and
  no tested cross-region deploy today → the RTO<2h target is **not guaranteed** for a
  full-region loss. Document this risk explicitly to stakeholders.

## Full-stack redeploy (from IaC)

```bash
# from repo root; SAM template is infra/sam-template-simple.yaml
sam deploy --region eu-west-1 \
  --template-file infra/sam-template-simple.yaml \
  --stack-name <STACK> --capabilities CAPABILITY_IAM \
  --parameter-overrides Environment=<env>
```
After deploy: verify SSM parameters exist (`rotate-secrets.md`), re-point config if
table names changed, run smoke tests (`monitoring.md` health checks).

## DR test cadence

- **TODO**: schedule a quarterly game-day: (a) Lambda rollback drill, (b) PITR restore
  to a scratch table, (c) secret rotation drill. Record measured RTO/RPO and compare
  to targets.

## Gaps summary

- PITR enablement unverified → RPO target at risk until confirmed.
- No Lambda aliases confirmed → rollback may require code redeploy (still minutes).
- Single-region, no cross-region backup copy → region-loss RTO not guaranteed.
- No DR game-day has been run.
