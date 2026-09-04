import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedMedia, fileNameFor, downloadMedia, _test } from '../src/transcribe.mjs';

test('isAllowedMedia — content-type noti', () => {
    assert.equal(isAllowedMedia('video/mp4', 'https://x/y.mp4'), true);
    assert.equal(isAllowedMedia('audio/mpeg', 'https://x/y'), true);
    assert.equal(isAllowedMedia('audio/webm; codecs=opus', 'https://x/y.webm'), true);
    assert.equal(isAllowedMedia('application/ogg', 'https://x/y.ogg'), true);
    assert.equal(isAllowedMedia('text/html', 'https://x/y.html'), false);
    assert.equal(isAllowedMedia('image/png', 'https://x/y.png'), false);
});

test('isAllowedMedia — octet-stream cade sull’estensione', () => {
    assert.equal(isAllowedMedia('application/octet-stream', 'https://x/clip.m4a'), true);
    assert.equal(isAllowedMedia('application/octet-stream', 'https://x/clip.mp4'), true);
    assert.equal(isAllowedMedia('application/octet-stream', 'https://x/clip'), false);
    assert.equal(isAllowedMedia('', 'https://x/clip.mp3'), true);
    assert.equal(isAllowedMedia('', 'https://x/clip'), false);
});

test('fileNameFor — estensione o content-type', () => {
    assert.equal(fileNameFor('https://x/a.mp4', ''), 'media.mp4');
    assert.equal(fileNameFor('https://x/a.webm', ''), 'media.webm');
    assert.equal(fileNameFor('https://x/a.m4a', ''), 'audio.m4a');
    assert.equal(fileNameFor('https://x/stream', 'audio/mpeg'), 'audio.mp3');
    assert.equal(fileNameFor('https://x/stream', 'video/webm'), 'media.mp4');
});

test('extOf — parsing estensione', () => {
    assert.equal(_test.extOf('https://x/a/b/c.MP4?y=1'), 'mp4');
    assert.equal(_test.extOf('https://x/novideo'), '');
});

test('downloadMedia — guard SSRF rifiuta indirizzi privati', async () => {
    await assert.rejects(() => downloadMedia('http://127.0.0.1/clip.mp4'), /privati|locali|pubblic/i);
    await assert.rejects(() => downloadMedia('http://[::1]/clip.mp4'), /privati|locali|pubblic/i);
});

test('downloadMedia — protocollo non http(s) rifiutato', async () => {
    await assert.rejects(() => downloadMedia('file:///etc/passwd'), (e) => e.code === 'INVALID_MEDIA_URL');
    await assert.rejects(() => downloadMedia('data:audio/mp3;base64,AAA'), (e) => e.code === 'INVALID_MEDIA_URL');
});
