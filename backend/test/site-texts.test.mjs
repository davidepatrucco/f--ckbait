// Foglio Google <-> testi del sito (scripts/site-texts.mjs): un CSV sbagliato non deve
// arrivare online, e il giro JSON -> CSV -> JSON non deve alterare nessun testo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { toCsv, fromCsv, parseCsv, LANGS } from '../../scripts/site-texts.mjs';

const I18N = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps', 'website', 'i18n');
const dicts = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(readFileSync(join(I18N, `${l}.json`), 'utf8'))]));

test('JSON -> CSV -> JSON restituisce gli stessi testi', () => {
    const back = fromCsv(toCsv(dicts));
    assert.deepEqual(back.errors, []);
    assert.deepEqual(back.dicts, dicts);
});

test('celle con virgole, virgolette e a capo', () => {
    assert.deepEqual(parseCsv('a,"b, c","d ""e""","f\ng"\r\n'), [['a', 'b, c', 'd "e"', 'f\ng']]);
});

test('cella vuota, chiave ripetuta o colonna mancante: rifiutato', () => {
    const ok = 'key,en,it,es,fr,de\nx,1,2,3,4,5\n';
    assert.deepEqual(fromCsv(ok).errors, []);
    assert.match(fromCsv('key,en,it,es,fr,de\nx,1,2,,4,5\n').errors.join(), /manca es/);
    assert.match(fromCsv(ok + 'x,1,2,3,4,5\n').errors.join(), /ripetuta x/);
    assert.match(fromCsv('key,en,it,es,fr\nx,1,2,3,4\n').errors.join(), /colonna mancante: de/);
});
