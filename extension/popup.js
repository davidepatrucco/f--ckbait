// popup.js - Gestione del popup dell'estensione LemonSqueezer con autenticazione

// Configurazione hard-coded
const CONFIG = {
    API_URL: 'https://8udffsiwnc.execute-api.eu-west-1.amazonaws.com/dev'
};

document.addEventListener('DOMContentLoaded', async () => {
    const languageSelect = document.getElementById('language');
    const summarizeBtn = document.getElementById('summarizeBtn');
    const copyBtn = document.getElementById('copyBtn');
    const loadingDiv = document.getElementById('loading');
    const resultDiv = document.getElementById('result');
    const resultTitle = document.getElementById('resultTitle');
    const resultStats = document.getElementById('resultStats');
    const resultContent = document.getElementById('resultContent');
    const errorDiv = document.getElementById('error');
    const errorMessage = document.getElementById('errorMessage');
    
    // Elementi di autenticazione
    const loginCard = document.getElementById('loginCard');
    const googleLoginBtn = document.getElementById('googleLoginBtn');
    const userInfo = document.getElementById('userInfo');
    const userAvatar = document.getElementById('userAvatar');
    const userName = document.getElementById('userName');
    const userPlan = document.getElementById('userPlan');
    const logoutBtn = document.getElementById('logoutBtn');
    
    let currentSummary = '';
    let currentUser = null;
    
    // Carica configurazione salvata
    const savedConfig = await chrome.storage.local.get(['language', 'user', 'authToken']);
    if (savedConfig.language) languageSelect.value = savedConfig.language;
    if (savedConfig.user && savedConfig.authToken) {
        currentUser = savedConfig.user;
        await checkUserAuth();
    }
    
    // Inizializza UI basata sullo stato di login
    updateUIForAuthState();
    
    // Salva configurazione quando cambia la lingua
    const saveConfig = async () => {
        await chrome.storage.local.set({
            language: languageSelect.value
        });
    };
    
    languageSelect.addEventListener('change', saveConfig);
    
    // Controllo autenticazione utente
    async function checkUserAuth() {
        try {
            const { authToken } = await chrome.storage.local.get(['authToken']);
            if (!authToken) {
                throw new Error('Token mancante');
            }
            
            const response = await fetch(`${CONFIG.API_URL}/auth/verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                }
            });
            
            if (!response.ok) {
                throw new Error('Token non valido');
            }
            
            const userData = await response.json();
            currentUser = userData;
            
            // Aggiorna storage
            await chrome.storage.local.set({ user: userData });
            
            return true;
        } catch (error) {
            console.log('Auth check fallito:', error.message);
            await logout();
            return false;
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
            
            // Aggiorna piano e limiti
            const plan = currentUser.plan || 'free';
            const usage = currentUser.usage || { used: 0, limit: 10 };
            const planText = plan === 'premium' ? 'Piano Premium' : 'Piano Free';
            const usageText = `${usage.used}/${usage.limit} riassunti`;
            userPlan.textContent = `${planText} • ${usageText}`;
            
            // Disabilita bottone se limiti superati
            if (usage.used >= usage.limit && plan === 'free') {
                summarizeBtn.disabled = true;
                summarizeBtn.textContent = '⚠️ Limite raggiunto - Upgrade a Premium';
            }
        } else {
            // Utente non loggato
            loginCard.style.display = 'block';
            userInfo.style.display = 'none';
            summarizeBtn.disabled = true;
        }
    }
    
    // Login con Google
    googleLoginBtn.addEventListener('click', async () => {
        try {
            googleLoginBtn.disabled = true;
            googleLoginBtn.textContent = 'Connessione in corso...';
            
            // Usa Chrome Identity API per OAuth
            const token = await new Promise((resolve, reject) => {
                chrome.identity.getAuthToken({ interactive: true }, (token) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(token);
                    }
                });
            });
            
            // Verifica token con il backend
            const response = await fetch(`${CONFIG.API_URL}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    googleToken: token
                })
            });
            
            if (!response.ok) {
                throw new Error('Login fallito');
            }
            
            const userData = await response.json();
            currentUser = userData;
            
            // Salva dati utente
            await chrome.storage.local.set({
                user: userData,
                authToken: userData.authToken
            });
            
            updateUIForAuthState();
            
        } catch (error) {
            console.error('Errore login:', error);
            showError('Errore durante il login: ' + error.message);
        } finally {
            googleLoginBtn.disabled = false;
            googleLoginBtn.innerHTML = `
                <svg class="google-icon" viewBox="0 0 24 24">
                    <path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#fbbc05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Accedi con Google
            `;
        }
    });
    
    // Logout
    async function logout() {
        currentUser = null;
        await chrome.storage.local.remove(['user', 'authToken']);
        
        // Revoca token Google
        try {
            chrome.identity.removeCachedAuthToken({ token: '' });
        } catch (e) {
            // Ignora errori
        }
        
        updateUIForAuthState();
    }
    
    logoutBtn.addEventListener('click', logout);
    
    // Mostra errore
    const showError = (message) => {
        hideAll();
        errorMessage.textContent = message;
        errorDiv.style.display = 'block';
        setTimeout(() => {
            errorDiv.style.display = 'none';
        }, 5000);
    };
    
    // Nasconde tutti i risultati
    const hideAll = () => {
        resultDiv.style.display = 'none';
        copyBtn.style.display = 'none';
        errorDiv.style.display = 'none';
        loadingDiv.style.display = 'none';
    };
    
    // Mostra loading
    const showLoading = () => {
        hideAll();
        loadingDiv.style.display = 'block';
        summarizeBtn.disabled = true;
    };
    
    // Nasconde loading
    const hideLoading = () => {
        loadingDiv.style.display = 'none';
        summarizeBtn.disabled = currentUser ? false : true;
    };
    
    // Mostra risultato con il nuovo design
    const showResult = (summary, title, readingTime, wordsCount, timeSavedText = '') => {
        hideAll();
        
        // Aggiorna title
        resultTitle.textContent = title || '📝 Riassunto';
        
        // Aggiorna stats
        resultStats.innerHTML = '';
        if (readingTime || wordsCount || timeSavedText) {
            if (readingTime) {
                const timeBadge = document.createElement('div');
                timeBadge.className = 'stat-badge';
                timeBadge.innerHTML = `
                    <span>📖</span>
                    <span class="stat-value">${readingTime}</span>
                    <span class="stat-label">min</span>
                `;
                resultStats.appendChild(timeBadge);
            }
            
            if (wordsCount) {
                const wordsBadge = document.createElement('div');
                wordsBadge.className = 'stat-badge';
                wordsBadge.innerHTML = `
                    <span>✏️</span>
                    <span class="stat-value">${wordsCount}</span>
                    <span class="stat-label">parole</span>
                `;
                resultStats.appendChild(wordsBadge);
            }
            
            if (timeSavedText) {
                const timeSavedBadge = document.createElement('div');
                timeSavedBadge.className = 'stat-badge stat-highlight';
                timeSavedBadge.innerHTML = `
                    <span>⚡</span>
                    <span class="stat-value">${timeSavedText}</span>
                `;
                resultStats.appendChild(timeSavedBadge);
            }
        }
        
        // Aggiorna contenuto
        resultContent.innerHTML = summary.replace(/\n/g, '<br>');
        
        // Mostra risultato e bottone copia
        resultDiv.style.display = 'block';
        copyBtn.style.display = 'block';
        
        // Salva per copia
        currentSummary = summary;
    };
    
    // Copia negli appunti
    copyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(currentSummary);
            const originalText = copyBtn.textContent;
            copyBtn.textContent = '✅ Copiato!';
            copyBtn.style.background = 'rgba(76, 175, 80, 0.3)';
            setTimeout(() => {
                copyBtn.textContent = originalText;
                copyBtn.style.background = '';
            }, 2000);
        } catch (error) {
            console.error('Errore nella copia:', error);
            showError('Errore nella copia negli appunti');
        }
    });
    
    // Riassumi pagina
    summarizeBtn.addEventListener('click', async () => {
        if (!currentUser) {
            showError('Effettua prima il login');
            return;
        }
        
        try {
            showLoading();
            
            // Ottieni il contenuto della pagina corrente
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab) {
                throw new Error('Nessun tab attivo trovato');
            }
            
            // Ottieni token di auth
            const { authToken } = await chrome.storage.local.get(['authToken']);
            
            // Usa l'endpoint /summarize-url con autenticazione
            const response = await fetch(`${CONFIG.API_URL}/summarize-url`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({
                    url: tab.url,
                    lang: languageSelect.value
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Errore di rete' }));
                
                if (response.status === 429) {
                    throw new Error('Limite riassunti raggiunto. Upgrade a Premium per continuare.');
                }
                
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }
            
            const data = await response.json();
            console.log('Dati ricevuti dal popup:', data);
            
            // Aggiorna contatore utilizzo locale
            if (currentUser.usage) {
                currentUser.usage.used = (currentUser.usage.used || 0) + 1;
                await chrome.storage.local.set({ user: currentUser });
                updateUIForAuthState();
            }
            
            // Calcola tempo risparmiato come fa la modale
            let timeSavedText = '';
            if (data.stats) {
                const originalWordsCount = data.stats.originalWords || 0;
                const summaryWordsCount = data.stats.summaryWords || data.wordsCount || 0;
                
                // Parole risparmiate
                const wordsSaved = Math.max(0, originalWordsCount - summaryWordsCount);
                // Tempo risparmiato in minuti (220 parole/minuto)
                const timeSavedMinutes = wordsSaved / 220;
                
                // Formatta il tempo risparmiato
                if (timeSavedMinutes >= 1) {
                    const minutes = Math.floor(timeSavedMinutes);
                    const seconds = Math.round((timeSavedMinutes - minutes) * 60);
                    if (seconds > 0) {
                        timeSavedText = `${minutes}m ${seconds}s risparmiati`;
                    } else {
                        timeSavedText = `${minutes} min risparmiati`;
                    }
                } else {
                    const totalSeconds = Math.max(1, Math.round(timeSavedMinutes * 60));
                    timeSavedText = `${totalSeconds} sec risparmiati`;
                }
            }
            
            // Mostra risultato con i dati corretti
            showResult(
                data.summary || 'Riassunto non disponibile',
                data.title || tab.title,
                data.readingTimeMinutes,
                data.wordsCount,
                timeSavedText
            );
            
        } catch (error) {
            console.error('Errore:', error);
            showError(error.message || 'Errore generico');
        } finally {
            hideLoading();
        }
    });
    
    // Inizializzazione
    hideAll();
});