// summary.js — pagina risultati (usata per i PDF, dove il viewer non ospita content
// script). Il service worker scrive il risultato in storage e apre questa scheda.
(function () {
  // i18n: stringhe in _locales/<lang>/messages.json, lingua = quella del browser.
  // Mai restituire la chiave: senza catalogo si degrada a un testo inglese leggibile.
  const t = (key, subs, fallback = 'Summary') => {
    try { const m = chrome.i18n.getMessage(key, subs); if (m) return m; } catch (e) { /* noop */ }
    return fallback;
  };
  const BRAND = (typeof window !== 'undefined' && window.__BRAND__) ? window.__BRAND__ : null;
  const primary = BRAND?.tokens?.colors?.primary || '#FFD400';
  document.documentElement.style.setProperty('--p', primary);
  const brandName = BRAND?.storeName || BRAND?.displayName || t('summarypage_title');
  document.getElementById('brand').textContent = brandName;
  document.title = brandName;

  const root = document.getElementById('root');
  const el = (t, txt) => { const e = document.createElement(t); if (txt != null) e.textContent = String(txt); return e; };

  function renderError(message) {
    root.innerHTML = '';
    const d = el('div'); d.className = 'error'; d.textContent = message || t('summarypage_generic_error');
    root.appendChild(d);
  }

  function renderResult(payload) {
    const data = payload?.data || {};
    const url = payload?.url || data.originalUrl || data.url || '';
    root.innerHTML = '';
    root.appendChild(Object.assign(el('h1', data.title || t('summarypage_title')), {}));
    if (url) {
      const src = el('div'); src.className = 'src';
      const a = el('a', url); a.href = url; a.target = '_blank'; src.appendChild(a); root.appendChild(src);
    }
    if (data.truncated) {
      const n = el('div'); n.className = 'note';
      n.textContent = `⚠️ ${t('summarypage_truncated')}`;
      n.style.cssText = 'background:#FFF7E6;border:1px solid #FFE1A8;color:#8a6d3b;border-radius:6px;padding:8px 10px;font-size:12px;';
      root.appendChild(n);
    }
    // Schema summary (testo) oppure output strutturato (brand): render generico.
    if (data.summary || data.text) {
      const c = el('div'); c.className = 'content'; c.textContent = data.summary || data.text; root.appendChild(c);
    } else if (data.output && typeof data.output === 'object') {
      for (const [k, v] of Object.entries(data.output)) {
        if (Array.isArray(v) && v.length) {
          root.appendChild(el('h4', k.replace(/_/g, ' ')));
          const ul = el('ul'); v.forEach((it) => ul.appendChild(el('li', it))); root.appendChild(ul);
        } else if (v != null && typeof v !== 'object') {
          const p = el('div'); p.className = 'note'; p.appendChild(el('b', k.replace(/_/g, ' ') + ': ')); p.appendChild(el('span', v)); root.appendChild(p);
        }
      }
    } else {
      renderError(t('summarypage_no_summary'));
    }
  }

  async function boot() {
    try {
      const { pendingSummary } = await chrome.storage.local.get(['pendingSummary']);
      if (!pendingSummary) { renderError(t('summarypage_none_queued')); return; }
      if (pendingSummary.error) { renderError(pendingSummary.error); }
      else { renderResult(pendingSummary); }
      // one-shot: pulisci per non mostrare un risultato vecchio alla prossima apertura.
      await chrome.storage.local.remove('pendingSummary');
    } catch (e) {
      renderError(t('summarypage_load_error'));
    }
  }
  boot();
})();
