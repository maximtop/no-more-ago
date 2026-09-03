/**
 * @file Settings-command responses returned to extension views.
 */

import type {
    DebugState,
    DisplayState,
    PopupState,
    ReadySitesState,
    RefreshFailure,
    SitesState,
} from "./view-state";
import type {
    DisplaySettingsError,
    SettingsPersistenceError,
    SiteSettingsError,
} from "./view-state-values";
import { SITE_SETTINGS_SURFACE } from "./view-state-values";

/**
 * Result of changing global activation.
 */
export type SetGlobalEnabledResponse =
    | {
        /**
         * Marks a committed global activation change.
         */
        readonly ok: true;

        /**
         * Settings revision produced by the committed change.
         */
        readonly acceptedRevision: number;

        /**
         * Popup projection built after the change.
         */
        readonly state: PopupState;
    }
    | {
        /**
         * Marks a change that could not be persisted.
         */
        readonly ok: false;

        /**
         * Reason the change was not persisted.
         */
        readonly error: SettingsPersistenceError;

        /**
         * Popup projection built after the failed change.
         */
        readonly state: PopupState;
    };

/**
 * Result of changing one site's activation on either supported UI surface.
 */
export type SetSiteEnabledResponse =
    | {
        /**
         * Marks a committed per-site change.
         */
        readonly ok: true;

        /**
         * Settings revision produced by the committed change.
         */
        readonly acceptedRevision: number;

        /**
         * Marks a response projected for the popup surface.
         */
        readonly surface: typeof SITE_SETTINGS_SURFACE.POPUP;

        /**
         * Popup projection built after the change.
         */
        readonly state: PopupState;
    }
    | {
        /**
         * Marks a committed per-site change.
         */
        readonly ok: true;

        /**
         * Settings revision produced by the committed change.
         */
        readonly acceptedRevision: number;

        /**
         * Marks a response projected for the options sites surface.
         */
        readonly surface: typeof SITE_SETTINGS_SURFACE.SITES;

        /**
         * Site-preferences projection built after the change.
         */
        readonly state: SitesState;
    }
    | {
        /**
         * Marks a change that could not be persisted.
         */
        readonly ok: false;

        /**
         * Reason the change was not persisted.
         */
        readonly error: SiteSettingsError;

        /**
         * Marks a response projected for the popup surface.
         */
        readonly surface: typeof SITE_SETTINGS_SURFACE.POPUP;

        /**
         * Popup projection built after the failed change.
         */
        readonly state: PopupState;
    }
    | {
        /**
         * Marks a change that could not be persisted.
         */
        readonly ok: false;

        /**
         * Reason the change was not persisted.
         */
        readonly error: SiteSettingsError;

        /**
         * Marks a response projected for the options sites surface.
         */
        readonly surface: typeof SITE_SETTINGS_SURFACE.SITES;

        /**
         * Site-preferences projection built after the failed change.
         */
        readonly state: SitesState;
    };

/**
 * Result of changing display settings and refreshing matching tabs.
 */
export type SetDisplaySettingsResponse =
    | {
        /**
         * Marks committed display settings.
         */
        readonly ok: true;

        /**
         * Settings revision produced by the committed change.
         */
        readonly acceptedRevision: number;

        /**
         * Display projection built after the change.
         */
        readonly state: DisplayState;

        /**
         * Tabs that could not receive the committed revision.
         */
        readonly refreshFailures: readonly RefreshFailure[];
    }
    | {
        /**
         * Marks display settings that were rejected or could not be persisted.
         */
        readonly ok: false;

        /**
         * Reason the display settings were not committed.
         */
        readonly error: DisplaySettingsError;

        /**
         * Display projection built after the failed change.
         */
        readonly state: DisplayState;
    };

/**
 * Result of restoring all settings to their defaults.
 */
export type ResetAllSettingsResponse =
    | {
        /**
         * Marks a committed reset.
         */
        readonly ok: true;

        /**
         * Settings revision produced by the reset.
         */
        readonly acceptedRevision: number;

        /**
         * Site-preferences projection built from the restored defaults.
         */
        readonly state: ReadySitesState;
    }
    | {
        /**
         * Marks a reset that could not be persisted.
         */
        readonly ok: false;

        /**
         * Reason the reset was not persisted.
         */
        readonly error: SettingsPersistenceError;

        /**
         * Site-preferences projection built after the failed reset.
         */
        readonly state: SitesState;
    };

/**
 * Result of changing diagnostic logging and refreshing matching tabs.
 */
export type SetDebugEnabledResponse =
    | {
        /**
         * Marks a committed diagnostic-logging change.
         */
        readonly ok: true;

        /**
         * Settings revision produced by the committed change.
         */
        readonly acceptedRevision: number;

        /**
         * Diagnostic projection built after the change.
         */
        readonly state: DebugState;

        /**
         * Tabs that could not receive the committed revision.
         */
        readonly refreshFailures?: readonly RefreshFailure[];
    }
    | {
        /**
         * Marks a change that could not be persisted.
         */
        readonly ok: false;

        /**
         * Reason the change was not persisted.
         */
        readonly error: SettingsPersistenceError;

        /**
         * Diagnostic projection built after the failed change.
         */
        readonly state: DebugState;
    };
