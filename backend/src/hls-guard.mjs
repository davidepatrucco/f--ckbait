// hls-guard.mjs — validazione delle playlist HLS prima di passarle a ffmpeg.
//
// Problema: ffmpeg riceve un URL e poi apre da solo le risorse a cui la playlist
// rimanda (varianti, segmenti, chiavi di cifratura). Quelle richieste non passano
// dal guard SSRF JavaScript, quindi un .m3u8 ostile poteva indirizzare ffmpeg verso
// destinazioni che il guard avrebbe rifiutato.
//
// Soluzione: la playlist viene scaricata e analizzata qui. Ogni URI referenziato è
// risolto in assoluto e validato; se tutti passano, si scrive una playlist locale con
// URI assoluti già verificati e si dà a ffmpeg quel file. ffmpeg non deve più
// risolvere nulla in autonomia, e viene comunque confinato ai protocolli necessari.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertPublicUrl, publicFetch } from './web-fetcher.mjs';
import { MEDIA_LIMITS } from './policy.mjs';

// Una playlist è testo: oltre questa dimensione non è una playlist legittima.
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
// Profondità: master -> media playlist. Oltre è un rimando circolare o abusivo.
const MAX_PLAYLIST_DEPTH = 2;

function fail(code, message) {
    const e = new Error(message || code);
    e.code = code;
    return e;
}

export function looksLikePlaylist(urlStr, contentType = '') {
    const ct = String(contentType).toLowerCase();
    if (ct.includes('mpegurl')) return true;
    try {
        return /\.m3u8(\?|$)/i.test(new URL(urlStr).pathname + new URL(urlStr).search);
    } catch {
        return false;
    }
}

// Scarica un testo applicando il guard a ogni salto: `redirect: 'follow'`
// convaliderebbe solo l'URL iniziale.
async function fetchTextGuarded(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        let current = new URL(url);
        await assertPublicUrl(current);
        for (let hop = 0; ; hop++) {
            if (hop > MEDIA_LIMITS.maxRedirects) throw fail('MEDIA_FETCH_FAILED', 'troppi redirect sulla playlist');
            const res = await publicFetch(current, { signal: controller.signal, redirect: 'manual' });
            if ([301, 302, 303, 307, 308].includes(res.status)) {
                const location = res.headers.get('location');
                if (!location) throw fail('MEDIA_FETCH_FAILED', 'redirect senza destinazione');
                const next = new URL(location, current);
                if (!['http:', 'https:'].includes(next.protocol)) throw fail('BLOCKED_URL', 'redirect a protocollo non consentito');
                await assertPublicUrl(next);
                current = next;
                continue;
            }
            if (!res.ok) throw fail('MEDIA_FETCH_FAILED', `playlist HTTP ${res.status}`);
            const len = Number(res.headers.get('content-length') || 0);
            if (len > MAX_PLAYLIST_BYTES) throw fail('UNSUPPORTED_MEDIA', 'playlist troppo grande');
            const text = await res.text();
            if (text.length > MAX_PLAYLIST_BYTES) throw fail('UNSUPPORTED_MEDIA', 'playlist troppo grande');
            return { text, finalUrl: current };
        }
    } finally {
        clearTimeout(timer);
    }
}

// Estrae tutti gli URI referenziati da una playlist: righe non commentate (varianti o
// segmenti) più gli URI dentro gli attributi dei tag (chiavi di cifratura, mappe di
// inizializzazione, rendition audio separate). Ognuno è un accesso di rete che
// ffmpeg farebbe, quindi ognuno va validato.
export function extractPlaylistUris(text) {
    const uris = [];
    for (const rawLine of String(text).split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith('#')) {
            // URI="..." dentro EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA, EXT-X-SESSION-KEY…
            for (const m of line.matchAll(/URI\s*=\s*"([^"]+)"/gi)) uris.push({ value: m[1], inAttribute: true, line: rawLine });
            continue;
        }
        uris.push({ value: line, inAttribute: false, line: rawLine });
    }
    return uris;
}

// Valida e riscrive la playlist con URI assoluti già verificati.
// Ritorna { text, count } oppure lancia con .code = 'BLOCKED_URL'.
export async function rewritePlaylist(text, baseUrl, validate) {
    const out = [];
    let count = 0;
    for (const rawLine of String(text).split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) { out.push(rawLine); continue; }

        if (line.startsWith('#')) {
            if (!/URI\s*=\s*"/i.test(line)) { out.push(rawLine); continue; }
            let rewritten = rawLine;
            const matches = [...line.matchAll(/URI\s*=\s*"([^"]+)"/gi)];
            for (const m of matches) {
                const abs = await validate(m[1], baseUrl);
                rewritten = rewritten.replace(`"${m[1]}"`, `"${abs}"`);
                count++;
            }
            out.push(rewritten);
            continue;
        }

        const abs = await validate(line, baseUrl);
        out.push(abs);
        count++;
    }
    return { text: out.join('\n'), count };
}

// Scarica, valida e materializza la playlist su disco. Ritorna il percorso del file
// locale che ffmpeg deve leggere, oppure null se l'URL non è una playlist.
export async function materializePlaylist(mediaUrl, workDir, depth = 0) {
    if (depth >= MAX_PLAYLIST_DEPTH) throw fail('UNSUPPORTED_MEDIA', 'playlist annidata troppo in profondità');

    const { text, finalUrl } = await fetchTextGuarded(mediaUrl, MEDIA_LIMITS.fetchTimeoutMs);
    if (!/^#EXTM3U/m.test(text)) throw fail('UNSUPPORTED_MEDIA', 'non è una playlist HLS valida');

    const validate = async (uri, base) => {
        let abs;
        try { abs = new URL(uri, base); } catch { throw fail('BLOCKED_URL', `URI non valido nella playlist: ${uri.slice(0, 80)}`); }
        if (!['http:', 'https:'].includes(abs.protocol)) {
            // Blocca in particolare file:// e data:, che darebbero a ffmpeg accesso
            // al filesystem della funzione.
            throw fail('BLOCKED_URL', `protocollo non consentito nella playlist: ${abs.protocol}`);
        }
        await assertPublicUrl(abs);
        return abs.toString();
    };

    const { text: safeText, count } = await rewritePlaylist(text, finalUrl, validate);
    if (!count) throw fail('UNSUPPORTED_MEDIA', 'playlist senza segmenti');

    const path = join(workDir, `playlist_${depth}.m3u8`);
    await writeFile(path, safeText, 'utf8');
    return path;
}

export const _test = { MAX_PLAYLIST_BYTES, MAX_PLAYLIST_DEPTH };
