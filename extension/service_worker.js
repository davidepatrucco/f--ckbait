// service_worker.js - Service Worker per l'estensione LemonSqueezer

// Event listener per l'installazione
chrome.runtime.onInstalled.addListener((details) => {
    console.log('LemonSqueezer installato:', details.reason);
    
    // Inizializza la configurazione di default
    chrome.storage.local.set({
        language: 'it',
        // apiKey e apiUrl saranno inseriti dall'utente
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