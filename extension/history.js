// history.js — pagina "I tuoi riassunti": tutti i riassunti degli ultimi 30 giorni
// (chrome.storage.local.summaryHistory, scritto da content.js), con ricerca e lettura.
(function () {
  const t = (key, subs, fallback = '') => {
    try { const m = chrome.i18n.getMessage(key, subs); if (m) return m; } catch (e) { /* noop */ }
    return fallback;
  };
  const BRAND = window.__BRAND__ || null;
  const DAY = 24 * 60 * 60 * 1000;
  const KEEP_DAYS = 30;
  const locale = t('locale_code', undefined, 'en');
  document.documentElement.lang = locale;

  for (const el of document.querySelectorAll('[data-i18n]')) {
    const v = t(el.getAttribute('data-i18n')); if (v) el.textContent = v;
  }
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    const v = t(el.getAttribute('data-i18n-placeholder')); if (v) el.setAttribute('placeholder', v);
  }
  for (const el of document.querySelectorAll('[data-i18n-aria]')) {
    const v = t(el.getAttribute('data-i18n-aria')); if (v) el.setAttribute('aria-label', v);
  }
  const brandName = (BRAND && BRAND.displayName) || 'LemonSqueezer';
  document.getElementById('brandName').textContent = brandName;
  document.title = `${t('history_title', undefined, 'Your summaries')} - ${brandName}`;

  const list = document.getElementById('list');
  const read = document.getElementById('read');
  const q = document.getElementById('q');
  const count = document.getElementById('count');
  let entries = [];
  let current = 0;

  const el = (tag, attrs = {}, text) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = String(text);
    return n;
  };

  function source(entry) {
    let host = '';
    if (!/^pdf:/i.test(entry.url || '')) try { host = new URL(entry.url).hostname.replace(/^www\./, ''); } catch (e) { /* URL non valido */ }
    const isPdf = entry.sourceType === 'pdf' || /\.pdf($|\?|#)/i.test(entry.url || '');
    if (!host) host = t('history_local_file', undefined, 'local file');
    return { host, badge: isPdf ? 'PDF' : host.replace(/[^a-z0-9]/gi, '').slice(0, 2) || '·', isWeb: /^https?:/i.test(entry.url || '') };
  }

  function lengthName(sq) {
    return { 10: t('popup_len_short', undefined, 'Short'), 20: t('popup_len_medium', undefined, 'Medium'), 50: t('popup_len_long', undefined, 'Long') }[sq] || '';
  }

  // Oggi, Ieri, Questa settimana, Prima: con 30 giorni bastano quattro gruppi.
  function groupOf(ts) {
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    const s = startToday.getTime();
    if (ts >= s) return t('history_today', undefined, 'Today');
    if (ts >= s - DAY) return t('history_yesterday', undefined, 'Yesterday');
    if (ts >= s - 6 * DAY) return t('history_this_week', undefined, 'This week');
    return t('history_earlier', undefined, 'Earlier');
  }

  function shortTime(ts) {
    const d = new Date(ts);
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    return ts >= startToday.getTime() - DAY
      ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  }

  function summaryText(entry) {
    if (entry.summary) return String(entry.summary);
    if (entry.output && typeof entry.output === 'object') {
      return Object.entries(entry.output).map(([k, v]) => Array.isArray(v)
        ? `${k.replace(/_/g, ' ')}\n${v.map((x) => `- ${x}`).join('\n')}`
        : (v != null && typeof v !== 'object' ? `${k.replace(/_/g, ' ')}: ${v}` : '')).filter(Boolean).join('\n\n');
    }
    return '';
  }

  async function load() {
    const { summaryHistory = [] } = await chrome.storage.local.get(['summaryHistory']);
    const cutoff = Date.now() - KEEP_DAYS * DAY;
    entries = summaryHistory.filter((e) => (e.timestamp || 0) >= cutoff);
    current = Math.min(current, Math.max(0, entries.length - 1));
    count.textContent = t('history_count', [String(entries.length)], `${entries.length} summaries from the last 30 days, saved only on this computer`);
    renderList();
    renderRead();
  }

  function renderList() {
    list.textContent = '';
    const term = q.value.trim().toLowerCase();
    const rows = entries.map((e, i) => ({ e, i })).filter(({ e }) => !term
      || `${e.title || ''} ${e.url || ''}`.toLowerCase().includes(term));
    if (!rows.length) {
      list.appendChild(el('p', { class: 'none' }, entries.length
        ? t('history_none', undefined, 'No summaries found.')
        : t('history_empty', undefined, 'Summaries from the last 30 days will appear here.')));
      return;
    }
    let lastGroup = '';
    for (const { e, i } of rows) {
      const g = groupOf(e.timestamp);
      if (g !== lastGroup) { list.appendChild(el('h3', { class: 'day' }, g)); lastGroup = g; }
      const { host, badge } = source(e);
      const btn = el('button', { class: 'item', type: 'button', 'aria-current': String(i === current) });
      btn.dataset.i = String(i);
      const info = el('span');
      info.append(el('b', {}, e.title || e.url), el('small', {}, [host, lengthName(e.squeeze)].filter(Boolean).join(' · ')));
      btn.append(el('span', { class: 'fav' }, badge), info, el('time', {}, shortTime(e.timestamp)));
      list.appendChild(btn);
    }
  }

  function renderRead() {
    read.textContent = '';
    const e = entries[current];
    if (!e) { read.appendChild(el('p', { class: 'empty' }, t('history_empty', undefined, 'Summaries from the last 30 days will appear here.'))); return; }
    const { host, badge, isWeb } = source(e);
    const sheet = el('article', { class: 'sheet' });

    const src = el('div', { class: 'src' });
    src.append(el('span', { class: 'fav' }, badge), document.createTextNode(`${host} · ${new Date(e.timestamp).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`));
    sheet.append(src, el('h2', {}, e.title || e.url));

    const meta = el('div', { class: 'meta' });
    if (e.squeeze) meta.appendChild(el('span', { class: 'chip juice' }, `${lengthName(e.squeeze)} · ${t('popup_len_sub', [String(e.squeeze)], `about ${e.squeeze}% of the text`)}`));
    const st = e.stats || {};
    if (st.originalWords > 0 && st.summaryWords > 0) {
      meta.appendChild(el('span', { class: 'chip' }, t('history_words', [st.originalWords.toLocaleString(locale), st.summaryWords.toLocaleString(locale)], `${st.originalWords} words cut to ${st.summaryWords}`)));
      const mins = Math.round((st.originalWords - st.summaryWords) / 220);
      if (mins >= 1) meta.appendChild(el('span', { class: 'chip' }, t('history_saved_min', [String(mins)], `about ${mins} min saved`)));
    }
    if (meta.children.length) sheet.appendChild(meta);

    // Corpo: righe che iniziano con un trattino o un pallino diventano un elenco.
    const body = el('div', { class: 'body' });
    let ul = null;
    for (const raw of summaryText(e).split('\n')) {
      const line = raw.trim();
      if (!line) { ul = null; continue; }
      const bullet = line.match(/^[•\-*]\s*(.*)$/);
      if (bullet) { if (!ul) { ul = el('ul'); body.appendChild(ul); } ul.appendChild(el('li', {}, bullet[1])); }
      else { ul = null; body.appendChild(el('p', {}, line)); }
    }
    sheet.appendChild(body);

    const actions = el('div', { class: 'actions' });
    if (isWeb) {
      const open = el('a', { class: 'btn dark', href: e.url, target: '_blank', rel: 'noopener noreferrer' }, t('history_open', undefined, 'Open the original page'));
      actions.appendChild(open);
    }
    const copy = el('button', { class: 'btn', type: 'button' }, t('history_copy', undefined, 'Copy'));
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(`${e.title || ''}\n\n${summaryText(e)}\n\n${e.url || ''}`.trim());
        copy.textContent = t('history_copied', undefined, 'Copied');
        setTimeout(() => { copy.textContent = t('history_copy', undefined, 'Copy'); }, 2000);
      } catch (err) { /* appunti non disponibili */ }
    });
    const del = el('button', { class: 'btn del', type: 'button' }, t('history_delete', undefined, 'Delete'));
    del.addEventListener('click', async () => {
      const { summaryHistory = [] } = await chrome.storage.local.get(['summaryHistory']);
      await chrome.storage.local.set({ summaryHistory: summaryHistory.filter((x) => !(x.url === e.url && x.timestamp === e.timestamp)) });
    });
    actions.append(copy, del);
    sheet.appendChild(actions);
    read.appendChild(sheet);
  }

  list.addEventListener('click', (ev) => {
    const b = ev.target.closest('.item');
    if (!b) return;
    current = Number(b.dataset.i);
    renderList();
    renderRead();
    read.scrollTop = 0;
  });
  q.addEventListener('input', renderList);
  // Un riassunto nuovo fatto in un'altra scheda, o una voce eliminata: si ricarica.
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.summaryHistory) load(); });
  load();
})();
