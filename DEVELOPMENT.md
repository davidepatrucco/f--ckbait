# LemonSqueezer - Local Development Setup

## Quick Local Testing

Per testare localmente senza deploy su AWS:

### 1. Avvia il server locale

```bash
cd backend
npm install
npm run local
```

### 2. Configura l'estensione

Nell'estensione usa:
- **Backend URL**: `http://localhost:3000`
- **API Key**: `sk-test-local-development-key`

### 3. Mock OpenAI (opzionale)

Se non hai una OpenAI API Key, puoi mockare le risposte modificando `src/openai.mjs`:

```javascript
// In development, ritorna una risposta mock
if (process.env.NODE_ENV === 'development') {
    return {
        summary: "• Mock summary point 1\n• Mock summary point 2\n• Mock summary point 3",
        bullets: [
            "Mock summary point 1",
            "Mock summary point 2", 
            "Mock summary point 3"
        ]
    };
}
```

## Environment Variables per Development

Crea un file `.env` in `backend/`:

```bash
NODE_ENV=development
OPENAI_API_KEY=sk-your-openai-key
AWS_REGION=eu-west-1
SUBSCRIPTIONS_TABLE=local-subscriptions
RATE_LIMIT_TABLE=local-rate-limits
```

## Test con curl

```bash
curl -X POST http://localhost:3000/summarize \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk-test-key" \
  -d '{
    "url": "https://example.com",
    "title": "Test Page",
    "text": "This is a test page with enough content to be summarized by the AI. It contains multiple sentences and provides context for testing the summarization functionality.",
    "lang": "en"
  }'
```