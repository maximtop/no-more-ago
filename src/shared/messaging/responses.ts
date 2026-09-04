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
 * Committed settings change carrying the projection built after it.
 */
interface CommittedChange<TState> {
    /**
     * Marks a change the background persisted.
     */
    readonly ok: true;

    /**
     * Settings revision produced by the committed change.
     */
    readonly acceptedRevision: number;

    /**
     * Projection built after the change.
     */
    readonly state: TState;
}

/**
 * Settings change the background rejected or could not persist.
 */
interface RejectedChange<TError, TState> {
    /**
     * Marks a change the background did not persist.
     */
    readonly ok: false;

    /**
     * Reason the change was not persisted.
     */
    readonly error: TError;

    /**
     * Projection built after the failed change.
     */
    readonly state: TState;
}

/**
 * Names the UI surface a command response was projected for.
 */
interface ProjectedSurface<TSurface> {
    /**
     * Surface whose projection the response carries.
     */
    readonly surface: TSurface;
}

/**
 * Result of one command answered with the projection of the requesting surface.
 */
type SurfacedResponse<TError> =
    | (CommittedChange<PopupState> & ProjectedSurface<typeof SITE_SETTINGS_SURFACE.POPUP>)
    | (CommittedChange<SitesState> & ProjectedSurface<typeof SITE_SETTINGS_SURFACE.SITES>)
    | (RejectedChange<TError, PopupState> & ProjectedSurface<typeof SITE_SETTINGS_SURFACE.POPUP>)
    | (RejectedChange<TError, SitesState> & ProjectedSurface<typeof SITE_SETTINGS_SURFACE.SITES>);

/**
 * Result of changing global activation on either supported UI surface.
 */
export type SetGlobalEnabledResponse = SurfacedResponse<SettingsPersistenceError>;

/**
 * Result of changing one site's activation on either supported UI surface.
 */
export type SetSiteEnabledResponse = SurfacedResponse<SiteSettingsError>;

/**
 * Result of changing the active site scope mode.
 */
export type SetSiteScopeModeResponse =
    | CommittedChange<SitesState>
    | RejectedChange<SettingsPersistenceError, SitesState>;

/**
 * Result of changing display settings and refreshing matching tabs.
 */
export type SetDisplaySettingsResponse =
    | (CommittedChange<DisplayState> & {
        /**
         * Tabs that could not receive the committed revision.
         */
        readonly refreshFailures: readonly RefreshFailure[];
    })
    | RejectedChange<DisplaySettingsError, DisplayState>;

/**
 * Result of changing the appearance applied to both surfaces.
 */
export type SetAppearanceResponse =
    | CommittedChange<DisplayState>
    | RejectedChange<SettingsPersistenceError, DisplayState>;

/**
 * Result of restoring all settings to their defaults.
 */
export type ResetAllSettingsResponse =
    | CommittedChange<ReadySitesState>
    | RejectedChange<SettingsPersistenceError, SitesState>;

/**
 * Result of changing diagnostic logging and refreshing matching tabs.
 */
export type SetDebugEnabledResponse =
    | (CommittedChange<DebugState> & {
        /**
         * Tabs that could not receive the committed revision.
         */
        readonly refreshFailures?: readonly RefreshFailure[];
    })
    | RejectedChange<SettingsPersistenceError, DebugState>;
