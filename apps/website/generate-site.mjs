#!/usr/bin/env node
// generate-site.mjs — static per-brand site generator.
//
// STATUS: scaffolding. Reads brands/<brand>/brand.json and renders the HTML
// templates in apps/website/template/ into apps/website/dist/<brand>/.
// Deterministic: same brand.json + same BUILD_YEAR => byte-identical output.
//
// Usage:
//   node apps/website/generate-site.mjs <brand>
//   node apps/website/generate-site.mjs --all
//   BUILD_YEAR=2026 node apps/website/generate-site.mjs lemonsqueezer
//   node apps/website/generate-site.mjs --year=2026 scout

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const TEMPLATE_DIR = join(__dirname, 'template');
const DIST_DIR = join(__dirname, 'dist');
const BRANDS_DIR = join(REPO_ROOT, 'brands');
const PAGES = ['landing', 'pricing', 'faq'];

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

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadBrand(brandId) {
  const brandPath = join(BRANDS_DIR, brandId, 'brand.json');
  if (!existsSync(brandPath)) {
    throw new GenerateError(
      `brand.json not found for "${brandId}".\n` +
      `  Expected at: ${brandPath}\n` +
      `  Create brands/${brandId}/brand.json or check the brand id.`
    );
  }
  let raw;
  try {
    raw = readFileSync(brandPath, 'utf8');
  } catch (e) {
    throw new GenerateError(`Cannot read ${brandPath}: ${e.message}`);
  }
  let brand;
  try {
    brand = JSON.parse(raw);
  } catch (e) {
    throw new GenerateError(`Invalid JSON in ${brandPath}: ${e.message}`);
  }
  return brand;
}

// Build the placeholder -> value map. Values are HTML-escaped once, here.
function buildReplacements(brand, year) {
  const c = (brand.tokens && brand.tokens.colors) || {};
  const wm = brand.wordmark || {};
  const urls = brand.urls || {};
  const store = brand.store || {};
  const map = {
    displayName: brand.displayName || brand.id || '',
    storeName: brand.storeName || brand.displayName || '',
    tagline: brand.tagline || '',
    storeSummary: store.summary || '',
    wordmarkPre: wm.pre || '',
    wordmarkAccent: wm.accent || brand.displayName || '',
    primary: c.primary || '#000000',
    primary700: c.primary700 || c.primary || '#000000',
    black: c.black || '#0D1117',
    white: c.white || '#FFFFFF',
    gray100: c.gray100 || '#F2F4F7',
    radius: (brand.tokens && brand.tokens.radius) || '12px',
    fontSans: (brand.tokens && brand.tokens.fontSans) || 'system-ui, sans-serif',
    privacyUrl: urls.privacy || '#',
    termsUrl: urls.terms || '#',
    supportUrl: urls.support || '#',
    year: year
  };
  const escaped = {};
  for (const [k, v] of Object.entries(map)) escaped[k] = htmlEscape(v);
  return escaped;
}

function render(template, replacements) {
  const missing = new Set();
  const out = template.replace(/\{\{(\w+)\}\}/g, (whole, key) => {
    if (Object.prototype.hasOwnProperty.call(replacements, key)) return replacements[key];
    missing.add(key);
    return whole; // leave untouched so drift is visible
  });
  return { out, missing: [...missing] };
}

function generateBrand(brandId, year) {
  const brand = loadBrand(brandId);
  const replacements = buildReplacements(brand, year);
  const outDir = join(DIST_DIR, brandId);
  mkdirSync(outDir, { recursive: true });

  const written = [];
  const missingAll = new Set();
  for (const page of PAGES) {
    const tplPath = join(TEMPLATE_DIR, `${page}.html`);
    if (!existsSync(tplPath)) throw new GenerateError(`Missing template: ${tplPath}`);
    const template = readFileSync(tplPath, 'utf8');
    const { out, missing } = render(template, replacements);
    missing.forEach((m) => missingAll.add(m));
    const outPath = join(outDir, `${page}.html`);
    writeFileSync(outPath, out, 'utf8');
    written.push(outPath);
  }
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

  let targets = args.brands;
  if (args.all) targets = listBrands();
  if (targets.length === 0) {
    throw new GenerateError(
      'No brand specified.\n' +
      '  Usage: node apps/website/generate-site.mjs <brand>\n' +
      '         node apps/website/generate-site.mjs --all'
    );
  }

  let exitCode = 0;
  for (const brandId of targets) {
    const { written, missing } = generateBrand(brandId, year);
    for (const f of written) console.log(`wrote ${f}`);
    if (missing.length) {
      console.warn(`WARN [${brandId}] unmapped placeholders left in output: ${missing.join(', ')}`);
      exitCode = 0; // non-fatal, but surfaced
    }
  }
  console.log(`done (year=${year}) — ${targets.length} brand(s)`);
  process.exit(exitCode);
}

try {
  main();
} catch (e) {
  if (e instanceof GenerateError) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
