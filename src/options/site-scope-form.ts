/**
 * @file Hostname entry rules and per-mode copy for the Sites section.
 */

import {
    isCanonicalHostname,
    normalizeHostnameInput,
} from "../shared/settings/hostname";
import {
    SITE_SCOPE_LIST_LABEL,
    SITE_SCOPE_MODE,
    type SiteScopeMode,
} from "../shared/settings/site-scope";

/**
 * Outcome of validating one hostname entered in the Sites form.
 */
export type HostnameEntryResult =
    | {
        /**
         * Indicates an accepted hostname.
         */
        readonly ok: true;

        /**
         * Canonical hostname to send to the background.
         */
        readonly hostname: string;
    }
    | {
        /**
         * Indicates a rejected hostname.
         */
        readonly ok: false;

        /**
         * Inline message shown beneath the field.
         */
        readonly error: string;
    };

/**
 * Labels and behavior of the list the active scope mode owns.
 */
export interface ActiveListCopy {
    /**
     * Heading above the list.
     */
    readonly title: string;

    /**
     * Sentence describing what membership means.
     */
    readonly description: string;

    /**
     * Label of the add-hostname field.
     */
    readonly fieldLabel: string;

    /**
     * Label of the add-hostname submit action.
     */
    readonly submitLabel: string;

    /**
     * Sentence explaining what removing a hostname from this list does.
     */
    readonly removalEffect: string;

    /**
     * Sentence shown when the list has no entries.
     */
    readonly emptyState: string;

    /**
     * Whether adding a hostname to this list enables processing for it.
     */
    readonly addEnables: boolean;
}

/**
 * Validates one hostname typed into the Sites form.
 *
 * @param value - Raw field value.
 * @param existing - Hostnames already present in the active list.
 * @returns - Canonical hostname, or the inline error to display.
 */
export function validateHostnameEntry(
    value: string,
    existing: readonly string[],
): HostnameEntryResult {
    const hostname = normalizeHostnameInput(value);
    if (hostname.length === 0) {
        return { ok: false, error: "Enter a hostname." };
    }
    if (!isCanonicalHostname(hostname)) {
        return {
            ok: false,
            error: "Use an exact hostname without a scheme, port, or path.",
        };
    }
    if (existing.includes(hostname)) {
        return { ok: false, error: "This hostname is already in the list." };
    }
    return { ok: true, hostname };
}

/**
 * Describes the list the active scope mode owns.
 *
 * @param mode - Active scope mode.
 * @returns - Labels, empty state, and add semantics for that list.
 */
export function activeListCopy(mode: SiteScopeMode): ActiveListCopy {
    if (mode === SITE_SCOPE_MODE.SELECTED_ONLY) {
        return {
            title: SITE_SCOPE_LIST_LABEL[mode],
            description: "The extension runs only on these exact hostnames.",
            fieldLabel: "Allow hostname",
            submitLabel: "Allow site",
            removalEffect: "Removing a hostname turns the extension off on it again.",
            emptyState: "No sites are allowed yet. The extension will stay off on every site "
                + "until one is added.",
            addEnables: true,
        };
    }
    return {
        title: SITE_SCOPE_LIST_LABEL[mode],
        description: "The extension stays off on these exact hostnames.",
        fieldLabel: "Exclude hostname",
        submitLabel: "Exclude site",
        removalEffect: "Removing a hostname lets the extension run on it again.",
        emptyState: "No sites are excluded.",
        addEnables: false,
    };
}
