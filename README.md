# 🍋 LemonSqueezer - TL;DR Chrome Extension

Un'estensione privata per Chrome che riassume qualsiasi pagina web usando OpenAI GPT-4o-mini.

## 🚀 Stato del Progetto

✅ **COMPLETATO E FUNZIONANTE**

- ✅ Estensione Chrome Manifest V3
- ✅ Backend AWS Lambda con OpenAI 
- ✅ API Gateway con CORS
- ✅ Deploy automatizzato con SAM
- ✅ Gestione errori e rate limiting
- ✅ Supporto multilingua
- ✅ **Sistema Freemium con Google OAuth**
- ✅ **Persistenza utenti su DynamoDB**
- ✅ **10 riepiloghi gratuiti/mese**
- ✅ **UI responsive e ottimizzata**

## 🔧 Installazione

### 1. Installare l'estensione Chrome

1. Apri Chrome e vai su `chrome://extensions/`
2. Attiva la "Modalità sviluppatore" in alto a destra
3. Clicca "Carica estensione non compressa"
4. Seleziona la cartella `extension/`

### 2. Configurare l'estensione

1. Clicca sull'icona LemonSqueezer nella barra degli strumenti
2. Inserisci la configurazione:
   - **Backend URL**: `https://8udffsiwnc.execute-api.eu-west-1.amazonaws.com/dev`
   - **OpenAI API Key**: La tua chiave OpenAI (sk-proj-...)
   - **Lingua**: Seleziona la lingua per i riassunti

## 🎯 Come usare

1. Naviga su qualsiasi pagina web
2. Clicca sull'icona LemonSqueezer 
3. Clicca "🎯 Riassumi questa pagina"
4. Attendi il riassunto (3-4 bullet points)
5. Copia il risultato negli appunti se necessario

## 🏗️ Architettura

```
📁 TLDR/
├── 📁 extension/          # Chrome Extension (Manifest V3)
│   ├── manifest.json      # Configurazione estensione
│   ├── popup.html         # Interfaccia popup
│   ├── popup.js          # Logica popup
│   ├── content.js        # Script per estrarre contenuto
│   └── service_worker.js # Service worker
│
├── 📁 backend/           # AWS Lambda Functions
│   ├── package.json      # Dipendenze Node.js
│   ├── lambda/
│   │   └── handler.mjs   # Handler principale
│   └── src/
│       ├── openai.mjs    # Integrazione OpenAI
│       ├── subscription.mjs # Gestione sottoscrizioni
│       └── rate-limit.mjs   # Rate limiting
│
├── 📁 infra/            # Infrastructure as Code
│   ├── sam-template-simple.yaml # Template SAM
│   ├── .env             # Variabili ambiente
│   └── scripts/
│       └── deploy.sh    # Script di deploy
│
└── README.md           # Questo file
```

## � Sicurezza

- ✅ API Key OpenAI gestita tramite AWS Parameter Store
- ✅ Rate limiting implementato
- ✅ CORS configurato correttamente  
- ✅ Validazione input su tutti gli endpoint
- ✅ Log sicuri (senza contenuti sensibili)

## 🌍 API Endpoints

**Base URL**: `https://8udffsiwnc.execute-api.eu-west-1.amazonaws.com/dev`

### GET /health
```json
{
  "status": "healthy",
  "timestamp": "2025-09-22T16:54:27.259Z",
  "version": "1.0.0"
}
```

### POST /summarize
```bash
curl -X POST https://8udffsiwnc.execute-api.eu-west-1.amazonaws.com/dev/summarize \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk-test-key" \
  -d '{
    "url": "https://example.com",
    "title": "Test Page", 
    "text": "Content to summarize...",
    "lang": "en"
  }'
```

**Risposta:**
```json
{
  "success": true,
  "summary": "Bullet 1\nBullet 2\nBullet 3",
  "bullets": ["Bullet 1", "Bullet 2", "Bullet 3"],
  "metadata": {
    "url": "https://example.com",
    "title": "Test Page",
    "language": "en", 
    "processedAt": "2025-09-22T16:54:27.259Z"
  }
}
```

## 🔄 Aggiornamenti Backend

Per aggiornare il backend:

```bash
cd infra/
source .env
sam build --template-file sam-template-simple.yaml
sam deploy --stack-name lemonsqueezer-dev-fixed \
  --s3-bucket lemonsqueezer-artifacts-dev \
  --region eu-west-1 \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides OpenAIApiKey=$OPENAI_API_KEY Environment=$ENVIRONMENT
```

## 📊 Monitoraggio

- **CloudWatch Logs**: `/aws/lambda/lemonsqueezer-summarize-dev`
- **Stack CloudFormation**: `lemonsqueezer-dev-fixed`
- **API Gateway**: Console AWS → API Gateway

## ⚙️ Configurazione Avanzata

### Variabili in `infra/.env`:
```bash
OPENAI_API_KEY=sk-proj-your-key-here
ENVIRONMENT=dev
AWS_REGION=eu-west-1
```

### Modelli OpenAI supportati:
- `gpt-4o-mini` (attuale)
- `gpt-3.5-turbo`
- `gpt-4`

## � Troubleshooting

### L'estensione non funziona:
1. Verifica che l'API URL sia corretto nel popup
2. Controlla la console di Chrome (F12) per errori
3. Verifica che l'API key OpenAI sia valida

### Errori API:
1. Controlla i log CloudWatch
2. Verifica i limiti di quota OpenAI  
3. Testa l'endpoint con curl

### Deploy fallisce:
1. Verifica credenziali AWS
2. Controlla che il bucket S3 esista
3. Elimina stack precedenti se in conflitto

## � Note Tecniche

- **Runtime**: Node.js 20.x ESM
- **Timeout Lambda**: 30 secondi
- **Memoria Lambda**: 512 MB
- **OpenAI Model**: gpt-4o-mini
- **Rate Limit**: Configurabile per utente

## 🎉 Completamento

Il progetto è **completamente funzionante** e pronto per l'uso!

Puoi iniziare subito a riassumere pagine web installando l'estensione e configurando l'API URL come descritto sopra.