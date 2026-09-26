# Runbook — Alarms (BIF-50)

Standalone stack (`infra/alarms.yaml`), separate from the SAM backend stack. Provisions:
SNS topic + email subscription, CloudWatch alarms (Lambda `Errors`/`Throttles` for
`summarize`, `stripe-webhook`, `transcribe-worker`; API Gateway `5XXError`), and (prod
only) an account-wide monthly cost budget.

## Deploy

```bash
aws cloudformation deploy --region eu-west-1 \
  --template-file infra/alarms.yaml \
  --stack-name reading-intelligence-alarms-<env> \
  --parameter-overrides Env=<env> AlertEmail=<email>
```

`<env>` is `dev`, `staging`, or `prod`. `MonthlyBudgetUsd` defaults to 50; override with
`MonthlyBudgetUsd=<amount>` if needed. The budget resource is only created when
`Env=prod` (AWS Budgets are account-global, not per-region/per-stack, so it must not be
duplicated across env deploys).

## After deploying

- **Confirm the SNS subscription.** AWS sends a confirmation email to `AlertEmail`
  immediately after deploy; no alarm or budget notification is delivered until that
  link is clicked.
- **Set the OpenAI monthly spend limit manually.** There is no API for it: in the
  OpenAI dashboard, go to Settings -> Limits and set the monthly budget there. This is
  a separate manual step per OpenAI account/project; it is not covered by this
  CloudFormation stack.
