/**
 * @file Hostname entry rules and per-mode copy for the Sites section.
 */

import {
    isCanonicalHostname,
    normalizeHostnameInput,
} from "../shared/settings/hostname";
import {
    SITE_SCOPE_MODE,
    type SiteScopeMode,
} from "../shared/settings/site-scope";
import type { MessageKey } from "../shared/i18n/translator";

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
         * Key of the inline message shown beneath the field.
         */
        readonly error: MessageKey;
    };

/**
 * Message keys and behavior of the list the active scope mode owns.
 */
export interface ActiveListCopy {
    /**
     * Key of the heading above the list.
     */
    readonly title: MessageKey;

    /**
     * Key of the sentence describing what membership means.
     */
    readonly description: MessageKey;

    /**
     * Key of the add-hostname field label.
     */
    readonly fieldLabel: MessageKey;

    /**
     * Key of the add-hostname submit action label.
     */
    readonly submitLabel: MessageKey;

    /**
     * Key of the sentence explaining what removing a hostname does.
     */
    readonly removalEffect: MessageKey;

    /**
     * Key of the sentence shown when the list has no entries.
     */
    readonly emptyState: MessageKey;

    /**
     * Key of the remove button's accessible name, which takes a hostname.
     */
    readonly removeAria: MessageKey;

    /**
     * Key of the confirmation announced after a hostname is added.
     */
    readonly addedConfirmation: MessageKey;

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
        return { ok: false, error: "sites_error_empty" };
    }
    if (!isCanonicalHostname(hostname)) {
        return { ok: false, error: "sites_error_invalid" };
    }
    if (existing.includes(hostname)) {
        return { ok: false, error: "sites_error_duplicate" };
    }
    return { ok: true, hostname };
}

/**
 * Message mapping for every supported outcome.
 */
const ACTIVE_LIST_COPY = {
    [SITE_SCOPE_MODE.SELECTED_ONLY]: {
        title: "scope_list_allowed",
        description: "sites_allowed_description",
        fieldLabel: "sites_allowed_field_label",
        submitLabel: "sites_allowed_submit",
        removalEffect: "sites_allowed_removal_effect",
        emptyState: "sites_allowed_empty",
        removeAria: "sites_remove_from_allowed_aria",
        addedConfirmation: "sites_added_to_allowed",
        addEnables: true,
    },
    [SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED]: {
        title: "scope_list_excluded",
        description: "sites_excluded_description",
        fieldLabel: "sites_excluded_field_label",
        submitLabel: "sites_excluded_submit",
        removalEffect: "sites_excluded_removal_effect",
        emptyState: "sites_excluded_empty",
        removeAria: "sites_remove_from_excluded_aria",
        addedConfirmation: "sites_added_to_excluded",
        addEnables: false,
    },
} as const satisfies Record<SiteScopeMode, ActiveListCopy>;

/**
 * Describes the list the active scope mode owns.
 *
 * @param mode - Active scope mode.
 * @returns - Message keys, empty state, and add semantics for that list.
 */
export function activeListCopy(mode: SiteScopeMode): ActiveListCopy {
    return ACTIVE_LIST_COPY[mode];
}
