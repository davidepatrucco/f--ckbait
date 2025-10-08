// service_worker.js - Service Worker per l'estensione LemonSqueezer

// Event listener per l'installazione
chrome.runtime.onInstalled.addListener((details) => {
    console.log('LemonSqueezer installato:', details.reason);
    
    // Inizializza la configurazione di default
    chrome.storage.local.set({
        language: 'it',
        // apiKey e apiUrl saranno inseriti dall'utente
    });
    
    // Crea il context menu per i link
    chrome.contextMenus.create({
        id: 'summarize-link',
        title: '🍋 Riassumi questo link',
        contexts: ['link'],
        documentUrlPatterns: ['http://*/*', 'https://*/*']
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
});

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
                // Utente non loggato - mostra modal di login
                await showLoginModal(linkUrl, tab.id);
                return;
            }
            
            // 2. MOSTRA SUBITO LA MODALE CON SPINNER
            await showLoadingModal(linkUrl, tab.id);
            
            // 3. CHIAMA L'API CON AUTENTICAZIONE
            const apiUrl = 'https://8udffsiwnc.execute-api.eu-west-1.amazonaws.com/dev';
            console.log('Chiamando API:', apiUrl);
            
            const result = await summarizeUrlDirectly(linkUrl, apiUrl, authToken, 'it');
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
async function summarizeUrlDirectly(url, apiUrl, authToken, language) {
    console.log('summarizeUrlDirectly chiamata con:', { url, apiUrl, language });
    try {
        const headers = {
            'Content-Type': 'application/json'
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
                lang: language || 'it'
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
            message: '🍋 Squeezing...'
        });
    }
}

// Funzione per mostrare la modale di login
async function showLoginModal(url, tabId) {
    try {
        // Inietta il content script se necessario
        await ensureContentScript(tabId);
        
        // Mostra la modale di login
        await chrome.tabs.sendMessage(tabId, {
            action: 'showLoginModal',
            data: { url }
        });
    } catch (error) {
        console.error('Errore nel mostrare login modal:', error);
        // Fallback: notifica
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'assets/icon-48.png',
            title: 'LemonSqueezer - Login richiesto',
            message: 'Apri l\'estensione per effettuare il login'
        });
    }
}

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