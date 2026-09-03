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
    createDefaultSettingsChangedSubscriber,
    type SubscribeSettingsChanged,
} from "../shared/messaging/settings-notifications";
import { APPEARANCE } from "../shared/settings/snapshot";
import { BrandMark } from "../shared/ui/brand-mark";
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
import type { OptionsNotice } from "./options-notice";
import { ResetControl } from "./reset-control";
import { useResetController } from "./reset-controller";
import { SETTINGS_SECTION, SettingsNavigation } from "./settings-navigation";
import { useSitesController } from "./sites-controller";
import { SitesSection } from "./sites-section";
import { OptionsUnavailablePanel } from "./unavailable-panel";

/**
 * Reads the installed extension version once, outside the extension it is empty.
 *
 * @returns - Manifest version, or an empty string when no runtime is available.
 */
function readExtensionVersion(): string {
    try {
        return typeof chrome === "undefined" ? "" : chrome.runtime.getManifest().version;
    } catch {
        return "";
    }
}

const EXTENSION_VERSION_LABEL = readExtensionVersion();

/**
 * Optional dependencies and preloaded state for the options UI.
 */
export interface SitesAppProps {
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
     * Runtime used to create and download a diagnostics archive.
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
}

/**
 * Finds the newest settings revision among the projections this page renders.
 *
 * @param states - Sites, display, and debug projections, when loaded.
 * @returns - Highest ready revision, or null while none is ready.
 */
function highestKnownRevision(
    ...states: readonly (SitesState | DisplayState | DebugState | undefined)[]
): number | null {
    let highest: number | null = null;
    for (const state of states) {
        if (state?.availability === STATE_AVAILABILITY.READY) {
            highest = highest === null ? state.revision : Math.max(highest, state.revision);
        }
    }
    return highest;
}

/**
 * Explains a reset failure on the recovery view.
 *
 * @param notice - Outcome of the latest reset attempt.
 * @returns - Guidance text, or undefined when the last reset did not fail.
 */
function recoveryResetText(notice: "save-failed" | "ambiguous" | undefined): string | undefined {
    if (notice === "save-failed") {
        return "Could not reset settings. Processing remains disabled. Try again.";
    }
    if (notice === "ambiguous") {
        return "The reset response could not be confirmed. Processing remains disabled. Try again.";
    }
    return undefined;
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
 * @returns - The options React view.
 */
export function OptionsApp({
    client: suppliedClient,
    initialState,
    initialDisplayState,
    initialDebugState,
    archiveRuntime,
    reporter: suppliedReporter,
    subscribe: suppliedSubscribe,
}: SitesAppProps): ReactElement {
    const client = useMemo(() => suppliedClient ?? createSitesClient(), [suppliedClient]);
    const reporter = useMemo(
        () => suppliedReporter ?? createDefaultSiteReportReporter(),
        [suppliedReporter],
    );
    const subscribe = useMemo(
        () => suppliedSubscribe ?? createDefaultSettingsChangedSubscriber(),
        [suppliedSubscribe],
    );
    const [notice, setNotice] = useState<OptionsNotice>();
    const sites = useSitesController({ client, initialState, onNoticeChange: setNotice });
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
        onNoticeChange: setNotice,
    });
    const reset = useResetController({ client, sites, display, diagnostics });
    const [externalChange, setExternalChange] = useState(false);
    const [pendingRevision, setPendingRevision] = useState<number>();
    const controllers = useRef({ sites, display, diagnostics });
    controllers.current = { sites, display, diagnostics };
    const knownRevision = highestKnownRevision(sites.state, display.state, diagnostics.state);
    const ownWriteInFlight = sites.busy !== undefined
        || display.saving
        || display.appearanceSaving
        || diagnostics.saving
        || reset.resetting;
    const onNewerRevision = useCallback((revision: number) => {
        setPendingRevision((current) => current === undefined
            ? revision
            : Math.max(current, revision));
    }, []);
    useSettingsChanged(subscribe, knownRevision, onNewerRevision);
    // The background announces every committed write to every page, including
    // the page that issued it, and the announcement can arrive before the
    // command response. The decision therefore waits until no write of this
    // page is in flight: an announced revision the page already renders by
    // then was its own, anything newer came from another surface.
    useEffect(() => {
        if (pendingRevision === undefined || ownWriteInFlight) {
            return;
        }
        setPendingRevision(undefined);
        if (knownRevision !== null && knownRevision >= pendingRevision) {
            return;
        }
        setExternalChange(true);
        const current = controllers.current;
        void current.sites.reload();
        void current.display.reload();
        void current.diagnostics.reload();
    }, [pendingRevision, ownWriteInFlight, knownRevision]);
    const appearance = display.state?.appearance ?? APPEARANCE.SYSTEM;
    const unavailable = !sites.loading
        && sites.state?.availability === STATE_AVAILABILITY.UNAVAILABLE;
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
                    {EXTENSION_VERSION_LABEL ? (
                        <span className="nma-eyebrow options-version">
                            v{EXTENSION_VERSION_LABEL}
                        </span>
                    ) : null}
                </header>
                <main aria-label="No More Ago Settings">
                    {sites.loading || !sites.state ? (
                        <Text role="status" className="settings-content">
                            Loading settings…
                        </Text>
                    ) : unavailable ? (
                        <OptionsUnavailablePanel
                            message="Settings could not be read, so processing is disabled."
                            diagnostics={diagnostics}
                            reset={reset}
                            resetNotice={recoveryResetText(reset.notice)}
                        />
                    ) : (
                        <SettingsNavigation
                            banner={externalChange ? (
                                <Alert role="status" color="gray" mb="md">
                                    Settings were updated in another window.
                                </Alert>
                            ) : null}
                            panels={{
                                [SETTINGS_SECTION.SITES]: (
                                    <SitesSection controller={sites} notice={notice} />
                                ),
                                [SETTINGS_SECTION.DISPLAY]: (
                                    <DisplaySection controller={display} />
                                ),
                                [SETTINGS_SECTION.DIAGNOSTICS]: (
                                    <DiagnosticsSection controller={diagnostics} notice={notice} />
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
