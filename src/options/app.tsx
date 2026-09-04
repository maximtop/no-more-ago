/**
 * @file Composes the settings shell, navigation, and feature sections of the options page.
 */

import { Alert, DirectionProvider, MantineProvider, Text } from "@mantine/core";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { STATE_AVAILABILITY } from "../shared/messaging/view-state-values";
import type {
    DebugState,
    DisplayState,
    SitesState,
} from "../shared/messaging/view-state";
import {
    INERT_SETTINGS_CHANGED_SUBSCRIBER,
    type SubscribeSettingsChanged,
} from "../shared/messaging/settings-notifications";
import { APPEARANCE } from "../shared/settings/snapshot";
import { BrandMark } from "../shared/ui/brand-mark";
import { t, uiDirection } from "../shared/i18n/translator";
import { NO_MORE_AGO_THEME, forcedColorScheme } from "../shared/ui/theme";
import { useSettingsChanged } from "../shared/ui/use-settings-changed";
import type { DownloadRuntime } from "../shared/diagnostics/archive";
import {
    createDefaultSiteReportReporter,
    type SiteReportReporter,
} from "../shared/reporting/site-report";
import { AppearanceControl } from "./appearance-control";
import { createSitesClient, type SitesClient } from "./client";
import { useDiagnosticsController } from "./diagnostics-controller";
import { DiagnosticsSection } from "./diagnostics-section";
import { useDisplayController } from "./display-controller";
import { DisplaySection } from "./display-section";
import { ResetControl, resetNoticeKey } from "./reset-control";
import { useResetController } from "./reset-controller";
import { SETTINGS_SECTION, SettingsNavigation } from "./settings-navigation";
import { useSitesController } from "./sites-controller";
import { SitesSection } from "./sites-section";
import { OptionsUnavailablePanel } from "./unavailable-panel";

/**
 * Optional dependencies and preloaded state for the options UI.
 */
export interface OptionsAppProps {
    /**
     * Client used to load and change persisted settings.
     */
    readonly client?: SitesClient;

    /**
     * Preloaded site settings that avoid the initial request.
     */
    readonly initialState?: SitesState;

    /**
     * Preloaded display settings that avoid the initial request.
     */
    readonly initialDisplayState?: DisplayState;

    /**
     * Preloaded diagnostic-logging state that avoids the initial request.
     */
    readonly initialDebugState?: DebugState;

    /**
     * Runtime used to hand a diagnostics archive to the browser.
     */
    readonly archiveRuntime?: DownloadRuntime;

    /**
     * Service used to open a GitHub report for a site.
     */
    readonly reporter?: SiteReportReporter;

    /**
     * Subscriber used to observe committed settings changes.
     */
    readonly subscribe?: SubscribeSettingsChanged;

    /**
     * Installed extension version shown in the header, when known.
     */
    readonly version?: string;
}

/**
 * One of the projections this page renders, when loaded.
 */
type Projection = SitesState | DisplayState | DebugState | undefined;

/**
 * Finds the newest settings revision among the projections this page renders.
 *
 * @param states - Sites, display, and debug projections, when loaded.
 * @returns - Highest ready revision, or null while none is ready.
 */
function highestKnownRevision(...states: readonly Projection[]): number | null {
    let highest: number | null = null;
    for (const state of states) {
        if (state?.availability === STATE_AVAILABILITY.READY) {
            highest = highest === null ? state.revision : Math.max(highest, state.revision);
        }
    }
    return highest;
}

/**
 * Reports whether a projection lags behind the newest revision the page knows.
 *
 * @param state - Projection to check.
 * @param highest - Newest ready revision on the page.
 * @returns - Whether the projection must be reread.
 */
function isBehind(state: Projection, highest: number): boolean {
    return state?.availability === STATE_AVAILABILITY.READY && state.revision < highest;
}

/**
 * Renders and coordinates the settings page.
 *
 * @param props - Optional dependencies and preloaded options state.
 * @param props.client - Settings client override.
 * @param props.initialState - Preloaded site settings state.
 * @param props.initialDisplayState - Preloaded display settings state.
 * @param props.initialDebugState - Preloaded diagnostic logging state.
 * @param props.archiveRuntime - Diagnostics archive download runtime.
 * @param props.reporter - Site-report service override.
 * @param props.subscribe - Settings change subscriber override.
 * @param props.version - Installed extension version.
 * @returns - The options React view.
 */
export function OptionsApp({
    client: suppliedClient,
    initialState,
    initialDisplayState,
    initialDebugState,
    archiveRuntime,
    reporter: suppliedReporter,
    subscribe = INERT_SETTINGS_CHANGED_SUBSCRIBER,
    version,
}: OptionsAppProps): ReactElement {
    const client = useMemo(() => suppliedClient ?? createSitesClient(), [suppliedClient]);
    const reporter = useMemo(
        () => suppliedReporter ?? createDefaultSiteReportReporter(),
        [suppliedReporter],
    );
    const sites = useSitesController({ client, initialState });
    const display = useDisplayController({
        client,
        initialState: initialDisplayState,
        loadWhenMissing: initialState === undefined,
    });
    const diagnostics = useDiagnosticsController({
        client,
        reporter,
        initialState: initialDebugState,
        archiveRuntime,
    });
    const reset = useResetController({ client, sites, display, diagnostics });
    const [externalChange, setExternalChange] = useState(false);
    const ownWriteInFlight = sites.busy !== undefined
        || display.saving
        || display.appearanceSaving
        || diagnostics.saving
        || reset.resetting;
    const reloadSites = sites.reload;
    const reloadDisplay = display.reload;
    const reloadDiagnostics = diagnostics.reload;
    const onExternalChange = useCallback(() => {
        setExternalChange(true);
        void reloadSites();
        void reloadDisplay();
        void reloadDiagnostics();
    }, [reloadSites, reloadDisplay, reloadDiagnostics]);
    const highest = highestKnownRevision(sites.state, display.state, diagnostics.state);
    useSettingsChanged({
        subscribe,
        revision: highest,
        inFlight: ownWriteInFlight,
        onExternalChange,
    });
    // The projections are read one at a time and an own write refreshes only
    // the projection it changed, so the page can hold two revisions for a
    // moment: a commit that lands between two reads, or an own write beside
    // untouched siblings. Either way, every projection behind the newest one
    // is reread silently as soon as no write is in flight; the announcement
    // for that revision then carries nothing new. Each revision is caught up
    // once: a reread that still lags waits for the next announcement.
    const caughtUp = useRef<number | undefined>(undefined);
    useEffect(() => {
        if (ownWriteInFlight || highest === null || caughtUp.current === highest) {
            return;
        }
        caughtUp.current = highest;
        if (isBehind(sites.state, highest)) {
            void reloadSites();
        }
        if (isBehind(display.state, highest)) {
            void reloadDisplay();
        }
        if (isBehind(diagnostics.state, highest)) {
            void reloadDiagnostics();
        }
    }, [
        ownWriteInFlight,
        highest,
        sites.state,
        display.state,
        diagnostics.state,
        reloadSites,
        reloadDisplay,
        reloadDiagnostics,
    ]);
    // The banner is a signal about the last change, so this page's own next
    // write retires it.
    useEffect(() => {
        if (ownWriteInFlight) {
            setExternalChange(false);
        }
    }, [ownWriteInFlight]);
    const appearance = display.state?.appearance ?? APPEARANCE.SYSTEM;
    return (
        <DirectionProvider initialDirection={uiDirection()} detectDirection={false}>
            <MantineProvider
                theme={NO_MORE_AGO_THEME}
                defaultColorScheme="auto"
                {...forcedColorScheme(appearance)}
            >
                <div className="options">
                    <header className="options-header">
                        <BrandMark size={30} />
                        <span className="options-brand">No More Ago</span>
                        <span className="options-header-spacer" />
                        <AppearanceControl controller={display} />
                        {version ? <span className="nma-eyebrow">v{version}</span> : null}
                    </header>
                    <main aria-label={t("options_document_title")}>
                        {sites.loading || !sites.state ? (
                            <Text role="status" className="options-content">
                                {t("options_loading")}
                            </Text>
                        ) : sites.state.availability === STATE_AVAILABILITY.UNAVAILABLE ? (
                            <OptionsUnavailablePanel
                                failure={sites.state.failure}
                                diagnostics={diagnostics}
                                reset={reset}
                                resetNotice={resetNoticeKey(reset.notice, reset.origin)}
                            />
                        ) : (
                            <SettingsNavigation
                                banner={externalChange ? (
                                    <Alert role="status" color="gray" mb="md">
                                        {t("settings_updated_elsewhere")}
                                    </Alert>
                                ) : null}
                                panels={{
                                    [SETTINGS_SECTION.SITES]: <SitesSection controller={sites} />,
                                    [SETTINGS_SECTION.DISPLAY]: (
                                        <DisplaySection controller={display} />
                                    ),
                                    [SETTINGS_SECTION.DIAGNOSTICS]: (
                                        <DiagnosticsSection controller={diagnostics} />
                                    ),
                                    [SETTINGS_SECTION.RESET]: <ResetControl controller={reset} />,
                                }}
                            />
                        )}
                    </main>
                </div>
            </MantineProvider>
        </DirectionProvider>
    );
}
