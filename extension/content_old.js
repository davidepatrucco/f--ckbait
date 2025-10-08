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
        if (request.action === 'ping') {
            // Risposta per verificare che il content script sia caricato
            sendResponse({ success: true });
            return;
        }
        
        if (request.action === 'extractContent') {
            try {
                const pageData = getPageData();
                sendResponse({ success: true, data: pageData });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
            return;
        }
        
        if (request.action === 'showLoadingModal') {
            try {
                showLoadingModal(request.data);
                sendResponse({ success: true });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
            return;
        }
        
        if (request.action === 'updateModalWithResult') {
            try {
                updateModalWithResult(request.data);
                sendResponse({ success: true });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
            return;
        }
        
        if (request.action === 'updateModalWithError') {
            try {
                updateModalWithError(request.data);
                sendResponse({ success: true });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
            return;
        }
        
        if (request.action === 'showSummaryModal') {
            try {
                showSummaryModal(request.data);
                sendResponse({ success: true });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
            return;
        }
        
        return true; // Mantiene il canale di risposta aperto
    });
    
    // Funzione per mostrare la modale di caricamento con spinner "squeezing"
    function showLoadingModal(data) {
        // Rimuovi modal esistenti
        const existingModal = document.getElementById('lemonsqueezer-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Crea il modal con spinner
        const modal = document.createElement('div');
        modal.id = 'lemonsqueezer-modal';
        modal.innerHTML = getModalStyles() + `
            <div class="lemonsqueezer-modal-overlay">
                <div class="lemonsqueezer-modal-content">
                    <div class="lemonsqueezer-modal-header">
                        <h3>🍋 LemonSqueezer - TL;DR</h3>
                        <button class="lemonsqueezer-modal-close">&times;</button>
                    </div>
                    <div class="lemonsqueezer-modal-body" id="lemonsqueezer-modal-body">
                        <div class="lemonsqueezer-loading">
                            <div class="lemonsqueezer-spinner"></div>
                            <div class="lemonsqueezer-loading-text">🍋 Squeezing...</div>
                            <div class="lemonsqueezer-url-preview">${data.url}</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Event listeners
        setupModalEventListeners(modal);
    }
    
    // Funzione per aggiornare la modale con il risultato
    function updateModalWithResult(data) {
        const modalBody = document.getElementById('lemonsqueezer-modal-body');
        if (!modalBody) return;
        
        modalBody.innerHTML = `
            <div class="lemonsqueezer-summary-meta">
                <strong>${data.title || 'Riassunto'}</strong>
                <div class="lemonsqueezer-stats">
                    📖 ${data.readingTime || 'N/A'} min • ${data.wordsCount || 'N/A'} parole
                </div>
                <div class="lemonsqueezer-url">
                    <a href="${data.originalUrl}" target="_blank">${data.originalUrl}</a>
                </div>
            </div>
            <div class="lemonsqueezer-summary-content">
                ${(data.summary || '').replace(/\n/g, '<br>')}
            </div>
        `;
        
        // Aggiungi footer se non esiste
        const modal = document.getElementById('lemonsqueezer-modal');
        if (modal && !modal.querySelector('.lemonsqueezer-modal-footer')) {
            const footer = document.createElement('div');
            footer.className = 'lemonsqueezer-modal-footer';
            footer.innerHTML = `
                <button class="lemonsqueezer-btn-secondary" id="lemonsqueezer-copy-summary">📋 Copia</button>
                <button class="lemonsqueezer-btn-primary" id="lemonsqueezer-open-link">🔗 Apri Link</button>
            `;
            modal.querySelector('.lemonsqueezer-modal-content').appendChild(footer);
            
            // Setup footer event listeners
            setupFooterEventListeners(data);
        }
    }
    
    // Funzione per aggiornare la modale con un errore
    function updateModalWithError(data) {
        const modalBody = document.getElementById('lemonsqueezer-modal-body');
        if (!modalBody) return;
        
        modalBody.innerHTML = `
            <div class="lemonsqueezer-error">
                <div class="lemonsqueezer-error-icon">❌</div>
                <div class="lemonsqueezer-error-title">Errore</div>
                <div class="lemonsqueezer-error-message">${data.error}</div>
                <button class="lemonsqueezer-btn-secondary" onclick="document.getElementById('lemonsqueezer-modal').remove()">Chiudi</button>
            </div>
        `;
    }

    // Funzione helper per ottenere gli stili del modal
    function getModalStyles() {
        return `
            <style>
            #lemonsqueezer-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 999999;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            
            .lemonsqueezer-modal-overlay {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                justify-content: center;
                align-items: center;
                padding: 20px;
            }
            
            .lemonsqueezer-modal-content {
                background: white;
                border-radius: 12px;
                max-width: 600px;
                width: 100%;
                max-height: 80vh;
                overflow-y: auto;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            }
            
            .lemonsqueezer-loading {
                text-align: center;
                padding: 40px 20px;
            }
            
            .lemonsqueezer-spinner {
                display: inline-block;
                width: 40px;
                height: 40px;
                border: 4px solid #f3f3f3;
                border-top: 4px solid #007AFF;
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin-bottom: 20px;
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            
            .lemonsqueezer-loading-text {
                font-size: 18px;
                color: #333;
                margin-bottom: 10px;
                font-weight: 500;
            }
            
            .lemonsqueezer-url-preview {
                font-size: 12px;
                color: #666;
                word-break: break-all;
                max-width: 500px;
                margin: 0 auto;
                line-height: 1.4;
            }
            
            .lemonsqueezer-error {
                text-align: center;
                padding: 40px 20px;
            }
            
            .lemonsqueezer-error-icon {
                font-size: 48px;
                margin-bottom: 16px;
            }
            
            .lemonsqueezer-error-title {
                font-size: 18px;
                font-weight: 600;
                color: #d32f2f;
                margin-bottom: 12px;
            }
            
            .lemonsqueezer-error-message {
                font-size: 14px;
                color: #666;
                margin-bottom: 24px;
                line-height: 1.4;
            }
            
            .lemonsqueezer-modal-header {
                padding: 20px 20px 15px;
                border-bottom: 1px solid #e5e5e5;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            .lemonsqueezer-modal-header h3 {
                margin: 0;
                font-size: 18px;
                color: #333;
            }
            
            .lemonsqueezer-modal-close {
                background: none;
                border: none;
                font-size: 24px;
                cursor: pointer;
                color: #666;
                padding: 0;
                width: 30px;
                height: 30px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .lemonsqueezer-modal-close:hover {
                background: #f5f5f5;
                color: #333;
            }
            
            .lemonsqueezer-modal-body {
                padding: 20px;
            }
            
            .lemonsqueezer-summary-meta {
                margin-bottom: 20px;
                padding-bottom: 15px;
                border-bottom: 1px solid #e5e5e5;
            }
            
            .lemonsqueezer-summary-meta strong {
                font-size: 16px;
                color: #333;
                display: block;
                margin-bottom: 8px;
            }
            
            .lemonsqueezer-stats {
                color: #666;
                font-size: 14px;
                margin-bottom: 8px;
            }
            
            .lemonsqueezer-url {
                font-size: 12px;
            }
            
            .lemonsqueezer-url a {
                color: #0066cc;
                text-decoration: none;
                word-break: break-all;
            }
            
            .lemonsqueezer-summary-content {
                line-height: 1.6;
                color: #333;
                font-size: 15px;
            }
            
            .lemonsqueezer-modal-footer {
                padding: 15px 20px 20px;
                display: flex;
                gap: 10px;
                justify-content: flex-end;
            }
            
            .lemonsqueezer-btn-primary,
            .lemonsqueezer-btn-secondary {
                padding: 10px 16px;
                border-radius: 6px;
                border: none;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
            }
            
            .lemonsqueezer-btn-primary {
                background: #007AFF;
                color: white;
            }
            
            .lemonsqueezer-btn-primary:hover {
                background: #005ce6;
            }
            
            .lemonsqueezer-btn-secondary {
                background: #f5f5f5;
                color: #333;
            }
            
            .lemonsqueezer-btn-secondary:hover {
                background: #e5e5e5;
            }
            </style>
        `;
    }

    // Funzione helper per setup event listeners del modal
    function setupModalEventListeners(modal) {
        modal.querySelector('.lemonsqueezer-modal-close').addEventListener('click', () => {
            modal.remove();
        });
        
        modal.querySelector('.lemonsqueezer-modal-overlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                modal.remove();
            }
        });
        
        // Chiudi con ESC
        const escHandler = (e) => {
            if (e.key === 'Escape' && document.getElementById('lemonsqueezer-modal')) {
                modal.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }

    // Funzione helper per setup event listeners del footer
    function setupFooterEventListeners(data) {
        const copyBtn = document.getElementById('lemonsqueezer-copy-summary');
        const openBtn = document.getElementById('lemonsqueezer-open-link');
        
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(data.summary).then(() => {
                    const originalText = copyBtn.textContent;
                    copyBtn.textContent = '✅ Copiato!';
                    setTimeout(() => {
                        copyBtn.textContent = originalText;
                    }, 2000);
                });
            });
        }
        
        if (openBtn) {
            openBtn.addEventListener('click', () => {
                window.open(data.originalUrl, '_blank');
                document.getElementById('lemonsqueezer-modal').remove();
            });
        }
    }
    
    // Funzione per mostrare il modal con il riassunto
    function showSummaryModal(data) {
    }
        // Rimuovi modal esistenti
        const existingModal = document.getElementById('lemonsqueezer-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Crea il modal
        const modal = document.createElement('div');
        modal.id = 'lemonsqueezer-modal';
        modal.innerHTML = `
            <div class="lemonsqueezer-modal-overlay">
                <div class="lemonsqueezer-modal-content">
                    <div class="lemonsqueezer-modal-header">
                        <h3>🍋 LemonSqueezer - TL;DR</h3>
                        <button class="lemonsqueezer-modal-close">&times;</button>
                    </div>
                    <div class="lemonsqueezer-modal-body">
                        <div class="lemonsqueezer-summary-meta">
                            <strong>${data.title}</strong>
                            <div class="lemonsqueezer-stats">
                                📖 ${data.readingTime} min • ${data.wordsCount} parole
                            </div>
                            <div class="lemonsqueezer-url">
                                <a href="${data.originalUrl}" target="_blank">${data.originalUrl}</a>
                            </div>
                        </div>
                        <div class="lemonsqueezer-summary-content">
                            ${data.summary.replace(/\n/g, '<br>')}
                        </div>
                    </div>
                    <div class="lemonsqueezer-modal-footer">
                        <button class="lemonsqueezer-btn-secondary" id="lemonsqueezer-copy-summary">📋 Copia</button>
                        <button class="lemonsqueezer-btn-primary" id="lemonsqueezer-open-link">🔗 Apri Link</button>
                    </div>
                </div>
            </div>
        `;
        
        // Aggiungi gli stili
        const styles = `
            <style>
            #lemonsqueezer-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 999999;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            
            .lemonsqueezer-modal-overlay {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                justify-content: center;
                align-items: center;
                padding: 20px;
            }
            
            .lemonsqueezer-modal-content {
                background: white;
                border-radius: 12px;
                max-width: 600px;
                width: 100%;
                max-height: 80vh;
                overflow-y: auto;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            }
            
            .lemonsqueezer-modal-header {
                padding: 20px 20px 15px;
                border-bottom: 1px solid #e5e5e5;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            .lemonsqueezer-modal-header h3 {
                margin: 0;
                font-size: 18px;
                color: #333;
            }
            
            .lemonsqueezer-modal-close {
                background: none;
                border: none;
                font-size: 24px;
                cursor: pointer;
                color: #666;
                padding: 0;
                width: 30px;
                height: 30px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .lemonsqueezer-modal-close:hover {
                background: #f5f5f5;
                color: #333;
            }
            
            .lemonsqueezer-modal-body {
                padding: 20px;
            }
            
            .lemonsqueezer-summary-meta {
                margin-bottom: 20px;
                padding-bottom: 15px;
                border-bottom: 1px solid #e5e5e5;
            }
            
            .lemonsqueezer-summary-meta strong {
                font-size: 16px;
                color: #333;
                display: block;
                margin-bottom: 8px;
            }
            
            .lemonsqueezer-stats {
                color: #666;
                font-size: 14px;
                margin-bottom: 8px;
            }
            
            .lemonsqueezer-url {
                font-size: 12px;
            }
            
            .lemonsqueezer-url a {
                color: #0066cc;
                text-decoration: none;
                word-break: break-all;
            }
            
            .lemonsqueezer-summary-content {
                line-height: 1.6;
                color: #333;
                font-size: 15px;
            }
            
            .lemonsqueezer-modal-footer {
                padding: 15px 20px 20px;
                display: flex;
                gap: 10px;
                justify-content: flex-end;
            }
            
            .lemonsqueezer-btn-primary,
            .lemonsqueezer-btn-secondary {
                padding: 10px 16px;
                border-radius: 6px;
                border: none;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
            }
            
            .lemonsqueezer-btn-primary {
                background: #007AFF;
                color: white;
            }
            
            .lemonsqueezer-btn-primary:hover {
                background: #005ce6;
            }
            
            .lemonsqueezer-btn-secondary {
                background: #f5f5f5;
                color: #333;
            }
            
            .lemonsqueezer-btn-secondary:hover {
                background: #e5e5e5;
            }
            </style>
        `;
        
        modal.innerHTML = styles + modal.innerHTML;
        document.body.appendChild(modal);
        
        // Event listeners
        modal.querySelector('.lemonsqueezer-modal-close').addEventListener('click', () => {
            modal.remove();
        });
        
        modal.querySelector('.lemonsqueezer-modal-overlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                modal.remove();
            }
        });
        
        modal.querySelector('#lemonsqueezer-copy-summary').addEventListener('click', () => {
            navigator.clipboard.writeText(data.summary).then(() => {
                const btn = modal.querySelector('#lemonsqueezer-copy-summary');
                const originalText = btn.textContent;
                btn.textContent = '✅ Copiato!';
                setTimeout(() => {
                    btn.textContent = originalText;
                }, 2000);
            });
        });
        
        modal.querySelector('#lemonsqueezer-open-link').addEventListener('click', () => {
            window.open(data.originalUrl, '_blank');
            modal.remove();
        });
        
        // Chiudi con ESC
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && document.getElementById('lemonsqueezer-modal')) {
                modal.remove();
            }
        }, { once: true });
    }
    
})();