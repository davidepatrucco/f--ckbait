// I file dell'estensione devono essere sintatticamente validi come moduli.
//
// Perche' esiste: `node --check file.js` su un file che contiene `import` lo tratta
// come CommonJS e fallisce per il motivo sbagliato, quindi NON rileva errori come
// `await` dentro una funzione non async. Un errore del genere e' stato realmente
// introdotto ed e' passato indenne da `node --check`. Qui ogni file viene compilato
// con il parser dei MODULI, lo stesso che usa il browser.
//
// La compilazione gira in un processo figlio con --experimental-vm-modules, cosi' il
// test vale comunque, senza dipendere da come viene invocata la suite (un test che
// si auto-salta quando manca un flag e' un test che non protegge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILES = ['popup.js', 'content.js', 'service_worker.js', 'summary.js', 'source-decision.js'];

function compileAsModule(file) {
    const script = `
        const { readFileSync } = await import('node:fs');
        const vm = await import('node:vm');
        const src = readFileSync(${JSON.stringify(join(ROOT, 'extension', file))}, 'utf8');
        new vm.SourceTextModule(src);
    `;
    try {
        execFileSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', script], {
            stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8'
        });
        return null;
    } catch (err) {
        const stderr = String(err.stderr || err.message);
        // Scarta il rumore dell'avviso sperimentale, tiene l'errore vero.
        const line = stderr.split('\n').find((l) => /Error|error/.test(l) && !/ExperimentalWarning/.test(l));
        return line ? line.trim() : stderr.slice(0, 200);
    }
}

for (const file of FILES) {
    test(`extension/${file} compila come modulo`, () => {
        const error = compileAsModule(file);
        assert.equal(error, null, `errore di sintassi in ${file}: ${error}`);
    });
}
