import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWebContent, extractTextFromHtml } from '../src/web-fetcher.mjs';

describe('Web fetcher SSRF guard', () => {
    for (const url of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/']) {
        it(`rejects private target ${url}`, async () => {
            await assert.rejects(() => fetchWebContent(url), /consentiti/);
        });
    }
});

describe('Web article extraction', () => {
    it('prefers article text over navigation and footer', () => {
        const html = `<!doctype html><html><head><title>News</title></head><body>
            <nav>Home Politics Subscribe Menu</nav>
            <main><article><h1>Important story</h1><p>${'The article has meaningful reporting. '.repeat(12)}</p></article></main>
            <aside>Recommended stories and advert</aside><footer>Copyright and privacy policy</footer>
        </body></html>`;
        const text = extractTextFromHtml(html, 'https://news.example/story');
        assert.match(text, /Important story/);
        assert.doesNotMatch(text, /Copyright and privacy policy/);
        assert.doesNotMatch(text, /Home Politics Subscribe Menu/);
    });
});
