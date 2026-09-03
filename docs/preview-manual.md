# LemonSqueezer — Manuale di preview

Grazie per provare **LemonSqueezer**: un'estensione per Chrome che riassume qualsiasi pagina web o video YouTube in un clic — bullet essenziali, tempo di lettura risparmiato, sintesi dei commenti.

> ⚠️ **Questa è una preview su ambiente di test.** L'estensione è collegata al backend di *staging*: nessun pagamento reale, dati non di produzione. Serve solo a valutare il prodotto prima del lancio.

---

## 1. Installazione (Chrome / Edge / Brave, ~1 minuto)

1. **Scompatta** il file `lemonsqueezer-chromium-staging-preview-1.3.2.zip` in una cartella stabile (es. `Documenti/LemonSqueezer`). Non cancellarla: Chrome carica l'estensione da lì.
2. Apri Chrome e vai su `chrome://extensions`.
3. In alto a destra attiva **Modalità sviluppatore** (Developer mode).
4. Clicca **Carica estensione non pacchettizzata** (Load unpacked) e seleziona la **cartella scompattata**.
5. L'icona di LemonSqueezer compare nella barra. Se non la vedi, clicca il tassello 🧩 e "pinna" LemonSqueezer.

> Chrome mostrerà un avviso "estensioni in modalità sviluppatore" a ogni avvio: è normale per le installazioni dirette pre-store, non è un errore.

---

## 2. Primo accesso

1. Clicca l'icona di LemonSqueezer.
2. Premi **Accedi con Google** e completa il login nella finestra che si apre.
3. Fatto: resti loggato: il login serve una sola volta.

Durante la preview potresti trovare un limite di **1 riassunto al giorno**. Se ti serve provarne di più, scrivimi (contact@bifa.digital) e te lo rimuovo.

---

## 3. Come si usa

1. Apri un articolo, un post o un video YouTube.
2. Clicca l'icona di LemonSqueezer.
3. Premi **Riassumi** (Summarize).
4. In pochi secondi compare il riassunto:
   - **Bullet essenziali**: i punti chiave della pagina.
   - **Tempo risparmiato**: quanto avresti impiegato a leggere tutto.
   - **Sintesi commenti** (dove presenti, es. Reddit / YouTube).

**PDF**: se sei su un PDF, il riassunto si apre in una **nuova scheda dei risultati** (il visualizzatore PDF non ospita il riquadro in-pagina).

**Lingua**: il riassunto segue la lingua della pagina.

---

## 4. Cosa è supportato

| Contenuto | Esito |
|-----------|-------|
| Articoli, blog, documentazione | ✅ estrazione e riassunto |
| YouTube | ✅ riassunto da trascrizione |
| Reddit | ✅ post + commenti principali |
| Hacker News | ✅ story + commenti |
| PDF (fino a ~50 pagine) | ✅ riassunto in scheda risultati |

---

## 5. Messaggi che potresti vedere (e cosa significano)

Non sono bug: sono casi gestiti volutamente.

- **"Il contenuto è dietro paywall"** — la pagina richiede un abbonamento al sito. Se il contenuto non è leggibile, non possiamo riassumerlo (serve iscriversi al fornitore).
- **"Contenuto dietro login"** — pagine come X/Twitter, LinkedIn, Instagram richiedono l'accesso al sito per mostrare il testo.
- **"Accetta prima i cookie / il consenso"** — un banner cookie copre il contenuto: chiudilo e riprova.
- **"Contenuto troppo lungo"** — oltre una certa soglia il testo non è supportato (scelta voluta per garantire qualità e costi prevedibili).
- **"Documento non leggibile"** (Google Docs/Office in modalità modifica) — apri la versione pubblicata/di sola lettura del documento.

---

## 6. Limiti della preview

- Ambiente **staging**: possibili dati di test, occasionali lentezze.
- Nessun pagamento è reale; eventuali flussi di acquisto usano la modalità test di Stripe.
- Feedback benvenuto su: chiarezza dei riassunti, casi non gestiti, errori.

**Supporto / feedback:** contact@bifa.digital
