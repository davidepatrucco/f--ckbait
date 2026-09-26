// publicFetch valida l'IP nella stessa risoluzione usata dal socket: un nome che
// risolve a un indirizzo interno viene rifiutato anche senza assertPublicUrl prima.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { publicFetch } from '../src/web-fetcher.mjs';

test('publicFetch rifiuta un host che risolve a loopback', async () => {
    const server = createServer((req, res) => res.end('interno'));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    try {
        // Controllo: il server e' raggiungibile con il fetch globale.
        assert.equal(await (await fetch(`http://localhost:${port}/`)).text(), 'interno');
        await assert.rejects(publicFetch(`http://localhost:${port}/`));
    } finally {
        server.close();
    }
});
