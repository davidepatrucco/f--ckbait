#!/usr/bin/env node
// generate-site.mjs — static, multilingual per-brand marketing site.
//
// Output (apps/website/dist/<brand>/):
//   index.html               fallback redirect to /en/ (the CloudFront function normally
//                            redirects "/" by Accept-Language before this is ever served)
//   404.html                 error page (English) with links to every language
//   privacy-policy.html      copied from legal/ (bilingual IT+EN, language-neutral URL)
//   terms.html               idem
//   assets/                  icon.svg, icon-128.png, hero.png (store screenshot)
//   <lang>/index.html        landing        lang ∈ en it es fr de
//   <lang>/faq.html
//   <lang>/thank-you.html    checkout return pages (noindex)
//   <lang>/canceled.html
//
// Templates use three placeholder kinds:
//   {{key}}      brand/page value, HTML-escaped
//   {{t.key}}    dictionary string (apps/website/i18n/<lang>.json), HTML-escaped; a string
//                may itself contain {{displayName}}
//   {{!key}}     trusted HTML built by this script (nav links, hreflang, CTA)
//   {{@name}}    include template/name.html
// Deterministic: same inputs + same BUILD_YEAR => byte-identical output. Stdlib only.
//
// Usage:
//   node apps/website/generate-site.mjs <brand> | --all   [--year=2026]

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const TEMPLATE_DIR = join(__dirname, 'template');
const I18N_DIR = join(__dirname, 'i18n');
const DIST_DIR = join(__dirname, 'dist');
const BRANDS_DIR = join(REPO_ROOT, 'brands');
const LEGAL_DIR = join(REPO_ROOT, 'legal');
const STORE_DIR = join(REPO_ROOT, 'store');

export const LANGS = ['en', 'it', 'es', 'fr', 'de'];
const LANG_PAGES = ['index', 'faq', 'thank-you', 'canceled'];
const NOINDEX = new Set(['thank-you', 'canceled', '404']);

class GenerateError extends Error {}

function parseArgs(argv) {
  const args = { brands: [], all: false, year: undefined };
  for (const a of argv) {
    if (a === '--all') args.all = true;
    else if (a.startsWith('--year=')) args.year = a.slice('--year='.length);
    else if (a.startsWith('--')) throw new GenerateError(`Unknown flag: ${a}`);
    else args.brands.push(a);
  }
  return args;
}

function resolveYear(cliYear) {
  const y = cliYear || process.env.BUILD_YEAR || String(new Date().getFullYear());
  if (!/^\d{4}$/.test(String(y))) throw new GenerateError(`Invalid year: ${y}`);
  return String(y);
}

export function htmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function readJson(path, what) {
  if (!existsSync(path)) throw new GenerateError(`${what} not found: ${path}`);
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { throw new GenerateError(`Invalid JSON in ${path}: ${e.message}`); }
}

// Text on the CTA must be readable on the brand colour: dark text on light brands
// (Lemon yellow), white on dark ones (Briefly near-black). WCAG relative luminance.
export function onColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '#0d1117';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.35 ? '#0d1117' : '#ffffff';
}

const partialCache = new Map();
function partial(name) {
  if (!partialCache.has(name)) {
    const p = join(TEMPLATE_DIR, `${name}.html`);
    if (!existsSync(p)) throw new GenerateError(`Missing partial: ${p}`);
    partialCache.set(name, readFileSync(p, 'utf8'));
  }
  return partialCache.get(name);
}

// Expand includes, then the three placeholder kinds. Unknown keys are left in place so
// drift is visible (and reported by the caller).
export function render(template, ctx) {
  const missing = new Set();
  let out = template.replace(/\{\{@(\w[\w-]*)\}\}/g, (_, name) => partial(name));
  out = out.replace(/\{\{(!|t\.)?([\w-]+)\}\}/g, (whole, kind, key) => {
    if (kind === '!') {
      if (key in ctx.raw) return ctx.raw[key];
    } else if (kind === 't.') {
      if (key in ctx.t) return htmlEscape(interpolate(ctx.t[key], ctx.vars));
    } else if (key in ctx.vars) {
      return htmlEscape(ctx.vars[key]);
    }
    missing.add(whole);
    return whole;
  });
  return { out, missing: [...missing] };
}

// Dictionary strings may reference brand values ({{displayName}}): resolved BEFORE escaping,
// once, so the brand name is escaped exactly one time like every other value.
function interpolate(str, vars) {
  return String(str).replace(/\{\{(\w+)\}\}/g, (w, k) => (k in vars ? vars[k] : w));
}

function loadBrand(brandId) {
  return readJson(join(BRANDS_DIR, brandId, 'brand.json'), `brand.json for "${brandId}"`);
}

function loadDictionaries() {
  const dicts = {};
  for (const lang of LANGS) dicts[lang] = readJson(join(I18N_DIR, `${lang}.json`), `dictionary ${lang}`);
  // Every language must carry the same keys: a missing one would render as a raw
  // placeholder in that language only, exactly the defect this check prevents.
  const ref = Object.keys(dicts.en).sort().join('|');
  for (const lang of LANGS) {
    const keys = Object.keys(dicts[lang]).sort().join('|');
    if (keys !== ref) throw new GenerateError(`dictionary ${lang} has a different key set than en`);
  }
  return dicts;
}

function brandVars(brand, year) {
  const c = (brand.tokens && brand.tokens.colors) || {};
  const wm = brand.wordmark || {};
  const siteUrl = String((brand.site && brand.site.url) || '').replace(/\/+$/, '');
  if (!siteUrl) throw new GenerateError(`brand ${brand.id}: site.url missing in brand.json`);
  return {
    brandId: brand.apiBrand || brand.id || '',
    displayName: brand.displayName || brand.id || '',
    storeName: brand.storeName || brand.displayName || '',
    tagline: brand.tagline || '',
    wordmarkPre: wm.pre || '',
    wordmarkAccent: wm.accent || brand.displayName || '',
    primary: c.primary || '#000000',
    primary700: c.primary700 || c.primary || '#000000',
    onPrimary: onColor(c.primary),
    siteUrl,
    chromeStoreUrl: (brand.urls && brand.urls.chromeStore) || '',
    year
  };
}

function langLinks(page, current, dicts, inline) {
  const file = page === 'index' ? '' : `${page}.html`;
  return LANGS.map((l) => {
    const cur = l === current ? ' aria-current="page"' : '';
    const label = inline ? htmlEscape(dicts[l].lang_name) : l;
    return `<a href="/${l}/${file}" hreflang="${l}" lang="${l}"${cur}>${label}</a>`;
  }).join(inline ? ' · ' : '');
}

function hreflangTags(page, siteUrl) {
  const file = page === 'index' ? '' : `${page}.html`;
  const tags = LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${siteUrl}/${l}/${file}">`);
  tags.push(`<link rel="alternate" hreflang="x-default" href="${siteUrl}/en/${file}">`);
  return tags.join('\n  ');
}

function ctaTag(vars, t) {
  if (/^https:\/\//.test(vars.chromeStoreUrl)) {
    return `<a class="cta" href="${htmlEscape(vars.chromeStoreUrl)}" rel="noopener">${htmlEscape(t.cta_add)}</a>`;
  }
  return `<span class="cta" aria-disabled="true">${htmlEscape(t.cta_soon)}</span>`;
}

function writePage(outPath, html, written) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, 'utf8');
  written.push(outPath);
}

function copyAssets(brand, outDir) {
  const assets = join(outDir, 'assets');
  mkdirSync(assets, { recursive: true });
  const brandAssets = join(BRANDS_DIR, brand.id, 'assets');
  for (const f of ['icon.svg', 'icon-128.png']) {
    const src = join(brandAssets, f);
    if (!existsSync(src)) throw new GenerateError(`missing asset ${src}`);
    copyFileSync(src, join(assets, f));
  }
  // Hero: the real popup screenshot from the store assets (exists for every brand).
  const hero = join(STORE_DIR, brand.id, 'screenshots', '02-testo-popup.png');
  if (!existsSync(hero)) throw new GenerateError(`missing hero screenshot ${hero}`);
  copyFileSync(hero, join(assets, 'hero.png'));
}

function copyLegal(brand, outDir) {
  const dir = brand.id === 'lemonsqueezer' ? LEGAL_DIR : join(LEGAL_DIR, brand.id);
  for (const f of ['privacy-policy.html', 'terms.html']) {
    const src = join(dir, f);
    if (!existsSync(src)) throw new GenerateError(`missing legal page ${src}`);
    copyFileSync(src, join(outDir, f));
  }
}

export function generateBrand(brandId, year, dicts) {
  const brand = loadBrand(brandId);
  const vars = brandVars(brand, year);
  const outDir = join(DIST_DIR, brandId);
  // Clean first: a page removed from the generator must not survive from an old run
  // and get published.
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const written = [];
  const missingAll = new Set();

  for (const lang of LANGS) {
    const t = dicts[lang];
    for (const page of LANG_PAGES) {
      const file = page === 'index' ? '' : `${page}.html`;
      const canonical = `${vars.siteUrl}/${lang}/${file}`;
      const title = page === 'index'
        ? `${vars.displayName} — ${interpolate(t.meta_title, vars)}`
        : `${interpolate(t[page === 'faq' ? 'faq_title' : page === 'thank-you' ? 'ty_title' : 'cx_title'], vars)} — ${vars.displayName}`;
      const ctx = {
        vars: {
          ...vars, lang, canonical,
          pageTitle: title,
          pageDesc: interpolate(t.meta_desc, vars),
          // English keeps the brand's own tagline; other languages get the translated
          // subtitle, so no page mixes two languages.
          heroSub: lang === 'en' && vars.tagline ? vars.tagline : interpolate(t.hero_sub, vars)
        },
        t,
        raw: {
          robots: NOINDEX.has(page) ? '<meta name="robots" content="noindex">' : '',
          hreflang: NOINDEX.has(page) ? '' : hreflangTags(page, vars.siteUrl),
          langLinks: langLinks(page, lang, dicts, false),
          langLinksInline: langLinks(page, lang, dicts, true),
          ctaTag: ctaTag(vars, t)
        }
      };
      const { out, missing } = render(readFileSync(join(TEMPLATE_DIR, `${page}.html`), 'utf8'), ctx);
      missing.forEach((m) => missingAll.add(`${lang}/${page}: ${m}`));
      writePage(join(outDir, lang, `${page}.html`), out, written);
    }
  }

  // Root-level pages (language-neutral URLs).
  const en = dicts.en;
  const rootCtx = (page) => ({
    vars: { ...vars, lang: 'en', canonical: `${vars.siteUrl}/`, pageTitle: `${en.nf_title} — ${vars.displayName}`, pageDesc: interpolate(en.meta_desc, vars), heroSub: '' },
    t: en,
    raw: {
      robots: '<meta name="robots" content="noindex">',
      hreflang: page === 'root-index' ? hreflangTags('index', vars.siteUrl) : '',
      langLinks: langLinks('index', 'en', dicts, false),
      langLinksInline: langLinks('index', 'en', dicts, true),
      ctaTag: ctaTag(vars, en)
    }
  });
  for (const [tpl, outName] of [['root-index', 'index.html'], ['404', '404.html']]) {
    const { out, missing } = render(readFileSync(join(TEMPLATE_DIR, `${tpl}.html`), 'utf8'), rootCtx(tpl));
    missing.forEach((m) => missingAll.add(`${outName}: ${m}`));
    writePage(join(outDir, outName), out, written);
  }

  copyAssets(brand, outDir);
  copyLegal(brand, outDir);
  return { written, missing: [...missingAll] };
}

function listBrands() {
  if (!existsSync(BRANDS_DIR)) throw new GenerateError(`brands/ dir not found at ${BRANDS_DIR}`);
  return readdirSync(BRANDS_DIR).filter((name) => {
    const p = join(BRANDS_DIR, name);
    return statSync(p).isDirectory() && existsSync(join(p, 'brand.json'));
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const year = resolveYear(args.year);
  const targets = args.all ? listBrands() : args.brands;
  if (targets.length === 0) {
    throw new GenerateError('No brand specified.\n  Usage: node apps/website/generate-site.mjs <brand> | --all');
  }
  const dicts = loadDictionaries();
  let exitCode = 0;
  for (const brandId of targets) {
    const { written, missing } = generateBrand(brandId, year, dicts);
    console.log(`${brandId}: ${written.length} pages`);
    if (missing.length) {
      console.warn(`WARN [${brandId}] unmapped placeholders: ${missing.join(', ')}`);
      exitCode = 1; // a raw placeholder must never be published
    }
  }
  console.log(`done (year=${year}) — ${targets.length} brand(s), ${LANGS.length} languages`);
  process.exit(exitCode);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (e) {
    if (e instanceof GenerateError) { console.error(`ERROR: ${e.message}`); process.exit(1); }
    throw e;
  }
}
