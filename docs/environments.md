# Ambienti backend: dev → staging → prod

Tre stack CloudFormation isolati nella stessa region (`eu-west-1`), stesso template
`infra/sam-template-simple.yaml` parametrizzato su `Environment`. Risorse suffissate
`-<env>` (DynamoDB, Lambda, API Gateway, log). SSM per-ambiente sotto `/lemonsqueezer/<env>/`.

| Ambiente | Stack | API base | Ruolo | SSM |
|----------|-------|----------|-------|-----|
| dev | `lemonsqueezer-dev` | `https://4jo5gamel9.execute-api.eu-west-1.amazonaws.com/dev` | sviluppo | `/lemonsqueezer/dev/*` |
| staging | `lemonsqueezer-staging` | `https://rjayfeyebe.execute-api.eu-west-1.amazonaws.com/staging` | pre-prod / QA | `/lemonsqueezer/staging/*` |
| prod | `lemonsqueezer-prod` | (creato dalla pipeline) | produzione | `/lemonsqueezer/prod/*` |

Dev resta l'ambiente di sviluppo. staging e prod hanno SSM inizializzati da dev
(`infra/bootstrap-ssm.sh`); `jwt-secret` è nuovo per ambiente. **Prod è in Stripe TEST-mode**
finché non si passa a LIVE (E18-005): serve creare prodotti/prezzi Stripe LIVE e aggiornare
`/lemonsqueezer/prod/stripe-*` + il webhook secret (dipende dalla Function URL prod).

## Pipeline di promozione (`.github/workflows/deploy-backend.yml`)

Ogni push su `main` che tocca `backend/**`, `infra/**` o lo smoke:

```
test → deploy-dev + smoke → deploy-staging + smoke/E2E → deploy-prod (APPROVAZIONE) + smoke
```

- Ogni stage è gate del successivo: se lo smoke fallisce, la promozione si ferma.
- **prod** è protetto dal GitHub Environment `production` con **required reviewer**
  (`davidepatrucco`): il job resta in pausa finché non approvi in Actions → Review deployments.
- Credenziali via OIDC (`aws-actions/configure-aws-credentials`), nessuna access key.
- Smoke/E2E: `scripts/smoke-e2e.mjs <apiBaseUrl>` — `/health` + `/analytics/event`
  (valido→persist, event_type/brand/JSON invalidi→400). Exit ≠0 blocca la pipeline.

## Setup una-tantum già eseguito
- SSM staging + prod inizializzati (`infra/bootstrap-ssm.sh`).
- GitHub Environments `staging` e `production` creati (branch protetti; prod con reviewer).
- Variabili per-environment `ALLOWED_ORIGINS` (placeholder = extension id dev).
- Stack `lemonsqueezer-staging` creato e smoke verde.

## Passo manuale richiesto (permessi IAM)
La pipeline dei job staging/prod assume il ruolo OIDC con `sub=...:environment:<name>`:
va estesa la trust policy + la permission policy del ruolo `lemonsqueezer-github-deploy`.
Eseguire (utente admin):

```
bash infra/update-deploy-role-iam.sh
```

Dopo questo passo, il push del workflow attiva la pipeline completa. Il primo run crea
lo stack `lemonsqueezer-prod` al momento dell'approvazione del job `deploy-prod`.

## Promozione a prod
1. Merge su `main` → pipeline esegue dev + staging + smoke.
2. Actions → run in corso → job `deploy-prod` in `Waiting` → **Review deployments** → approva.
3. Deploy prod + smoke. Rollback: vedi `docs/runbooks/` (versione Lambda precedente / stack).
