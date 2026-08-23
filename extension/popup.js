// popup.js - Gestione del popup dell'estensione LemonSqueezer con autenticazione OAuth PKCE

import { GOOGLE_WEB_CLIENT_ID } from './oauth-config.js';

// Configurazione
const CONFIG = {
    API_URL: 'https://4jo5gamel9.execute-api.eu-west-1.amazonaws.com/dev'
};

const REDIRECT_URI = `https://${chrome.runtime.id}.chromiumapp.org/`;
const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

// Utility functions per PKCE
function base64url(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

async function generateCodeVerifier() {
    const array = new Uint8Array(64);
    crypto.getRandomValues(array);
    return base64url(array);
}

async function generateCodeChallenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return base64url(digest);
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log('[POPUP] ===== POPUP OPENED =====');
    
    // CONTROLLO: verifica se login completato durante chiusura popup
    const storage = await chrome.storage.local.get(['loginInProgress', 'authToken', 'user']);
    console.log('[POPUP] Storage check:', { 
        loginInProgress: storage.loginInProgress,
        hasToken: !!storage.authToken,
        hasUser: !!storage.user
    });
    
    // Se c'era login in corso e ora ci sono token/user, login completato!
    if (storage.loginInProgress && storage.authToken && storage.user) {
        console.log('[POPUP] Login completato durante chiusura, rimuovo flag...');
        await chrome.storage.local.remove('loginInProgress');
    }
    
    // Se ci sono token/user freschi (creati negli ultimi 30 secondi), potrebbero essere da login appena completato
    if (storage.authToken && storage.user && !storage.loginInProgress) {
        const userUpdatedAt = storage.user.updatedAt || storage.user.createdAt;
        if (userUpdatedAt && (Date.now() - new Date(userUpdatedAt).getTime()) < 30000) {
            console.log('[POPUP] Login fresco rilevato (< 30s), aggiorno UI...');
        }
    }
    const summarizeBtn = document.getElementById('summarizeBtn');
    const languageSelect = document.getElementById('language');
    const historyList = document.getElementById('historyList');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    
    // Elementi di autenticazione
    const loginCard = document.getElementById('loginCard');
    const googleLoginBtn = document.getElementById('googleLoginBtn');
    const emailInput = document.getElementById('emailInput');
    const passwordInput = document.getElementById('passwordInput');
    const emailLoginBtn = document.getElementById('emailLoginBtn');
    const emailRegisterBtn = document.getElementById('emailRegisterBtn');
    const emailLoginError = document.getElementById('emailLoginError');
    const userInfo = document.getElementById('userInfo');
    const userAvatar = document.getElementById('userAvatar');
    const userName = document.getElementById('userName');
    const userPlan = document.getElementById('userPlan');
    const logoutBtn = document.getElementById('logoutBtn');
    
    let currentUser = null;

    // Carica configurazione salvata
    const savedConfig = await chrome.storage.local.get(['user', 'authToken', 'loginInProgress']);

    // Use the browser UI language automatically; no per-extension language setting.
    const browserLanguage = (chrome.i18n?.getUILanguage?.() || navigator.language || 'it')
        .toLowerCase().split('-')[0];
    const supportedLanguage = ['it', 'en', 'es', 'fr', 'de', 'zh', 'ja', 'pt', 'ko'].includes(browserLanguage)
        ? browserLanguage : 'en';
    const uiText = {
        it: { summary: 'Riassumi questa pagina', options: 'Opzioni', history: 'Cronologia', user: 'User', premium: 'Piano Premium', free: 'Piano Free', unlimited: 'Riassunti illimitati', summaries: 'riassunti', month: 'Questo mese', total: 'Totale', saved: 'risparmiati', output: 'Output', language: 'Lingua riassunto' },
        en: { summary: 'Summarize this page', options: 'Options', history: 'History', user: 'User', premium: 'Premium plan', free: 'Free plan', unlimited: 'Unlimited summaries', summaries: 'summaries', month: 'This month', total: 'Total', saved: 'saved', output: 'Output', language: 'Summary language' }
    }[supportedLanguage] || null;
    const text = uiText || { summary: 'Summarize this page', options: 'Options', history: 'History', user: 'User', premium: 'Premium plan', free: 'Free plan', unlimited: 'Unlimited summaries', summaries: 'summaries', month: 'This month', total: 'Total', saved: 'saved', output: 'Output', language: 'Summary language' };
    document.documentElement.lang = supportedLanguage;
    document.getElementById('summarizeBtn').lastChild.textContent = `\n                ${text.summary}\n            `;
    document.querySelector('.options-panel > summary').textContent = text.options;
    document.querySelector('.history-card h3').textContent = text.history;
    document.querySelector('.user-label').textContent = text.user;
    document.querySelector('label[for="language"]').textContent = text.output;
    document.querySelector('.config-card h3').lastChild.textContent = `\n                    ${text.language}\n                `;
    if (languageSelect) {
        languageSelect.value = supportedLanguage;
        languageSelect.closest('.input-group')?.classList.add('browser-language-setting');
        languageSelect.disabled = true;
    }

    async function renderHistory() {
        if (!historyList) return;
        const { summaryHistory = [] } = await chrome.storage.local.get(['summaryHistory']);
        const entries = summaryHistory.slice(0, 5);
        clearHistoryBtn.hidden = entries.length === 0;
        if (!entries.length) {
            historyList.innerHTML = '<p class="history-empty">I tuoi ultimi riassunti appariranno qui.</p>';
            return;
        }
        historyList.innerHTML = `<div class="history-list">${entries.map((entry, index) => {
            const timestamp = new Date(entry.timestamp).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
            const cacheStatus = entry.cached ? ' · <span class="cache-badge">cache</span>' : '';
            return `<button class="history-item" type="button" data-history-index="${index}"><span class="history-item-title">${escapeHtml(entry.title || entry.url)}</span><span class="history-item-meta">${timestamp}${cacheStatus}</span></button>`;
        }).join('')}</div>`;
        historyList.querySelectorAll('[data-history-index]').forEach((item) => {
            item.addEventListener('click', () => {
                const entry = entries[Number(item.dataset.historyIndex)];
                if (entry?.url) chrome.tabs.create({ url: entry.url });
            });
        });
    }

    function escapeHtml(value) {
        const element = document.createElement('span');
        element.textContent = String(value || '');
        return element.innerHTML;
    }

    clearHistoryBtn?.addEventListener('click', async () => {
        await chrome.storage.local.remove(['summaryHistory']);
        await renderHistory();
    });
    await renderHistory();
    
    // Gestisci stato di login in corso
    if (savedConfig.loginInProgress && !savedConfig.authToken) {
        // Login ancora in corso, mostra stato di attesa
        console.log('[POPUP] Login in corso rilevato, mostro stato attesa...');
        googleLoginBtn.disabled = true;
        googleLoginBtn.textContent = 'Completa il login nella finestra Google...';
        
        // Polling per verificare completamento
        let attempts = 0;
        const maxAttempts = 60; // 30 secondi
        const pollInterval = setInterval(async () => {
            attempts++;
            const check = await chrome.storage.local.get(['authToken', 'user', 'loginInProgress']);
            
            if (check.authToken && check.user) {
                // Login completato!
                clearInterval(pollInterval);
                await chrome.storage.local.remove('loginInProgress');
                console.log('[POPUP] Login completato durante polling!');
                location.reload(); // Ricarica il popup per mostrare stato loggato
            } else if (!check.loginInProgress) {
                // Login fallito/cancellato
                clearInterval(pollInterval);
                console.log('[POPUP] Login cancellato/fallito');
                googleLoginBtn.disabled = false;
                googleLoginBtn.textContent = 'Connetti con Google';
            } else if (attempts >= maxAttempts) {
                // Timeout
                clearInterval(pollInterval);
                await chrome.storage.local.remove('loginInProgress');
                console.log('[POPUP] Timeout login');
                googleLoginBtn.disabled = false;
                googleLoginBtn.textContent = 'Timeout - Riprova';
                setTimeout(() => {
                    googleLoginBtn.textContent = 'Connetti con Google';
                }, 3000);
            }
        }, 500);
    } else if (savedConfig.user && savedConfig.authToken) {
        currentUser = savedConfig.user;
        
        // Se il login è fresco (< 5 secondi), skippa checkUserAuth per evitare conflitti
        const userUpdatedAt = savedConfig.user.updatedAt || savedConfig.user.createdAt;
        const isFreshLogin = userUpdatedAt && (Date.now() - new Date(userUpdatedAt).getTime()) < 5000;
        
        if (isFreshLogin) {
            console.log('[POPUP] Login fresco rilevato, skippo checkUserAuth...');
            // Usa direttamente i dati salvati
        } else {
            console.log('[POPUP] Login esistente, verifico con backend...');
            await checkUserAuth();
        }
    }
    
    // Inizializza UI basata sullo stato di login
    updateUIForAuthState();
    
    // Controllo autenticazione utente
    async function checkUserAuth() {
        console.log('[AUTH CHECK] ===== INIZIO VERIFICA =====');
        try {
            const { authToken } = await chrome.storage.local.get(['authToken']);
            console.log('[AUTH CHECK] Token presente:', !!authToken);

            if (!authToken) {
                throw new Error('Token mancante');
            }

            console.log('[AUTH CHECK] Chiamando /auth/verify...');
            const response = await fetch(`${CONFIG.API_URL}/auth/verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                }
            });
            
            console.log('[AUTH CHECK] Response status:', response.status);
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.log('[AUTH CHECK] Response error:', errorData);
                throw new Error(`Token non valido: ${response.status} - ${errorData.error || 'Unknown'}`);
            }
            
            const userData = await response.json();
            console.log('[AUTH CHECK] User data ricevuta:', userData.email);
            currentUser = userData;
            
            // Aggiorna storage
            await chrome.storage.local.set({ user: userData });
            console.log('[AUTH CHECK] ===== VERIFICA OK =====');
            
            return true;
        } catch (error) {
            console.error('[AUTH CHECK] ===== VERIFICA FALLITA =====');
            console.error('[AUTH CHECK] Errore:', error.message);
            console.log('[AUTH CHECK] Chiamando logout...');
            await logout();
            return false;
        }
    }
    
    // Funzioni per statistiche di tempo utente
    async function getUserTimeStats() {
        try {
            const { userTimeStats = [] } = await chrome.storage.local.get(['userTimeStats']);
            return userTimeStats;
        } catch (error) {
            console.error('[STATS] Errore recupero statistiche:', error);
            return [];
        }
    }
    
    async function getAggregatedStats() {
        const stats = await getUserTimeStats();
        const now = new Date();
        const currentMonth = now.toISOString().slice(0, 7); // YYYY-MM
        
        // Calcola totali
        const lifetime = stats.reduce((acc, entry) => {
            acc.timeSaved += entry.timeSavedMinutes || 0;
            acc.readingTime += entry.readingTimeMinutes || 0;
            acc.summaries += 1;
            return acc;
        }, { timeSaved: 0, readingTime: 0, summaries: 0 });
        
        // Calcola per mese corrente
        const thisMonth = stats
            .filter(entry => entry.month === currentMonth)
            .reduce((acc, entry) => {
                acc.timeSaved += entry.timeSavedMinutes || 0;
                acc.readingTime += entry.readingTimeMinutes || 0;
                acc.summaries += 1;
                return acc;
            }, { timeSaved: 0, readingTime: 0, summaries: 0 });
        
        return { lifetime, thisMonth };
    }
    
    function formatTime(minutes) {
        if (minutes < 1) {
            const seconds = Math.round(minutes * 60);
            return `${seconds} sec`;
        } else if (minutes < 60) {
            const mins = Math.floor(minutes);
            const secs = Math.round((minutes - mins) * 60);
            return secs > 0 ? `${mins}m ${secs}s` : `${mins} min`;
        } else {
            const hours = Math.floor(minutes / 60);
            const mins = Math.round(minutes % 60);
            return mins > 0 ? `${hours}h ${mins}m` : `${hours} ore`;
        }
    }
    
    // Aggiorna UI basata sullo stato di autenticazione
    function updateUIForAuthState() {
        if (currentUser && currentUser.email) {
            // Utente loggato
            loginCard.style.display = 'none';
            userInfo.style.display = 'flex';
            summarizeBtn.disabled = false;
            
            // Aggiorna info utente
            userName.textContent = currentUser.name || currentUser.email;
            if (currentUser.picture) {
                userAvatar.src = currentUser.picture;
                userAvatar.style.display = 'block';
            } else {
                userAvatar.style.display = 'none';
            }
            
            // Aggiorna piano e limiti con statistiche
            const plan = currentUser.plan || 'free';
            const usage = currentUser.usage || { used: 0, limit: 10 };
            const planText = plan === 'premium' ? text.premium : text.free;
            const usageText = plan === 'premium' 
                ? text.unlimited
                : `${usage.used}/${usage.limit} ${text.summaries}`;
            
            // Aggiorna con statistiche di tempo (async)
            updateUserPlanWithStats(planText, usageText);
            
            // Disabilita bottone se limiti superati
            if (usage.used >= usage.limit && plan === 'free') {
                summarizeBtn.disabled = true;
                summarizeBtn.textContent = 'Limite raggiunto - Upgrade a Premium';
            }
            
            // Aggiunge bottone Premium per utenti free
            addPremiumButtonIfNeeded(plan);
        } else {
            // Utente non loggato
            loginCard.style.display = 'block';
            userInfo.style.display = 'none';
            summarizeBtn.disabled = true;
        }
    }

    function setEmailLoginError(message) {
        if (!emailLoginError) return;
        if (message) {
            emailLoginError.textContent = message;
            emailLoginError.style.display = 'block';
        } else {
            emailLoginError.textContent = '';
            emailLoginError.style.display = 'none';
        }
    }

    function setEmailFormDisabled(disabled) {
        if (emailInput) emailInput.disabled = disabled;
        if (passwordInput) passwordInput.disabled = disabled;
        if (emailLoginBtn) emailLoginBtn.disabled = disabled;
        if (emailRegisterBtn) emailRegisterBtn.disabled = disabled;
    }

    async function handleEmailAuth(mode) {
        try {
            setEmailLoginError('');
            const email = (emailInput?.value || '').trim();
            const password = passwordInput?.value || '';

if (!email || !password) {
                setEmailLoginError('Inserisci email e password.');
                return;
            }
            if (password.length < 8) {
                setEmailLoginError('La password deve avere almeno 8 caratteri.');
                return;
            }

            setEmailFormDisabled(true);

            const endpoint = mode === 'register' ? '/auth/register' : '/auth/login';
            const response = await fetch(`${CONFIG.API_URL}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || 'Login non riuscito');
            }

            await chrome.storage.local.set({
                authToken: data.authToken,
                user: data.user
            });

            currentUser = data.user;
            updateUIForAuthState();
        } catch (error) {
            setEmailLoginError(error.message);
        } finally {
            setEmailFormDisabled(false);
        }
    }
    
    // Aggiorna il piano utente con statistiche di tempo
    async function updateUserPlanWithStats(planText, usageText) {
        try {
            const stats = await getAggregatedStats();
            
            let statsText = '';
            if (stats.thisMonth.summaries > 0 || stats.lifetime.summaries > 0) {
                if (stats.thisMonth.timeSaved > 0) {
                    statsText += `${text.month}: ${formatTime(stats.thisMonth.timeSaved)} ${text.saved}`;
                }
                if (stats.lifetime.timeSaved > 0) {
                    if (statsText) statsText += ' • ';
                    statsText += `${text.total}: ${formatTime(stats.lifetime.timeSaved)} ${text.saved}`;
                }
            }
            
            if (statsText) {
                userPlan.innerHTML = `
                    <div>${planText} • ${usageText}</div>
                    <div style="font-size: 11px; color: #666; margin-top: 2px;">${statsText}</div>
                `;
            } else {
                userPlan.textContent = `${planText} • ${usageText}`;
            }
        } catch (error) {
            console.error('[POPUP] Errore aggiornamento statistiche:', error);
            userPlan.textContent = `${planText} • ${usageText}`;
        }
    }
    
    // Aggiunge bottone Premium se necessario
    function addPremiumButtonIfNeeded(plan) {
        // Rimuovi bottone esistente se presente
        const existingBtn = document.getElementById('premiumBtn');
        if (existingBtn) existingBtn.remove();
        
        if (plan === 'free') {
            const premiumBtn = document.createElement('button');
            premiumBtn.id = 'premiumBtn';
            premiumBtn.className = 'premium-btn';
            premiumBtn.innerHTML = 'Passa a Premium';
            premiumBtn.style.cssText = `
                width: 100%;
                padding: 10px 12px;
                margin-top: 10px;
                background: #111827;
                color: #f9fafb;
                border: none;
                border-radius: 10px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.2s ease;
            `;
            
            premiumBtn.addEventListener('mouseover', () => {
                premiumBtn.style.background = '#0b1220';
            });
            premiumBtn.addEventListener('mouseout', () => {
                premiumBtn.style.background = '#111827';
            });
            
            premiumBtn.addEventListener('click', handlePremiumUpgrade);
            
            // Inserisci dopo userPlan
            userPlan.parentNode.insertBefore(premiumBtn, userPlan.nextSibling);
        }
    }
    
    // Gestisce il click sul bottone Premium
    async function handlePremiumUpgrade() {
        try {
            const { authToken } = await chrome.storage.local.get(['authToken']);
            
            if (!authToken) {
                console.error('[PREMIUM] Token mancante');
                return;
            }
            
            console.log('[PREMIUM] Avviando processo di upgrade...');
            
            // Chiama endpoint per creare sessione di pagamento
            const response = await fetch(`${CONFIG.API_URL}/payments/create-checkout`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({
                    planType: 'premium_monthly'
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Errore di rete' }));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }
            
            const data = await response.json();
            const checkoutUrl = data.checkout_session?.url;
            
            if (checkoutUrl) {
                // Apri checkout in nuova tab
                chrome.tabs.create({ url: checkoutUrl });
                window.close(); // Chiudi popup
            } else {
                throw new Error('URL checkout non ricevuto');
            }
            
        } catch (error) {
            console.error('[PREMIUM] Errore upgrade:', error);
            alert(`Errore durante l'upgrade: ${error.message}`);
        }
    }
    
    // Login con Google usando OAuth PKCE Flow (delegato al service worker)
    googleLoginBtn.addEventListener('click', async () => {
        // Prevenire click multipli
        if (googleLoginBtn.disabled) {
            console.log('[LOGIN] Click ignorato, già in corso...');
            return;
        }
        
        try {
            googleLoginBtn.disabled = true;
            googleLoginBtn.textContent = 'Autenticazione in corso...';
            
            console.log('[LOGIN] Generazione PKCE parametri...');
            
            // Genera state e PKCE parameters
            const state = crypto.randomUUID();
            const codeVerifier = await generateCodeVerifier();
            const codeChallenge = await generateCodeChallenge(codeVerifier);
            
            console.log('[LOGIN] Invio richiesta al service worker...');
            
            // Salva flag che indica login in corso
            await chrome.storage.local.set({ loginInProgress: true });
            
            // Delega al service worker (il popup si chiuderà, è normale)
            chrome.runtime.sendMessage({
                action: 'googleLogin',
                state,
                codeChallenge,
                codeVerifier,
                redirectUri: REDIRECT_URI,
                clientId: GOOGLE_WEB_CLIENT_ID,
                apiUrl: CONFIG.API_URL
            }, (response) => {
                // Questa callback potrebbe non essere chiamata se popup si chiude
                console.log('[LOGIN] Callback ricevuta:', response);
                if (response?.success) {
                    chrome.storage.local.remove('loginInProgress');
                    location.reload();
                } else if (response?.error) {
                    chrome.storage.local.remove('loginInProgress');
                    googleLoginBtn.textContent = response.error;
                    googleLoginBtn.disabled = false;
                }
            });
            
            // Mostra messaggio all'utente
            googleLoginBtn.textContent = 'Completa il login nella finestra Google...';
            console.log('[LOGIN] Il popup potrebbe chiudersi. Riaprilo dopo il login.');
            
        } catch (error) {
            console.error('[LOGIN] Errore completo:', error);
            googleLoginBtn.textContent = error.message;
            await chrome.storage.local.remove('loginInProgress');
            googleLoginBtn.disabled = false;
            setTimeout(() => {
                googleLoginBtn.innerHTML = `
                    <svg class="google-icon" viewBox="0 0 24 24">
                        <path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#fbbc05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Accedi con Google
                `;
            }, 3000);
        }
    });

    if (emailLoginBtn) {
        emailLoginBtn.addEventListener('click', () => handleEmailAuth('login'));
    }
    if (emailRegisterBtn) {
        emailRegisterBtn.addEventListener('click', () => handleEmailAuth('register'));
    }
    
    // Logout
    async function logout() {
        console.log('[LOGOUT] Inizio logout...');
        
        currentUser = null;
        await chrome.storage.local.remove(['user', 'authToken']);
        
        console.log('[LOGOUT] Logout completato');
        updateUIForAuthState();
    }
    
    logoutBtn.addEventListener('click', logout);
    
    // Riassumi pagina - apre la modale nel tab attivo
    summarizeBtn.addEventListener('click', async () => {
        if (!currentUser) {
            console.error('[POPUP] Utente non loggato');
            return;
        }
        
        try {
            // Ottieni il tab attivo
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab) {
                console.error('[POPUP] Nessun tab attivo');
                return;
            }
            
            console.log('[POPUP] Aprendo modale nel tab:', tab.url);

            const request = {
                action: 'openSummaryModal',
                requestId: crypto.randomUUID(),
                url: tab.url,
                lang: languageSelect?.value || 'it',
                summaryProfile: 'standard',
                summaryModel: 'gpt-5-nano'
            };
            try {
                await chrome.tabs.sendMessage(tab.id, request);
            } catch (messageError) {
                // A tab already open when the extension is reloaded can be
                // missing its content script. Inject it once and retry.
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                });
                await chrome.tabs.sendMessage(tab.id, request);
            }

            // Close only after the tab confirmed receiving the request.
            window.close();
            
        } catch (error) {
            console.error('[POPUP] Errore apertura modale:', error);
                summarizeBtn.textContent = 'Impossibile avviare il riassunto';
                setTimeout(() => {
                summarizeBtn.textContent = text.summary;
            }, 3000);
        }
    });
    
});
