# Runbook — Monitoring

> Status: **scaffolding**. Alarms below are **specified, not provisioned**. Thresholds
> are starting points to tune against real baselines. Region: `eu-west-1`.

## Signals and sources

| Signal | Source | What to watch |
|---|---|---|
| Uptime / availability | API Gateway REST (`LemonSqueezerAPI`), Stripe webhook Function URL | success rate, reachability |
| Latency p95 | Lambda `Duration`, API Gateway `Latency`/`IntegrationLatency` | summarize p95 |
| Error rate | Lambda `Errors`, API Gateway `5XXError`/`4XXError` | ratio vs invocations |
| Throttling / quota (429) | OpenAI 429 in logs; API Gateway usage-plan throttles; Lambda `Throttles` | upstream + self throttling |
| Stripe events | `lemonsqueezer-stripe-webhook-<env>` logs; Stripe Dashboard | delivery success, signature failures |
| Cost per brand | analytics table aggregation (`docs/dashboard-spec.md` §1.7) + Cost Explorer tags | daily spend by brand |
| DynamoDB health | `ThrottledRequests`, `SystemErrors`, `UserErrors` on analytics/cache tables | throttles/errors |

## Key metrics and namespaces

- Lambda (`AWS/Lambda`, dimension `FunctionName`):
  `lemonsqueezer-summarize-<env>`, `lemonsqueezer-stripe-webhook-<env>` —
  `Invocations`, `Errors`, `Throttles`, `Duration` (use p95 stat), `ConcurrentExecutions`.
- API Gateway (`AWS/ApiGateway`): `5XXError`, `4XXError`, `Latency`, `Count`.
- DynamoDB (`AWS/DynamoDB`, dimension `TableName`): `ThrottledRequests`,
  `SystemErrors`, `ConsumedRead/WriteCapacityUnits`.

## Proposed alarms (tune thresholds)

1. **Summarize error rate high** (SEV2→SEV1 if sustained):
   `Errors / Invocations > 2%` over 5 min, 3 datapoints.
2. **Summarize p95 latency high**: `Duration p95 > 8000 ms` over 5 min (baseline TBD).
3. **Lambda throttling**: `Throttles > 0` over 1 min.
4. **API Gateway 5xx**: `5XXError > 1%` over 5 min.
5. **OpenAI 429 spike**: metric filter on the summarize log group counting `429`,
   alarm on `> N/5min` (N from baseline). See metric-filter example below.
6. **Stripe webhook failures**: metric filter for signature-verification failures /
   non-2xx in the webhook log group; alarm on `>= 1` over 5 min.
7. **DynamoDB throttling**: `ThrottledRequests > 0` on analytics/cache tables.
8. **Cost per brand anomaly**: daily rollup exceeds a per-brand budget (from the
   dashboard cost estimate, §1.7). Requires the analytics rollup job.

### Example: 429 metric filter + alarm

```bash
aws logs put-metric-filter --region eu-west-1 \
  --log-group-name /aws/lambda/lemonsqueezer-summarize-<env> \
  --filter-name openai-429 \
  --filter-pattern '429' \
  --metric-transformations \
    metricName=OpenAI429,metricNamespace=LemonSqueezer/<env>,metricValue=1

aws cloudwatch put-metric-alarm --region eu-west-1 \
  --alarm-name lemonsqueezer-<env>-openai-429 \
  --namespace LemonSqueezer/<env> --metric-name OpenAI429 \
  --statistic Sum --period 300 --evaluation-periods 1 \
  --threshold 10 --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions <SNS_TOPIC_ARN>
```

## Health checks (manual / smoke)

```bash
# API reachability (URL = CFN output ApiUrl)
curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' https://<api-id>.execute-api.eu-west-1.amazonaws.com/<env>/health

# recent errors (last 15 min)
aws logs filter-log-events --region eu-west-1 \
  --log-group-name /aws/lambda/lemonsqueezer-summarize-<env> \
  --start-time $(( ($(date +%s) - 900) * 1000 )) \
  --filter-pattern '?ERROR ?Exception ?timeout'

# lambda error metric (last hour)
aws cloudwatch get-metric-statistics --region eu-west-1 \
  --namespace AWS/Lambda --metric-name Errors \
  --dimensions Name=FunctionName,Value=lemonsqueezer-summarize-<env> \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 --statistics Sum
```
(The `/health` path is assumed — confirm it exists in the API before relying on it.)

## Cost per brand

- Short term: use the analytics-derived estimate in `docs/dashboard-spec.md` §1.7
  (token estimate from `chars_input`/`chars_output`).
- Better: emit real OpenAI `usage` tokens per event (backend change) and/or apply AWS
  cost-allocation tags per brand and read Cost Explorer.

## Dashboards

- **TODO**: build a CloudWatch dashboard with the metrics above, one row per Lambda,
  plus API Gateway and DynamoDB widgets. Mirror the per-brand product KPIs from
  `docs/dashboard-spec.md`.

## Gaps

- No alarms/dashboards provisioned in IaC yet (specified here only).
- `/health` endpoint existence unconfirmed.
- Per-brand cost is an estimate until real token usage is recorded.
- Baselines for latency/error thresholds not yet measured — thresholds are initial
  guesses to calibrate.
