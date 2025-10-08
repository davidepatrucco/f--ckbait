// popup.js - Gestione del popup dell'estensione LemonSqueezer

// Configurazione hard-coded
const CONFIG = {
    API_URL: 'https://8udffsiwnc.execute-api.eu-west-1.amazonaws.com/dev',
    API_KEY: 'sk-test-key'
};

document.addEventListener('DOMContentLoaded', async () => {
    const languageSelect = document.getElementById('language');
    const summarizeBtn = document.getElementById('summarizeBtn');
    const copyBtn = document.getElementById('copyBtn');
    const loadingDiv = document.getElementById('loading');
    const resultDiv = document.getElementById('result');
    const bulletList = document.getElementById('bulletList');
    const statsSection = document.getElementById('statsSection');
    const statsText = document.getElementById('statsText');
    const errorDiv = document.getElementById('error');
    
    let currentSummary = '';
    
    // Carica lingua salvata
    const savedConfig = await chrome.storage.local.get(['language']);
    if (savedConfig.language) languageSelect.value = savedConfig.language;
    
    // Salva configurazione quando cambia la lingua
    const saveConfig = async () => {
        await chrome.storage.local.set({
            language: languageSelect.value
        });
    };
    
    languageSelect.addEventListener('change', saveConfig);
    
    // Mostra errore
    const showError = (message) => {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
        setTimeout(() => {
            errorDiv.style.display = 'none';
        }, 5000);
    };
    
    // Nasconde risultati precedenti
    const hideResults = () => {
        resultDiv.style.display = 'none';
        copyBtn.style.display = 'none';
        errorDiv.style.display = 'none';
    };
    
    // Mostra loading
    const showLoading = (show) => {
        loadingDiv.style.display = show ? 'block' : 'none';
        summarizeBtn.disabled = show;
    };
    
    // Evento click sul pulsante riassumi
    summarizeBtn.addEventListener('click', async () => {
        const language = languageSelect.value;
        
        hideResults();
        showLoading(true);
        
        try {
            // Ottieni il tab attivo
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab) {
                throw new Error('Impossibile accedere al tab attivo');
            }
            
            // Inietta il content script se necessario ed estrai il contenuto
            let pageData;
            try {
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    function: extractPageContent
                });
                pageData = results[0].result;
            } catch (injectionError) {
                throw new Error('Impossibile accedere al contenuto della pagina');
            }
            
            if (!pageData.text || pageData.text.length < 50) {
                throw new Error('Contenuto della pagina troppo breve o non accessibile');
            }
            
            // Chiama il backend
            const response = await fetch(`${CONFIG.API_URL}/summarize`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': CONFIG.API_KEY
                },
                body: JSON.stringify({
                    url: pageData.url,
                    title: pageData.title,
                    text: pageData.text,
                    lang: language
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Errore sconosciuto' }));
                throw new Error(errorData.error || `Errore HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data.summary || !Array.isArray(data.bullets)) {
                throw new Error('Risposta del server non valida');
            }
            
            // Mostra i risultati
            bulletList.innerHTML = '';
            // Mostra solo i bullet points del riassunto, senza la statistica finale
            const summaryBullets = data.bullets.slice(0, -1); // Rimuovi l'ultimo elemento (statistica)
            summaryBullets.forEach(bullet => {
                const li = document.createElement('li');
                li.textContent = bullet;
                bulletList.appendChild(li);
            });
            
            // Mostra le statistiche se disponibili
            if (data.stats) {
                const timeSavedMsg = data.bullets[data.bullets.length - 1]; // Ultimo elemento
                statsText.textContent = timeSavedMsg;
                statsSection.style.display = 'block';
            } else {
                statsSection.style.display = 'none';
            }
            
            currentSummary = summaryBullets.join('\n• ');
            resultDiv.style.display = 'block';
            copyBtn.style.display = 'block';
            
        } catch (error) {
            console.error('Errore durante il riassunto:', error);
            showError(error.message || 'Errore durante il riassunto');
        } finally {
            showLoading(false);
        }
    });
    
    // Evento click sul pulsante copia
    copyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(`• ${currentSummary}`);
            copyBtn.textContent = '✅ Copiato!';
            setTimeout(() => {
                copyBtn.textContent = '📋 Copia negli appunti';
            }, 2000);
        } catch (error) {
            showError('Impossibile copiare negli appunti');
        }
    });
});

// Funzione per estrarre il contenuto della pagina (sarà eseguita nel content script)
function extractPageContent() {
    // Funzione per estrarre testo leggibile (implementazione semplificata di Readability)
    function getReadableText() {
        // Rimuovi elementi non desiderati
        const elementsToRemove = document.querySelectorAll(
            'script, style, nav, header, footer, aside, .ad, .advertisement, ' +
            '.social, .share, .comment, .sidebar, .menu, .navigation'
        );
        
        const clone = document.cloneNode(true);
        const cloneElementsToRemove = clone.querySelectorAll(
            'script, style, nav, header, footer, aside, .ad, .advertisement, ' +
            '.social, .share, .comment, .sidebar, .menu, .navigation'
        );
        
        cloneElementsToRemove.forEach(el => el.remove());
        
        // Cerca il contenuto principale
        const contentSelectors = [
            'article',
            'main',
            '.content',
            '.post',
            '.article',
            '#content',
            '#main',
            '.entry-content',
            '.post-content'
        ];
        
        let mainContent = null;
        for (const selector of contentSelectors) {
            const element = clone.querySelector(selector);
            if (element && element.textContent.trim().length > 200) {
                mainContent = element;
                break;
            }
        }
        
        // Fallback al body se non troviamo contenuto specifico
        if (!mainContent) {
            mainContent = clone.body || clone;
        }
        
        // Estrai il testo
        let text = mainContent.textContent || mainContent.innerText || '';
        
        // Pulisci il testo
        text = text
            .replace(/\s+/g, ' ')  // Normalizza spazi
            .replace(/\n\s*\n/g, '\n')  // Rimuovi righe vuote multiple
            .trim();
        
        // Tronca se troppo lungo (120k caratteri come da spec)
        if (text.length > 120000) {
            text = text.substring(0, 120000) + '...';
        }
        
        return text;
    }
    
    return {
        url: window.location.href,
        title: document.title,
        text: getReadableText()
    };
}