/**
 * @file Composes the settings shell, navigation, and feature sections of the options page.
 */

import { Alert, MantineProvider, Text } from "@mantine/core";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { STATE_AVAILABILITY } from "../shared/messaging/view-state-values";
import type {
    DebugState,
    DisplayState,
    SitesState,
} from "../shared/messaging/view-state-schemas";
import {
    INERT_SETTINGS_CHANGED_SUBSCRIBER,
    type SubscribeSettingsChanged,
} from "../shared/messaging/settings-notifications";
import { APPEARANCE } from "../shared/settings/snapshot";
import { BrandMark } from "../shared/ui/brand-mark";
import { updatedInAnotherWindow } from "../shared/ui/copy";
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
import { ResetControl, resetNoticeText } from "./reset-control";
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
    // An own write refreshes one projection only. When the committed revision
    // jumped past the next expected one, another surface wrote in between, so
    // the siblings that are still behind are reread silently. The revision is
    // captured once, when the write starts.
    const beforeWrite = useRef<{ readonly revision: number | null } | undefined>(undefined);
    useEffect(() => {
        if (ownWriteInFlight) {
            beforeWrite.current ??= { revision: highest };
            return;
        }
        const before = beforeWrite.current;
        beforeWrite.current = undefined;
        if (
            before?.revision === null
            || before === undefined
            || highest === null
            || highest <= before.revision + 1
        ) {
            return;
        }
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
                <main aria-label="No More Ago Settings">
                    {sites.loading || !sites.state ? (
                        <Text role="status" className="options-content">
                            Loading settings…
                        </Text>
                    ) : sites.state.availability === STATE_AVAILABILITY.UNAVAILABLE ? (
                        <OptionsUnavailablePanel
                            failure={sites.state.failure}
                            diagnostics={diagnostics}
                            reset={reset}
                            resetNotice={resetNoticeText(reset.notice, reset.origin)}
                        />
                    ) : (
                        <SettingsNavigation
                            banner={externalChange ? (
                                <Alert role="status" color="gray" mb="md">
                                    {updatedInAnotherWindow("Settings")}
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
    );
}
