# Runbook — Disable a Provider (OpenAI / Stripe)

> Status: **scaffolding**. Verify the exact failure modes and env/feature flags in
> the current backend before relying on these steps. Region: `eu-west-1`.

## When

- OpenAI outage, quota exhaustion, or a cost incident → stop calling OpenAI.
- Stripe incident or a billing bug → stop checkout / stop processing webhooks.

## Provider: OpenAI (summaries)

Consumer: `lemonsqueezer-summarize-<env>`. Secret:
`/lemonsqueezer/<env>/openai-api-key`.

### Effect of disabling

New summary requests cannot be generated. Cache **hits still work**
(`lemonsqueezer-summary-cache-<env>`); only cache **misses** fail. Decide whether to
return a user-facing "temporarily unavailable" message.

### Options (least to most disruptive)

1. **Throttle at API Gateway**: lower the usage-plan rate/quota to shed load without
   full outage. (Touches `infra/**`; coordinate with infra owner.)
2. **Fail fast, serve cache**: if a feature flag exists to disable generation while
   still serving cache, set it. If no such flag exists today, this is a **gap** — the
   only lever is (3) or (4).
3. **Break the key deliberately** (hard stop, fast): overwrite the OpenAI SSM
   parameter with an invalid placeholder so all generation calls fail cleanly, then
   recycle the Lambda:
   ```bash
   aws ssm put-parameter --region eu-west-1 \
     --name "/lemonsqueezer/<env>/openai-api-key" \
     --value "DISABLED-INCIDENT-$(date -u +%Y%m%d)" --type SecureString --overwrite
   ```
   Restore from `get-parameter-history` when the incident ends (see
   `rotate-secrets.md`). This produces upstream errors the summarize path must handle;
   confirm it returns a controlled error, not a 5xx storm.
4. **Reserved concurrency = 0** (hardest stop for the whole function): sets the
   function to reject all invocations. This also disables cache reads. Use only for a
   full stop.
   ```bash
   aws lambda put-function-concurrency --region eu-west-1 \
     --function-name lemonsqueezer-summarize-<env> --reserved-concurrent-executions 0
   # re-enable: delete-function-concurrency
   ```

### Verification
- Trigger one request; confirm the intended behavior (controlled error or cache-only).
- Watch `/aws/lambda/lemonsqueezer-summarize-<env>` for error class and rate.

## Provider: Stripe (billing)

Consumers: checkout in `lemonsqueezer-summarize-<env>`; webhook in
`lemonsqueezer-stripe-webhook-<env>` (Function URL, CFN output `StripeWebhookUrl`).
Secrets: `/lemonsqueezer/<env>/stripe-secret-key`, `stripe-webhook-secret`.

### Disable checkout (stop new subscriptions)
- If a feature flag exists, disable the upgrade CTA / checkout endpoint. If not, this
  is a **gap**.
- Hard stop: invalidate `stripe-secret-key` in SSM as in OpenAI option (3), recycle
  Lambda. Checkout session creation then fails; existing subscriptions are unaffected
  (managed by Stripe).

### Disable webhook processing
- Preferred: disable the endpoint in the **Stripe Dashboard** (stops delivery at the
  source; Stripe retries later, so events are not lost during a short window).
- Hard stop: set reserved concurrency = 0 on `lemonsqueezer-stripe-webhook-<env>`.
  Warning: dropped events during the stop rely on Stripe's retry policy; verify the
  retry window covers the downtime, otherwise reconcile manually afterward.

### Verification
- Attempt a test checkout → expect controlled failure.
- Send a test event from Stripe → confirm expected 4xx/5xx or 0 delivered while
  disabled; after re-enable, confirm backlog is processed and idempotency holds.

## Re-enable
- Restore the SSM secret from history and recycle Lambdas.
- `delete-function-concurrency` to remove the reserved=0 stop.
- Re-enable the Stripe endpoint in the Dashboard.
- Log the incident window in the postmortem (see `incident-response.md`).

## Gaps

- No confirmed application-level feature flags to disable generation/checkout while
  keeping the function healthy. If absent, the levers are SSM-key invalidation or
  reserved concurrency, both blunt. Adding flags is a backend change (out of scope).
