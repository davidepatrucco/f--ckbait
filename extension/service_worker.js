// service_worker.js - Service Worker per l'estensione LemonSqueezer

// Config del brand (iniettata da brand-config.js). Determina l'header X-Brand.
try { importScripts('browser-polyfill.js', 'brand-config.js'); } catch (e) { console.warn('brand-config/polyfill non caricati via importScripts (atteso su event-page):', e?.message); }
const BRAND_ID = (self.__BRAND__ && self.__BRAND__.apiBrand) || 'lemonsqueezer';

// Event listener per l'installazione
const API_BASE = 'https://4jo5gamel9.execute-api.eu-west-1.amazonaws.com/dev';

// Emette un evento funnel al backend (best-effort, non blocca, no contenuto).
async function emitClientEvent(eventType, authToken) {
    try {
        await fetch(`${API_BASE}/analytics/event`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Brand': BRAND_ID,
                'X-Client': 'browser-extension',
                ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
            },
            body: JSON.stringify({ event_type: eventType })
        });
    } catch (e) { /* funnel best-effort */ }
}

chrome.runtime.onInstalled.addListener((details) => {
    console.log('LemonSqueezer installato:', details.reason);
    if (details.reason === 'install') emitClientEvent('extension_installed');

    // Inizializza la configurazione di default
    chrome.storage.local.set({
        language: 'it',
        // apiKey e apiUrl saranno inseriti dall'utente
    });
    
    // Crea il context menu per i link. removeAll prima di create rende l'handler
    // idempotente: onInstalled scatta anche sugli update/reload, dove l'id esiste
    // già (altrimenti: "Cannot create item with duplicate id summarize-link").
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: 'summarize-link',
            title: 'Riassumi questo link',
            contexts: ['link'],
            documentUrlPatterns: ['http://*/*', 'https://*/*']
        });
    });
});

// Event listener per l'avvio
chrome.runtime.onStartup.addListener(() => {
    console.log('LemonSqueezer avviato');
});

// Event listener per i messaggi dal popup o content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getPageContent') {
        // Gestisce la richiesta di contenuto della pagina
        handleGetPageContent(request, sender, sendResponse);
        return true; // Mantiene il canale di risposta aperto per chiamate asincrone
    }
    
    if (request.action === 'summarize') {
        // Gestisce la richiesta di riassunto
        handleSummarize(request, sender, sendResponse);
        return true;
    }
    
    if (request.action === 'summarizeUrl') {
        // Gestisce la richiesta di riassunto di un URL
        handleSummarizeUrl(request, sender, sendResponse);
        return true;
    }
    
    if (request.action === 'googleLogin') {
        // Gestisce il login Google OAuth
        handleGoogleLogin(request, sender, sendResponse);
        return true;
    }

    if (request.action === 'getYouTubeCaptionTracks') {
        getYouTubeCaptionTracks(sender, sendResponse);
        return true;
    }

    if (request.action === 'getYouTubeCaptionText') {
        getYouTubeCaptionText(request, sender, sendResponse);
        return true;
    }

    if (request.action === 'getYouTubeTranscriptText') {
        getYouTubeTranscriptText(sender, sendResponse);
        return true;
    }

    if (request.action === 'getYouTubeVideoExtras') {
        getYouTubeVideoExtras(sender, sendResponse);
        return true;
    }

    if (request.action === 'summarizePageData') {
        summarizePageData(request, sendResponse);
        return true;
    }
});

async function summarizePageData(request, sendResponse) {
    try {
        const { authToken } = await chrome.storage.local.get(['authToken']);
        if (!authToken) {
            sendResponse({ success: false, status: 401, error: 'Utente non autenticato' });
            return;
        }

        const response = await fetch('https://4jo5gamel9.execute-api.eu-west-1.amazonaws.com/dev/summarize-url', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
                'X-Brand': BRAND_ID
            },
            body: JSON.stringify(request.requestBody || {})
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            sendResponse({
                success: false,
                status: response.status,
                error: payload.error || `HTTP ${response.status}`
            });
            return;
        }
        sendResponse({ success: true, status: response.status, data: payload });
    } catch (error) {
        console.error('[SUMMARY API] Errore fetch dal service worker:', error);
        sendResponse({ success: false, error: `Backend non raggiungibile: ${error.message}` });
    }
}

async function getYouTubeCaptionTracks(sender, sendResponse) {
    try {
        if (!sender.tab?.id) throw new Error('Richiesta trascrizione senza tab');
        const [{ result: tracks = [] } = {}] = await chrome.scripting.executeScript({
            target: { tabId: sender.tab.id },
            world: 'MAIN',
            func: async () => {
                const extractTracks = (response) => response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
                const currentVideoId = new URL(location.href).searchParams.get('v') ||
                    location.pathname.match(/^\/(?:shorts|live)\/([^/?]+)/)?.[1] || '';
                const isCurrentPlayer = (response) => !currentVideoId ||
                    !response?.videoDetails?.videoId || response.videoDetails.videoId === currentVideoId;
                let captionTracks = isCurrentPlayer(window.ytInitialPlayerResponse)
                    ? extractTracks(window.ytInitialPlayerResponse) : [];
                let durationSeconds = isCurrentPlayer(window.ytInitialPlayerResponse)
                    ? Number(window.ytInitialPlayerResponse?.videoDetails?.lengthSeconds || 0) : 0;

                if (!captionTracks.length) {
                    try {
                        const serializedResponse = window.ytplayer?.config?.args?.player_response;
                        const player = JSON.parse(serializedResponse || '{}');
                        if (isCurrentPlayer(player)) captionTracks = extractTracks(player);
                    } catch {
                        // Keep searching the initial player payload below.
                    }
                }

                if (!captionTracks.length) {
                    const scriptText = Array.from(document.scripts)
                        .map((script) => script.textContent || '')
                        .find((text) => text.includes('"captionTracks"'));
                    const marker = scriptText?.indexOf('"captionTracks"') ?? -1;
                    const start = marker >= 0 ? scriptText.indexOf('[', marker) : -1;
                    if (start >= 0) {
                        let depth = 0;
                        let string = false;
                        let escaped = false;
                        for (let index = start; index < scriptText.length; index += 1) {
                            const character = scriptText[index];
                            if (string) {
                                if (escaped) escaped = false;
                                else if (character === '\\') escaped = true;
                                else if (character === '"') string = false;
                            } else if (character === '"') string = true;
                            else if (character === '[') depth += 1;
                            else if (character === ']' && --depth === 0) {
                                try { captionTracks = JSON.parse(scriptText.slice(start, index + 1)); } catch { /* no tracks */ }
                                break;
                            }
                        }
                    }
                }

                // YouTube may omit the player response from page globals even
                // when captions exist. Query the same structured player API
                // used by the page, in its own authenticated origin context.
                if (!captionTracks.length) {
                    try {
                        const videoId = new URL(location.href).searchParams.get('v') ||
                            location.pathname.match(/^\/(?:shorts|live)\/([^/?]+)/)?.[1];
                        const apiKey = window.ytcfg?.get?.('INNERTUBE_API_KEY');
                        const clientVersion = window.ytcfg?.get?.('INNERTUBE_CLIENT_VERSION');
                        if (videoId && apiKey && clientVersion) {
                            const playerResponse = await fetch(`/youtubei/v1/player?prettyPrint=false&key=${encodeURIComponent(apiKey)}`, {
                                method: 'POST',
                                headers: {
                                    'content-type': 'application/json',
                                    'x-youtube-client-name': '1',
                                    'x-youtube-client-version': clientVersion
                                },
                                body: JSON.stringify({
                                    videoId,
                                    context: { client: { clientName: 'WEB', clientVersion } }
                                })
                            });
                            if (playerResponse.ok) {
                                const player = await playerResponse.json();
                                captionTracks = extractTracks(player);
                                durationSeconds = Number(player?.videoDetails?.lengthSeconds || durationSeconds);
                            }
                        }
                    } catch {
                        // The primary player payload remains the preferred path.
                    }
                }
                return {
                    tracks: captionTracks.map(({ baseUrl, languageCode, name }) => ({
                        baseUrl,
                        languageCode,
                        name: name?.simpleText || name?.runs?.map((run) => run.text).join('') || ''
                    })),
                    durationSeconds
                };
            }
        });
        const extractedTracks = tracks.tracks || [];
        console.log('[YT CAPTIONS] Risultato estrazione player:', {
            tabId: sender.tab.id,
            trackCount: extractedTracks.length,
            languages: extractedTracks.map((track) => track.languageCode),
            durationSeconds: tracks.durationSeconds || 0
        });
        sendResponse({ success: true, tracks: extractedTracks, durationSeconds: tracks.durationSeconds || 0 });
    } catch (error) {
        console.error('[YT CAPTIONS] Errore lettura tracce:', error);
        sendResponse({ success: false, tracks: [], error: error.message });
    }
}

// Estrae, dal contesto MAIN della pagina YouTube, la descrizione del video e una
// campionatura dei commenti. Best-effort: qualsiasi fallimento restituisce vuoto,
// senza mai bloccare il riassunto (transcript resta la fonte primaria).
async function getYouTubeVideoExtras(sender, sendResponse) {
    try {
        if (!sender.tab?.id) throw new Error('Richiesta extra senza tab');
        const [{ result } = {}] = await chrome.scripting.executeScript({
            target: { tabId: sender.tab.id },
            world: 'MAIN',
            func: async () => {
                const out = { description: '', comments: [] };
                try {
                    out.description = window.ytInitialPlayerResponse?.videoDetails?.shortDescription || '';
                } catch { /* descrizione non disponibile */ }

                try {
                    const apiKey = window.ytcfg?.get?.('INNERTUBE_API_KEY');
                    const clientVersion = window.ytcfg?.get?.('INNERTUBE_CLIENT_VERSION');

                    // Trova il token di continuation della sezione commenti in ytInitialData.
                    const findCommentsToken = (root) => {
                        const stack = [root];
                        while (stack.length) {
                            const node = stack.pop();
                            if (!node || typeof node !== 'object') continue;
                            const isr = node.itemSectionRenderer;
                            if (isr && isr.sectionIdentifier === 'comment-item-section') {
                                const token = isr.contents?.[0]?.continuationItemRenderer
                                    ?.continuationEndpoint?.continuationCommand?.token;
                                if (token) return token;
                            }
                            for (const key in node) {
                                const value = node[key];
                                if (value && typeof value === 'object') stack.push(value);
                            }
                        }
                        return null;
                    };

                    const token = findCommentsToken(window.ytInitialData);
                    if (apiKey && clientVersion && token) {
                        const res = await fetch(`/youtubei/v1/next?prettyPrint=false&key=${encodeURIComponent(apiKey)}`, {
                            method: 'POST',
                            headers: {
                                'content-type': 'application/json',
                                'x-youtube-client-name': '1',
                                'x-youtube-client-version': clientVersion
                            },
                            body: JSON.stringify({
                                context: { client: { clientName: 'WEB', clientVersion } },
                                continuation: token
                            })
                        });
                        if (res.ok) {
                            const data = await res.json();
                            const texts = [];
                            const walk = (node) => {
                                if (!node || typeof node !== 'object' || texts.length >= 50) return;
                                const modern = node.commentEntityPayload?.properties?.content?.content;
                                const legacy = node.commentRenderer?.contentText?.runs
                                    ?.map((run) => run.text).join('');
                                const value = modern || legacy;
                                if (value && typeof value === 'string') texts.push(value.trim());
                                for (const key in node) {
                                    const child = node[key];
                                    if (child && typeof child === 'object') walk(child);
                                }
                            };
                            walk(data);
                            out.comments = texts.filter(Boolean).slice(0, 50);
                        }
                    }
                } catch { /* commenti non disponibili o disabilitati */ }

                return out;
            }
        });
        sendResponse({ success: true, description: result?.description || '', comments: result?.comments || [] });
    } catch (error) {
        console.warn('[YT EXTRAS] Estrazione descrizione/commenti fallita:', error?.message);
        sendResponse({ success: false, description: '', comments: [], error: error?.message });
    }
}

async function getYouTubeCaptionText(request, sender, sendResponse) {
    try {
        if (!sender.tab?.id) throw new Error('Richiesta trascrizione senza tab');
        const captionUrl = new URL(request.baseUrl);
        if (!captionUrl.hostname.endsWith('youtube.com')) throw new Error('Host caption non valido');
        const [{ result = {} } = {}] = await chrome.scripting.executeScript({
            target: { tabId: sender.tab.id },
            world: 'MAIN',
            args: [captionUrl.toString()],
            func: async (url) => {
                const response = await fetch(url, { credentials: 'include' });
                return {
                    ok: response.ok,
                    status: response.status,
                    contentType: response.headers.get('content-type') || '',
                    text: await response.text()
                };
            }
        });

        console.log('[YT CAPTIONS] Download nel contesto YouTube:', {
            status: result.status,
            contentType: result.contentType,
            characters: result.text?.length || 0
        });
        sendResponse({ success: Boolean(result.ok), ...result });
    } catch (error) {
        console.error('[YT CAPTIONS] Errore download traccia:', error);
        sendResponse({ success: false, error: error.message });
    }
}

async function getYouTubeTranscriptText(sender, sendResponse) {
    try {
        if (!sender.tab?.id) throw new Error('Richiesta trascrizione senza tab');
        const [{ result = {} } = {}] = await chrome.scripting.executeScript({
            target: { tabId: sender.tab.id },
            world: 'MAIN',
            func: async () => {
                const currentVideoId = new URL(location.href).searchParams.get('v') ||
                    location.pathname.match(/^\/(?:shorts|live)\/([^/?]+)/)?.[1] || '';
                const decodeParams = (params) => {
                    try {
                        let value = String(params).replace(/-/g, '+').replace(/_/g, '/');
                        value += '='.repeat((4 - value.length % 4) % 4);
                        return atob(value);
                    } catch {
                        return '';
                    }
                };
                const belongsToCurrentVideo = (params) => !currentVideoId || decodeParams(params).includes(currentVideoId);
                const findTranscriptEndpoint = (root) => {
                    const seen = new WeakSet();
                    const visit = (value) => {
                        if (!value || typeof value !== 'object' || seen.has(value)) return null;
                        seen.add(value);
                        if (typeof value.getTranscriptEndpoint?.params === 'string' &&
                            belongsToCurrentVideo(value.getTranscriptEndpoint.params)) {
                            return {
                                params: value.getTranscriptEndpoint.params,
                                clickTrackingParams: value.clickTrackingParams || null
                            };
                        }
                        for (const child of Object.values(value)) {
                            const found = visit(child);
                            if (found) return found;
                        }
                        return null;
                    };
                    return visit(root);
                };
                const findModernTranscriptPanel = (root) => {
                    const seen = new WeakSet();
                    const visit = (value) => {
                        if (!value || typeof value !== 'object' || seen.has(value)) return null;
                        seen.add(value);
                        const command = value.updateEngagementPanelContentCommand;
                        const panelId = command?.contentSourcePanelIdentifier?.tag;
                        const params = command?.globalConfiguration?.params;
                        if (typeof panelId === 'string' && /transcript/i.test(panelId) &&
                            (typeof params !== 'string' || belongsToCurrentVideo(params))) {
                            return {
                                panelId,
                                params,
                                clickTrackingParams: value.clickTrackingParams || null
                            };
                        }
                        for (const child of Object.values(value)) {
                            const found = visit(child);
                            if (found) return found;
                        }
                        return null;
                    };
                    return visit(root);
                };
                const collectSegments = (root) => {
                    const segments = [];
                    const seen = new WeakSet();
                    const visit = (value) => {
                        if (!value || typeof value !== 'object' || seen.has(value)) return;
                        seen.add(value);
                        const renderer = value.transcriptSegmentRenderer;
                        if (renderer?.snippet?.runs) {
                            segments.push(renderer.snippet.runs.map((run) => run.text || '').join(''));
                            return;
                        }
                        for (const child of Object.values(value)) visit(child);
                    };
                    visit(root);
                    return segments.join(' ').replace(/\s+/g, ' ').trim();
                };
                const collectModernSegments = (root) => {
                    const segments = [];
                    const seenObjects = new WeakSet();
                    const seenSegments = new Set();
                    const visit = (value) => {
                        if (!value || typeof value !== 'object' || seenObjects.has(value)) return;
                        seenObjects.add(value);
                        const segment = value.transcriptSegmentViewModel;
                        if (typeof segment?.simpleText === 'string') {
                            const text = segment.simpleText.replace(/\s+/g, ' ').trim();
                            const key = `${segment.timestamp || ''}\u0000${text}`;
                            if (text && !seenSegments.has(key)) {
                                seenSegments.add(key);
                                segments.push(text);
                            }
                        }
                        for (const child of Object.values(value)) visit(child);
                    };
                    visit(root);
                    return segments.join(' ').replace(/\s+/g, ' ').trim();
                };
                const collectRenderedTranscript = () => Array.from(document.querySelectorAll(
                    'ytd-transcript-segment-renderer, yt-transcript-segment-view-model, ' +
                    'transcript-segment-view-model'
                )).map((element) => (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim())
                    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
                const buildModernPanelParams = (videoId) => {
                    if (!videoId) return '';
                    const bytes = [0xaa, 0x09, 0x0f, 0x0a, videoId.length, ...Array.from(videoId, (char) => char.charCodeAt(0)), 0x18, 0x01];
                    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
                };

                const findCurrentPanel = () => {
                    const roots = [window.ytInitialData];
                    for (const element of document.querySelectorAll(
                        'ytd-video-description-transcript-section-renderer, ' +
                        'ytd-engagement-panel-section-list-renderer, ' +
                        'ytd-engagement-panel-title-header-renderer, ' +
                        'ytd-transcript-renderer'
                    )) {
                        if (element.data && typeof element.data === 'object') roots.push(element.data);
                    }
                    return roots.map(findModernTranscriptPanel).find(Boolean) || null;
                };
                // YouTube is an SPA: after clicking another video, old globals can
                // remain for a short time. Never send the previous video's params.
                let modernPanel = findCurrentPanel();
                let transcriptClicked = false;
                const clickTranscriptButton = () => {
                    const candidates = Array.from(document.querySelectorAll(
                        'ytd-video-description-transcript-section-renderer button, ' +
                        'ytd-video-description-transcript-section-renderer ytd-button-renderer, ' +
                        'button'
                    )).filter((button) => /mostra trascrizione|show transcript/i.test(button.innerText || button.textContent || ''));
                    const transcriptButton = candidates.find((button) => button.offsetParent !== null) || candidates[0];
                    if (transcriptButton) {
                        transcriptButton.click();
                        transcriptButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                        transcriptClicked = true;
                    }
                };
                for (let attempt = 0; !modernPanel && attempt < 80; attempt += 1) {
                    if (!transcriptClicked || attempt % 10 === 0) clickTranscriptButton();
                    modernPanel = findCurrentPanel();
                    if (modernPanel) break;
                    await new Promise((resolve) => setTimeout(resolve, 150));
                }
                // Newer YouTube pages expose only the searchable-transcript tag
                // without params. The PAmodern params are a stable protobuf envelope
                // containing the current video ID; generate it directly so extraction
                // does not depend on opening the side panel.
                if (modernPanel && !modernPanel.params && currentVideoId) {
                    modernPanel = {
                        panelId: 'PAmodern_transcript_view',
                        params: buildModernPanelParams(currentVideoId),
                        clickTrackingParams: modernPanel.clickTrackingParams
                    };
                } else if (!modernPanel && currentVideoId) {
                    modernPanel = {
                        panelId: 'PAmodern_transcript_view',
                        params: buildModernPanelParams(currentVideoId),
                        clickTrackingParams: null
                    };
                }
                // Some videos use the searchable transcript panel. Its command
                // intentionally has no params and the rendered panel is the
                // authoritative source after the button is activated.
                if (modernPanel && !modernPanel.params) {
                    if (!transcriptClicked) clickTranscriptButton();
                    for (let attempt = 0; attempt < 40; attempt += 1) {
                        const renderedText = collectRenderedTranscript();
                        if (renderedText.length >= 50) {
                            return {
                                ok: true,
                                text: renderedText,
                                characters: renderedText.length,
                                source: 'rendered-transcript',
                                videoId: currentVideoId
                            };
                        }
                        const refreshedPanel = findCurrentPanel();
                        if (refreshedPanel?.params) {
                            modernPanel = refreshedPanel;
                            break;
                        }
                        await new Promise((resolve) => setTimeout(resolve, 150));
                    }
                }
                const endpoint = findTranscriptEndpoint(window.ytInitialData) ||
                    findTranscriptEndpoint(window.ytInitialPlayerResponse);
                const apiKey = window.ytcfg?.get?.('INNERTUBE_API_KEY');
                const clientVersion = window.ytcfg?.get?.('INNERTUBE_CLIENT_VERSION');
                const context = window.ytcfg?.get?.('INNERTUBE_CONTEXT');
                if (!clientVersion || !context?.client || (!modernPanel && (!endpoint?.params || !apiKey))) {
                    return { ok: false, reason: 'Parametri trascrizione YouTube non disponibili' };
                }

                const requestContext = JSON.parse(JSON.stringify(context));
                requestContext.client.originalUrl = location.href;
                const clickTrackingParams = modernPanel?.clickTrackingParams || endpoint?.clickTrackingParams;
                if (clickTrackingParams) {
                    requestContext.clickTracking = { clickTrackingParams };
                }

                const headers = {
                    'content-type': 'application/json',
                    'x-youtube-client-name': String(window.ytcfg?.get?.('INNERTUBE_CONTEXT_CLIENT_NAME') || 1),
                    'x-youtube-client-version': clientVersion,
                    'x-youtube-bootstrap-logged-in': String(Boolean(window.ytcfg?.get?.('LOGGED_IN')))
                };
                const visitorData = window.ytcfg?.get?.('VISITOR_DATA') || requestContext.client.visitorData;
                if (visitorData) headers['x-goog-visitor-id'] = visitorData;
                const identityToken = window.ytcfg?.get?.('ID_TOKEN');
                if (identityToken) headers['x-youtube-identity-token'] = identityToken;

                // YouTube's own network layer adds this signature for logged-in
                // sessions. A plain fetch does not, causing FAILED_PRECONDITION.
                const cookies = Object.fromEntries(document.cookie.split(';').map((part) => {
                    const separator = part.indexOf('=');
                    if (separator < 0) return [part.trim(), ''];
                    return [part.slice(0, separator).trim(), part.slice(separator + 1)];
                }));
                const decodeCookie = (value) => {
                    try { return decodeURIComponent(value); } catch { return value; }
                };
                const baseSapisid = window.__SAPISID || cookies.SAPISID || cookies['__Secure-3PAPISID'];
                const onePartySapisid = window.__1PSAPISID || cookies['__Secure-1PAPISID'];
                const threePartySapisid = window.__3PSAPISID || cookies['__Secure-3PAPISID'];
                const sidTokens = [
                    ['SAPISIDHASH', baseSapisid],
                    ['SAPISID1PHASH', onePartySapisid],
                    ['SAPISID3PHASH', threePartySapisid]
                ].filter(([, secret]) => Boolean(secret));
                if (sidTokens.length) {
                    const timestamp = Math.floor(Date.now() / 1000);
                    const tokens = [];
                    for (const [name, secret] of sidTokens) {
                        const input = new TextEncoder().encode(`${timestamp} ${decodeCookie(secret)} ${location.origin}`);
                        const digest = await crypto.subtle.digest('SHA-1', input);
                        const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
                        tokens.push(`${name} ${timestamp}_${hash}`);
                    }
                    headers.authorization = tokens.join(' ');
                    headers['x-origin'] = location.origin;
                    headers['x-goog-authuser'] = String(window.ytcfg?.get?.('SESSION_INDEX') || 0);
                    const delegatedSessionId = window.ytcfg?.get?.('DELEGATED_SESSION_ID');
                    if (delegatedSessionId) headers['x-goog-pageid'] = delegatedSessionId;
                }

                // YouTube's current transcript UI (2026) no longer uses
                // get_transcript. It loads PAmodern_transcript_view through
                // get_panel, even while the panel is closed.
                let modernPanelFailure = null;
                if (modernPanel) {
                    const panelResponse = await fetch('/youtubei/v1/get_panel?prettyPrint=false', {
                        method: 'POST',
                        headers,
                        credentials: 'same-origin',
                        body: JSON.stringify({
                            context: requestContext,
                            panelId: modernPanel.panelId,
                            params: modernPanel.params
                        })
                    });
                    if (panelResponse.ok) {
                        const payload = await panelResponse.json();
                        const text = collectModernSegments(payload);
                        if (text.length >= 50) {
                            return {
                                ok: true,
                                text,
                                characters: text.length,
                                source: 'modern-panel',
                                videoId: currentVideoId
                            };
                        }
                        modernPanelFailure = `get_panel HTTP ${panelResponse.status}, 0 segmenti`;
                    } else {
                        modernPanelFailure = `get_panel HTTP ${panelResponse.status}`;
                    }
                }

                if (!endpoint?.params || !apiKey) {
                    return { ok: false, reason: modernPanelFailure || 'Endpoint trascrizione YouTube non disponibile' };
                }

                const response = await fetch(`/youtubei/v1/get_transcript?prettyPrint=false&key=${encodeURIComponent(apiKey)}`, {
                    method: 'POST',
                    headers,
                    credentials: 'same-origin',
                    body: JSON.stringify({
                        context: requestContext,
                        params: endpoint.params
                    })
                });
                if (!response.ok) {
                    const errorBody = await response.text();
                    return {
                        ok: false,
                        reason: `${modernPanelFailure ? `${modernPanelFailure}; ` : ''}Transcript API HTTP ${response.status}`,
                        responseCode: (() => {
                            try { return JSON.parse(errorBody)?.error?.status || null; } catch { return null; }
                        })()
                    };
                }
                const payload = await response.json();
                const text = collectSegments(payload);
                return { ok: text.length >= 50, text, characters: text.length, source: 'legacy-transcript', videoId: currentVideoId };
            }
        });
        console.log('[YT TRANSCRIPT] Risposta API transcript:', {
            success: result.ok,
            characters: result.characters || 0,
            source: result.source,
            reason: result.reason,
            responseCode: result.responseCode
        });
        sendResponse({ success: Boolean(result.ok), ...result });
    } catch (error) {
        console.error('[YT TRANSCRIPT] Errore API transcript:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Funzione per ottenere il contenuto della pagina
async function handleGetPageContent(request, sender, sendResponse) {
    try {
        // Ottieni il tab attivo
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab) {
            sendResponse({ success: false, error: 'Nessun tab attivo trovato' });
            return;
        }
        
        // Invia messaggio al content script
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractContent' });
        
        if (response.success) {
            sendResponse({ success: true, data: response.data });
        } else {
            sendResponse({ success: false, error: response.error });
        }
        
    } catch (error) {
        console.error('Errore nel service worker:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Event listener per il context menu
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'summarize-link') {
        try {
            // URL del link cliccato
            const linkUrl = info.linkUrl;
            console.log('Riassunto richiesto per URL:', linkUrl);
            
            // 1. VERIFICA AUTENTICAZIONE PRIMA DI TUTTO
            const { user, authToken } = await chrome.storage.local.get(['user', 'authToken']);
            
            if (!user || !authToken) {
                // Utente non loggato - apri popup per login invece di modale
                console.log('Utente non loggato, aprendo popup per login...');
                try {
                    await chrome.action.openPopup();
                } catch (error) {
                    console.log('Errore nell\'aprire popup:', error);
                    // Fallback: mostra notifica
                    chrome.notifications.create({
                        type: 'basic',
                        iconUrl: 'assets/icon-48.png',
                        title: 'LemonSqueezer - Login richiesto',
                        message: 'Apri l\'estensione per effettuare il login, poi riprova con il link.'
                    });
                }
                return;
            }
            
            // 2. MOSTRA SUBITO LA MODALE CON SPINNER
            await showLoadingModal(linkUrl, tab.id);
            
            // 3. CHIAMA L'API CON AUTENTICAZIONE
            const apiUrl = 'https://4jo5gamel9.execute-api.eu-west-1.amazonaws.com/dev';
            console.log('Chiamando API:', apiUrl);
            
            // Rispetta le preferenze utente (lingua di output + compressione) anche
            // per il riassunto da menu contestuale.
            const prefs = await chrome.storage.local.get(['summaryLanguage', 'squeezePercent']);
            const result = await summarizeUrlDirectly(
                linkUrl, apiUrl, authToken,
                prefs.summaryLanguage || 'it',
                Number(prefs.squeezePercent) || 20
            );
            console.log('Risultato API:', result);
            
            // 4. AGGIORNA LA MODALE CON IL RISULTATO
            if (result.success) {
                console.log('Successo! Aggiornando modal con:', result.data);
                await updateModalWithResult(result.data, linkUrl, tab.id);
            } else {
                console.error('Errore API:', result.error);
                
                // Se errore di autenticazione, chiedi login
                if (result.error.includes('Token') || result.error.includes('AUTH_REQUIRED')) {
                    await chrome.storage.local.remove(['user', 'authToken']);
                    await showLoginModal(linkUrl, tab.id);
                } else {
                    await updateModalWithError(result.error || 'Errore nel riassumere il link', tab.id);
                }
            }
            
        } catch (error) {
            console.error('Errore nel context menu:', error);
            await updateModalWithError('Errore interno: ' + error.message, tab.id);
        }
    }
});

// Funzione per riassumere un URL direttamente
async function summarizeUrlDirectly(url, apiUrl, authToken, language, squeeze) {
    console.log('summarizeUrlDirectly chiamata con:', { url, apiUrl, language, squeeze });
    try {
        const headers = {
            'Content-Type': 'application/json',
            'X-Brand': BRAND_ID
        };

        // Aggiungi Bearer token se fornito
        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }
        
        console.log('Facendo fetch a:', `${apiUrl}/summarize-url`);
        const response = await fetch(`${apiUrl}/summarize-url`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                url: url,
                lang: language || 'it',
                ...([10, 20, 50].includes(Number(squeeze)) ? { squeeze: Number(squeeze) } : {})
            })
        });
        
        console.log('Response status:', response.status);
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Errore di rete' }));
            console.log('Errore response:', errorData);
            return { success: false, error: errorData.error || `HTTP ${response.status}` };
        }
        
        const data = await response.json();
        console.log('Data ricevuta:', data);
        return { success: true, data: data };
        
    } catch (error) {
        console.error('Errore nella chiamata API per URL:', error);
        return { success: false, error: error.message };
    }
}

// Funzione per mostrare la modale con spinner di caricamento
async function showLoadingModal(url, tabId) {
    try {
        // Inietta il content script se necessario
        await ensureContentScript(tabId);
        
        // Mostra la modale con spinner
        await chrome.tabs.sendMessage(tabId, {
            action: 'showLoadingModal',
            data: { url }
        });
    } catch (error) {
        console.error('Errore nel mostrare loading modal:', error);
        // Fallback: notifica
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'assets/icon-48.png',
            title: 'LemonSqueezer - TL;DR',
            message: 'Analisi in corso...'
        });
    }
}

// Funzione per mostrare la modale di login
// Funzione per aggiornare la modale con il risultato
async function updateModalWithResult(summaryData, originalUrl, tabId) {
    try {
        await chrome.tabs.sendMessage(tabId, {
            action: 'updateModalWithResult',
            data: {
                summary: summaryData.text || summaryData.summary,
                readingTime: summaryData.readingTimeMinutes,
                wordsCount: summaryData.wordsCount,
                title: summaryData.title,
                originalUrl: originalUrl,
                stats: summaryData.stats
            }
        });
    } catch (error) {
        console.error('Errore nell\'aggiornare il modal:', error);
    }
}

// Funzione per aggiornare la modale con un errore
async function updateModalWithError(errorMessage, tabId) {
    try {
        await chrome.tabs.sendMessage(tabId, {
            action: 'updateModalWithError',
            data: { error: errorMessage }
        });
    } catch (error) {
        console.error('Errore nell\'aggiornare il modal con errore:', error);
        // Fallback: notifica
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'assets/icon-48.png',
            title: 'LemonSqueezer - Errore',
            message: errorMessage
        });
    }
}

// Funzione per assicurarsi che il content script sia caricato
async function ensureContentScript(tabId) {
    try {
        // Prova a fare ping al content script
        await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    } catch (error) {
        // Se non risponde, inietta il content script
        console.log('Iniettando content script nel tab', tabId);
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        });
        // Aspetta un po' per il caricamento
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

// Funzione per gestire la richiesta di riassunto URL (dal popup)
async function handleSummarizeUrl(request, sender, sendResponse) {
    try {
        const { apiUrl, url, language } = request;
        
        if (!apiUrl) {
            sendResponse({ success: false, error: 'API URL mancante' });
            return;
        }
        
        const result = await summarizeUrlDirectly(url, apiUrl, null, language);
        sendResponse(result);
        
    } catch (error) {
        console.error('Errore nella richiesta di riassunto URL:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Funzione per gestire la richiesta di riassunto
async function handleSummarize(request, sender, sendResponse) {
    try {
        const { apiUrl, apiKey, pageData, language } = request;
        
        if (!apiUrl || !apiKey) {
            sendResponse({ success: false, error: 'API URL o API Key mancanti' });
            return;
        }
        
        // Chiama il backend
        const response = await fetch(`${apiUrl}/summarize`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey
            },
            body: JSON.stringify({
                url: pageData.url,
                title: pageData.title,
                text: pageData.text,
                lang: language || 'it'
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Errore di rete' }));
            sendResponse({ success: false, error: errorData.error || `HTTP ${response.status}` });
            return;
        }
        
        const data = await response.json();
        sendResponse({ success: true, data: data });
        
    } catch (error) {
        console.error('Errore nella chiamata API:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Event listener per l'attivazione del tab (per future funzionalità)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    // Placeholder per funzionalità future come auto-riassunto
});

// Event listener per l'aggiornamento del tab (per future funzionalità)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Placeholder per funzionalità future
    if (changeInfo.status === 'complete' && tab.url) {
        // Potresti qui implementare l'auto-riassunto se abilitato
    }
});

// Gestione degli errori globali
self.addEventListener('error', (event) => {
    console.error('Errore nel service worker:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
    console.error('Promise rejetta nel service worker:', event.reason);
});

// Google OAuth Login Handler (eseguito nel background)
async function handleGoogleLogin(request, sender, sendResponse) {
    console.log('[SW LOGIN] ===== INIZIO GOOGLE LOGIN =====');
    console.log('[SW LOGIN] Request ricevuto:', { hasState: !!request.state, hasChallenge: !!request.codeChallenge, hasVerifier: !!request.codeVerifier });
    
    try {
        const { state, codeChallenge, codeVerifier, redirectUri, clientId, apiUrl } = request;
        
        if (!state || !codeChallenge || !codeVerifier || !redirectUri || !clientId || !apiUrl) {
            throw new Error('Parametri mancanti per OAuth');
        }
        
        // Costruisci URL autorizzazione
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: 'openid email profile',
            prompt: 'consent',
            access_type: 'offline',
            include_granted_scopes: 'true',
            state: state,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256'
        })}`;
        
        console.log('[SW LOGIN] Avvio launchWebAuthFlow...');
        console.log('[SW LOGIN] Auth URL:', authUrl.substring(0, 100) + '...');
        
        // Lancia OAuth flow - questo rimane attivo anche se popup si chiude
        const redirectUrl = await chrome.identity.launchWebAuthFlow({
            url: authUrl,
            interactive: true
        });
        
        console.log('[SW LOGIN] Redirect URL ricevuto');
        
        // Parse redirect URL
        const url = new URL(redirectUrl);
        const returnedState = url.searchParams.get('state');
        const code = url.searchParams.get('code');
        
        if (returnedState !== state) {
            throw new Error('State mismatch - possibile attacco CSRF');
        }
        
        if (!code) {
            throw new Error('Authorization code mancante');
        }
        
        console.log('[SW LOGIN] Code ottenuto, invio al backend...');
        
        // Invia code al backend per scambio token
        const backendResponse = await fetch(`${apiUrl}/auth/google`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                code,
                code_verifier: codeVerifier,
                redirect_uri: redirectUri
            })
        });
        
        if (!backendResponse.ok) {
            const error = await backendResponse.json().catch(() => ({}));
            console.error('[SW LOGIN] Errore backend:', error);
            throw new Error(error.error || 'Login fallito');
        }
        
        const data = await backendResponse.json();
        console.log('[SW LOGIN] Dati ricevuti dal backend');
        
        // Salva JWT token e user info in storage
        console.log('[SW LOGIN] Salvataggio in storage...');
        await chrome.storage.local.set({
            authToken: data.authToken,
            user: data.user
        });
        
        // RIMUOVI il flag loginInProgress
        await chrome.storage.local.remove('loginInProgress');
        
        // Verifica subito che sia salvato
        const check = await chrome.storage.local.get(['authToken', 'user', 'loginInProgress']);
        console.log('[SW LOGIN] Verifica storage:', { 
            hasToken: !!check.authToken, 
            hasUser: !!check.user,
            loginInProgress: check.loginInProgress 
        });
        
        console.log('[SW LOGIN] Login completato! User:', data.user.email);
        console.log('[SW LOGIN] ===== FINE GOOGLE LOGIN =====');
        
        sendResponse({ 
            success: true, 
            user: data.user,
            authToken: data.authToken
        });
        
    } catch (error) {
        console.error('[SW LOGIN] ===== ERRORE GOOGLE LOGIN =====');
        console.error('[SW LOGIN] Errore:', error);
        console.error('[SW LOGIN] Stack:', error.stack);
        
        // IMPORTANTE: Rimuovi sempre il flag loginInProgress in caso di errore
        await chrome.storage.local.remove('loginInProgress');
        
        sendResponse({ success: false, error: error.message });
    }
}
