#!/usr/bin/env node
// scan-secrets.mjs [dir] — verifica che una build (default: dist/) non contenga
// segreti (E14-002). Exit non-zero se trova pattern sensibili.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Pattern ad alto segnale (evitano falsi positivi). Il client id Google pubblico
// (…apps.googleusercontent.com) NON è un segreto e non matcha nulla di questi.
const SECRET_PATTERNS = [
    { name: 'OpenAI key', re: /\bsk-[A-Za-z0-9\-]{16,}/ },
    { name: 'Stripe secret/restricted key', re: /\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}/ },
    { name: 'JWT', re: /\beyJ[A-Za-z0-9._\-]{20,}\.[A-Za-z0-9._\-]{10,}/ },
    { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: 'Private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { name: 'AWS secret access key assignment', re: /aws_secret_access_key\s*[=:]\s*['\"]?[A-Za-z0-9/+]{40}/i }
];

const TEXT_EXT = new Set(['.js', '.mjs', '.json', '.html', '.css', '.txt', '.md', '.svg']);

export function findSecrets(text) {
    const hits = [];
    for (const p of SECRET_PATTERNS) {
        if (p.re.test(text)) hits.push(p.name);
    }
    return hits;
}

function scanDir(dir) {
    const findings = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            findings.push(...scanDir(full));
        } else if (TEXT_EXT.has(extname(entry))) {
            const hits = findSecrets(readFileSync(full, 'utf8'));
            for (const h of hits) findings.push({ file: full, secret: h });
        }
    }
    return findings;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const target = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(ROOT, 'dist');
    if (!existsSync(target)) {
        console.error(`✗ directory non trovata: ${target} (esegui prima build-brand)`);
        process.exit(1);
    }
    const findings = scanDir(target);
    if (findings.length) {
        for (const f of findings) console.error(`✗ SEGRETO POTENZIALE (${f.secret}) in ${f.file}`);
        console.error(`\n${findings.length} potenziali segreti trovati.`);
        process.exit(1);
    }
    console.log(`✓ nessun segreto trovato in ${target}`);
}
