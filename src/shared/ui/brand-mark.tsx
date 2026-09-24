/**
 * @file Inline Exact Point mark shared by the popup and the settings page.
 */

import type { ReactElement } from 'react';

/**
 * Size and accessible-name options for the brand mark.
 */
export interface BrandMarkProps {
    /**
     * Rendered edge length in pixels.
     */
    readonly size: number;

    /**
     * Accessible name; omit to render the mark as decoration.
     */
    readonly title?: string;
}

/**
 * Renders the Exact Point mark at the requested size.
 *
 * @param props - Component properties.
 * @param props.size - Rendered edge length in pixels.
 * @param props.title - Accessible name, when the mark carries meaning.
 *
 * @returns - The inline brand mark.
 */
export function BrandMark({ size, title }: BrandMarkProps): ReactElement {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 128 128"
            role={title ? 'img' : 'presentation'}
            aria-hidden={title ? undefined : true}
            focusable="false"
        >
            {title ? <title>{title}</title> : null}
            <defs>
                <mask id="nma-ring-cut">
                    <rect width="128" height="128" fill="white" />
                    <circle cx="64" cy="64" r="27" fill="black" />
                </mask>
            </defs>
            <g
                fill="var(--nma-accent)"
                transform="translate(64 64) scale(1.148) translate(-64 -58)"
            >
                <circle cx="64" cy="64" r="48" mask="url(#nma-ring-cut)" />
                <rect x="59" y="4" width="10" height="23" rx="5" />
                <circle cx="64" cy="64" r="9" />
            </g>
        </svg>
    );
}
