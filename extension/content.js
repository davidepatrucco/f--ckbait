// content.js - Content script per l'estrazione del testo leggibile
// Implementazione semplificata di Readability per estrarre il contenuto principale

(function() {
    'use strict';
    
    // Funzione per calcolare la densità del testo in un elemento
    function getTextDensity(element) {
        const text = element.textContent || '';
        const html = element.innerHTML || '';
        
        if (html.length === 0) return 0;
        
        const linkLength = (element.querySelectorAll('a') || [])
            .reduce((sum, link) => sum + (link.textContent || '').length, 0);
        
        const textLength = text.length;
        const linkDensity = linkLength / textLength;
        
        return textLength > 25 ? (1 - linkDensity) : 0;
    }
    
    // Funzione per assegnare un punteggio agli elementi
    function scoreElement(element) {
        let score = 0;
        const tagName = element.tagName.toLowerCase();
        
        // Punteggio base per tipo di tag
        switch (tagName) {
            case 'article':
                score += 30;
                break;
            case 'div':
                score += 5;
                break;
            case 'section':
                score += 15;
                break;
            case 'p':
                score += 3;
                break;
            case 'td':
                score += 3;
                break;
            default:
                score += 0;
        }
        
        // Bonus per classi e ID che indicano contenuto
        const className = element.className || '';
        const id = element.id || '';
        const classAndId = (className + ' ' + id).toLowerCase();
        
        if (/article|content|entry|main|post|text|blog|story/.test(classAndId)) {
            score += 25;
        }
        
        if (/comment|meta|footer|sidebar|aside|nav|ad|advertisement/.test(classAndId)) {
            score -= 25;
        }
        
        // Punteggio basato sulla densità del testo
        const textDensity = getTextDensity(element);
        score += textDensity * 25;
        
        // Punteggio basato sulla lunghezza del testo
        const textLength = (element.textContent || '').length;
        if (textLength > 100) {
            score += Math.min(textLength / 100, 10);
        }
        
        return score;
    }
    
    // Funzione per pulire il testo estratto
    function cleanText(text) {
        return text
            .replace(/\s+/g, ' ')  // Normalizza gli spazi
            .replace(/\n\s*\n/g, '\n')  // Rimuovi righe vuote multiple
            .trim();
    }
    
    // Funzione principale per estrarre il testo leggibile
    function extractReadableText() {
        // Prima rimuovi elementi non desiderati
        const elementsToIgnore = document.querySelectorAll(
            'script, style, nav, header, footer, aside, ' +
            '.ad, .advertisement, .social, .share, .comment, ' +
            '.sidebar, .menu, .navigation, .cookie, .popup'
        );
        
        // Cerca tutti i possibili contenitori di contenuto
        const candidates = document.querySelectorAll('div, article, section, main, p');
        let bestCandidate = null;
        let bestScore = 0;
        
        candidates.forEach(element => {
            // Salta elementi nascosti o molto piccoli
            const rect = element.getBoundingClientRect();
            if (rect.width < 100 || rect.height < 50) return;
            
            // Salta elementi che sono dentro elementi da ignorare
            if (element.closest('script, style, nav, header, footer, aside')) return;
            
            const score = scoreElement(element);
            if (score > bestScore) {
                bestScore = score;
                bestCandidate = element;
            }
        });
        
        // Fallback se non troviamo un buon candidato
        if (!bestCandidate || bestScore < 10) {
            bestCandidate = document.body;
        }
        
        // Estrai il testo
        let text = bestCandidate.textContent || bestCandidate.innerText || '';
        text = cleanText(text);
        
        // Tronca se troppo lungo (120k caratteri come da spec)
        if (text.length > 120000) {
            text = text.substring(0, 120000) + '...';
        }
        
        return text;
    }
    
    // Funzione per ottenere i dati della pagina
    function getPageData() {
        return {
            url: window.location.href,
            title: document.title,
            text: extractReadableText(),
            timestamp: Date.now()
        };
    }
    
    // Rendi disponibile la funzione per il popup
    if (typeof window !== 'undefined') {
        window.lemonsqueezer = {
            getPageData: getPageData,
            extractReadableText: extractReadableText
        };
    }
    
    // Listener per messaggi dal popup/service worker
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'extractContent') {
            try {
                const pageData = getPageData();
                sendResponse({ success: true, data: pageData });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        }
        return true; // Mantiene il canale di risposta aperto
    });
    
})();