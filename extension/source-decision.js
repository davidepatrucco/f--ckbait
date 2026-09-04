// source-decision.js — logica PURA di scelta della fonte da riassumere.
//
// Caricato in tre contesti, senza dipendenze:
//  1. content script (manifest content_scripts, prima di content.js)
//  2. service worker (importScripts) — serve parseVtt
//  3. test Node (node:vm) — si testa il file spedito, non una copia
//
// Stadi del flusso: probe (DOM) -> decide (qui, puro) -> esecuzione (rete+UI).
// Le regole sono ORDINATE e chiuse da un catch-all: ogni input mappa a
// esattamente un'azione (proprietà verificata dal test cartesiano).
(function (root) {
    'use strict';

    // Soglie condivise con content.js/backend.
    var C = {
        MIN_TEXT: 400,            // testo "sostanzioso" (sopra: l'articolo è contenuto vero)
        MIN_TEXT_USABLE: 50,      // testo minimo per un riassunto
        TOO_LONG_CHARS: 80000,    // oltre: nessun riassunto parziale
        MAX_TRANSCRIPT_CHARS: 120000, // limite backend /summarize-url
        VIDEO_MIN_SECONDS: 120,   // sotto: clip breve, non "il contenuto" della pagina
        STT_SYNC_MAX_SECONDS: 300,    // path sincrono (24MB, entro i 29s di API Gateway)
        STT_ASYNC_MAX_SECONDS: 10800  // path asincrono (job): fino a 3h
    };

    // --- selezione traccia sottotitoli -------------------------------------
    // Preferenze: kind captions/subtitles > altro; lingua utente > it > en > prima.
    function pickCaptionTrack(tracks, userLang) {
        if (!Array.isArray(tracks) || !tracks.length) return null;
        var pref = [];
        if (userLang) pref.push(String(userLang).slice(0, 2).toLowerCase());
        pref.push('it', 'en');
        var usable = tracks.filter(function (t) { return t && t.url; });
        if (!usable.length) return null;
        var kindOk = function (t) {
            var k = String(t.kind || '').toLowerCase();
            return k === '' || k === 'captions' || k === 'subtitles';
        };
        var byKind = usable.filter(kindOk);
        var pool = byKind.length ? byKind : usable;
        for (var i = 0; i < pref.length; i++) {
            var want = pref[i];
            for (var j = 0; j < pool.length; j++) {
                var lang = String(pool[j].lang || '').toLowerCase();
                if (lang === want || lang.indexOf(want + '-') === 0) return pool[j];
            }
        }
        return pool[0];
    }

    // Player JS senza <track>: gli URL .vtt si trovano scandendo la pagina, e
    // possono appartenere ad ALTRI video (es. altri post nel feed). Si preferiscono
    // quelli il cui URL condivide un id lungo con l'URL della pagina.
    function correlateVttUrls(urls, pageUrl) {
        var list = (Array.isArray(urls) ? urls : []).filter(Boolean);
        if (list.length <= 1) return list;
        var ids = String(pageUrl || '').match(/\d{5,}/g) || [];
        if (!ids.length) return list;
        var matched = list.filter(function (u) {
            for (var i = 0; i < ids.length; i++) if (String(u).indexOf(ids[i]) !== -1) return true;
            return false;
        });
        return matched.length ? matched : list;
    }

    // --- parsing WebVTT ----------------------------------------------------
    // Scarta header/cue-number/timestamp/blocchi NOTE-STYLE-REGION, rimuove i tag
    // inline (<v Autore>, <c.class>, <00:00:01.000>) e deduplica le righe ripetute
    // consecutive (sottotitoli "a scorrimento"). Tollera anche input SRT.
    function parseVtt(input) {
        var s = String(input || '');
        if (!s.trim()) return '';
        s = s.replace(/\r\n?/g, '\n');
        var lines = s.split('\n');
        var out = [];
        var prev = '';
        var skipBlock = false;
        for (var i = 0; i < lines.length; i++) {
            var l = lines[i].trim();
            if (!l) { skipBlock = false; continue; }
            if (/^WEBVTT/.test(l)) { continue; }
            if (/^(NOTE|STYLE|REGION)\b/.test(l)) { skipBlock = true; continue; }
            if (skipBlock) continue;
            if (l.indexOf('-->') !== -1) continue;          // timestamp (+ eventuali setting)
            if (/^\d+$/.test(l)) continue;                   // numero di cue
            if (/^(Kind|Language):/i.test(l)) continue;      // metadati YouTube-style
            l = l.replace(/<[^>]*>/g, '')                    // tag inline
                .replace(/&nbsp;/gi, ' ')
                .replace(/&amp;/gi, '&')
                .replace(/&lt;/gi, '<')
                .replace(/&gt;/gi, '>')
                .replace(/&#39;|&apos;/gi, "'")
                .replace(/&quot;/gi, '"')
                .trim();
            if (!l) continue;
            if (l === prev) continue;                        // rolling captions
            out.push(l);
            prev = l;
        }
        return out.join(' ').replace(/\s+/g, ' ').trim();
    }

    // --- decisione ---------------------------------------------------------
    // inv = { text:{len,rawLen}, video:{present,prominent,isLive,durationSeconds,
    //         captionTracks:[],directMedia:{url,kind}}, blocked }
    // opts = { userLang, plan, asyncAvailable }
    function decideSummarySource(inventory, options) {
        var inv = inventory || {};
        var opts = options || {};
        var text = inv.text || {};
        var textLen = Number(text.len) || 0;
        var rawLen = Number(text.rawLen) || textLen;
        var video = inv.video || {};
        var blocked = inv.blocked || null;
        var isPremium = opts.plan === 'premium';
        var asyncOk = opts.asyncAvailable !== false;
        var hasText = textLen >= C.MIN_TEXT_USABLE;
        var richText = textLen >= C.MIN_TEXT;

        // 1. contenuto bloccato e nessun testo utile
        if (blocked && textLen < 200) return { action: 'UNSUPPORTED', code: blocked };

        if (video.present) {
            // 2. diretta: sottotitoli/contenuto parziali
            if (video.isLive) {
                if (richText) return { action: 'TEXT', note: 'VIDEO_SKIPPED_LIVE' };
                return { action: 'UNSUPPORTED', code: 'LIVE_STREAM' };
            }

            var tracks = Array.isArray(video.captionTracks) ? video.captionTracks : [];
            var duration = Number(video.durationSeconds) || 0;
            var longEnough = duration === 0 || duration >= C.VIDEO_MIN_SECONDS;

            // 3. sottotitoli disponibili: via preferita (qualsiasi durata, costo zero).
            //    Vince sul testo solo se il video è prominente e non è una clip breve;
            //    altrimenti il testo dell'articolo resta la fonte principale.
            if (tracks.length) {
                var track = pickCaptionTrack(tracks, opts.userLang);
                if (track && ((video.prominent && longEnough) || !richText)) {
                    return { action: 'VIDEO_CAPTIONS', trackUrl: track.url, trackLang: track.lang || null };
                }
                if (track) return { action: 'TEXT', note: 'VIDEO_AVAILABLE' };
            }

            // 4-5. nessun sottotitolo: trascrizione audio (premium).
            var media = video.directMedia && video.directMedia.url ? video.directMedia : null;
            if (media) {
                var isFile = (media.kind || 'file') === 'file';
                if (!isPremium) {
                    if (richText) return { action: 'TEXT', note: 'VIDEO_NEEDS_PREMIUM' };
                    return { action: 'UNSUPPORTED', code: 'PREMIUM_REQUIRED' };
                }
                if (isFile && duration > 0 && duration <= C.STT_SYNC_MAX_SECONDS) {
                    return { action: 'VIDEO_STT', mediaUrl: media.url };
                }
                if (asyncOk && duration <= C.STT_ASYNC_MAX_SECONDS) {
                    return { action: 'VIDEO_STT_ASYNC', mediaUrl: media.url, mediaKind: media.kind || 'file' };
                }
                if (!asyncOk && isFile && duration === 0) {
                    return { action: 'VIDEO_STT', mediaUrl: media.url };
                }
                if (richText) return { action: 'TEXT', note: 'VIDEO_TOO_LONG' };
                return { action: 'UNSUPPORTED', code: 'VIDEO_TOO_LONG_NO_CAPTIONS' };
            }

            // 6-7. video non accessibile (blob/MSE/DRM) e senza sottotitoli
            if (richText) return { action: 'TEXT', note: 'VIDEO_NOT_ACCESSIBLE' };
            if (rawLen > C.TOO_LONG_CHARS) return { action: 'UNSUPPORTED', code: 'TOO_LONG' };
            if (hasText) return { action: 'TEXT', note: 'VIDEO_NOT_ACCESSIBLE' };
            return { action: 'UNSUPPORTED', code: 'VIDEO_NOT_ACCESSIBLE' };
        }

        // 8. testo oltre soglia: nessun riassunto parziale
        if (rawLen > C.TOO_LONG_CHARS) return { action: 'UNSUPPORTED', code: 'TOO_LONG' };
        // 9. contenuto bloccato con testo insufficiente per essere utile
        if (blocked && !hasText) return { action: 'UNSUPPORTED', code: blocked };
        // 10. testo
        if (hasText) return { action: 'TEXT' };
        // 11. catch-all
        return { action: 'UNSUPPORTED', code: 'INSUFFICIENT_CONTENT' };
    }

    // Azioni e codici dichiarati: il test verifica che ogni codice prodotto dalla
    // decisione abbia un messaggio utente e che ogni azione sia gestita.
    var ACTIONS = ['VIDEO_CAPTIONS', 'VIDEO_STT', 'VIDEO_STT_ASYNC', 'TEXT', 'UNSUPPORTED'];
    var UNSUPPORTED_CODES = [
        'PAYWALL', 'LOGIN_WALL', 'CONSENT_WALL', 'CANVAS_DOC', 'BOT_CHALLENGE',
        'LIVE_STREAM', 'VIDEO_NOT_ACCESSIBLE', 'VIDEO_TOO_LONG_NO_CAPTIONS',
        'PREMIUM_REQUIRED', 'TOO_LONG', 'INSUFFICIENT_CONTENT'
    ];
    var NOTES = [
        'VIDEO_AVAILABLE', 'VIDEO_NOT_ACCESSIBLE', 'VIDEO_NEEDS_PREMIUM',
        'VIDEO_TOO_LONG', 'VIDEO_SKIPPED_LIVE', 'CAPTIONS_FAILED', 'STT_FAILED',
        'CAPTIONS_TRANSLATED', 'TRANSCRIPT_TRUNCATED'
    ];

    root.RI_SOURCE = {
        CONSTANTS: C,
        ACTIONS: ACTIONS,
        UNSUPPORTED_CODES: UNSUPPORTED_CODES,
        NOTES: NOTES,
        decideSummarySource: decideSummarySource,
        pickCaptionTrack: pickCaptionTrack,
        correlateVttUrls: correlateVttUrls,
        parseVtt: parseVtt
    };
})(typeof globalThis !== 'undefined' ? globalThis : self);
