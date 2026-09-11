import * as cheerio from 'cheerio';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { CONTENT_LIMITS } from './policy.mjs';

// Config
const MAX_TEXT_CHARS = CONTENT_LIMITS.maxTextChars;
// Oltre questa soglia il contenuto è troppo lungo per un riassunto affidabile:
// meglio un messaggio chiaro che un riassunto parziale (niente chunking per ora).
const TOO_LONG_CHARS = CONTENT_LIMITS.tooLongChars;

// Estrae il testo da un PDF (buffer) con pdfjs-dist (build legacy per Node, no worker).
// Cap a 50 pagine / 200k char per restare nei 29s di API Gateway.
export async function extractPdfText(buffer) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({
        data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true
    }).promise;
    // Oltre questa soglia il documento NON viene letto per intero: restituire
    // comunque un testo parziale produrrebbe un riassunto che ignora il resto senza
    // dirlo. Si rifiuta, coerentemente con la regola sui contenuti troppo lunghi.
    const MAX_PDF_PAGES = CONTENT_LIMITS.maxPdfPages;
    if (doc.numPages > MAX_PDF_PAGES) {
        const e = new Error(`TOO_LONG: PDF di ${doc.numPages} pagine (massimo ${MAX_PDF_PAGES})`);
        e.code = 'CONTENT_TOO_LONG';
        throw e;
    }
    const maxPages = Math.min(doc.numPages, MAX_PDF_PAGES);
    let out = '';
    for (let i = 1; i <= maxPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        out += content.items.map((it) => (it.str || '')).join(' ') + '\n';
        if (out.length > 200000) break;
    }
    return out.replace(/\s+/g, ' ').trim();
}
// Sopra questa dimensione HTML si salta JSDOM+Readability (troppo lento su Lambda)
// e si usa il path cheerio veloce. ~350KB ≈ ≤12s su Lambda, dentro i 29s.
const MAX_HTML_FOR_READABILITY = parseInt(process.env.MAX_HTML_FOR_READABILITY || '350000', 10);

// Un indirizzo IPv6 puo' incapsulare un IPv4 (::ffff:127.0.0.1, ::ffff:7f00:1,
// 64:ff9b::127.0.0.1). Senza normalizzare, il controllo IPv6 non riconosce quelle
// forme e lascia passare loopback e link-local: bypass reale del filtro.
// Restituisce l'IPv4 in notazione puntata, oppure null.
export function embeddedIPv4(address) {
    const a = String(address).toLowerCase();
    if (isIP(a) !== 6) return null;
    // Forma con IPv4 gia' puntato in coda (::ffff:127.0.0.1, 64:ff9b::127.0.0.1)
    const dotted = a.match(/:((?:\d{1,3}\.){3}\d{1,3})$/);
    if (dotted && isIP(dotted[1]) === 4) return dotted[1];
    // Forma esadecimale (::ffff:7f00:1 -> 127.0.0.1): si espandono i gruppi e si
    // interpretano gli ultimi 32 bit come IPv4.
    const parts = a.split('::');
    if (parts.length > 2) return null;
    const head = parts[0] ? parts[0].split(':').filter(Boolean) : [];
    const tail = parts.length === 2 && parts[1] ? parts[1].split(':').filter(Boolean) : [];
    if (parts.length === 1 && head.length !== 8) return null;
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    const groups = [...head, ...Array(parts.length === 2 ? fill : 0).fill('0'), ...tail];
    if (groups.length !== 8) return null;
    const isMapped = groups.slice(0, 5).every((g) => parseInt(g, 16) === 0) && parseInt(groups[5], 16) === 0xffff;
    const isNat64 = parseInt(groups[0], 16) === 0x64 && parseInt(groups[1], 16) === 0xff9b;
    if (!isMapped && !isNat64) return null;
    const hi = parseInt(groups[6], 16);
    const lo = parseInt(groups[7], 16);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
    return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join('.');
}

export function isPrivateAddress(address) {
    // Prima la normalizzazione: un IPv4 incapsulato va giudicato come IPv4.
    const mapped = embeddedIPv4(address);
    if (mapped) return isPrivateAddress(mapped);

    if (isIP(address) === 4) {
        const [a, b] = address.split('.').map(Number);
        return a === 0 || a === 10 || a === 127 ||
            (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 100 && b >= 64 && b <= 127) ||   // CGNAT 100.64.0.0/10
            a >= 224;                                // multicast e riservati
    }
    if (isIP(address) === 6) {
        const n = address.toLowerCase();
        return n === '::1' || n === '::' ||
            /^f[cd]/.test(n) ||      // unique-local fc00::/7
            n.startsWith('fe80:') || // link-local
            /^ff/.test(n);           // multicast
    }
    // Non e' un indirizzo IP: il chiamante risolve il nome e ricontrolla.
    return true;
}


export async function assertPublicUrl(validUrl) {
    const hostname = validUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
        throw new Error('Gli URL locali non sono consentiti');
    }

    if (isIP(hostname)) {
        if (isPrivateAddress(hostname)) throw new Error('Gli indirizzi privati non sono consentiti');
        return;
    }

    const addresses = await lookup(hostname, { all: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
        throw new Error('L\'host deve risolvere esclusivamente a indirizzi pubblici');
    }
}

/**
 * Estrae il contenuto testuale da HTML rimuovendo script, stili e elementi non necessari
 * @param {string} html - HTML da processare
 * @returns {string} - Testo pulito
 */
// Estrazione veloce con cheerio (htmlparser2): millisecondi anche su ~1MB.
// Usata come fallback per pagine non-articolo e per le pagine troppo grandi.
function extractWithCheerio(html) {
    const $ = cheerio.load(html);
    $('script, style, nav, footer, header, aside, noscript, iframe, svg, form, button, [role="navigation"], [role="complementary"]').remove();
    const main = $('article, main, [role="main"], .article-body, .article__body, .story-body, .entry-content, .post-content, #mw-content-text').first();
    const text = (main.length ? main.text() : $('body').text()) || $('html').text() || '';
    return text.replace(/\s+/g, ' ').trim();
}

export function extractTextFromHtml(html, url = 'https://example.com/') {
    try {
        // JSDOM+Readability è super-lineare nella dimensione del DOM e gira su un
        // Lambda con CPU limitata: una homepage di news da ~958KB ha misurato 47s,
        // oltre il limite di 29s di API Gateway (HTTP 504). Sopra la soglia si usa
        // il path cheerio veloce (~1s anche a ~1MB). Le pagine-articolo normali
        // (sotto soglia) restano su Readability, che dà qualità migliore.
        if (html.length > MAX_HTML_FOR_READABILITY) {
            console.log(`HTML ${html.length} > ${MAX_HTML_FOR_READABILITY}: fast cheerio extraction`);
            return extractWithCheerio(html);
        }

        // Readability is purpose-built to isolate an article from chrome such
        // as navigation, sidebars, related links and page footer. It is the
        // primary extractor for newspapers and regular editorial pages.
        const dom = new JSDOM(html, { url });
        const article = new Readability(dom.window.document).parse();
        const readableText = article?.textContent?.replace(/\s+/g, ' ').trim() || '';
        if (readableText.length >= 200) {
            return readableText;
        }

        // Not every useful page is an article (documentation, simple blogs,
        // knowledge bases). Keep a constrained fallback instead of sending an
        // entire body, which was the cause of footer/menu summaries.
        return extractWithCheerio(html);

    } catch (error) {
        console.error('Error extracting text from HTML:', error);
        // Readability può lanciare su DOM anomali: non rinunciare al riassunto,
        // prova comunque il path cheerio prima di fallire.
        try {
            return extractWithCheerio(html);
        } catch {
            throw new Error('Failed to extract text from HTML');
        }
    }
}

/**
 * Estrae il titolo dalla pagina HTML
 * @param {string} html - HTML da processare
 * @returns {string} - Titolo della pagina
 */
function extractTitleFromHtml(html) {
    try {
        const $ = cheerio.load(html);
        
        // Prova diversi selettori per il titolo
        let title = $('title').first().text().trim();
        if (title) return title;
        
        title = $('h1').first().text().trim();
        if (title) return title;
        
        title = $('.title').first().text().trim();
        if (title) return title;
        
        return 'Contenuto web';
        
    } catch (error) {
        console.error('Error extracting title from HTML:', error);
        return 'Contenuto web';
    }
}

/**
 * Fetch del contenuto web da un URL e estrazione del testo
 * @param {string} url - URL da cui estrarre il contenuto
 * @returns {Promise<{text: string, title: string}>} - Contenuto estratto
 */
export async function fetchWebContent(url) {
    try {
        // Valida URL
        let validUrl;
        try {
            validUrl = new URL(url);
        } catch (error) {
            throw new Error('URL non valido');
        }
        
        // Solo HTTP/HTTPS
        if (!['http:', 'https:'].includes(validUrl.protocol)) {
            throw new Error('Solo URL HTTP/HTTPS sono supportati');
        }

        await assertPublicUrl(validUrl);
        
        console.log('Fetching URL host:', validUrl.hostname);
        
        // Fetch con timeout e headers appropriati
    const controller = new AbortController();
    const timeoutMs = parseInt(process.env.FETCH_TIMEOUT_MS || '8000', 10); // default 8s
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        
        const response = await fetch(validUrl.toString(), {
            method: 'GET',
            // A redirect can turn a safe public URL into an internal one. Reject
            // it unless a redirect-aware, revalidating fetcher is introduced.
            redirect: 'error',
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; LemonSqueezer-TLDR/1.0)',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            },
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        // Verifica content-type
        const contentType = response.headers.get('content-type') || '';
        // PDF: estrazione testo dedicata (report/paper pubblici). Ramo prima del check HTML.
        const isPdf = contentType.includes('application/pdf') || /\.pdf($|\?)/i.test(validUrl.pathname + validUrl.search);
        if (isPdf) {
            const buf = Buffer.from(await response.arrayBuffer());
            const pdfText = await extractPdfText(buf);
            if (!pdfText || pdfText.length < 50) {
                throw new Error('PDF senza testo estraibile (probabile scansione/immagine).');
            }
            if (pdfText.length > TOO_LONG_CHARS) {
                throw new Error('TOO_LONG: PDF troppo lungo per un riassunto affidabile');
            }
            const pdfTitle = decodeURIComponent((validUrl.pathname.split('/').pop() || 'PDF').replace(/\.pdf$/i, '')) || 'PDF';
            return { text: pdfText.slice(0, MAX_TEXT_CHARS), title: pdfTitle };
        }
        if (!contentType.includes('text/html')) {
            throw new Error('Il contenuto non è HTML');
        }
        
    // Ottieni il contenuto (misura tempi)
    const t0 = Date.now();
    const html = await response.text();
    const t1 = Date.now();
    console.log(`Fetched ${html.length} characters of HTML (download time: ${t1 - t0} ms)`);
        
        if (!html || html.length < 100) {
            throw new Error('Contenuto HTML troppo breve');
        }

        // Anti-bot / challenge (Cloudflare, ecc.): il fetch server riceve la pagina di
        // sfida, non il contenuto. Segnala con un codice mappabile a un messaggio chiaro.
        if (/BOT_CHALLENGE|cf-browser-verification|Checking your browser|Just a moment\.\.\.|Enable JavaScript and cookies to continue|Attention Required/i.test(html.slice(0, 4000))) {
            throw new Error('BOT_CHALLENGE: pagina protetta da controllo anti-bot');
        }

        console.log(`Fetched ${html.length} characters of HTML`);
        
        // Estrai titolo e testo
        const extractStart = Date.now();
        const title = extractTitleFromHtml(html);
        let text = extractTextFromHtml(html, validUrl.toString());
        const extractEnd = Date.now();
        console.log(`Extracted title and text (extraction time: ${extractEnd - extractStart} ms)`);

        // Troppo lungo: messaggio chiaro invece di un riassunto parziale inaffidabile.
        if (text.length > TOO_LONG_CHARS) {
            throw new Error('TOO_LONG: contenuto troppo lungo per un riassunto affidabile');
        }

        // Trim text to a max length to reduce tokens
        if (text.length > MAX_TEXT_CHARS) {
            console.log(`Trimming extracted text from ${text.length} to ${MAX_TEXT_CHARS} chars`);
            text = text.substring(0, MAX_TEXT_CHARS);
        }
        
        if (!text || text.length < 50) {
            throw new Error('Non è possibile estrarre testo sufficiente dalla pagina');
        }
        
        console.log(`Extracted title: "${title}", text: ${text.length} characters`);

        return {
            text,
            title
        };
        
    } catch (error) {
        console.error('Error fetching web content:', error);
        
        if (error.name === 'AbortError') {
            throw new Error('Timeout nel caricamento della pagina');
        }
        
        if (error.message.includes('fetch')) {
            throw new Error('Impossibile accedere all\'URL');
        }
        
        throw error;
    }
}
