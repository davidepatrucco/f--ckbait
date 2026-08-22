import * as cheerio from 'cheerio';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

// Config
const MAX_TEXT_CHARS = parseInt(process.env.MAX_TEXT_CHARS || '6000', 10);

function isPrivateAddress(address) {
    if (isIP(address) === 4) {
        const [a, b] = address.split('.').map(Number);
        return a === 0 || a === 10 || a === 127 ||
            (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168);
    }
    if (isIP(address) === 6) {
        const normalized = address.toLowerCase();
        return normalized === '::1' || normalized.startsWith('fc') ||
            normalized.startsWith('fd') || normalized.startsWith('fe80:');
    }
    return true;
}

async function assertPublicUrl(validUrl) {
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
export function extractTextFromHtml(html, url = 'https://example.com/') {
    try {
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
        const $ = cheerio.load(html);
        $('script, style, nav, footer, header, aside, noscript, iframe, svg, form, button, [role="navigation"], [role="complementary"]').remove();
        const main = $('article, main, [role="main"], .article-body, .article__body, .story-body, .entry-content, .post-content, #mw-content-text').first();
        let text = (main.length ? main.text() : $('body').text()) || $('html').text() || '';
        
        // Normalize whitespace
        text = text.replace(/\s+/g, ' ').trim();
        return text;
        
    } catch (error) {
        console.error('Error extracting text from HTML:', error);
        throw new Error('Failed to extract text from HTML');
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
        
        console.log(`Fetched ${html.length} characters of HTML`);
        
        // Estrai titolo e testo
        const extractStart = Date.now();
        const title = extractTitleFromHtml(html);
        let text = extractTextFromHtml(html, validUrl.toString());
        const extractEnd = Date.now();
        console.log(`Extracted title and text (extraction time: ${extractEnd - extractStart} ms)`);

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
