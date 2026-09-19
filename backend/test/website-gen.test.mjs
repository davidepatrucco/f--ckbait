// Generatore del sito marketing (apps/website). Si verifica cio' che, se rotto, finirebbe
// pubblicato: valori del brand non escapati, dizionari con chiavi diverse fra lingue
// (placeholder grezzi in una sola lingua), colore del testo sul pulsante illeggibile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { render, onColor, htmlEscape, LANGS } from '../../apps/website/generate-site.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = join(ROOT, 'apps', 'website');

test('i dizionari hanno le stesse chiavi in tutte le lingue', () => {
    const ref = Object.keys(JSON.parse(readFileSync(join(SITE, 'i18n', 'en.json'), 'utf8'))).sort();
    for (const lang of LANGS) {
        const keys = Object.keys(JSON.parse(readFileSync(join(SITE, 'i18n', `${lang}.json`), 'utf8'))).sort();
        assert.deepEqual(keys, ref, `${lang}: chiavi diverse da en`);
    }
    assert.ok(ref.length >= 60, `dizionario troppo corto: ${ref.length}`);
});

test('i valori del brand e delle traduzioni sono escapati; l’HTML fidato no', () => {
    const ctx = {
        vars: { displayName: 'A<b>&"c' },
        t: { greet: 'Ciao {{displayName}} <i>' },
        raw: { cta: '<a class="cta">ok</a>' }
    };
    const { out, missing } = render('{{displayName}}|{{t.greet}}|{{!cta}}', ctx);
    assert.equal(out, 'A&lt;b&gt;&amp;&quot;c|Ciao A&lt;b&gt;&amp;&quot;c &lt;i&gt;|<a class="cta">ok</a>');
    assert.deepEqual(missing, []);
});

test('un placeholder sconosciuto resta visibile e viene segnalato', () => {
    const { out, missing } = render('x {{nope}} {{t.nope}} {{!nope}}', { vars: {}, t: {}, raw: {} });
    assert.equal(out, 'x {{nope}} {{t.nope}} {{!nope}}');
    assert.deepEqual(missing, ['{{nope}}', '{{t.nope}}', '{{!nope}}']);
});

test('il testo sul pulsante e’ leggibile sul colore del brand', () => {
    assert.equal(onColor('#FFD400'), '#0d1117', 'giallo Lemon: testo scuro');
    assert.equal(onColor('#111827'), '#ffffff', 'Briefly quasi nero: testo bianco');
    assert.equal(onColor('#EF4444'), '#ffffff', 'rosso NoBull: testo bianco');
    assert.equal(onColor('#16A34A'), '#ffffff', 'verde Scout: testo bianco');
    assert.equal(onColor('non-un-colore'), '#0d1117', 'valore non valido: default scuro, non crash');
});

test('htmlEscape copre i quattro caratteri che rompono l’HTML', () => {
    assert.equal(htmlEscape('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
});

test('la generazione completa non lascia placeholder e produce tutte le pagine', () => {
    execFileSync('node', [join(SITE, 'generate-site.mjs'), 'lemonsqueezer', '--year=2026'], { stdio: 'pipe' });
    const dist = join(SITE, 'dist', 'lemonsqueezer');
    for (const lang of LANGS) {
        for (const page of ['index', 'faq', 'thank-you', 'canceled']) {
            const html = readFileSync(join(dist, lang, `${page}.html`), 'utf8');
            assert.ok(!html.includes('{{'), `${lang}/${page}: placeholder residuo`);
            assert.ok(html.includes(`<html lang="${lang}">`), `${lang}/${page}: attributo lang errato`);
        }
    }
    const it = readFileSync(join(dist, 'it', 'index.html'), 'utf8');
    assert.ok(!/Add to Chrome|How it works|Coming soon/.test(it), 'inglese residuo nella pagina italiana');
    assert.ok(readdirSync(join(dist, 'assets')).includes('hero.png'));
    // Nessuna pagina di pricing finche' i pagamenti non sono attivi.
    assert.ok(!readdirSync(dist).includes('pricing.html'));
});
