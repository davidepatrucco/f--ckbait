// Guard sulle playlist HLS.
//
// ffmpeg, dato un URL, apre da solo tutto ciò a cui la playlist rimanda: varianti,
// segmenti e chiavi di cifratura. Quelle richieste non passano dal guard SSRF, quindi
// una playlist ostile poteva indirizzarlo verso destinazioni che il guard avrebbe
// rifiutato. Qui si verifica che ogni URI referenziato venga estratto e validato, e
// che la playlist riscritta contenga solo destinazioni già controllate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPlaylistUris, rewritePlaylist, looksLikePlaylist } from '../src/hls-guard.mjs';

const BASE = 'https://cdn.example.com/video/master.m3u8';

test('riconosce una playlist da estensione o content-type', () => {
    assert.equal(looksLikePlaylist('https://x/y/master.m3u8'), true);
    assert.equal(looksLikePlaylist('https://x/y/master.m3u8?token=abc'), true);
    assert.equal(looksLikePlaylist('https://x/y/video.mp4', 'application/vnd.apple.mpegurl'), true);
    assert.equal(looksLikePlaylist('https://x/y/video.mp4'), false);
});

test('estrae i segmenti e anche gli URI dentro gli attributi', () => {
    const playlist = [
        '#EXTM3U',
        '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/key.bin",IV=0x00',
        '#EXT-X-MAP:URI="init.mp4"',
        '#EXTINF:10,',
        'seg1.ts',
        '#EXTINF:10,',
        'https://cdn.example.com/video/seg2.ts'
    ].join('\n');
    const uris = extractPlaylistUris(playlist).map((u) => u.value);
    // Le chiavi di cifratura e le mappe di inizializzazione sono accessi di rete
    // come i segmenti: ignorarli lascerebbe un canale non controllato.
    assert.ok(uris.includes('https://cdn.example.com/key.bin'), 'chiave di cifratura non estratta');
    assert.ok(uris.includes('init.mp4'), 'mappa di inizializzazione non estratta');
    assert.ok(uris.includes('seg1.ts') && uris.includes('https://cdn.example.com/video/seg2.ts'));
    assert.equal(uris.length, 4);
});

test('gli URI relativi vengono risolti in assoluto', async () => {
    const playlist = '#EXTM3U\n#EXTINF:10,\nseg1.ts\n#EXTINF:10,\n../altro/seg2.ts\n';
    const seen = [];
    const { text, count } = await rewritePlaylist(playlist, BASE, async (uri, base) => {
        const abs = new URL(uri, base).toString();
        seen.push(abs);
        return abs;
    });
    assert.equal(count, 2);
    assert.deepEqual(seen, [
        'https://cdn.example.com/video/seg1.ts',
        'https://cdn.example.com/altro/seg2.ts'
    ]);
    assert.ok(text.includes('https://cdn.example.com/video/seg1.ts'), 'la playlist riscritta deve contenere URI assoluti');
    assert.ok(!/^seg1\.ts$/m.test(text), 'nessun URI relativo deve sopravvivere');
});

test('ogni URI passa dal validatore: nessuno sfugge', async () => {
    const playlist = [
        '#EXTM3U',
        '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/key.bin"',
        '#EXTINF:10,', 'seg1.ts',
        '#EXTINF:10,', 'seg2.ts'
    ].join('\n');
    let validated = 0;
    const { count } = await rewritePlaylist(playlist, BASE, async (uri, base) => {
        validated++;
        return new URL(uri, base).toString();
    });
    assert.equal(validated, 3, 'chiave + due segmenti devono essere tutti validati');
    assert.equal(count, 3);
});

test('un URI rifiutato dal validatore interrompe la riscrittura', async () => {
    // È il caso che conta: un segmento verso un indirizzo interno non deve poter
    // finire nella playlist data a ffmpeg.
    const playlist = '#EXTM3U\n#EXTINF:10,\nhttp://169.254.169.254/latest/meta-data\n';
    await assert.rejects(
        () => rewritePlaylist(playlist, BASE, async (uri) => {
            if (/169\.254|127\.0\.0\.1|localhost/.test(uri)) {
                const e = new Error('indirizzo non consentito'); e.code = 'BLOCKED_URL'; throw e;
            }
            return uri;
        }),
        /indirizzo non consentito/
    );
});

test('un protocollo non http finisce comunque al validatore', async () => {
    // file:// darebbe a ffmpeg accesso al filesystem della funzione.
    const playlist = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="file:///etc/passwd"\n#EXTINF:10,\nseg1.ts\n';
    const rejected = [];
    await assert.rejects(
        () => rewritePlaylist(playlist, BASE, async (uri, base) => {
            const abs = new URL(uri, base);
            if (!['http:', 'https:'].includes(abs.protocol)) {
                rejected.push(abs.protocol);
                const e = new Error(`protocollo non consentito: ${abs.protocol}`); e.code = 'BLOCKED_URL'; throw e;
            }
            return abs.toString();
        }),
        /protocollo non consentito/
    );
    assert.deepEqual(rejected, ['file:']);
});

test('i commenti senza URI restano invariati', async () => {
    const playlist = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nseg1.ts\n#EXT-X-ENDLIST\n';
    const { text } = await rewritePlaylist(playlist, BASE, async (u, b) => new URL(u, b).toString());
    for (const tag of ['#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:10', '#EXT-X-ENDLIST']) {
        assert.ok(text.includes(tag), `${tag} alterato`);
    }
});

test('il worker confina i protocolli di ffmpeg', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../lambda/transcribe-worker.mjs', import.meta.url), 'utf8');
    assert.match(src, /-protocol_whitelist/, 'senza la lista, ffmpeg accetta anche file:// e data:');
    assert.ok(!/protocol_whitelist',\s*'[^']*\bdata\b/.test(src), 'data: non deve essere consentito');
    // Il cap di durata va applicato all'ingresso, non dopo l'elaborazione.
    const inputIdx = src.indexOf("'-i', mediaUrl");
    const capIdx = src.indexOf("'-t',");
    assert.ok(capIdx > 0 && capIdx < inputIdx, 'il cap di durata deve precedere l’input');
});
