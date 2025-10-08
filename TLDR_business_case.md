# ShaveIt --- Business Case Sintetico

## Problema

Le persone perdono tempo su articoli clickbait o prolissi. ShaveIt
risolve il problema: clicchi l'estensione e ottieni **3--4 bullet
secchi** con i contenuti chiave, risparmiando minuti.

## Soluzione

-   **Estensione browser** (poi app) → legge la pagina, invia testo a
    backend.
-   **Backend AWS**: Lambda + API Gateway → chiama modello `gpt-5-nano`.
-   **Output**: max 4 bullet in linguaggio diretto + tempo stimato
    risparmiato.
-   **Opzione tasto destro** su link → sintesi al volo.

## Monetizzazione

-   **Abbonamento**: 0,99 €/mese → fair use 100--200 articoli.
-   **Modello economico**: GPT-5-nano (costi molto bassi).

## Costi per 200 articoli/mese

  Voce                 Stripe         PayPal Micro
  -------------------- -------------- --------------
  Ricavo lordo         \$1,06         \$1,06
  Fee pagamento        \~\$0,33       \~\$0,10
  Ricavo netto         \~\$0,73       \~\$0,96
  Costo OpenAI         \~\$0,11       \~\$0,11
  Costo AWS+Mongo      \~\$0,07       \~\$0,07
  **Margine finale**   **\~\$0,55**   **\~\$0,78**

## Conclusioni

-   Margine 55--75% già con pochi utenti.
-   PayPal Micropayments più efficiente per ticket bassi → +40% margine.
-   Scalabilità: costi variabili, margini migliorano con volumi (Lambda
    e Mongo ottimizzati).

## Come provare l'MVP su Chrome

1.  Clonare la repo o scaricare la cartella `extension/` con i file
    `manifest.json`, `popup.html`, `popup.js`, ecc.
2.  Aprire **Chrome → Estensioni → Gestisci estensioni**.
3.  Abilitare **Modalità sviluppatore** (toggle in alto a destra).
4.  Fare clic su **Carica estensione non pacchettizzata** e selezionare
    la cartella `extension/`.
5.  L'icona ShaveIt apparirà vicino alla barra. Aprire una pagina,
    cliccare l'icona e premere "Riassumi".
6.  (Facoltativo) Inserire l'API Key fornita dal backend di test nel
    popup per abilitare la sintesi.
