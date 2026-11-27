/**
 * @file Verifies which browser targets each build command selects.
 */

import { describe, expect, it } from 'vitest';

import { createBuildRequest } from '../../../scripts/build/cli';
import { BROWSER, BUILD_MODE, STORE_ARCHIVE_BROWSERS } from '../../../scripts/build/contracts';

describe('build target selection', () => {
    it('builds the store archives by default and Safari only on request', () => {
        expect(createBuildRequest(BUILD_MODE.RELEASE, undefined, false).browsers)
            .toEqual(STORE_ARCHIVE_BROWSERS);
        expect(STORE_ARCHIVE_BROWSERS).not.toContain(BROWSER.SAFARI);
        expect(createBuildRequest(BUILD_MODE.RELEASE, BROWSER.SAFARI, false).browsers)
            .toEqual([BROWSER.SAFARI]);
        expect(createBuildRequest(BUILD_MODE.DEV, undefined, false).browsers).toEqual([BROWSER.CHROME]);
    });
});
