// Guard SSRF: casi trovati da un audit esterno, che il filtro precedente lasciava
// passare. Un indirizzo IPv6 puo' incapsulare un IPv4 in tre forme diverse, e il
// controllo per famiglia non le riconosceva.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateAddress, embeddedIPv4 } from '../src/web-fetcher.mjs';

test('IPv4 incapsulato in IPv6: tutte le forme vengono riconosciute', () => {
    assert.equal(embeddedIPv4('::ffff:127.0.0.1'), '127.0.0.1');
    assert.equal(embeddedIPv4('::ffff:7f00:1'), '127.0.0.1', 'forma esadecimale');
    assert.equal(embeddedIPv4('::ffff:169.254.169.254'), '169.254.169.254');
    assert.equal(embeddedIPv4('64:ff9b::127.0.0.1'), '127.0.0.1', 'NAT64');
    assert.equal(embeddedIPv4('2606:4700::1111'), null, 'IPv6 normale non incapsula nulla');
    assert.equal(embeddedIPv4('8.8.8.8'), null, 'un IPv4 non e\' un IPv6');
});

test('gli indirizzi interni mascherati da IPv6 sono bloccati', () => {
    for (const addr of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254',
        '64:ff9b::127.0.0.1', '::ffff:10.0.0.1', '::ffff:192.168.1.1', '::ffff:172.16.0.1']) {
        assert.equal(isPrivateAddress(addr), true, `${addr} deve essere bloccato`);
    }
});

test('gli indirizzi interni in forma nativa restano bloccati', () => {
    for (const addr of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254',
        '0.0.0.0', '::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', '100.64.0.1', '224.0.0.1']) {
        assert.equal(isPrivateAddress(addr), true, `${addr} deve essere bloccato`);
    }
});

test('gli indirizzi pubblici non vengono bloccati, nemmeno se incapsulati', () => {
    for (const addr of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700::1111', '::ffff:8.8.8.8']) {
        assert.equal(isPrivateAddress(addr), false, `${addr} non deve essere bloccato`);
    }
});

test('un valore che non e’ un indirizzo IP viene trattato come non sicuro', () => {
    // Il chiamante risolve il nome e ricontrolla gli indirizzi ottenuti: qui la
    // risposta prudente e' "privato" per non lasciare passare nulla per errore.
    assert.equal(isPrivateAddress('example.com'), true);
    assert.equal(isPrivateAddress('0177.0.0.1'), true, 'ottale: non e\' un IP valido, quindi prudenza');
    assert.equal(isPrivateAddress('2130706433'), true, 'decimale: idem');
});
