// Parser dell'output "summary" (bullet). Il rischio coperto: il modello restituisce i
// bullet in forme diverse (JSON, righe, prosa) e il renderer aggiunge sempre "• " —
// se il parser non normalizza il segno di elenco, in UI compaiono due segni.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/schemas/summary.mjs';

test('estrae i bullet da un array JSON', () => {
    assert.deepEqual(parse(JSON.stringify({ bullets: ['Primo', 'Secondo'] })), ['Primo', 'Secondo']);
});

test('estrae i bullet da righe multiple', () => {
    assert.deepEqual(parse('• Primo punto.\n• Secondo punto.'), ['Primo punto.', 'Secondo punto.']);
});

// Regressione: un output su una riga sola che inizia con "•" conservava il segno e il
// renderer ne aggiungeva un secondo, producendo "• • testo" in UI (osservato dal vivo
// su piu' riassunti a bullet singolo).
test('rimuove il segno di elenco anche su riga singola', () => {
    assert.deepEqual(parse('• La fotosintesi avviene nei cloroplasti.'), ['La fotosintesi avviene nei cloroplasti.']);
    assert.deepEqual(parse('- Un solo punto.'), ['Un solo punto.']);
    assert.deepEqual(parse('1. Primo e unico.'), ['Primo e unico.']);
});

test('nessun segno di elenco residuo, in nessun ramo del parser', () => {
    const inputs = [
        '• Uno.',
        '• Uno. Due.',
        '• Uno.\n• Due.',
        'Uno. Due.',
        '- Uno.\n- Due.',
        '1) Uno.\n2) Due.',
        JSON.stringify({ bullets: ['• Uno', 'Due'] }),
        JSON.stringify({ summary: '• Uno. Due.' }),
        JSON.stringify(['– Uno', '* Due'])
    ];
    for (const input of inputs) {
        const bullets = parse(input);
        assert.ok(bullets.length > 0, `nessun bullet da ${JSON.stringify(input)}`);
        for (const bullet of bullets) {
            assert.ok(
                !/^\s*(?:[•*–-]|\d+[.)])\s/.test(bullet),
                `segno residuo in "${bullet}" da input ${JSON.stringify(input)}`
            );
        }
    }
});

test('scarta le voci vuote', () => {
    assert.deepEqual(parse(JSON.stringify({ bullets: ['Uno', '', '  ', 'Due'] })), ['Uno', 'Due']);
});
