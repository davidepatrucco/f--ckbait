import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWebContent } from '../src/web-fetcher.mjs';

describe('Web fetcher SSRF guard', () => {
    for (const url of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/']) {
        it(`rejects private target ${url}`, async () => {
            await assert.rejects(() => fetchWebContent(url), /consentiti/);
        });
    }
});
