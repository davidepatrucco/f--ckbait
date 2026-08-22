// content.js - Content script per l'estrazione del testo leggibile
// Implementazione semplificata di Readability per estrarre il contenuto principale

(function() {
    'use strict';
    
    // Configurazione
    const CONFIG = {
        API_URL: 'https://4jo5gamel9.execute-api.eu-west-1.amazonaws.com/dev'
    };
    
    // Funzione per calcolare la densità del testo in un elemento
    function getTextDensity(element) {
        const text = element.textContent || '';
        const html = element.innerHTML || '';
        
        if (html.length === 0) return 0;
        
        const links = element.querySelectorAll('a');
        const linkLength = Array.from(links)
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

    function isYouTubeVideoUrl(url = window.location.href) {
        try {
            const parsed = new URL(url);
            const hostname = parsed.hostname.replace(/^www\./, '');
            if (hostname === 'youtu.be') return parsed.pathname.length > 1;
            if (!['youtube.com', 'm.youtube.com'].includes(hostname)) return false;
            return (parsed.pathname === '/watch' && Boolean(parsed.searchParams.get('v'))) ||
                /^\/(shorts|live)\/.+/.test(parsed.pathname);
        } catch {
            return false;
        }
    }

    async function getYouTubeTranscript() {
        if (!isYouTubeVideoUrl()) return null;

        // Use the player's structured caption tracks, not the rendered page
        // or its controls. This is independent of whether the transcript UI is
        // open and never allows a YouTube HTML/footer summary.
        const response = await chrome.runtime.sendMessage({ action: 'getYouTubeCaptionTracks' });
        const { success, tracks, durationSeconds } = response;
        console.log('[YT TRANSCRIPT] Risposta service worker:', {
            success,
            trackCount: Array.isArray(tracks) ? tracks.length : 0,
            error: response.error
        });
        if (!success || !Array.isArray(tracks) || tracks.length === 0) return null;

        const preferredLanguages = [navigator.language?.slice(0, 2), 'it', 'en'].filter(Boolean);
        const track = tracks.find((item) => preferredLanguages.some((language) =>
            item.languageCode === language || item.languageCode?.startsWith(`${language}-`)
        )) || tracks[0];
        const captionUrl = new URL(track.baseUrl);
        if (!captionUrl.hostname.endsWith('youtube.com')) {
            console.error('[YT TRANSCRIPT] Host caption non valido:', captionUrl.hostname);
            return null;
        }
        captionUrl.searchParams.set('fmt', 'json3');

        const captionResponse = await chrome.runtime.sendMessage({
            action: 'getYouTubeCaptionText',
            baseUrl: captionUrl.toString()
        });
        console.log('[YT TRANSCRIPT] Download caption:', {
            status: captionResponse.status,
            language: track.languageCode,
            contentType: captionResponse.contentType,
            characters: captionResponse.text?.length || 0
        });
        if (!captionResponse.success || !captionResponse.text) return null;
        const rawTranscript = captionResponse.text;
        let text = '';
        try {
            const payload = JSON.parse(rawTranscript.replace(/^\)\]\}'\s*/, ''));
            text = (payload.events || [])
                .flatMap((event) => event.segs || [])
                .map((segment) => segment.utf8 || '')
                .join(' ');
        } catch {
            const xml = new DOMParser().parseFromString(rawTranscript, 'text/xml');
            if (!xml.querySelector('parsererror')) {
                text = Array.from(xml.querySelectorAll('text, p, s'))
                    .map((node) => node.textContent || '')
                    .join(' ');
            }
        }
        text = text.replace(/\s+/g, ' ').trim();

        console.log('[YT TRANSCRIPT] Testo estratto:', { characters: text.length, language: track.languageCode });
        return text && text.length >= 50 ? {
            text: text.slice(0, 120000),
            title: document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim() || 'Video YouTube',
            language: track.languageCode,
            durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : undefined
        } : null;
    }
    
    // Rendi disponibile la funzione per il popup
    if (typeof window !== 'undefined') {
        window.lemonsqueezer = {
            getPageData: getPageData,
            extractReadableText: extractReadableText,
            getYouTubeTranscript: getYouTubeTranscript
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

        if (request.action === 'extractYouTubeTranscript') {
            getYouTubeTranscript()
                .then((data) => sendResponse({ success: Boolean(data), data, error: data ? undefined : 'Trascrizione non disponibile per questo video' }))
                .catch((error) => sendResponse({ success: false, error: error.message }));
            return true;
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
        
        if (request.action === 'showLoginModal') {
            try {
                showLoginModal(request.data);
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
        
        if (request.action === 'openSummaryModal') {
            try {
                openSummaryModal(request);
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
                        <h3>LemonSqueezer - TL;DR</h3>
                        <button class="lemonsqueezer-modal-close">&times;</button>
                    </div>
                    <div class="lemonsqueezer-modal-body" id="lemonsqueezer-modal-body">
                        <div class="lemonsqueezer-loading">
                            <div class="lemonsqueezer-spinner"></div>
                            <div class="lemonsqueezer-loading-text">Analisi in corso...</div>
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
    
    // Funzione per mostrare la modale di login
    // Funzione semplificata: Non mostra più modale di login
    // Il login ora viene gestito solo nel popup
    function showLoginModal(data) {
        console.log('[CONTENT] showLoginModal chiamata ma rimossa - login gestito nel popup');
        // Questa funzione non dovrebbe più essere chiamata con la nuova UX
        // ma la lascio per compatibilità con il codice esistente
    }
    
    // Funzione per aggiornare la modale con il risultato
    function updateModalWithResult(data) {
        const modalBody = document.getElementById('lemonsqueezer-modal-body');
        if (!modalBody) return;
        
        // Calcola tempi usando la stessa logica per consistenza
        const originalWordsCount = data.stats?.originalWords || 0;
        const summaryWordsCount = data.stats?.summaryWords || data.wordsCount || 0;
        
        console.log('DEBUG tempo risparmiato:', { 
            originalWordsCount, 
            summaryWordsCount,
            stats: data.stats 
        });
        
        const videoDurationSeconds = Number(data.videoDurationSeconds);
        const isVideo = data.sourceType === 'video' && Number.isFinite(videoDurationSeconds) && videoDurationSeconds > 0;
        const formatDuration = (seconds) => {
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = Math.round(seconds % 60);
            return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`;
        };

        // A video is measured against its actual runtime, never by transcript
        // word count. Web pages retain the reading-time calculation.
        let readingTimeDisplay;
        if (isVideo) {
            readingTimeDisplay = `Video: ${formatDuration(videoDurationSeconds)}`;
        } else if (data.stats?.readingTime && data.stats.readingTime !== 'N/D') {
            readingTimeDisplay = `${data.stats.readingTime} min di lettura`;
        } else if (originalWordsCount > 0) {
            const readingTimeMinutes = Math.max(1, Math.round(originalWordsCount / 220));
            readingTimeDisplay = `${readingTimeMinutes} min di lettura`;
        } else {
            readingTimeDisplay = 'Tempo non disponibile';
        }
        
        // Calcola tempo risparmiato solo se abbiamo i dati
        let timeSavedText = '';
        if (isVideo || (originalWordsCount > 0 && summaryWordsCount >= 0)) {
            const summarySeconds = (summaryWordsCount / 220) * 60;
            const timeSavedMinutes = isVideo
                ? Math.max(0, (videoDurationSeconds - summarySeconds) / 60)
                : Math.max(0, (originalWordsCount - summaryWordsCount) / 220);
            
            console.log('DEBUG calcolo:', {
                isVideo,
                videoDurationSeconds,
                originalWordsCount,
                summaryWordsCount,
                timeSavedMinutes
            });
            
            if (timeSavedMinutes >= 1) {
                const minutes = Math.floor(timeSavedMinutes);
                const seconds = Math.round((timeSavedMinutes - minutes) * 60);
                if (seconds > 0) {
                    timeSavedText = `Hai risparmiato ${minutes}m ${seconds}s!`;
                } else {
                    timeSavedText = `Hai risparmiato ${minutes} min!`;
                }
            } else {
                const totalSeconds = Math.max(1, Math.round(timeSavedMinutes * 60));
                timeSavedText = `Hai risparmiato ${totalSeconds} sec!`;
            }
        } else {
            timeSavedText = 'Risparmio non calcolabile';
        }
        
        console.log('DEBUG risultato:', { readingTimeDisplay, timeSavedText });
        
        modalBody.innerHTML = `
            <div class="lemonsqueezer-summary-meta">
                <strong>${data.title || 'Riassunto'}</strong>
                <div class="lemonsqueezer-stats">
                    <div class="lemonsqueezer-stat-item">
                        <span class="lemonsqueezer-stat-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M4 5h10"></path>
                                <path d="M4 9h10"></path>
                                <path d="M4 13h6"></path>
                                <path d="M14 4h6v16h-6"></path>
                            </svg>
                        </span>
                        <span class="lemonsqueezer-stat-text">${readingTimeDisplay}</span>
                    </div>
                    <div class="lemonsqueezer-stat-item">
                        <span class="lemonsqueezer-stat-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 20h9"></path>
                                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
                            </svg>
                        </span>
                        <span class="lemonsqueezer-stat-text">${data.stats?.summaryWords || data.wordsCount || 'N/A'} parole</span>
                    </div>
                    <div class="lemonsqueezer-stat-item lemonsqueezer-stat-highlight">
                        <span class="lemonsqueezer-stat-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M13 2L4 14h7l-1 8 9-12h-7z"></path>
                            </svg>
                        </span>
                        <span class="lemonsqueezer-stat-text">${timeSavedText}</span>
                    </div>
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
                <button class="lemonsqueezer-btn-secondary" id="lemonsqueezer-copy-summary">
                    <span class="lemonsqueezer-btn-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="10" height="10" rx="2"></rect>
                            <rect x="5" y="5" width="10" height="10" rx="2"></rect>
                        </svg>
                    </span>
                    Copia
                </button>
                <button class="lemonsqueezer-btn-primary" id="lemonsqueezer-open-link">
                    <span class="lemonsqueezer-btn-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"></path>
                            <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"></path>
                        </svg>
                    </span>
                    Apri link
                </button>
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
                <div class="lemonsqueezer-error-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="9"></circle>
                        <path d="M15 9l-6 6"></path>
                        <path d="M9 9l6 6"></path>
                    </svg>
                </div>
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
                width: 44px;
                height: 44px;
                margin: 0 auto 16px;
                color: #d32f2f;
            }

            .lemonsqueezer-error-icon svg {
                width: 100%;
                height: 100%;
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
                margin-bottom: 12px;
                line-height: 1.3;
            }
            
            .lemonsqueezer-stats {
                display: flex;
                flex-wrap: wrap;
                gap: 12px;
                margin-bottom: 10px;
            }
            
            .lemonsqueezer-stat-item {
                display: flex;
                align-items: center;
                gap: 6px;
                background: #f8f9fa;
                border: 1px solid #e9ecef;
                border-radius: 6px;
                padding: 6px 10px;
                font-size: 13px;
                color: #495057;
            }
            
            .lemonsqueezer-stat-highlight {
                background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
                border-color: #28a745;
                color: white;
                font-weight: 600;
                animation: pulse 2s infinite;
            }
            
            @keyframes pulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.02); }
                100% { transform: scale(1); }
            }
            
            .lemonsqueezer-stat-icon {
                width: 14px;
                height: 14px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }

            .lemonsqueezer-stat-icon svg {
                width: 14px;
                height: 14px;
            }

            .lemonsqueezer-stat-highlight .lemonsqueezer-stat-icon svg {
                color: #ffffff;
            }
            
            .lemonsqueezer-stat-text {
                font-size: 13px;
                line-height: 1;
            }
            
            .lemonsqueezer-url {
                font-size: 12px;
            }
            
            .lemonsqueezer-url a {
                color: #0066cc;
                text-decoration: none;
                word-break: break-all;
                line-height: 1.3;
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
                display: inline-flex;
                align-items: center;
                gap: 8px;
            }

            .lemonsqueezer-btn-icon {
                width: 14px;
                height: 14px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }

            .lemonsqueezer-btn-icon svg {
                width: 14px;
                height: 14px;
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
            
            /* Login modal styles */
            .lemonsqueezer-login {
                text-align: center;
                padding: 40px 20px;
            }
            
            .lemonsqueezer-login-icon {
                font-size: 48px;
                margin-bottom: 16px;
            }
            
            .lemonsqueezer-login-title {
                font-size: 18px;
                font-weight: 600;
                color: #333;
                margin-bottom: 12px;
            }
            
            .lemonsqueezer-login-message {
                font-size: 14px;
                color: #666;
                margin-bottom: 20px;
                line-height: 1.4;
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
                    copyBtn.textContent = 'Copiato!';
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
    
    // Funzione per mostrare il modal con il riassunto (backward compatibility)
    function showSummaryModal(data) {
        // Rimuovi modal esistenti
        const existingModal = document.getElementById('lemonsqueezer-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Prima mostra il loading
        showLoadingModal({ url: data.originalUrl });
        
        // Poi aggiorna con i dati
        setTimeout(() => {
            updateModalWithResult(data);
        }, 100);
    }
    
    // Funzione per aprire la modale dal popup e avviare il riassunto
    async function openSummaryModal(request) {
        console.log('[CONTENT] openSummaryModal chiamata:', request);
        
        // Mostra loading modal
        showLoadingModal({ url: request.url });
        
        try {
            // Verifica se l'utente è autenticato
            const { authToken } = await chrome.storage.local.get(['authToken']);
            
            if (!authToken) {
                throw new Error('Utente non autenticato');
            }
            
            const requestBody = {
                url: request.url,
                lang: 'it'
            };

            if (isYouTubeVideoUrl(request.url)) {
                const transcript = await getYouTubeTranscript();
                if (!transcript) {
                    throw new Error('Questo video non ha una trascrizione accessibile. Apri un video con sottotitoli disponibili.');
                }
                requestBody.transcript = transcript.text;
                requestBody.title = transcript.title;
                requestBody.transcriptLanguage = transcript.language;
                requestBody.videoDurationSeconds = transcript.durationSeconds;
            }

            // Chiama l'API per il riassunto; per YouTube invia la trascrizione
            // già accessibile nella pagina invece di chiedere al backend di
            // scaricare o processare il video.
            const response = await fetch(`${CONFIG.API_URL}/summarize-url`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify(requestBody)
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Errore di rete' }));
                
                if (response.status === 429) {
                    throw new Error('Limite riassunti raggiunto. Upgrade a Premium per continuare.');
                }
                
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }
            
            const dataRaw = await response.json();
            console.log('[CONTENT] Dati ricevuti (raw):', dataRaw);

            // Normalizza e fornisce fallback per campi mancanti
            const data = Object.assign({}, dataRaw);

            // originalUrl: fallback alla request.url (il tab corrente)
            if (!data.originalUrl) data.originalUrl = request.url || window.location.href;

            // title: fallback al document.title o all'URL
            if (!data.title) data.title = dataRaw.title || document.title || data.originalUrl;

            // summary: fallback stringa vuota
            if (!data.summary) data.summary = dataRaw.summary || '';

            // stats: assicurati che esista e abbia readingTime e summaryWords
            data.stats = data.stats || {};

            // readingTime: se mancante, proviamo a calcolarlo da originalWords (se presente) o usare 'N/D'
            if (data.stats.readingTime == null) {
                const approxWords = data.stats.originalWords || data.originalWords || 0;
                if (approxWords > 0) {
                    // calcola minutes approssimativi a 220 parole/min
                    data.stats.readingTime = Math.max(1, Math.round(approxWords / 220));
                } else {
                    data.stats.readingTime = 'N/D';
                }
            }

            // summaryWords: fallback a conteggio parole del summary
            if (data.stats.summaryWords == null) {
                const summaryWordsCount = (data.summary || '').trim().split(/\s+/).filter(Boolean).length;
                data.stats.summaryWords = summaryWordsCount || (data.wordsCount || 0);
            }

            // wordsCount: fallback a stats.summaryWords
            if (data.wordsCount == null) data.wordsCount = data.stats.summaryWords || 0;

            // Salva statistiche di tempo per analytics
            await saveTimeStats(data);
            
            // Aggiorna modale con risultato normalizzato
            updateModalWithResult(data);
            
        } catch (error) {
            console.error('[CONTENT] Errore riassunto:', error);
            updateModalWithError({ error: error.message });
        }
    }
    
    // Funzione per salvare statistiche di tempo per analytics utente
    async function saveTimeStats(data) {
        try {
            const originalWords = data.stats?.originalWords || 0;
            const summaryWords = data.stats?.summaryWords || data.wordsCount || 0;
            const videoDurationSeconds = Number(data.videoDurationSeconds);
            const isVideo = data.sourceType === 'video' && Number.isFinite(videoDurationSeconds) && videoDurationSeconds > 0;
            
            if (!isVideo && originalWords <= 0) return; // Skip se non abbiamo dati validi
            
            // Calcola tempi in minuti
            const readingTimeMinutes = isVideo ? videoDurationSeconds / 60 : originalWords / 220;
            const summaryTimeMinutes = summaryWords / 220;
            const timeSavedMinutes = Math.max(0, readingTimeMinutes - summaryTimeMinutes);
            
            // Crea record delle statistiche
            const statsEntry = {
                timestamp: Date.now(),
                date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
                month: new Date().toISOString().slice(0, 7), // YYYY-MM
                originalWords,
                summaryWords,
                readingTimeMinutes,
                timeSavedMinutes,
                url: data.originalUrl || window.location.href
            };
            
            // Recupera statistiche esistenti
            const { userTimeStats = [] } = await chrome.storage.local.get(['userTimeStats']);
            
            // Aggiungi nuovo record
            userTimeStats.push(statsEntry);
            
            // Mantieni solo ultimi 1000 record per non saturare storage
            if (userTimeStats.length > 1000) {
                userTimeStats.splice(0, userTimeStats.length - 1000);
            }
            
            // Salva nel storage
            await chrome.storage.local.set({ userTimeStats });
            
            console.log('[CONTENT] Statistiche salvate:', {
                readingTime: readingTimeMinutes.toFixed(1),
                timeSaved: timeSavedMinutes.toFixed(1),
                totalEntries: userTimeStats.length
            });
            
        } catch (error) {
            console.error('[CONTENT] Errore salvataggio statistiche:', error);
        }
    }
    
})();
