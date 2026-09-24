/**
 * @file Mantine theme and appearance mapping shared by both extension surfaces.
 */

import { createTheme, type MantineThemeOverride } from '@mantine/core';

import { APPEARANCE, type Appearance } from '../settings/snapshot';

/**
 * Signal-green scale derived from the prototype accent.
 */
const SIGNAL = [
    'oklch(96% 0.03 145)',
    'oklch(92% 0.05 145)',
    'oklch(86% 0.08 145)',
    'oklch(80% 0.11 145)',
    'oklch(74% 0.13 145)',
    'oklch(68% 0.15 145)',
    'oklch(58% 0.16 145)',
    'oklch(52% 0.15 145)',
    'oklch(45% 0.13 145)',
    'oklch(38% 0.11 145)',
] as const;

/**
 * Shared theme applying the prototype typography, accent, and radii.
 */
export const NO_MORE_AGO_THEME: MantineThemeOverride = createTheme({
    primaryColor: 'signal',
    primaryShade: { light: 6, dark: 5 },
    cursorType: 'pointer',
    colors: { signal: [...SIGNAL] },
    defaultRadius: 'md',
    radius: { md: '10px', lg: '16px' },
    fontFamily: 'var(--nma-font-body)',
    fontFamilyMonospace: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, Menlo, monospace',
    headings: { fontFamily: 'var(--nma-font-display)', fontWeight: '600' },
});

/**
 * Color-scheme override implied by an appearance choice.
 */
export interface ForcedColorScheme {
    /**
     * Scheme Mantine must apply, omitted when the browser decides.
     */
    readonly forceColorScheme?: 'light' | 'dark';
}

/**
 * Maps an appearance choice to the provider's color-scheme override.
 *
 * @param appearance - Persisted appearance choice.
 *
 * @returns - Props spread into MantineProvider; empty for the system choice.
 */
export function forcedColorScheme(appearance: Appearance): ForcedColorScheme {
    if (appearance === APPEARANCE.LIGHT) {
        return { forceColorScheme: 'light' };
    }
    if (appearance === APPEARANCE.DARK) {
        return { forceColorScheme: 'dark' };
    }
    return {};
}
