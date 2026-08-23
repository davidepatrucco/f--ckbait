# Chrome Web Store — Guida compilazione campi (LemonSqueezer — TL;DR)

Pacchetto da caricare: `lemonsqueezer-1.3.2.zip`
Screenshot: `store-assets/screenshot-1280x800.png`
Privacy policy / Terms: hostare `legal/privacy-policy.html` e `legal/terms.html` (URL pubblici).

---

## Tab "Package"
- Carica `lemonsqueezer-1.3.2.zip`.

## Tab "Store listing"

**Item name** (max 45)
```
LemonSqueezer — TL;DR
```

**Summary / short description** (max 132)
```
Riassumi qualsiasi pagina web o video YouTube in un clic: bullet chiari, tempo risparmiato calcolato, sintesi dei commenti.
```

**Description** (max 16.000)
```
LemonSqueezer trasforma pagine web lunghe e video YouTube in un riassunto TL;DR chiaro, con un clic.

• Un clic, nel contesto: premi l'icona nella toolbar e ottieni la sintesi della pagina che stai leggendo. Nessun copia-incolla, nessun cambio scheda.
• Tempo risparmiato calcolato: ogni riassunto mostra tempo di lettura originale, tempo della sintesi, parole e percentuale di compressione. Il beneficio è misurato, non promesso.
• Sintesi fedele alla fonte: usa solo le informazioni presenti nel contenuto, elimina menu, pubblicità e ripetizioni.
• YouTube completo: combina trascrizione e descrizione nel nucleo del riassunto e aggiunge un bullet dedicato ai commenti, con il sentiment prevalente.
• Su misura: scegli la lingua di output e quanto comprimere (10%, 20%, 50% del testo).
• Cronologia: ritrovi i tuoi riassunti quando ti servono.

Come funziona: l'estrazione del contenuto avviene nel browser, sulla pagina già visualizzata, e la sintesi viene generata da un modello linguistico. È richiesto un account (login Google o email). Piano gratuito con limite mensile; piano Premium con limiti estesi.

Skip the noise. Get the point.
```

**Category:** Productivity
**Language:** Italiano (primaria)
**Store icon:** 128×128 (preso automaticamente dal pacchetto)
**Screenshots:** carica `screenshot-1280x800.png` (1–5 immagini, 1280×800)
**Small promo tile 440×280:** opzionale (posso generartelo)

## Tab "Privacy practices"

**Single purpose** (descrizione scopo unico)
```
LemonSqueezer genera un riassunto della pagina web o del video YouTube che l'utente sta visualizzando, solo su sua esplicita richiesta.
```

**Permission justifications** (una per permesso)
- `activeTab`:
```
Leggere il contenuto della scheda attiva solo quando l'utente avvia un riassunto.
```
- `scripting`:
```
Estrarre il testo dell'articolo dalla pagina renderizzata per generarne la sintesi.
```
- host permissions (`http://*/*`, `https://*/*`):
```
L'utente può richiedere il riassunto su qualsiasi sito, quindi serve accesso al contenuto del sito scelto dall'utente al momento della richiesta.
```
- `identity`:
```
Login con Google (OAuth) necessario per usare il servizio.
```
- `storage`:
```
Salvare sessione, preferenze (lingua, compressione) e cronologia dei riassunti sul dispositivo.
```
- `contextMenus`:
```
Aggiungere la voce "Riassumi questo link" al menu contestuale.
```
- `notifications`:
```
Mostrare avvisi essenziali (es. richiesta di login).
```
- Remote code: **No** (nessun codice remoto eseguito).

**Data usage** (spunta le categorie raccolte)
- Personally identifiable information (email) → SÌ
- Authentication information → SÌ
- Website content (testo/URL della pagina) → SÌ
- Location, Health, Financial and payment info, Personal communications, Web history, User activity → NO
  (i dati della carta sono gestiti da Stripe, non dall'estensione)

**Certificazioni** (spunta tutte e tre)
- Non vendo né trasferisco i dati a terzi al di fuori degli usi approvati.
- Non uso né trasferisco i dati per scopi estranei allo scopo unico dell'articolo.
- Non uso né trasferisco i dati per determinare merito creditizio o per prestiti.

**Privacy policy URL:** [URL dove hosti privacy-policy.html]

## Tab "Distribution"
- **Visibility:** Unlisted
- **Distribution:** tutte le regioni (o a scelta)
- Accetta il Developer Program Policies / agreement → **Submit for review**

---

## Dopo la creazione dell'item (IMPORTANTE)
1. Copia l'**Item ID**.
2. Google Cloud Console → OAuth client `610186850503-…` → Authorized redirect URIs → aggiungi `https://<ITEM-ID>.chromiumapp.org/`.
3. Aggiorna `ALLOWED_ORIGINS` del Lambda con `chrome-extension://<ITEM-ID>` (posso farlo io via AWS).
