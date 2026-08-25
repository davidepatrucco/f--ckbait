import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { buildBrand } from '../../scripts/build-brand.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = mkdtempSync(join(tmpdir(), 'ls-build-'));
after(() => rmSync(out, { recursive: true, force: true }));

const REQUIRED = ['manifest.json', 'popup.html', 'popup.js', 'service_worker.js', 'content.js', 'browser-polyfill.js', 'brand-config.js',
    'assets/icon-16.png', 'assets/icon-48.png', 'assets/icon-128.png'];

describe('build-brand pipeline', () => {
    it('builds lemonsqueezer with all required files and correct branding', () => {
        const res = buildBrand('lemonsqueezer', out);
        for (const f of REQUIRED) assert.ok(existsSync(join(res.outDir, f)), `manca ${f}`);
        const manifest = JSON.parse(readFileSync(join(res.outDir, 'manifest.json'), 'utf8'));
        assert.match(manifest.name, /LemonSqueezer/);
        assert.match(readFileSync(join(res.outDir, 'brand-config.js'), 'utf8'), /"apiBrand": "lemonsqueezer"/);
    });

    it('builds scout with distinct branding and green primary token', () => {
        const res = buildBrand('scout', out);
        for (const f of REQUIRED) assert.ok(existsSync(join(res.outDir, f)), `manca ${f}`);
        const manifest = JSON.parse(readFileSync(join(res.outDir, 'manifest.json'), 'utf8'));
        assert.match(manifest.name, /Scout/);
        const cfg = readFileSync(join(res.outDir, 'brand-config.js'), 'utf8');
        assert.match(cfg, /"apiBrand": "scout"/);
        assert.match(cfg, /#16A34A/); // Scout primary
    });

    it('inietta apiBase per ambiente in brand-config.js (--env)', () => {
        const dev = buildBrand('scout', { outRoot: out, env: 'dev' });
        assert.match(readFileSync(join(dev.outDir, 'brand-config.js'), 'utf8'), /amazonaws\.com\/dev/);
        const prod = buildBrand('scout', { outRoot: out, env: 'prod' });
        const cfg = readFileSync(join(prod.outDir, 'brand-config.js'), 'utf8');
        assert.match(cfg, /amazonaws\.com\/prod/);
        assert.match(cfg, /"env": "prod"/);
    });

    it('LemonSqueezer build reproduces the shared extension files (regression-zero)', () => {
        const res = buildBrand('lemonsqueezer', out);
        // oauth-config.js è git-ignored (assente in CI) -> escluso dal confronto di parità.
        for (const f of ['popup.html', 'popup.js', 'service_worker.js', 'content.js', 'browser-polyfill.js']) {
            const a = readFileSync(join(REPO, 'extension', f), 'utf8');
            const b = readFileSync(join(res.outDir, f), 'utf8');
            assert.equal(b, a, `${f} differisce dalla sorgente extension/`);
        }
    });

    it('E11 firefox target: event-page manifest + gecko id, no service_worker key', () => {
        const res = buildBrand('lemonsqueezer', { browser: 'firefox', outRoot: out });
        const m = JSON.parse(readFileSync(join(res.outDir, 'manifest.json'), 'utf8'));
        assert.ok(Array.isArray(m.background.scripts), 'firefox usa background.scripts');
        assert.ok(m.background.scripts.includes('service_worker.js'));
        assert.ok(m.background.scripts.includes('browser-polyfill.js'));
        assert.ok(!m.background.service_worker, 'firefox non deve avere service_worker');
        assert.match(m.browser_specific_settings.gecko.id, /@bifa\.digital/);
    });

    it('E11 chromium target: keeps service_worker, no gecko settings', () => {
        const res = buildBrand('lemonsqueezer', { browser: 'chromium', outRoot: out });
        const m = JSON.parse(readFileSync(join(res.outDir, 'manifest.json'), 'utf8'));
        assert.equal(m.background.service_worker, 'service_worker.js');
        assert.ok(!m.browser_specific_settings);
    });

    it('brands ship distinct icon assets', () => {
        const lemon = buildBrand('lemonsqueezer', out).outDir;
        const scout = buildBrand('scout', out).outDir;
        const a = readFileSync(join(lemon, 'assets/icon-128.png'));
        const b = readFileSync(join(scout, 'assets/icon-128.png'));
        assert.ok(!a.equals(b), 'le icone dei due brand dovrebbero differire');
    });
});
