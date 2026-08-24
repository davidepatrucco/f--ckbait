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

const REQUIRED = ['manifest.json', 'popup.html', 'popup.js', 'service_worker.js', 'content.js', 'brand-config.js',
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

    it('LemonSqueezer build reproduces the shared extension files (regression-zero)', () => {
        const res = buildBrand('lemonsqueezer', out);
        for (const f of ['popup.html', 'popup.js', 'service_worker.js', 'content.js', 'oauth-config.js']) {
            const a = readFileSync(join(REPO, 'extension', f), 'utf8');
            const b = readFileSync(join(res.outDir, f), 'utf8');
            assert.equal(b, a, `${f} differisce dalla sorgente extension/`);
        }
    });

    it('brands ship distinct icon assets', () => {
        const lemon = buildBrand('lemonsqueezer', out).outDir;
        const scout = buildBrand('scout', out).outDir;
        const a = readFileSync(join(lemon, 'assets/icon-128.png'));
        const b = readFileSync(join(scout, 'assets/icon-128.png'));
        assert.ok(!a.equals(b), 'le icone dei due brand dovrebbero differire');
    });
});
