# LemonSqueezer --- TL;DR di qualsiasi pagina in 3--4 bullet

## Value prop

Clicchi l'icona → invia pagina al backend → LLM risponde con 3--4 bullet
secchi. Stop.

------------------------------------------------------------------------

## Architettura (minima ma solida)

-   **Estensione Manifest V3** (Chrome/Edge/Brave, compatibile con
    Firefox MV3): popup + service worker.
-   **Backend**: AWS API Gateway (HTTP) → Lambda (Node 20) → OpenAI
    **Responses/Chat** API (modello: `gpt-5-mini`, configurabile). Dati
    utente e piani → DynamoDB. Billing → Stripe (Checkout + Webhook).
    Rate limit → API Gateway Usage Plans + chiave per estensione.
-   **Flusso**
    1)  Utente preme l'icona → estensione legge `document.title`,
        `location.href`, testo leggibile (fallback: invio HTML).
    2)  Estensione chiama `POST /summarize` con:
        `{ url, title, text, lang, apiKey }`.
    3)  Lambda verifica **subscription attiva** (DynamoDB) + **quota**.
    4)  Chiamata a OpenAI con prompt fisso → ritorno 3--4 bullet.
    5)  Popup mostra i bullet, copia negli appunti.

------------------------------------------------------------------------

## Repository structure

    shaveit/
    ├─ extension/
    │  ├─ manifest.json
    │  ├─ popup.html
    │  ├─ popup.js
    │  ├─ service_worker.js
    │  ├─ content.js            # estrazione testo leggibile (Readability-lite)
    │  └─ assets/icon-16.png ... 48/128
    ├─ backend/
    │  ├─ lambda/handler.mjs
    │  ├─ package.json
    │  ├─ src/openai.mjs
    │  ├─ src/subscription.mjs
    │  ├─ src/rate-limit.mjs
    │  └─ test/
    ├─ infra/
    │  ├─ sam-template.yaml     # SAM (oppure Terraform main.tf)
    │  └─ scripts/deploy.sh
    ├─ ops/
    │  ├─ stripe-webhook.mjs
    │  └─ postman_collection.json
    ├─ README.md
    └─ LICENSE

------------------------------------------------------------------------

## Estensione --- file minimi

### `extension/manifest.json`

``` json
{ ... }
```

### `extension/popup.html`

``` html
<!doctype html>...
```

### `extension/popup.js`

``` js
const elK = document.getElementById('k');...
```

### `extension/content.js` (estrazione light, no dipendenze)

``` js
function visibleText(doc=document){...}
```

### `extension/service_worker.js`

``` js
// Placeholder per future features
```

------------------------------------------------------------------------

## Backend --- Lambda (Node 20 ESM)

### `backend/lambda/handler.mjs`

``` js
import { summarize } from '../src/openai.mjs';...
```

### `backend/src/openai.mjs` (Responses/Chat API)

``` js
import fetch from 'node-fetch';...
```

### `backend/src/subscription.mjs`

``` js
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';...
```

### `backend/src/rate-limit.mjs`

``` js
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';...
```

------------------------------------------------------------------------

## Stripe (0,99¢/mese) --- flusso minimal

-   **Checkout**: pagina hosted → al successo, webhook
    `checkout.session.completed` crea **apiKey** random, scrive su
    `SUBS_TABLE` (`status=active`), manda email con chiave.
-   **Renewal/cancel**: webhook
    `invoice.payment_succeeded`/`customer.subscription.deleted` aggiorna
    `status`.
-   **Estensione**: l'utente incolla la chiave nel popup; usala in
    header `x-api-key`.

------------------------------------------------------------------------

## Infra --- AWS SAM (minimo)

``` yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Resources: ...
```

------------------------------------------------------------------------

## Prompt LLM (chiaro e ripetibile)

    Sistema: "Riassumi qualsiasi pagina ..."

------------------------------------------------------------------------

## Privacy & anti‑rotture

-   Troncamento a 120k caratteri.
-   No log del testo, solo metadati.
-   Timeout 10--15s, retry 1 volta.

------------------------------------------------------------------------

## Roadmap rapida (post-MVP)

-   Tasto "Auto‑TL;DR all'apertura".
-   Selezione-only.
-   Lingua output.
-   Firefox, Safari port.

------------------------------------------------------------------------

## Testing

-   Unit su parser e normalizzazione prompt.
-   Contract test API.
-   E2E Puppeteer.

------------------------------------------------------------------------

## Licenza & pricing

-   0,99€/mese via Stripe. Free trial 7 giorni.

------------------------------------------------------------------------

## Nota API OpenAI

-   Chat/Responses API e Structured Outputs.
-   Modelli mini economici consigliati.
