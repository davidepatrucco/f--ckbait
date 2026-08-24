# Runbook — Rotate Secrets (SSM Parameter Store)

> Status: **scaffolding**. Commands reference the real resource names in this repo
> but ARNs/account IDs and the exact rotation policy must be confirmed against the
> live AWS account before use. Region: `eu-west-1`.

## Scope

Rotation of the secrets consumed by the Lambdas via SSM Parameter Store. Parameter
path prefix (from `backend/src/secrets.mjs`): `/lemonsqueezer/<env>/`.

| Parameter | Type | Consumer |
|---|---|---|
| `/lemonsqueezer/<env>/openai-api-key` | SecureString | `lemonsqueezer-summarize-<env>` |
| `/lemonsqueezer/<env>/jwt-secret` | SecureString | auth in summarize Lambda |
| `/lemonsqueezer/<env>/stripe-secret-key` | SecureString | summarize + webhook |
| `/lemonsqueezer/<env>/stripe-webhook-secret` | SecureString | `lemonsqueezer-stripe-webhook-<env>` |
| `/lemonsqueezer/<env>/stripe-premium-monthly-price-id` | String | checkout |
| `/lemonsqueezer/<env>/stripe-premium-yearly-price-id` | String | checkout |
| `/lemonsqueezer/<env>/stripe-success-url` | String | checkout |
| `/lemonsqueezer/<env>/stripe-cancel-url` | String | checkout |

`<env>` ∈ {`dev`, `prod`}.

## Preconditions

- AWS CLI authenticated with rights to `ssm:PutParameter`, `ssm:GetParameter`,
  `lambda:GetFunctionConfiguration`, `logs:FilterLogEvents`.
- The Lambdas read secrets at runtime (with in-memory caching in `secrets.mjs`).
  A cold start picks up the new value; to force immediate pickup, publish a new
  Lambda version or update an env var to recycle execution environments.

## General procedure (per secret)

1. Announce a short maintenance window if rotating `jwt-secret` (invalidates issued
   tokens) or Stripe keys (webhook downtime risk).
2. Create the new secret value in the provider first (OpenAI / Stripe), keeping the
   old one active (overlap).
3. Write the new value to SSM (SecureString, overwrite):
   ```bash
   aws ssm put-parameter \
     --region eu-west-1 \
     --name "/lemonsqueezer/<env>/<param>" \
     --value "<NEW_VALUE>" \
     --type SecureString \
     --overwrite
   ```
4. Force pickup — recycle the execution environments:
   ```bash
   aws lambda update-function-configuration \
     --region eu-west-1 \
     --function-name lemonsqueezer-summarize-<env> \
     --environment "Variables={SECRET_ROTATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
   ```
   (Adjust to merge, not replace, existing variables — read current config first with
   `aws lambda get-function-configuration` and re-send the full map.)
5. Verify (see per-secret checks below).
6. Revoke the old value at the provider only after verification.

## Per-secret specifics

### openai-api-key
- Create a new key in the OpenAI dashboard, keep old active.
- After SSM write + recycle, trigger one summarize request and confirm `200` and a
  non-empty summary. Check `/aws/lambda/lemonsqueezer-summarize-<env>` for auth
  errors (401 from OpenAI).
- Revoke old OpenAI key.

### jwt-secret
- Rotating invalidates all previously issued JWTs → users must re-login.
- Generate: `openssl rand -hex 32`.
- Schedule during low traffic. Communicate forced re-login.

### stripe-secret-key
- Roll in Stripe Dashboard (API keys). Update SSM, recycle both summarize and webhook
  Lambdas.
- Verify a test checkout session can be created.

### stripe-webhook-secret
- If the webhook endpoint signing secret changes, update SSM, then send a test event
  from Stripe Dashboard to the Function URL and confirm the webhook Lambda returns
  `200` (no signature-verification failure in logs).
- The webhook Function URL comes from CFN output `StripeWebhookUrl`.

### stripe price / url parameters (String)
- Non-secret; `--type String`. No provider revocation step.

## Verification

```bash
aws ssm get-parameter --region eu-west-1 \
  --name "/lemonsqueezer/<env>/<param>" --with-decryption \
  --query 'Parameter.{Name:Name,Version:Version,LastModified:LastModifiedDate}'
```
Confirm `Version` incremented and `LastModified` is recent. Do not print decrypted
values to shared logs.

## Rollback

SSM keeps parameter history. Revert:
```bash
aws ssm get-parameter-history --region eu-west-1 \
  --name "/lemonsqueezer/<env>/<param>" --with-decryption
# re-put the previous value with --overwrite, then recycle Lambdas
```

## Gaps

- No automated rotation (no Secrets Manager rotation Lambda). Manual only.
- The env-var recycle step must merge existing variables; a helper script is not yet
  provided in this scaffold.
