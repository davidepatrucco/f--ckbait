// Generatore del sito marketing (apps/website). Si verifica cio' che, se rotto, finirebbe
// pubblicato: valori del brand non escapati, dizionari con chiavi diverse fra lingue
// (placeholder grezzi in una sola lingua), colore del testo sul pulsante illeggibile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { render, onColor, htmlEscape, LANGS, HERO_VARIANTS, heroAbScript } from '../../apps/website/generate-site.mjs';

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

test('A/B della hero: ogni lingua ha tutte le varianti e lo script non si chiude da un testo', () => {
    for (const lang of LANGS) {
        const t = JSON.parse(readFileSync(join(SITE, 'i18n', `${lang}.json`), 'utf8'));
        for (const v of HERO_VARIANTS) assert.ok(t[`hero_claim_${v}`], `${lang}: manca hero_claim_${v}`);
    }
    const t = { hero_claim_a: 'A', hero_claim_b: '</script><b>x', hero_claim_c: 'C {{displayName}}', hero_claim_d: 'D' };
    const js = heroAbScript(t, { displayName: 'Lemon' });
    assert.equal(js.match(/<\/script>/g).length, 1, 'un testo ha chiuso il tag script');
    assert.ok(js.includes('C Lemon'));
    const html = readFileSync(join(SITE, 'dist', 'lemonsqueezer', 'it', 'index.html'), 'utf8');
    assert.ok(html.includes('<h1 id="hero-claim">Risparmia tempo. Prendi il succo.</h1>'), 'la variante a non e’ nel HTML');
    assert.ok(html.includes("utm_campaign','hero_'+k"));
});
