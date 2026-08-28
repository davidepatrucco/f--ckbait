# Reading Intelligence Platform — Executive Summary

## Cos'è
- **Estensione browser che riassume e "valuta" qualsiasi pagina web** in un clic (articoli, blog, documentazione, YouTube).
- **Portfolio di 5 brand** sullo stesso motore, per testare 5 posizionamenti di mercato in parallelo:
  - **LemonSqueezer** — TL;DR generalista (bullet essenziali).
  - **Scout** — "vale il tuo tempo?" punteggio di attenzione prima di leggere.
  - **NoBull** — anti-clickbait: cosa c'è davvero, senza hype.
  - **Briefly** — executive brief (contesto + punti chiave, tono professionale).
  - **Signal** — insight strutturati per chi fa ricerca/analisi.
- **Identità condivisa, vita commerciale separata per brand**: login unico, ma quota/piano/abbonamento indipendenti per ciascun brand (billing per-brand già pronto).
- Un'unica base di codice → build automatiche **per brand × browser (Chrome/Firefox/Safari) × ambiente**.

## A che punto siamo
- **Prodotto funzionalmente completo e in produzione (tecnica).** 3 ambienti isolati (dev / staging / prod) con pipeline CI/CD automatica fino a staging e **deploy in produzione con approvazione manuale**.
- **5 brand end-to-end**: ognuno con il proprio stile di output, verificato live.
- **Motore LLM cost-aware**: usa il modello economico di default, quello premium solo quando serve; **costo per riassunto trascurabile** (frazioni di centesimo). Il prezzo del prodotto è quindi una scelta di posizionamento, non un vincolo di costo.
- **Pricing** deciso: **€1.99/mese · €14.99/anno** (uniforme, "frictionless"), **free 1 riassunto/giorno**. Il prezzo è single-source da Stripe (si cambia in un posto solo).
- **Dashboard interna di analytics** (funnel, engagement, retention, costi, confronto tra i 5 brand) per capire quale esperimento vince.
- **Siti marketing** (landing/pricing/faq) generati per ciascun brand e già online (in attesa del dominio definitivo).
- **Legale**: privacy/termini per-brand pubblicati; entità **Bifa SRLS**.
- **Qualità**: revisione avversariale completa eseguita, ~140 test automatici verdi, sicurezza/abuso quota verificati. **Nessun bug aperto.**
- **Non ancora lanciato pubblicamente**: zero clienti reali (è il momento ideale, tutto pulito).

## Prossimi step (verso il go-live)
Prerequisiti (1–4), poi la **pubblicazione** (5) è il traguardo:
1. **Stripe LIVE**: creare prodotti/prezzi reali per i 5 brand e collegare l'incasso (oggi in modalità test).
2. **QA sui browser** reali (Chrome, Firefox, Safari) — check di prodotto su ciascun brand.
3. **Asset store**: screenshot e materiali per le schede (copy già pronta).
4. **Dominio** per i siti + collegamento URL di checkout.
5. **➡️ PUBBLICAZIONE NEGLI STORE** (il go-live vero e proprio): submission a **Chrome Web Store** per primo, poi **Firefox (AMO)** e **Safari (App Store)**. **"Launch wave" ravvicinata (48–72h)** dei 5 brand, ordine Lemon → Scout → NoBull → Briefly → Signal.
6. **Post-lancio**: misurare gli unit economics reali sui primi utenti e decidere su quali brand puntare.

## Sintesi
Piattaforma pronta a livello tecnico e di prodotto; ciò che resta è **configurazione commerciale (Stripe), QA e pubblicazione**. L'obiettivo è coprire velocemente più posizionamenti con un solo motore e lasciare che i dati dicano quale brand scala.
