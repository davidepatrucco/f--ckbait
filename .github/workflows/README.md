# Deploy backend

`deploy-backend.yml` esegue `npm test`, SAM validate/build e il deploy dello stack
`lemonsqueezer-dev` quando un push su `main` modifica `backend/` o `infra/`.
Puoi anche avviarlo a mano dalla scheda **Actions** di GitHub.

## Configurazione una tantum su GitHub

Nel repository GitHub vai su **Settings → Secrets and variables → Actions → Variables**
e crea:

| Variabile | Valore |
| --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | ARN della role AWS assumibile da GitHub Actions, ad esempio `arn:aws:iam::707688585651:role/lemonsqueezer-github-deploy` |
| `ALLOWED_ORIGINS` | `chrome-extension://akglkopghhlleheelgjgnnkkbecngpgh` |

Non inserire chiavi AWS (`AWS_ACCESS_KEY_ID` o `AWS_SECRET_ACCESS_KEY`) in GitHub.
La role usa OIDC e credenziali temporanee.

## Requisito AWS una tantum

Nell'account AWS deve esserci il provider OIDC `token.actions.githubusercontent.com`
e una role che permetta il trust solo al repository `davidepatrucco/f--ckbait`,
branch `main`, con permessi per aggiornare lo stack CloudFormation
`lemonsqueezer-dev` e le risorse SAM collegate.

Finché `AWS_DEPLOY_ROLE_ARN` non è impostata, il workflow si fermerà al passaggio
di autenticazione AWS: non può fare deploy senza quella autorizzazione.
