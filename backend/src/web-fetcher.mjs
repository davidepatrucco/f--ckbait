import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

// Config
const MAX_TEXT_CHARS = parseInt(process.env.MAX_TEXT_CHARS || '6000', 10);

/**
 * Estrae il contenuto testuale da HTML rimuovendo script, stili e elementi non necessari
 * @param {string} html - HTML da processare
 * @returns {string} - Testo pulito
 */
function extractTextFromHtml(html) {
    try {
        const dom = new JSDOM(html, { url: 'http://localhost' });
        const document = dom.window.document;

        // Prima prova con Mozilla Readability: più robusto e restituisce solo il contenuto principale
        try {
            const reader = new Readability(document);
            const article = reader.parse();
            if (article && article.textContent && article.textContent.length > 50) {
                let text = article.textContent;
                // Normalize whitespace
                text = text.replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
                return text;
            }
        } catch (readErr) {
            // Se Readability fallisce, continuiamo con il fallback
            console.warn('Readability extraction failed, falling back to manual extraction:', readErr && readErr.message);
        }

        // Fallback: rimuovi script/style/elements tipici e prendi il body
        // Rimuovi script, style, nav, footer, header, aside
        const elementsToRemove = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript'];
        elementsToRemove.forEach(tag => {
            const elements = document.querySelectorAll(tag);
            elements.forEach(el => el.remove());
        });

        // Rimuovi elementi con classi comuni per ads/sidebar
        const adSelectors = [
            '.ad', '.ads', '.advertisement', '.sidebar', '.social', '.share',
            '.comment', '.comments', '.footer', '.header', '.navigation',
            '.menu', '.popup', '.modal', '.cookie'
        ];
        adSelectors.forEach(selector => {
            try {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => el.remove());
            } catch (e) {
                // Ignora errori di selettori
            }
        });

        // Usa body come fallback
        const mainContent = document.body || document.documentElement;
        let text = mainContent.textContent || '';
        text = text.replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
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
        const dom = new JSDOM(html);
        const document = dom.window.document;
        
        // Prova diversi selettori per il titolo
        const titleSelectors = [
            'title',
            'h1',
            '.title',
            '.post-title',
            '.article-title',
            '.entry-title'
        ];
        
        for (const selector of titleSelectors) {
            const element = document.querySelector(selector);
            if (element && element.textContent.trim()) {
                return element.textContent.trim();
            }
        }
        
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
        
        console.log('Fetching URL:', validUrl.toString());
        
        // Fetch con timeout e headers appropriati
    const controller = new AbortController();
    const timeoutMs = parseInt(process.env.FETCH_TIMEOUT_MS || '8000', 10); // default 8s
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        
        const response = await fetch(validUrl.toString(), {
            method: 'GET',
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
        let text = extractTextFromHtml(html);
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