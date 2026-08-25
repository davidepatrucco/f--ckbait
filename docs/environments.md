# Ambienti backend: dev → staging → prod

Tre stack CloudFormation isolati nella stessa region (`eu-west-1`), stesso template
`infra/sam-template-simple.yaml` parametrizzato su `Environment`. Risorse suffissate
`-<env>` (DynamoDB, Lambda, API Gateway, log). SSM per-ambiente sotto `/lemonsqueezer/<env>/`.

| Ambiente | Stack | API base | Ruolo | SSM |
|----------|-------|----------|-------|-----|
| dev | `lemonsqueezer-dev` | `https://4jo5gamel9.execute-api.eu-west-1.amazonaws.com/dev` | sviluppo | `/lemonsqueezer/dev/*` |
| staging | `lemonsqueezer-staging` | `https://rjayfeyebe.execute-api.eu-west-1.amazonaws.com/staging` | pre-prod / QA | `/lemonsqueezer/staging/*` |
| prod | `lemonsqueezer-prod` | `https://l6ykaxiveh.execute-api.eu-west-1.amazonaws.com/prod` | produzione | `/lemonsqueezer/prod/*` |

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
- Ruolo OIDC `lemonsqueezer-github-deploy` esteso via `bash infra/update-deploy-role-iam.sh`
  (trust: subject `environment:staging`/`environment:production`; permission: ciclo di vita
  dei ruoli Lambda per-env, `iam:CreateRole/DeleteRole/Attach/Detach/Tag`).
- **Tutti e tre gli stack creati e smoke verde** (dev, staging, prod). Prod creato via
  pipeline con approvazione manuale.

## Estensione per ambiente
L'estensione legge l'API base da `__BRAND__.apiBase`, iniettato dal build:
```
node scripts/build-brand.mjs <brand> --env dev|staging|prod        # dev = default (unpacked)
node scripts/package-brand.mjs <brand> [--env prod]                # zip store: prod = default
```
Fallback a dev se non buildato (sviluppo unpacked). **Prima di pubblicare**: aggiungere
l'origin dell'estensione pubblicata (`chrome-extension://<id>`) a `ALLOWED_ORIGINS` dell'ambiente.

## Promozione a prod (workflow manuale)
Prod è disaccoppiato dalla pipeline main. Deploy: Actions → **Deploy backend PROD (manual)**
→ Run workflow → input `prod` → approva (Environment `production`). I push su main
arrivano automaticamente solo fino a **staging**. Rollback: vedi `docs/runbooks/`
(versione Lambda precedente / stack).
