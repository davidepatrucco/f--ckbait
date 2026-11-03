// content.js - Content script per l'estrazione del testo leggibile
// Implementazione semplificata di Readability per estrarre il contenuto principale

(function() {
    'use strict';

    // Tema del brand iniettato da brand-config.js (stesso isolated world del content script).
    const BRAND = (typeof globalThis !== 'undefined' && globalThis.__BRAND__) ? globalThis.__BRAND__ : null;
    const BRAND_PRIMARY = (BRAND && BRAND.tokens && BRAND.tokens.colors && BRAND.tokens.colors.primary) || '#FFD400';
    const BRAND_PRIMARY_700 = (BRAND && BRAND.tokens && BRAND.tokens.colors && BRAND.tokens.colors.primary700) || '#FFB800';
    const BRAND_INK = (BRAND && BRAND.tokens && BRAND.tokens.colors && BRAND.tokens.colors.black) || '#0D1117';
    let activeSummaryRequestId = null;

    // Accesso dal sito del brand: la pagina /<lang>/login.html manda email e password
    // con postMessage e il service worker fa la chiamata all'API (il sito non ha CORS
    // sull'API). Solo sull'origine del sito, solo messaggi della pagina stessa.
    // Sul sito il gestore password del browser propone la password salvata e incollare
    // funziona, cosa che nel popup non succede (si chiude quando si cambia finestra).
    const SITE_ORIGIN = (() => { try { return new URL(BRAND.urls.site).origin; } catch (e) { return ''; } })();
    if (SITE_ORIGIN && location.origin === SITE_ORIGIN) {
        window.addEventListener('message', (event) => {
            const msg = event.data;
            if (event.source !== window || !msg || msg.type !== 'LS_AUTH') return;
            chrome.runtime.sendMessage({ action: 'siteAuth', mode: msg.mode, email: msg.email, password: msg.password }, (res) => {
                const reply = res || { ok: false, error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'error' };
                window.postMessage({ type: 'LS_AUTH_RESULT', ok: !!reply.ok, error: reply.error || '' }, SITE_ORIGIN);
            });
        });
        document.documentElement.dataset.lsExtension = '1';
    }

    // i18n: le stringhe UI vivono in _locales/<lang>/messages.json e seguono la lingua
    // del browser (chrome.i18n). Il fallback restituisce la chiave, così una stringa
    // mancante è visibile invece di produrre testo vuoto.
    // Senza traduzione si restituisce il fallback esplicito, MAI la chiave: mostrare
    // "err_paywall" all'utente sarebbe peggio di un messaggio generico in inglese.
    function t(key, substitutions, fallback) {
        try {
            const s = chrome.i18n.getMessage(key, substitutions);
            if (s) return s;
        } catch (e) { /* i18n non disponibile */ }
        return fallback !== undefined ? fallback : 'Content unavailable';
    }
    // Escape per interpolare testo tradotto dentro i template HTML della modale.
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Icone inline (niente emoji): 14-16px, currentColor, decorative (aria-hidden).
    const ICON_VIDEO = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px"><rect x="2" y="6" width="14" height="12" rx="2"></rect><path d="M16 10l6-3v10l-6-3z"></path></svg>';
    const ICON_DOC = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px"><path d="M6 2h9l5 5v15H6z"></path><path d="M15 2v5h5"></path><path d="M9 13h6M9 17h6"></path></svg>';
    const ICON_WARN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px"><path d="M12 3l10 18H2z"></path><path d="M12 10v4M12 17h.01"></path></svg>';
    // La fetta di limone del sito: unico segno del brand nel riquadro.
    const LEMON_SLICE = (cls) => {
        const segs = [0, 36, 72, 108, 144, 180, 216, 252, 288, 324].map((r) => `<path d="M0 -8 L-21 -80 A84 84 0 0 1 21 -80 Z" transform="rotate(${r})"/>`).join('');
        return `<svg class="${cls}" viewBox="-100 -100 200 200" aria-hidden="true"><circle r="100" fill="${BRAND_PRIMARY}"/><circle r="90" fill="#fff9dc"/><g fill="${BRAND_PRIMARY}">${segs}</g></svg>`;
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
        const currentVideoId = (() => {
            try {
                const parsed = new URL(window.location.href);
                return parsed.searchParams.get('v') || parsed.pathname.match(/^\/(?:shorts|live)\/([^/?]+)/)?.[1] || '';
            } catch {
                return '';
            }
        })();

        // Use the player's structured caption tracks, not the rendered page
        // or its controls. This is independent of whether the transcript UI is
        // open and never allows a YouTube HTML/footer summary.
        const response = await chrome.runtime.sendMessage({ action: 'getYouTubeCaptionTracks' });
        const { success, tracks, durationSeconds } = response;
        console.log('[YT TRANSCRIPT] Risposta service worker:', {
            success,
            trackCount: Array.isArray(tracks) ? tracks.length : 0,
            videoId: response.videoId,
            error: response.error
        });

        const preferredLanguages = [navigator.language?.slice(0, 2), 'it', 'en'].filter(Boolean);
        const availableTracks = Array.isArray(tracks) ? tracks : [];
        const track = availableTracks.find((item) => preferredLanguages.some((language) =>
            item.languageCode === language || item.languageCode?.startsWith(`${language}-`)
        )) || availableTracks[0];

        // YouTube's structured transcript APIs are authoritative. Modern
        // videos may expose get_panel even when captionTracks is unavailable.
        const transcriptApi = await chrome.runtime.sendMessage({ action: 'getYouTubeTranscriptText' });
        console.log('[YT TRANSCRIPT] API risultato:', {
            success: transcriptApi.success,
            source: transcriptApi.source,
            videoId: transcriptApi.videoId,
            characters: transcriptApi.characters || 0,
            reason: transcriptApi.reason || transcriptApi.error
        });
        if (transcriptApi.success && transcriptApi.text?.length >= 50) {
            if (transcriptApi.videoId && currentVideoId && transcriptApi.videoId !== currentVideoId) {
                throw new Error(`YouTube: trascrizione del video sbagliato (${transcriptApi.videoId} invece di ${currentVideoId})`);
            }
            return {
                text: transcriptApi.text.slice(0, 120000),
                title: document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim() || t('video_default_title'),
                language: track?.languageCode || document.documentElement.lang || 'auto',
                durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : undefined
            };
        }

        if (!success || !track) {
            throw new Error(
                `YouTube: ${transcriptApi.reason || transcriptApi.error || 'trascrizione strutturata non disponibile'}; ` +
                `tracce timedtext non trovate${response.error ? ` (${response.error})` : ''}`
            );
        }

        const captionUrl = new URL(track.baseUrl);
        if (!captionUrl.hostname.endsWith('youtube.com')) {
            console.error('[YT TRANSCRIPT] Host caption non valido:', captionUrl.hostname);
            return null;
        }
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
        if (!captionResponse.success || !captionResponse.text) {
            throw new Error(
                `YouTube: API trascrizione ${transcriptApi.reason || transcriptApi.error || 'fallita'}; ` +
                `timedtext HTTP ${captionResponse.status || 'N/D'}, ${captionResponse.text?.length || 0} caratteri`
            );
        }
        const rawTranscript = captionResponse.text;
        let text = '';
        const normalizedPayload = rawTranscript.replace(/^\)\]\}'\s*/, '').trim();
        if (normalizedPayload.startsWith('{')) {
            try {
                const payload = JSON.parse(normalizedPayload);
                text = (payload.events || [])
                    .flatMap((event) => event.segs || [])
                    .map((segment) => segment.utf8 || '')
                    .join(' ');
            } catch {
                // Try the XML parser below for non-standard payloads.
            }
        }
        if (!text) {
            const xml = new DOMParser().parseFromString(rawTranscript, 'text/xml');
            if (!xml.querySelector('parsererror')) {
                text = Array.from(xml.querySelectorAll('text, p, s'))
                    .map((node) => node.textContent || '')
                    .join(' ');
            }
        }
        text = text.replace(/\s+/g, ' ').trim();

        console.log('[YT TRANSCRIPT] Testo estratto:', { characters: text.length, language: track.languageCode });
        if (!text || text.length < 50) {
            throw new Error(
                `YouTube: API trascrizione ${transcriptApi.reason || transcriptApi.error || 'fallita'}; ` +
                `timedtext scaricato (${rawTranscript.length} caratteri) ma non contiene segmenti leggibili`
            );
        }
        return {
            text: text.slice(0, 120000),
            title: document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim() || t('video_default_title'),
            language: track.languageCode,
            durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : undefined
        };
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
                .then((data) => sendResponse({ success: Boolean(data), data, error: data ? undefined : t('err_transcript_unavailable') }))
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
                <div class="lemonsqueezer-modal-content" role="dialog" aria-modal="true" aria-label="${esc(brandTitle())}">
                    <div class="lemonsqueezer-modal-header">
                        ${LEMON_SLICE('ls-slice')}
                        <h3>${esc(brandTitle())}</h3>
                        <button class="lemonsqueezer-modal-close" aria-label="${esc(t('app_close', undefined, 'Close'))}">&times;</button>
                    </div>
                    <div class="lemonsqueezer-modal-body" id="lemonsqueezer-modal-body">
                        <div class="lemonsqueezer-loading">
                            ${LEMON_SLICE('lemonsqueezer-spinner')}
                            <div class="lemonsqueezer-loading-text">${esc(t('modal_loading', undefined, 'Analyzing...'))}</div>
                            <div class="lemonsqueezer-url-preview">${data.url ? esc(shortUrl(data.url)) : ''}</div>
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
    
    // Note non bloccanti (degrado): spiegano perché la fonte scelta è quella e non un'altra.
    // Codice della nota → chiave i18n (il testo vive in _locales/).
    const NOTE_KEYS = {
        VIDEO_AVAILABLE: 'note_video_available',
        VIDEO_NOT_ACCESSIBLE: 'note_video_not_accessible',
        VIDEO_NEEDS_PREMIUM: 'note_video_needs_premium',
        VIDEO_TOO_LONG: 'note_video_too_long',
        VIDEO_SKIPPED_LIVE: 'note_video_skipped_live',
        CAPTIONS_FAILED: 'note_captions_failed',
        STT_FAILED: 'note_stt_failed',
        CAPTIONS_TRANSLATED: 'note_captions_translated',
        TRANSCRIPT_TRUNCATED: 'note_transcript_truncated',
        TRANSCRIPT_PARTIAL: 'note_transcript_partial'
    };

    // Etichetta di trasparenza: dice SEMPRE quale fonte è stata riassunta (buco A).
    function sourceBadgeHtml(data) {
        if (!data || !data.__source) return '';
        const isVideo = data.__source === 'video';
        const label = isVideo ? `${ICON_VIDEO} ${esc(t('source_video', undefined, 'Summary of the video'))}` : `${ICON_DOC} ${esc(t('source_text', undefined, 'Summary of the page text'))}`;
        const alt = data.__alternative || {};
        const canSwitch = isVideo ? alt.text : alt.video;
        const switchLabel = esc(t(isVideo ? 'source_switch_to_text' : 'source_switch_to_video', undefined, isVideo ? 'Summarize the text instead' : 'Summarize the video instead'));
        const btn = canSwitch
            ? `<button id="lemonsqueezer-switch-source" data-target="${isVideo ? 'text' : 'video'}">${switchLabel}</button>`
            : '';
        return `<div class="lemonsqueezer-source-badge">
            <span>${label}</span>${btn}
        </div>`;
    }

    function sourceNotesHtml(notes) {
        const list = (Array.isArray(notes) ? notes : []).filter((n) => NOTE_KEYS[n]);
        if (!list.length) return '';
        return list.map((n) => `<p class="ls-note">${esc(t(NOTE_KEYS[n]))}</p>`).join('');
    }

    // Switch di fonte: rilancia il riassunto forzando l'altra fonte.
    function setupSourceSwitch(data) {
        const btn = document.getElementById('lemonsqueezer-switch-source');
        if (!btn) return;
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-target');
            openSummaryModal({
                url: data.originalUrl || window.location.href,
                lang: lastSummaryRequest.lang,
                summaryProfile: lastSummaryRequest.summaryProfile,
                squeeze: lastSummaryRequest.squeeze,
                forceSource: target
            });
        });
    }

    // Ultimi parametri usati: servono al pulsante di switch per rilanciare identico.
    let lastSummaryRequest = {};

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
            readingTimeDisplay = t('modal_video_duration', [formatDuration(videoDurationSeconds)]);
        } else if (data.stats?.readingTime && data.stats.readingTime !== 'N/D') {
            readingTimeDisplay = t('modal_reading_time', [String(data.stats.readingTime)]);
        } else if (originalWordsCount > 0) {
            const readingTimeMinutes = Math.max(1, Math.round(originalWordsCount / 220));
            readingTimeDisplay = t('modal_reading_time', [String(readingTimeMinutes)]);
        } else {
            readingTimeDisplay = t('modal_time_unavailable', undefined, 'Time unavailable');
        }
        
        // Calcola tempo risparmiato solo se abbiamo i dati
        let timeSavedText = '';
        let savedFigure = '';
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
            
            const savedSeconds = Math.max(1, Math.round(timeSavedMinutes * 60));
            savedFigure = savedSeconds >= 60 ? `${Math.floor(savedSeconds / 60)} min${savedSeconds % 60 ? ` ${savedSeconds % 60} s` : ''}` : `${savedSeconds} s`;
            if (timeSavedMinutes >= 1) {
                const minutes = Math.floor(timeSavedMinutes);
                const seconds = Math.round((timeSavedMinutes - minutes) * 60);
                if (seconds > 0) {
                    timeSavedText = t('modal_saved_ms', [String(minutes), String(seconds)]);
                } else {
                    timeSavedText = t('modal_saved_m', [String(minutes)]);
                }
            } else {
                const totalSeconds = Math.max(1, Math.round(timeSavedMinutes * 60));
                timeSavedText = t('modal_saved_s', [String(totalSeconds)]);
            }
        } else {
            timeSavedText = t('modal_saved_unavailable', undefined, 'Savings not available');
        }
        
        console.log('DEBUG risultato:', { readingTimeDisplay, timeSavedText });
        
        // Il riassunto arriva come righe "• punto": diventa una vera lista.
        const points = String(data.summary || '').split('\n').map((l) => l.replace(/^\s*[•\-*]\s*/, '').trim()).filter(Boolean);
        const bodyHtml = points.length > 1
            ? `<ul class="ls-points">${points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`
            : `<p class="ls-text">${esc(data.summary)}</p>`;
        const words = t('modal_words', [String(data.stats?.summaryWords || data.wordsCount || 0)]);
        modalBody.innerHTML = `
            <h2 class="ls-title">${esc(data.title || t('modal_summary', undefined, 'Summary'))}</h2>
            ${safeLink(data.originalUrl, 'ls-src')}
            <p class="ls-saved">${savedFigure ? `<b>${esc(savedFigure)}</b><span>${esc(t('modal_saved_label', undefined, 'of reading saved'))}</span>` : `<span>${esc(timeSavedText)}</span>`}<span>${esc(readingTimeDisplay)} · ${esc(words)}${data.cached ? ` · ${esc(t('modal_cached', undefined, 'From cache'))}` : ''}</span></p>
            ${sourceBadgeHtml(data)}
            ${sourceNotesHtml(data.__notes)}
            ${data.truncated ? `<p class="ls-note">${esc(t('modal_truncated'))}</p>` : ''}
            ${bodyHtml}
        `;
        setupSourceSwitch(data);
        
        // Aggiungi footer se non esiste
        const modal = document.getElementById('lemonsqueezer-modal');
        if (modal && !modal.querySelector('.lemonsqueezer-modal-footer')) {
            const footer = document.createElement('div');
            footer.className = 'lemonsqueezer-modal-footer';
            footer.innerHTML = `
                <button class="lemonsqueezer-btn-primary" id="lemonsqueezer-copy-summary">
                    <span class="lemonsqueezer-btn-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="10" height="10" rx="2"></rect>
                            <rect x="5" y="5" width="10" height="10" rx="2"></rect>
                        </svg>
                    </span>
                    ${esc(t('modal_copy', undefined, 'Copy'))}
                </button>
            `;
            modal.querySelector('.lemonsqueezer-modal-content').appendChild(footer);
            
            // Setup footer event listeners
            setupFooterEventListeners(data);
        }
    }
    
    // Casi previsti e non riassumibili: sono AVVISI (stato atteso), non errori tecnici.
    const WARNING_CODES = new Set([
        'PAYWALL', 'LOGIN_WALL', 'CONSENT_WALL', 'CANVAS_DOC', 'BOT_CHALLENGE', 'TOO_LONG',
        'LIVE_STREAM', 'VIDEO_NOT_ACCESSIBLE', 'VIDEO_TOO_LONG_NO_CAPTIONS', 'UNSUPPORTED_MEDIA',
        'PREMIUM_REQUIRED', 'MEDIA_TOO_LARGE', 'NO_SPEECH', 'INSUFFICIENT_CONTENT'
    ]);

    // Funzione per aggiornare la modale con un errore o un avviso
    function updateModalWithError(data) {
        const modalBody = document.getElementById('lemonsqueezer-modal-body');
        if (!modalBody) return;

        const code = String((data && data.error) || '');
        const isWarning = WARNING_CODES.has(code);
        const icon = isWarning
            ? '<circle cx="12" cy="12" r="9"></circle><path d="M12 8v5"></path><path d="M12 16h.01"></path>'
            : '<circle cx="12" cy="12" r="9"></circle><path d="M15 9l-6 6"></path><path d="M9 9l6 6"></path>';

        modalBody.innerHTML = `
            <div class="lemonsqueezer-error">
                <div class="lemonsqueezer-error-icon" aria-hidden="true" style="${isWarning ? 'color:#B58105;' : ''}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        ${icon}
                    </svg>
                </div>
                <div class="lemonsqueezer-error-title">${esc(t(isWarning ? 'app_not_summarizable' : 'app_error', undefined, isWarning ? "Can't be summarized" : 'Error'))}</div>
                <div class="lemonsqueezer-error-message"></div>
                <div class="lemonsqueezer-error-notes"></div>
                <button class="lemonsqueezer-btn-secondary" onclick="document.getElementById('lemonsqueezer-modal').remove()">${esc(t('app_close', undefined, 'Close'))}</button>
            </div>
        `;
        const messageEl = modalBody.querySelector('.lemonsqueezer-error-message');
        if (messageEl) messageEl.textContent = toUserFacingError(code);
        // Note di degrado: spiegano cosa è stato tentato prima di arrendersi.
        const notesEl = modalBody.querySelector('.lemonsqueezer-error-notes');
        if (notesEl) notesEl.innerHTML = sourceNotesHtml(data && data.notes);
    }

    // Etichetta leggibile per la raccomandazione Scout.
    function attentionRecommendationLabel(rec) {
        const map = {
            read_now: { label: t('brand_rec_read_now'), color: '#16A34A' },
            skim: { label: t('brand_rec_skim'), color: '#FFB800' },
            save: { label: t('brand_rec_save'), color: '#3B82F6' },
            ignore: { label: t('brand_rec_ignore'), color: '#EF4444' }
        };
        return map[rec] || map.skim;
    }

    // View-model per schema (mappa l'output strutturato del backend a hero/badge/
    // metrics/sections/notes). Difensivo verso campi mancanti.
    function brandOutputViewModel(schema, out) {
        const list = (v) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []);
        const num = (v) => String(Number.isFinite(Number(v)) ? Number(v) : 0);
        if (schema === 'attention') {
            const rec = attentionRecommendationLabel(out.recommendation);
            return {
                hero: { value: num(out.attention_score), label: t('brand_label_attention_score') },
                badge: { text: rec.label, color: rec.color },
                metrics: [
                    { value: num(out.novelty), label: t('brand_label_novelty') },
                    { value: num(out.importance), label: t('brand_label_relevance') },
                    { value: num(out.credibility), label: t('brand_label_reliability') }
                ],
                sections: [{ title: 'Perché', items: list(out.reasons) }],
                notes: []
            };
        }
        if (schema === 'insights') {
            return {
                hero: { value: num(out.signal_score), label: t('brand_label_signal') },
                metrics: [],
                sections: [
                    { title: t('brand_section_key_takeaways'), items: list(out.key_takeaways) },
                    { title: 'Rischi', items: list(out.risks) },
                    { title: t('brand_section_opportunities'), items: list(out.opportunities) }
                ],
                notes: [{ label: t('brand_label_decision'), text: out.decision_note || '' }]
            };
        }
        if (schema === 'noise') {
            return {
                metrics: [
                    { value: num(out.clickbait_score), label: t('brand_label_clickbait') },
                    { value: num(out.hype_score), label: t('brand_label_hype') },
                    { value: num(out.information_density), label: t('brand_label_info_density') }
                ],
                sections: [
                    { title: 'Fatti', items: list(out.facts) },
                    { title: t('brand_section_filler_hype'), items: list(out.filler_patterns) }
                ],
                notes: [{ label: t('brand_label_framing'), text: out.framing_note || '' }]
            };
        }
        if (schema === 'brief') {
            return {
                metrics: [],
                sections: [
                    { title: t('brand_section_what_happened'), items: list(out.what_happened) },
                    { title: t('brand_section_why_it_matters'), items: list(out.why_it_matters) },
                    { title: 'Contesto', items: list(out.background) },
                    { title: t('brand_section_alternative_views'), items: list(out.alternative_views) },
                    { title: t('brand_section_watch_next'), items: list(out.watch_next) }
                ],
                notes: [{ label: t('brand_label_strategic_importance'), text: out.strategic_importance || '' }]
            };
        }
        return null;
    }

    // Renderer generico per output brand-specifici (schema != summary).
    function updateModalWithBrandOutput(data) {
        const modalBody = document.getElementById('lemonsqueezer-modal-body');
        if (!modalBody) return;
        const vm = brandOutputViewModel(data.schema, data.output || {});
        if (!vm) {
            updateModalWithError({ error: t('modal_unsupported_output') });
            return;
        }

        const el = (tag, cls, text) => {
            const e = document.createElement(tag);
            if (cls) e.className = cls;
            if (text != null) e.textContent = String(text);
            return e;
        };

        modalBody.innerHTML = '';
        const card = el('div', 'lemonsqueezer-brandout');

        if (vm.hero) {
            const h = el('div', 'lsb-hero');
            h.appendChild(el('div', 'lsb-hero-num', vm.hero.value));
            h.appendChild(el('div', 'lsb-hero-label', vm.hero.label));
            card.appendChild(h);
        }
        if (vm.badge && vm.badge.text) {
            const b = el('div', 'lsb-badge', vm.badge.text);
            if (vm.badge.color) b.style.background = vm.badge.color;
            card.appendChild(b);
        }
        if (vm.metrics && vm.metrics.length) {
            const row = el('div', 'lsb-metrics');
            vm.metrics.forEach((m) => {
                const cell = el('div', 'lsb-metric');
                cell.appendChild(el('b', null, m.value));
                cell.appendChild(el('span', null, m.label));
                row.appendChild(cell);
            });
            card.appendChild(row);
        }
        (vm.notes || []).forEach((n) => {
            if (!n.text) return;
            const note = el('div', 'lsb-note');
            note.appendChild(el('span', 'lsb-note-label', `${n.label}: `));
            note.appendChild(document.createTextNode(String(n.text)));
            card.appendChild(note);
        });
        (vm.sections || []).forEach((s) => {
            if (!s.items || !s.items.length) return;
            card.appendChild(el('h4', 'lsb-section-title', s.title));
            const ul = el('ul', 'lsb-list');
            s.items.forEach((it) => ul.appendChild(el('li', null, it)));
            card.appendChild(ul);
        });

        const closeBtn = el('button', 'lemonsqueezer-btn-secondary', 'Chiudi');
        closeBtn.addEventListener('click', () => {
            const modal = document.getElementById('lemonsqueezer-modal');
            if (modal) modal.remove();
        });
        card.appendChild(closeBtn);

        modalBody.appendChild(card);
    }

    // Funzione helper per ottenere gli stili del modal
    function getModalStyles() {
        const font = (w) => { try { return chrome.runtime.getURL(`fonts/switzer-${w}.woff2`); } catch (e) { return ''; } };
        // Stesso linguaggio del sito: Switzer, il giallo del brand su un fondo bianco, la
        // fetta di limone come unico segno, niente righe sottili e niente ombre a riposo
        // (l'unica ombra e' quella del riquadro, che galleggia sulla pagina).
        // Le regole sono legate a #lemonsqueezer-modal e azzerano quelle della pagina ospite.
        return `
            <style>
            @font-face { font-family: LSSwitzer; src: url(${font(400)}) format("woff2"); font-weight: 400; font-display: swap; }
            @font-face { font-family: LSSwitzer; src: url(${font(600)}) format("woff2"); font-weight: 600; font-display: swap; }
            @font-face { font-family: LSSwitzer; src: url(${font(800)}) format("woff2"); font-weight: 800; font-display: swap; }
            #lemonsqueezer-modal, #lemonsqueezer-modal * { box-sizing: border-box; margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; letter-spacing: inherit; text-transform: none; text-shadow: none; box-shadow: none; float: none; }
            #lemonsqueezer-modal {
                --ls-y: ${BRAND_PRIMARY}; --ls-ink: #16181c; --ls-muted: #555b64; --ls-tone: #f2f2ee; --ls-pale: #fff4b8;
                position: fixed; inset: 0; z-index: 2147483646;
                font-family: LSSwitzer, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
                font-size: 16px; line-height: 1.5; color: var(--ls-ink); letter-spacing: -0.005em; -webkit-font-smoothing: antialiased;
            }
            #lemonsqueezer-modal .lemonsqueezer-modal-overlay { position: absolute; inset: 0; background: rgba(22, 24, 28, .55); display: flex; justify-content: center; align-items: center; padding: 20px; }
            #lemonsqueezer-modal .lemonsqueezer-modal-content { position: relative; background: #fff; border-radius: 20px; width: 100%; max-width: 620px; max-height: 86vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 30px 80px rgba(0, 0, 0, .35); }
            #lemonsqueezer-modal .lemonsqueezer-modal-header { display: flex; align-items: center; gap: 10px; padding: 14px 14px 14px 20px; background: var(--ls-ink); color: #fff; flex: none; }
            #lemonsqueezer-modal .lemonsqueezer-modal-header h3 { font-size: 16px; font-weight: 600; margin-right: auto; }
            #lemonsqueezer-modal .ls-slice { width: 22px; height: 22px; flex: none; display: block; }
            #lemonsqueezer-modal .lemonsqueezer-modal-close { width: 36px; height: 36px; border-radius: 999px; display: grid; place-items: center; font-size: 22px; line-height: 1; cursor: pointer; color: #fff; transition: background .15s; }
            #lemonsqueezer-modal .lemonsqueezer-modal-close:hover { background: #33363c; }
            #lemonsqueezer-modal .lemonsqueezer-modal-close:focus-visible, #lemonsqueezer-modal button:focus-visible, #lemonsqueezer-modal a:focus-visible { outline: 3px solid var(--ls-y); outline-offset: 2px; }
            #lemonsqueezer-modal .lemonsqueezer-modal-body { padding: 24px 24px 8px; overflow-y: auto; }

            #lemonsqueezer-modal .ls-title { font-size: 22px; font-weight: 600; letter-spacing: -0.03em; line-height: 1.15; }
            #lemonsqueezer-modal .ls-src { display: inline-block; margin-top: 6px; font-size: 14px; color: var(--ls-muted); text-decoration: none; }
            #lemonsqueezer-modal .ls-src:hover { color: var(--ls-ink); text-decoration: underline; }
            #lemonsqueezer-modal .ls-saved { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 12px; margin: 20px -24px 0; padding: 16px 24px; background: var(--ls-y); color: #16181c; }
            #lemonsqueezer-modal .ls-saved b { font-size: 30px; font-weight: 600; letter-spacing: -0.04em; line-height: 1; font-variant-numeric: tabular-nums; }
            #lemonsqueezer-modal .ls-saved span { font-size: 14px; }
            #lemonsqueezer-modal .ls-points { list-style: none; margin: 22px 0 8px; display: grid; gap: 14px; }
            #lemonsqueezer-modal .ls-points li { position: relative; padding-left: 26px; font-size: 16px; line-height: 1.55; }
            #lemonsqueezer-modal .ls-points li::before { content: ""; position: absolute; left: 2px; top: .42em; width: 12px; height: 12px; border-radius: 50%; background: var(--ls-y); }
            #lemonsqueezer-modal .ls-text { margin: 22px 0 8px; white-space: pre-line; }
            #lemonsqueezer-modal .lemonsqueezer-source-badge { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 16px; padding: 8px 12px; border-radius: 12px; background: var(--ls-tone); font-size: 14px; }
            #lemonsqueezer-modal #lemonsqueezer-switch-source { color: var(--ls-ink); text-decoration: underline; cursor: pointer; font-size: 14px; }
            #lemonsqueezer-modal .ls-note { margin-top: 12px; padding: 10px 12px; border-radius: 12px; background: var(--ls-pale); font-size: 14px; }

            #lemonsqueezer-modal .lemonsqueezer-modal-footer { display: flex; gap: 10px; justify-content: flex-end; padding: 16px 24px 20px; flex: none; }
            #lemonsqueezer-modal .lemonsqueezer-btn-primary, #lemonsqueezer-modal .lemonsqueezer-btn-secondary { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 20px; border-radius: 999px; font-size: 15px; font-weight: 600; cursor: pointer; transition: transform .15s, background .15s; }
            #lemonsqueezer-modal .lemonsqueezer-btn-primary { background: var(--ls-ink); color: #fff; }
            #lemonsqueezer-modal .lemonsqueezer-btn-primary:hover { background: #000; transform: translateY(-1px); }
            #lemonsqueezer-modal .lemonsqueezer-btn-secondary { background: var(--ls-tone); color: var(--ls-ink); }
            #lemonsqueezer-modal .lemonsqueezer-btn-secondary:hover { background: #e6e6e1; }
            #lemonsqueezer-modal .lemonsqueezer-btn-primary:active, #lemonsqueezer-modal .lemonsqueezer-btn-secondary:active { transform: scale(.98); }
            #lemonsqueezer-modal .lemonsqueezer-btn-icon, #lemonsqueezer-modal .lemonsqueezer-btn-icon svg { width: 16px; height: 16px; display: inline-flex; }

            /* Attesa: la fetta di limone gira, al posto dello spinner generico. */
            #lemonsqueezer-modal .lemonsqueezer-loading { display: grid; justify-items: center; gap: 10px; padding: 40px 12px 48px; text-align: center; }
            #lemonsqueezer-modal .lemonsqueezer-spinner { width: 72px; height: 72px; margin-bottom: 10px; animation: ls-spin 1.4s cubic-bezier(.5,.1,.5,.9) infinite; }
            #lemonsqueezer-modal .lemonsqueezer-loading-text { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; }
            #lemonsqueezer-modal .lemonsqueezer-url-preview { font-size: 14px; color: var(--ls-muted); word-break: break-all; max-width: 46ch; }
            @keyframes ls-spin { to { transform: rotate(360deg); } }

            #lemonsqueezer-modal .lemonsqueezer-error { display: grid; justify-items: start; gap: 12px; padding: 12px 0 20px; }
            #lemonsqueezer-modal .lemonsqueezer-error-icon { width: 40px; height: 40px; color: #b42318; }
            #lemonsqueezer-modal .lemonsqueezer-error-icon svg { width: 100%; height: 100%; }
            #lemonsqueezer-modal .lemonsqueezer-error-title { font-size: 22px; font-weight: 600; letter-spacing: -0.03em; }
            #lemonsqueezer-modal .lemonsqueezer-error-message { font-size: 16px; max-width: 50ch; }
            #lemonsqueezer-modal .lemonsqueezer-error-notes { width: 100%; }

            /* Output strutturati degli altri brand */
            #lemonsqueezer-modal .lemonsqueezer-brandout { padding-bottom: 12px; }
            #lemonsqueezer-modal .lsb-hero-num { font-size: 56px; font-weight: 600; letter-spacing: -0.04em; line-height: 1; }
            #lemonsqueezer-modal .lsb-hero-label { font-size: 14px; color: var(--ls-muted); margin-top: 6px; }
            #lemonsqueezer-modal .lsb-badge { display: inline-block; margin: 14px 0; padding: 6px 14px; border-radius: 999px; color: #fff; font-weight: 600; font-size: 14px; }
            #lemonsqueezer-modal .lsb-metrics { display: flex; gap: 8px; margin: 14px 0; }
            #lemonsqueezer-modal .lsb-metric { flex: 1; background: var(--ls-tone); border-radius: 12px; padding: 12px; }
            #lemonsqueezer-modal .lsb-metric b { display: block; font-size: 22px; font-weight: 600; }
            #lemonsqueezer-modal .lsb-metric span { font-size: 14px; color: var(--ls-muted); }
            #lemonsqueezer-modal .lsb-note { margin: 10px 0; }
            #lemonsqueezer-modal .lsb-note-label { font-weight: 600; }
            #lemonsqueezer-modal .lsb-section-title { margin: 18px 0 8px; font-size: 18px; font-weight: 600; }
            #lemonsqueezer-modal .lsb-list { list-style: disc; padding-left: 20px; margin-bottom: 12px; }
            #lemonsqueezer-modal .lsb-list li { margin: 6px 0; }

            @media (max-width: 520px) {
                #lemonsqueezer-modal .lemonsqueezer-modal-overlay { padding: 0; align-items: flex-end; }
                #lemonsqueezer-modal .lemonsqueezer-modal-content { max-height: 92vh; border-radius: 20px 20px 0 0; }
                #lemonsqueezer-modal .lemonsqueezer-modal-body { padding: 20px 16px 8px; }
                #lemonsqueezer-modal .ls-saved { margin-inline: -16px; padding-inline: 16px; }
                #lemonsqueezer-modal .lemonsqueezer-modal-footer { padding: 12px 16px 16px; }
            }
            @media (prefers-reduced-motion: reduce) {
                #lemonsqueezer-modal .lemonsqueezer-spinner { animation-duration: 6s; }
                #lemonsqueezer-modal * { transition: none !important; }
            }
            </style>
        `;
    }

    // Funzione helper per setup event listeners del modal
    function setupModalEventListeners(modal) {
        modal.querySelector('.lemonsqueezer-modal-close').addEventListener('click', () => {
            modal.remove();
        });
        
        // Niente chiusura con un clic fuori: un clic per sbaglio faceva perdere il riassunto.
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

        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(data.summary).then(() => {
                    const originalText = copyBtn.textContent;
                    copyBtn.textContent = t('modal_copied', undefined, 'Copied!');
                    setTimeout(() => {
                        copyBtn.textContent = originalText;
                    }, 2000);
                });
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
    
    // Seleziona il contenitore principale dell'articolo nella pagina renderizzata.
    // Usa innerText sul DOM live: restituisce il testo VISIBILE (rispetta display:none,
    // JS già eseguito, consent/paywall gestiti dalla sessione utente), senza clonare
    // (innerText su nodi staccati non è affidabile perché dipende dal layout).
    function pickMainElement() {
        const selectors = [
            'article', 'main', '[role="main"]',
            '.article-body', '.article__body', '.story-body',
            '.entry-content', '.post-content', '#mw-content-text'
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && (el.innerText || '').trim().length > 200) return el;
        }
        return document.body;
    }

    // ---- Reddit: estrattore dedicato (post + commenti principali) via API .json ----
    // Reddit espone <permalink>.json pubblicamente per i subreddit pubblici. Il fetch
    // dal content script su reddit.com è same-origin, quindi non è bloccato da CORS.
    function isRedditUrl(url = window.location.href) {
        try { return /(^|\.)reddit\.com$/.test(new URL(url).hostname.replace(/^www\./, '')); }
        catch { return false; }
    }

    async function getRedditContent() {
        const u = new URL(window.location.href);
        // Solo pagine-commenti di un post (path con /comments/).
        if (!/\/comments\//.test(u.pathname)) return null;
        const jsonUrl = `${u.origin}${u.pathname.replace(/\/$/, '')}.json?limit=100&sort=top&raw_json=1`;
        const res = await fetch(jsonUrl, { credentials: 'omit', headers: { 'Accept': 'application/json' } });
        if (!res.ok) throw new Error(`Reddit .json HTTP ${res.status}`);
        const data = await res.json();
        const post = data?.[0]?.data?.children?.[0]?.data;
        if (!post) return null;
        const parts = [];
        parts.push(`Titolo: ${post.title || ''}`);
        if (post.selftext) parts.push(post.selftext.trim());
        else if (post.url && !/reddit\.com/.test(post.url)) parts.push(`Link: ${post.url}`);
        // Top commenti (ordine 'top'), salta 'more'/stickied/AutoModerator; max ~40.
        const comments = (data?.[1]?.data?.children || [])
            .map((c) => c?.data).filter((c) => c && c.body && c.author !== 'AutoModerator' && !c.stickied)
            .slice(0, 40)
            .map((c) => `• (${c.score ?? 0}) ${c.body.replace(/\s+/g, ' ').trim()}`);
        if (comments.length) { parts.push('', 'Commenti principali:', ...comments); }
        let text = parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
        if (text.length > 120000) text = text.slice(0, 120000);
        const title = (post.title || document.title || 'Discussione Reddit').trim();
        return { text, title };
    }

    // ---- Paywall detection ----
    // Ritorna true solo con segnali robusti, per non falsare articoli brevi legittimi:
    //  - schema.org / meta isAccessibleForFree = false (segnale forte, usato da molte testate)
    //  - contenitore paywall presente E testo estratto molto corto.
    function detectPaywall(extractedText) {
        try {
            const ldFalse = [...document.querySelectorAll('script[type="application/ld+json"]')]
                .some((s) => /"isAccessibleForFree"\s*:\s*(false|"false")/i.test(s.textContent || ''));
            const metaFalse = !!document.querySelector(
                'meta[name="isAccessibleForFree" i][content="false" i], meta[property="isAccessibleForFree" i][content="false" i]'
            );
            if (ldFalse || metaFalse) return true;
            const paywallEl = document.querySelector(
                '[class*="paywall" i],[id*="paywall" i],[data-paywall],[class*="subscribe-wall" i],.tp-modal,.fc-message-root'
            );
            return !!paywallEl && (extractedText || '').length < 300;
        } catch { return false; }
    }

    // ---- Hacker News: estrattore dedicato (story + commenti) via API Algolia HN ----
    function isHackerNewsUrl(url = window.location.href) {
        try {
            const u = new URL(url);
            return u.hostname.replace(/^www\./, '') === 'news.ycombinator.com' &&
                u.pathname === '/item' && Boolean(u.searchParams.get('id'));
        } catch { return false; }
    }
    async function getHackerNewsContent() {
        const id = new URL(window.location.href).searchParams.get('id');
        if (!id) return null;
        const res = await fetch(`https://hn.algolia.com/api/v1/items/${id}`, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HN API HTTP ${res.status}`);
        const item = await res.json();
        const strip = (h) => h ? new DOMParser().parseFromString(h, 'text/html').body.textContent.replace(/\s+/g, ' ').trim() : '';
        const parts = [`Titolo: ${item.title || ''}`];
        if (item.url) parts.push(`Link: ${item.url}`);
        if (item.text) parts.push(strip(item.text));
        const flat = [];
        const walk = (nodes, depth) => {
            for (const c of (nodes || [])) {
                if (flat.length >= 60) return;
                if (c && c.text) flat.push(`${'  '.repeat(depth)}• ${strip(c.text)}`);
                if (depth < 1) walk(c.children, depth + 1);
            }
        };
        walk(item.children, 0);
        if (flat.length) parts.push('', 'Commenti principali:', ...flat);
        let text = parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
        if (text.length > 120000) text = text.slice(0, 120000);
        return { text, title: item.title || 'Hacker News' };
    }

    // ---- Casi noti: documento non leggibile / login wall / consent banner ----
    // Documenti canvas-rendered (nessun testo nel DOM): editor Google Docs/Sheets/Slides,
    // Office online. NB: i Google Doc "pubblicati" (/pub) sono HTML → NON bloccati.
    function isCanvasDoc() {
        try {
            const h = location.hostname.replace(/^www\./, '');
            if (h === 'docs.google.com' && /\/(document|spreadsheets|presentation)\/d\/.*\/edit/.test(location.pathname)) return true;
            if (/(^|\.)officeapps\.live\.com$/.test(h) || /(^|\.)onedrive\.live\.com$/.test(h)) return true;
            return false;
        } catch { return false; }
    }
    // Banner consenso/cookie (CMP) VISIBILE che copre il contenuto, con testo corto.
    function detectConsentWall(extractedText) {
        if ((extractedText || '').length >= 400) return false;
        const cmp = document.querySelector(
            '#onetrust-banner-sdk,.ot-sdk-container,#didomi-host,.qc-cmp2-container,.cc-window,#usercentrics-root,[id*="cookie-consent" i],[class*="cookie-consent" i],[aria-label*="consent" i]'
        );
        if (!cmp) return false;
        const r = cmp.getBoundingClientRect();
        return r.width > 0 && r.height > 0; // presente e renderizzato
    }
    // Login wall sui social/app JS-heavy: solo se il testo estratto è insufficiente,
    // per non bloccare un thread/post che è comunque leggibile.
    function detectLoginWall(extractedText) {
        const h = location.hostname.replace(/^www\./, '');
        const social = /(^|\.)(x\.com|twitter\.com|linkedin\.com|facebook\.com|instagram\.com|threads\.net)$/.test(h);
        return social && (extractedText || '').length < 200;
    }
    // Ritorna un codice-motivo se il contenuto NON è riassumibile, altrimenti null.
    function detectBlockedContent(extractedText) {
        if (isCanvasDoc()) return 'CANVAS_DOC';
        if (detectPaywall(extractedText)) return 'PAYWALL';
        if (detectConsentWall(extractedText)) return 'CONSENT_WALL';
        if (detectLoginWall(extractedText)) return 'LOGIN_WALL';
        return null;
    }

    // Estrae testo e titolo dalla pagina corrente per inviarli al backend.
    // Sposta l'estrazione dal Lambda (dove JSDOM+Readability su pagine grandi
    // superava i 29s di API Gateway -> HTTP 504) al browser, dov'è nativa e veloce.
    function extractReadablePageContent() {
        try {
            // Dal server (GET /config) o dal build: un override di content.maxTextChars
            // deve valere anche per il testo estratto nel browser.
            const MAX_TEXT = (window.RI_SOURCE && window.RI_SOURCE.CONSTANTS.MAX_TEXT_CHARS) || 40000;
            const el = pickMainElement();
            const raw = (el && el.innerText ? el.innerText : '').replace(/\s+/g, ' ').trim();
            const rawLen = raw.length;
            const truncated = rawLen > MAX_TEXT;
            const text = truncated ? raw.slice(0, MAX_TEXT) : raw;

            const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
            const h1 = document.querySelector('h1')?.innerText;
            let title = (ogTitle || document.title || h1 || '').replace(/\s+/g, ' ').trim();

            return { text, title, truncated, rawLen };
        } catch (error) {
            console.warn('[CONTENT] Estrazione testo pagina fallita, fallback al fetch server:', error);
            return { text: '', title: '', truncated: false, rawLen: 0 };
        }
    }

    const MIN_MEDIA_AREA = 320 * 180; // sotto: sfondi/anteprime, non il contenuto

    // Cerca nell'HTML della pagina gli URL delle tracce sottotitoli (.vtt/.srt) e dei
    // media (.m3u8/.mp4). Serve per i player JS che non espongono <track> né una
    // sorgente diretta sull'elemento (es. Substack). Un solo passaggio di regex.
    function scanPageMediaUrls() {
        try {
            const html = document.documentElement ? document.documentElement.innerHTML : '';
            if (!html) return { vtt: [], hls: [], files: [] };
            const grab = (re) => [...new Set((html.match(re) || []).map((u) => u.replace(/&amp;/g, '&')))].slice(0, 20);
            return {
                vtt: grab(/https?:\/\/[^"'\\\s<>]+\.(?:vtt|srt)(?:\?[^"'\\\s<>]*)?/gi),
                hls: grab(/https?:\/\/[^"'\\\s<>]+\.m3u8(?:\?[^"'\\\s<>]*)?/gi),
                files: grab(/https?:\/\/[^"'\\\s<>]+\.(?:mp4|webm|m4a|mp3)(?:\?[^"'\\\s<>]*)?/gi)
            };
        } catch { return { vtt: [], hls: [], files: [] }; }
    }

    // Inventario del media presente in pagina, per la funzione di decisione pura.
    // Nota: i content script girano solo nel frame principale, quindi un video dentro
    // un <iframe> non è ispezionabile come elemento; in quel caso ci si affida agli
    // URL trovati nell'HTML (i sottotitoli restano raggiungibili).
    function probeVideo() {
        const empty = { present: false, prominent: false, isLive: false, durationSeconds: 0, captionTracks: [], directMedia: null };
        try {
            const scanned = scanPageMediaUrls();
            // 1. elemento media più prominente (video, o audio come fallback)
            let el = null; let bestArea = -1; let isAudio = false;
            for (const v of document.querySelectorAll('video')) {
                const r = v.getBoundingClientRect();
                const area = Math.max(0, r.width) * Math.max(0, r.height);
                if (area > bestArea) { bestArea = area; el = v; }
            }
            if (!el || bestArea < MIN_MEDIA_AREA) {
                const a = document.querySelector('audio');
                if (a && /^https?:\/\//i.test(a.currentSrc || a.src || '')) { el = a; isAudio = true; bestArea = Infinity; }
            }

            // 2. tracce sottotitoli: <track> dell'elemento, poi URL scansionati e
            //    correlati all'id di questa pagina (buco C).
            const tracks = [];
            const trackEls = el ? el.querySelectorAll('track') : document.querySelectorAll('video track, audio track');
            for (const t of trackEls) {
                const src = t.getAttribute('src') || '';
                const kind = (t.getAttribute('kind') || '').toLowerCase();
                if (!src || (kind && kind !== 'captions' && kind !== 'subtitles')) continue;
                let abs = src;
                try { abs = new URL(src, location.href).href; } catch { /* relativo non risolvibile */ }
                if (/^https?:\/\//i.test(abs)) tracks.push({ url: abs, lang: t.getAttribute('srclang') || '', kind: kind || 'captions', label: t.getAttribute('label') || '' });
            }
            let correlatedVtt = [];
            if (!tracks.length && scanned.vtt.length && window.RI_SOURCE) {
                correlatedVtt = window.RI_SOURCE.correlateVttUrls(scanned.vtt, location.href);
                // Lingua non nota dall'URL: si prova a dedurla dal nome file (es. .../en.vtt).
                for (const u of correlatedVtt) {
                    const m = u.match(/\/([a-z]{2})(?:-[a-z]{2})?\.(?:vtt|srt)/i);
                    tracks.push({ url: u, lang: m ? m[1].toLowerCase() : '', kind: 'captions', label: '' });
                }
            }

            // 3. sorgente diretta scaricabile (file o HLS)
            let directMedia = null;
            const elSrc = el ? (el.currentSrc || el.src || '') : '';
            if (/^https?:\/\//i.test(elSrc)) {
                directMedia = { url: elSrc, kind: /\.m3u8(\?|$)/i.test(elSrc) ? 'hls' : 'file' };
            } else if (scanned.files.length) {
                directMedia = { url: scanned.files[0], kind: 'file' };
            } else if (scanned.hls.length) {
                directMedia = { url: scanned.hls[0], kind: 'hls' };
            }

            // 4. durata e diretta
            const rawDuration = el && Number.isFinite(el.duration) ? Math.round(el.duration) : 0;
            const isLive = Boolean(
                (el && el.duration === Infinity) ||
                document.querySelector('.ytp-live, [class*="live-badge" i], [data-is-live="true"]')
            );

            const present = Boolean((el && (bestArea >= MIN_MEDIA_AREA || isAudio)) || tracks.length || directMedia);
            if (!present) return empty;

            // Prominenza: misurata sull'elemento; se l'elemento non è ispezionabile
            // (player in iframe) la si assume solo con UNA traccia correlata a questa
            // pagina, che è un segnale forte che il video è il contenuto principale.
            let prominent = false;
            if (el && bestArea >= MIN_MEDIA_AREA) {
                const r = el.getBoundingClientRect();
                prominent = r.top < (window.innerHeight || 800) * 1.5;
            } else if (isAudio) {
                prominent = true;
            } else if (correlatedVtt.length === 1) {
                prominent = true;
            }

            return {
                present: true,
                prominent,
                isLive,
                durationSeconds: rawDuration,
                captionTracks: tracks,
                directMedia
            };
        } catch (e) {
            console.warn('[CONTENT] probeVideo fallito:', e);
            return empty;
        }
    }

    // Inventario completo della pagina passato alla decisione pura.
    function probePageContent(page) {
        return {
            text: { len: (page.text || '').length, rawLen: page.rawLen || 0, title: page.title || '' },
            video: probeVideo(),
            blocked: detectBlockedContent(page.text)
        };
    }

    function mediaTitle(fallback) {
        const t = document.querySelector('meta[property="og:title"]')?.content || document.title || fallback || 'Video';
        return String(t).replace(/\s+/g, ' ').trim();
    }

    // Converte messaggi di errore tecnici in messaggi comprensibili all'utente.
    // Gli errori interni (OpenAI, bullet, HTTP, stack trace) non devono arrivare in UI.
    // Codice/errore tecnico -> chiave i18n. Gli errori interni (OpenAI, HTTP, stack
    // trace) non devono mai arrivare in UI: qualunque cosa non riconosciuta cade su
    // err_generic. La mappa e' esportata per il test (ogni chiave deve esistere).
    const ERROR_CODE_KEYS = {
        PAYWALL: 'err_paywall',
        LOGIN_WALL: 'err_login_wall',
        CONSENT_WALL: 'err_consent_wall',
        CANVAS_DOC: 'err_canvas_doc',
        PREMIUM_REQUIRED: 'err_premium_required',
        UNSUPPORTED_MEDIA: 'err_unsupported_media',
        MEDIA_TOO_LARGE: 'err_media_too_large',
        NO_SPEECH: 'err_no_speech',
        LIVE_STREAM: 'err_live_stream',
        VIDEO_NOT_ACCESSIBLE: 'err_video_not_accessible',
        VIDEO_TOO_LONG_NO_CAPTIONS: 'err_video_too_long_no_captions',
        VIDEO_CAPTIONS_FAILED: 'err_captions_failed',
        TRANSCRIBE_TIMEOUT: 'err_transcribe_timeout',
        BLOCKED_URL: 'err_blocked_url',
        INSUFFICIENT_CONTENT: 'err_insufficient_content',
        TRANSCRIBE_BUSY: 'err_transcribe_busy',
        TRANSCRIBE_DAILY_LIMIT: 'err_transcribe_daily_limit',
        TRANSCRIBE_MINUTES_LIMIT: 'err_transcribe_minutes_limit',
        ASYNC_UNAVAILABLE: 'err_transcribe_generic',
        TRANSCRIBE_ERROR: 'err_transcribe_generic',
        TRANSCRIPTION_FAILED: 'err_transcribe_generic',
        MEDIA_FETCH_FAILED: 'err_transcribe_generic',
        TOO_LONG: 'err_too_long',
        BOT_CHALLENGE: 'err_bot_challenge'
    };

    // Pattern testuali (messaggi non strutturati provenienti dal backend o dalla rete).
    const ERROR_PATTERN_KEYS = [
        [/TOO_LONG/, 'err_too_long'],
        [/just a moment|checking your browser|challenge/i, 'err_bot_challenge'],
        [/INVALID_OPENAI_RESPONSE|non utilizzabile|Risposta OpenAI non valida/i, 'err_invalid_response'],
        [/autenticat|login|AUTH_REQUIRED/i, 'err_auth_required'],
        [/troppo breve|sufficiente|INSUFFICIENT|INVALID_TRANSCRIPT/i, 'err_insufficient_text'],
        [/504|timeout|tempo|scadut/i, 'err_timeout'],
        [/non raggiungibile|Failed to fetch|network|URL_NOT_ACCESSIBLE/i, 'err_network']
    ];

    // Converte un errore tecnico nel messaggio localizzato da mostrare all'utente.
    function toUserFacingError(raw) {
        const msg = String(raw || '').trim();
        if (ERROR_CODE_KEYS[msg]) return t(ERROR_CODE_KEYS[msg]);
        // Messaggio gia' destinato all'utente (quota/premium): passa invariato.
        if (/limite|premium|upgrade|limit reached/i.test(msg) && msg.length > 20) return msg;
        for (const [re, key] of ERROR_PATTERN_KEYS) {
            if (re.test(msg)) return t(key);
        }
        return t('err_generic', undefined, "The summary couldn't be generated. Please try again shortly.");
    }

    // Risolve QUALE fonte riassumere ed esegue il recupero, popolando requestBody.
    //
    // Stadi: probe (DOM) -> decisione pura (source-decision.js) -> esecuzione.
    // La catena di degrado (fallimento sottotitoli, STT non disponibile, gate premium)
    // è implementata RI-DECIDENDO su un inventario ridotto: ogni fallimento rimuove
    // la fonte che non ha funzionato, quindi la catena termina sempre e riusa la
    // logica di decisione già testata.
    // `forceSource` ('video'|'text') bypassa la scelta automatica (pulsante di switch).
    async function resolveSummarySource(page, requestBody, forceSource) {
        const RI = window.RI_SOURCE;
        const notes = [];
        if (!RI) {
            // Modulo di decisione assente (build incompleta): comportamento minimo sul testo.
            if (page.text && page.text.length >= 50) {
                requestBody.text = page.text;
                if (page.title) requestBody.title = page.title;
                return { ok: true, source: 'text', notes };
            }
            return { ok: false, code: 'INSUFFICIENT_CONTENT', notes };
        }

        // Il server e' l'autorita' sui limiti: si allineano prima di decidere, cosi'
        // un override attivo sull'ambiente distribuito viene rispettato anche dal
        // browser (i valori nel pacchetto sono i default del build).
        try {
            const srv = await chrome.runtime.sendMessage({ action: 'getServerLimits' });
            if (srv && srv.success && srv.limits) RI.applyServerLimits(srv.limits);
        } catch (e) { /* restano i valori generati */ }

        let stored = {};
        try { stored = await chrome.storage.local.get(['user']); } catch { /* storage non disponibile */ }
        // Il piano è autoritativo lato backend (non è nel JWT): qui è solo un
        // suggerimento per evitare round-trip inutili. Se assente si tenta.
        let plan = stored?.user?.plan === 'free' ? 'free' : 'premium';
        const inventory = probePageContent(page);
        const alternative = computeAlternative(inventory, page);

        if (forceSource === 'text') {
            if (page.text && page.text.length >= 50) {
                requestBody.text = page.text;
                if (page.title) requestBody.title = page.title;
                if (page.truncated) requestBody.truncated = true;
                return { ok: true, source: 'text', notes, alternative };
            }
            return { ok: false, code: 'INSUFFICIENT_CONTENT', notes };
        }
        if (forceSource === 'video') {
            // Ignora il testo per forzare il ramo video della decisione.
            inventory.text = { len: 0, rawLen: 0, title: inventory.text.title };
        }

        let decision = RI.decideSummarySource(inventory, { userLang: requestBody.lang, plan, asyncAvailable: true });
        // Limite di iterazioni: l'inventario si riduce a ogni degrado (tracce, media, piano).
        const maxSteps = (inventory.video.captionTracks || []).length + 4;

        for (let step = 0; step < maxSteps; step++) {
            const redecide = () => RI.decideSummarySource(inventory, { userLang: requestBody.lang, plan, asyncAvailable: true });

            if (decision.action === 'VIDEO_CAPTIONS') {
                const res = await chrome.runtime.sendMessage({ action: 'fetchCaptions', trackUrl: decision.trackUrl });
                const text = res && res.success ? String(res.text || '') : '';
                if (text.length >= 50) {
                    requestBody.transcript = text.slice(0, RI.CONSTANTS.MAX_TRANSCRIPT_CHARS);
                    if (text.length > RI.CONSTANTS.MAX_TRANSCRIPT_CHARS) {
                        requestBody.truncated = true;
                        notes.push('TRANSCRIPT_TRUNCATED');
                    }
                    requestBody.title = mediaTitle(page.title);
                    if (decision.trackLang && requestBody.lang && decision.trackLang.slice(0, 2) !== requestBody.lang.slice(0, 2)) {
                        notes.push('CAPTIONS_TRANSLATED');
                    }
                    return { ok: true, source: 'video', notes, alternative };
                }
                // Degrado: scarta questa traccia (URL firmato scaduto, rete, VTT vuoto).
                notes.push('CAPTIONS_FAILED');
                inventory.video.captionTracks = (inventory.video.captionTracks || []).filter((t) => t.url !== decision.trackUrl);
                decision = redecide();
                continue;
            }

            if (decision.action === 'VIDEO_STT' || decision.action === 'VIDEO_STT_ASYNC') {
                const isAsync = decision.action === 'VIDEO_STT_ASYNC';
                const res = isAsync
                    ? await runAsyncTranscription(decision.mediaUrl, requestBody.lang)
                    : await chrome.runtime.sendMessage({ action: 'transcribeMedia', mediaUrl: decision.mediaUrl, lang: requestBody.lang });
                const text = res && res.success ? String(res.transcript || '') : '';
                if (text.length >= 50) {
                    requestBody.transcript = text.slice(0, RI.CONSTANTS.MAX_TRANSCRIPT_CHARS);
                    if (text.length > RI.CONSTANTS.MAX_TRANSCRIPT_CHARS) {
                        requestBody.truncated = true;
                        notes.push('TRANSCRIPT_TRUNCATED');
                    }
                    // Il backend segnala se parte del video non e' stata trascritta:
                    // va detto, altrimenti il riassunto sembra completo e non lo e'.
                    if (res && res.partial) {
                        requestBody.truncated = true;
                        notes.push('TRANSCRIPT_PARTIAL');
                    }
                    requestBody.title = mediaTitle(page.title);
                    return { ok: true, source: 'video', notes, alternative };
                }
                // Gate premium: il backend è autoritativo, il suggerimento locale era sbagliato.
                if (res && (res.code === 'PREMIUM_REQUIRED' || res.status === 403)) {
                    plan = 'free';
                    decision = redecide();
                    continue;
                }
                notes.push('STT_FAILED');
                inventory.video.directMedia = null;
                decision = redecide();
                continue;
            }

            if (decision.action === 'TEXT') {
                if (decision.note) notes.push(decision.note);
                if (page.text && page.text.length >= 50) {
                    requestBody.text = page.text;
                    if (page.title) requestBody.title = page.title;
                    if (page.truncated) requestBody.truncated = true;
                    return { ok: true, source: 'text', notes, alternative };
                }
                // Il testo non è più utilizzabile: azzera e ri-decidi (finirà in UNSUPPORTED).
                inventory.text = { len: 0, rawLen: inventory.text.rawLen, title: inventory.text.title };
                decision = redecide();
                continue;
            }

            // UNSUPPORTED
            return { ok: false, code: decision.code, notes };
        }
        return { ok: false, code: 'INSUFFICIENT_CONTENT', notes };
    }

    // Fonte alternativa disponibile, per il pulsante di switch nella modale (buco A).
    function computeAlternative(inventory, page) {
        const hasVideo = Boolean(inventory.video.present &&
            ((inventory.video.captionTracks || []).length || inventory.video.directMedia));
        const hasText = (page.text || '').length >= 50;
        return { video: hasVideo, text: hasText };
    }

    // Trascrizione asincrona (video lunghi/HLS): avvia un job e ne segue lo stato.
    // Il polling vive nel content script così la modale può mostrare il progresso.
    async function runAsyncTranscription(mediaUrl, lang) {
        const start = await chrome.runtime.sendMessage({ action: 'startTranscribeJob', mediaUrl, lang });
        if (!start || !start.success || !start.jobId) {
            return { success: false, code: start && start.code ? start.code : 'TRANSCRIBE_ERROR', status: start && start.status };
        }
        setModalProgress(t('modal_transcribing', undefined, 'Transcribing the video…'));
        const deadline = Date.now() + 10 * 60 * 1000; // 10 min
        let delay = 3000;
        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, delay));
            delay = Math.min(delay * 1.3, 10000);
            const st = await chrome.runtime.sendMessage({ action: 'transcribeJobStatus', jobId: start.jobId });
            if (!st || !st.success) continue;
            if (st.status === 'done') return { success: true, transcript: st.transcript, partial: Boolean(st.partial) };
            if (st.status === 'error') return { success: false, code: st.code || 'TRANSCRIBE_ERROR' };
            if (st.progress) setModalProgress(t('modal_transcribing_progress', [String(st.progress)]));
        }
        return { success: false, code: 'TRANSCRIBE_TIMEOUT' };
    }

    // Aggiorna il testo di stato nella modale di caricamento (se presente).
    // L'URL proviene dalla pagina visitata, quindi e' un valore non fidato: va
    // sempre escapato. Senza il fallback, una modale aperta prima di conoscere
    // l'URL mostrava la stringa "undefined".
    // Un href non escapato accetta anche `javascript:`: cliccarlo eseguirebbe codice.
    // Si ammettono solo http/https, e sia l'attributo sia il testo passano da esc().
    function safeLink(u, cls) {
        const raw = String(u || '');
        if (!raw) return '';
        let parsed;
        try { parsed = new URL(raw); } catch { return `<span>${esc(shortUrl(raw))}</span>`; }
        if (!['http:', 'https:'].includes(parsed.protocol)) return `<span>${esc(shortUrl(raw))}</span>`;
        const label = cls ? parsed.hostname.replace(/^www\./, '') : shortUrl(parsed.href);
        return `<a${cls ? ` class="${cls}"` : ''} href="${esc(parsed.href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
    }

    function shortUrl(u) {
        const s = String(u || '');
        return s.length > 90 ? `${s.slice(0, 87)}…` : s;
    }

    // Nome prodotto del brand corrente: i sorgenti sono condivisi fra 5 brand, quindi
    // nessuna stringa visibile puo' essere fissa. brand-config.js e' caricato prima.
    function brandTitle() {
        const b = globalThis.__BRAND__;
        return (b && (b.storeName || b.displayName)) || 'LemonSqueezer - TL;DR';
    }

    function setModalProgress(message) {
        try {
            const el = document.querySelector('#lemonsqueezer-modal .lemonsqueezer-loading-text');
            if (el) el.textContent = message;
        } catch { /* modale non presente */ }
    }

    // Funzione per aprire la modale dal popup e avviare il riassunto
    async function openSummaryModal(request) {
        console.log('[CONTENT] openSummaryModal chiamata:', request);
        const requestId = request.requestId || crypto.randomUUID();
        const requestedUrl = request.url;
        activeSummaryRequestId = requestId;
        // Fonte effettivamente riassunta (trasparenza in UI) + note di degrado.
        let sourceUsed = null;
        let sourceNotes = [];
        let sourceAlternative = null;
        
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
                lang: request.lang || 'it',
                summaryProfile: request.summaryProfile || 'standard',
                summaryModel: request.summaryModel || 'gpt-5-nano'
            };
            if ([10, 20, 50].includes(Number(request.squeeze))) {
                requestBody.squeeze = Number(request.squeeze);
            }
            // Memorizza i parametri per il pulsante di switch fonte.
            lastSummaryRequest = { lang: requestBody.lang, summaryProfile: requestBody.summaryProfile, squeeze: requestBody.squeeze };

            if (isYouTubeVideoUrl(request.url)) {
                const transcript = await getYouTubeTranscript();
                if (!transcript) {
                    throw new Error('YouTube: estrazione terminata senza risultato diagnostico');
                }
                requestBody.transcript = transcript.text;
                requestBody.title = transcript.title;
                requestBody.transcriptLanguage = transcript.language;
                requestBody.videoDurationSeconds = transcript.durationSeconds;
                // Descrizione + commenti: nucleo (transcript+descrizione) e 1 bullet
                // di sintesi commenti. Opzionali: un fallimento non blocca il riassunto.
                try {
                    const extras = await chrome.runtime.sendMessage({ action: 'getYouTubeVideoExtras' });
                    if (extras?.description) requestBody.description = extras.description;
                    if (Array.isArray(extras?.comments) && extras.comments.length) {
                        requestBody.comments = extras.comments;
                    }
                } catch (extrasError) {
                    console.warn('[CONTENT] Extra YouTube non disponibili:', extrasError);
                }
            } else if (request.url === window.location.href) {
                // Riassunto della pagina corrente: estrai il testo dal DOM renderizzato.
                // Per un link diverso (menu contestuale) il DOM di questa pagina non
                // corrisponde all'URL, quindi si lascia che il backend faccia il fetch.
                let handled = false;
                // Reddit: estrattore dedicato (post + commenti) via API .json.
                if (isRedditUrl(request.url)) {
                    try {
                        const reddit = await getRedditContent();
                        if (reddit && reddit.text.length >= 50) {
                            requestBody.text = reddit.text;
                            requestBody.title = reddit.title;
                            handled = true;
                        }
                    } catch (e) { console.warn('[CONTENT] Reddit estrazione fallita, fallback generico:', e); }
                }
                // Hacker News: estrattore dedicato (story + commenti) via API.
                if (!handled && isHackerNewsUrl(request.url)) {
                    try {
                        const hn = await getHackerNewsContent();
                        if (hn && hn.text.length >= 50) {
                            requestBody.text = hn.text;
                            requestBody.title = hn.title;
                            handled = true;
                        }
                    } catch (e) { console.warn('[CONTENT] HN estrazione fallita, fallback generico:', e); }
                }
                if (!handled) {
                    let page = extractReadablePageContent();
                    // SPA non ancora renderizzata: se il testo è insufficiente, attendi e riprova una volta.
                    if ((!page.text || page.text.length < 50) && !detectBlockedContent(page.text)) {
                        await new Promise((r) => setTimeout(r, 1200));
                        page = extractReadablePageContent();
                    }
                    const resolved = await resolveSummarySource(page, requestBody, request.forceSource);
                    if (!resolved.ok) {
                        updateModalWithError({ error: resolved.code, notes: resolved.notes });
                        return;
                    }
                    sourceUsed = resolved.source;
                    sourceNotes = resolved.notes;
                    sourceAlternative = resolved.alternative;
                }
            }

            // La chiamata parte dal service worker: un fetch eseguito dal
            // content script eredita l'origine della pagina e viene bloccato
            // dal CORS del sito visitato (per esempio youtube.com).
            const apiResult = await chrome.runtime.sendMessage({
                action: 'summarizePageData',
                requestBody
            });

            if (!apiResult?.success) {
                if (apiResult?.status === 429) {
                    throw new Error(t('err_quota_reached'));
                }
                throw new Error(apiResult?.error || 'Backend non raggiungibile');
            }

            // A navigation or a newer click can complete while the backend is
            // working. Never render that stale answer into the current tab.
            if (activeSummaryRequestId !== requestId || window.location.href !== requestedUrl) {
                console.warn('[CONTENT] Risposta ignorata: richiesta non piu attiva', { requestId, requestedUrl });
                return;
            }

            const dataRaw = apiResult.data;
            console.log('[CONTENT] Dati ricevuti (raw):', dataRaw);

            // Output brand-specifico (schema != summary, es. Scout "attention"):
            // renderer dedicato. Lo schema summary (Lemon) prosegue sotto invariato.
            if (dataRaw && dataRaw.output && !dataRaw.summary) {
                updateModalWithBrandOutput(dataRaw);
                return;
            }

            // Normalizza e fornisce fallback per campi mancanti
            const data = Object.assign({}, dataRaw);
            // Contenuto troncato lato client: segnalalo nella modale.
            if (requestBody.truncated) data.truncated = true;
            // Campi solo-client: fonte usata, note di degrado, switch disponibile.
            data.__source = sourceUsed;
            data.__notes = sourceNotes;
            data.__alternative = sourceAlternative;

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
            await saveSummaryHistory(data);
            
            // Aggiorna modale con risultato normalizzato
            updateModalWithResult(data);
            
        } catch (error) {
            console.error('[CONTENT] Errore riassunto:', error);
            if (activeSummaryRequestId === requestId) {
                updateModalWithError({ error: error.message });
            }
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

    async function saveSummaryHistory(data) {
        try {
            const entry = {
                timestamp: Date.now(),
                title: data.title || t('modal_summary'),
                url: data.originalUrl || window.location.href,
                cached: Boolean(data.cached),
                sourceType: data.sourceType || 'web',
                // Il testo resta salvato: dalla cronologia si riapre il riassunto, non solo la pagina.
                summary: data.summary || data.text || '',
                output: data.output && typeof data.output === 'object' ? data.output : null,
                truncated: Boolean(data.truncated),
                stats: data.stats ? { originalWords: data.stats.originalWords || 0, summaryWords: data.stats.summaryWords || 0 } : null
            };
            const { summaryHistory = [] } = await chrome.storage.local.get(['summaryHistory']);
            const withoutDuplicate = summaryHistory.filter((existing) => existing.url !== entry.url);
            withoutDuplicate.unshift(entry);
            await chrome.storage.local.set({ summaryHistory: withoutDuplicate.slice(0, 50) });
        } catch (error) {
            console.error('[CONTENT] Errore salvataggio cronologia:', error);
        }
    }
    
})();
