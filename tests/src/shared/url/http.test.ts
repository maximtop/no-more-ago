/**
 * @file Verifies the shared HTTP URL contract.
 */

import { describe, expect, it } from 'vitest';

import { isHttpUrl, parseHttpUrl } from '../../../../src/shared/url/http';

describe('HTTP URL contract', () => {
    it.each([
        ['http://example.test/path', 'http:'],
        ['https://example.test/path', 'https:'],
        ['HTTPS://EXAMPLE.TEST/path', 'https:'],
    ])('parses canonical HTTP(S) URL %s', (value, protocol) => {
        const parsed = parseHttpUrl(value);

        expect(parsed?.protocol).toBe(protocol);
        expect(isHttpUrl(parsed as URL)).toBe(true);
    });

    it.each([
        'about:blank',
        'file:///tmp/page.html',
        'data:text/html,hello',
        'not a URL',
        42,
        null,
        undefined,
    ])('rejects unsupported or malformed URL %j', (value) => {
        expect(parseHttpUrl(value)).toBeNull();
    });
});
