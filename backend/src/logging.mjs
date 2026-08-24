// logging.mjs - Redazione dei segreti prima del log (E14-005).
// Da usare su qualsiasi valore che potrebbe contenere token/chiavi prima di loggarlo.

const PATTERNS = [
    [/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]'],
    [/\beyJ[A-Za-z0-9._\-]{10,}/g, '[REDACTED_JWT]'],                 // JWT
    [/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]+/g, '$1_$2_[REDACTED]'],   // Stripe
    [/\bsk-[A-Za-z0-9\-]{12,}/g, 'sk-[REDACTED]'],                     // OpenAI
    [/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]'],                       // AWS access key id
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]']
];

export function redactSecrets(value) {
    let s;
    try {
        s = typeof value === 'string' ? value : JSON.stringify(value);
    } catch {
        s = String(value);
    }
    if (!s) return s;
    for (const [re, repl] of PATTERNS) s = s.replace(re, repl);
    return s;
}
