# Runbook — Incident Response

> Status: **scaffolding**. On-call rotation, contacts, and escalation targets are
> placeholders and must be filled in. Region: `eu-west-1`.

## Severity levels

| Sev | Definition | Examples | Response |
|---|---|---|---|
| **SEV1** | Full outage or data loss; core function unusable for most users | Summarize API 5xx storm; DynamoDB analytics/cache unavailable; secret leak | Immediate. Page on-call. Incident channel. Status updates every 30 min. |
| **SEV2** | Major degradation; workaround exists; subset of users | Elevated latency/p95; OpenAI 429 throttling; Stripe webhook failing; one brand broken | Same business day. On-call engaged. Updates every 2h. |
| **SEV3** | Minor / cosmetic; no material user impact | Single non-critical error, minor UI issue, isolated log noise | Next business day. Tracked as normal ticket. |

## Roles

- **Incident Commander (IC)**: coordinates, owns decisions, single writer of the
  timeline. (On-call primary by default.)
- **Ops/Comms**: user-facing status, stakeholder updates.
- **Subject engineer(s)**: investigate and mitigate.

For SEV3 the IC and engineer can be the same person.

## On-call

- Primary + secondary rotation. **TODO: define rotation, tooling, and contacts.**
- Escalation path: primary → secondary → engineering lead → **TODO owner**.
- Contact: `contact@bifa.digital` (from brand configs) — replace with the real
  paging/alert destination.

## Response procedure

1. **Detect / declare**: alarm fires or report received. IC declares severity.
2. **Communicate**: open the incident channel; post initial summary (what, scope,
   suspected component, sev).
3. **Triage — locate the failing component**:
   - Summarize path: `/aws/lambda/lemonsqueezer-summarize-<env>` logs, error rate,
     throttles, duration.
   - Stripe webhook: `/aws/lambda/lemonsqueezer-stripe-webhook-<env>` logs; Stripe
     Dashboard event delivery.
   - API Gateway REST: 4xx/5xx metrics, latency.
   - DynamoDB: throttling / system errors on analytics & cache tables.
   - Upstream: OpenAI status / 429; Stripe status.
   Quick log query:
   ```bash
   aws logs filter-log-events --region eu-west-1 \
     --log-group-name /aws/lambda/lemonsqueezer-summarize-<env> \
     --start-time $(( ($(date +%s) - 900) * 1000 )) \
     --filter-pattern '?ERROR ?Exception ?"5xx" ?timeout'
   ```
4. **Mitigate** (stop the bleeding before root cause):
   - Upstream provider issue → `disable-provider.md`.
   - Bad deploy → roll back Lambda version (`disaster-recovery.md`).
   - Corrupted cache output → `invalidate-cache.md`.
   - Suspected secret leak → `rotate-secrets.md` immediately.
   - Data corruption → `restore-database.md`.
5. **Verify** recovery against the monitoring signals in `monitoring.md`.
6. **Resolve**: downgrade severity, close incident, note end time.

## Communication cadence

- SEV1: every 30 min until resolved. SEV2: every 2h. SEV3: on status change.
- Always include: current impact, actions taken, next update time.

## Postmortem (blameless)

- Required for **SEV1 and SEV2**. Draft due within **48h** of resolution.
- Contents: timeline (UTC), impact + scope + duration, detection method, root cause,
  contributing factors, what went well / poorly, action items (owner + due date).
- Store under `docs/postmortems/YYYY-MM-DD-<slug>.md` (**TODO: create directory**).
- Review action items in the next ops sync; track to closure.

## Gaps

- No alerting/paging tooling defined yet — depends on the alarms in `monitoring.md`,
  which are themselves specified but not provisioned.
- On-call rotation and escalation contacts are placeholders.
- `docs/postmortems/` does not yet exist.
