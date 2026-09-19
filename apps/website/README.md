# apps/website — sito marketing statico, per brand, in 5 lingue

Generatore in Node (solo stdlib), nessuna dipendenza, output deterministico.
Live per LemonSqueezer su <https://lemonsqueezer.app> (stack `site-lemonsqueezer`, `infra/site.yaml`).

## Struttura

```
apps/website/
├── generate-site.mjs       # generatore
├── i18n/{en,it,es,fr,de}.json   # dizionari: stesse chiavi in ogni lingua (verificato a build e nei test)
├── template/
│   ├── _head.html _header.html _footer.html   # partial ({{@nome}})
│   ├── index.html faq.html thank-you.html canceled.html   # una copia per lingua
│   ├── 404.html root-index.html                # radice, senza lingua
├── publish.sh              # upload su S3 + invalidazione CloudFront
└── dist/<brand>/           # output (ignorato da git)
    ├── index.html          # fallback: redirect a /en/ (di norma agisce la CloudFront Function)
    ├── 404.html
    ├── privacy-policy.html terms.html   # copiati da legal/ (IT+EN nello stesso file)
    ├── assets/{icon.svg,icon-128.png,hero.png}   # hero = screenshot store 02-testo-popup
    └── <lang>/{index,faq,thank-you,canceled}.html
```

## Placeholder nei template

| Sintassi | Origine | Escape |
|---|---|---|
| `{{key}}` | `brand.json` / pagina (`displayName`, `primary`, `lang`, `canonical`…) | sì |
| `{{t.key}}` | dizionario della lingua; può contenere `{{displayName}}` | sì |
| `{{!key}}` | HTML costruito dal generatore (`langLinks`, `hreflang`, `ctaTag`, `robots`) | no (fidato) |
| `{{@name}}` | include `template/name.html` | — |

Un placeholder non risolto resta visibile nell'output e fa uscire con codice 1: non si pubblica.

## Dati dal brand.json

- `site.url` — origine del sito (canonical, hreflang, og:url). Obbligatorio.
- `urls.chromeStore` — se è un `https://…`, il pulsante diventa "Aggiungi a Chrome"; se vuoto, "In arrivo" non cliccabile.
- `tokens.colors.primary` — colore del brand; il colore del testo sul pulsante è calcolato dalla luminanza (scuro su Lemon, bianco su Briefly).
- `tagline` — usata come sottotitolo solo nella versione inglese; le altre lingue usano `hero_sub` tradotto, così nessuna pagina mescola due lingue.

## Uso

```bash
node apps/website/generate-site.mjs lemonsqueezer          # un brand
node apps/website/generate-site.mjs --all                  # tutti
BUILD_YEAR=2026 node apps/website/generate-site.mjs --all  # anno fisso (output riproducibile)

# pubblicazione (bucket e distribuzione dagli output dello stack site-<brand>)
bash apps/website/publish.sh lemonsqueezer site-707688585651-site-lemonsqueezer E3QN8AWQPKI8VI
```

`publish.sh` fa due passaggi: HTML con `max-age=300`, asset con un anno `immutable`; `--delete` rimuove ciò che non è più generato; poi invalida `/*`.

## Infrastruttura (`infra/site.yaml`, regione us-east-1)

Bucket privato + CloudFront con OAC + certificato ACM validato via DNS + record A/AAAA nella zona Route 53.
Una CloudFront Function (viewer-request) fa due cose: `/` → 302 verso `/<lingua>/` dall'`Accept-Language`
(default `en`), e `/it/` → `/it/index.html` (un'origine S3 REST non serve gli index delle sottocartelle).

```bash
aws cloudformation deploy --region us-east-1 --stack-name site-<brand> --template-file infra/site.yaml \
  --parameter-overrides DomainName=<dominio> HostedZoneId=<zona>
```

## Verifica

- `cd backend && node --test test/website-gen.test.mjs` — chiavi dei dizionari, escape, colore del pulsante, generazione completa senza placeholder né inglese residuo.
- Controllo visivo: renderizzare `dist/<brand>` con un server locale e Playwright (desktop/mobile, chiaro/scuro); nessun overflow orizzontale, nessun `{{`/`undefined`.
