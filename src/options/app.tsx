/**
 * @file Composes the focused feature controllers and sections of the options page.
 */

import { MantineProvider, Paper, Stack, Text } from "@mantine/core";
import { useMemo, useState, type ReactElement } from "react";
import {
    STATE_AVAILABILITY,
} from "../shared/messaging/view-state-values";
import type {
    DebugState,
    DisplayState,
    SitesState,
} from "../shared/messaging/view-state-schemas";
import type { DownloadRuntime } from "./diagnostics/archive";
import {
    createDefaultSiteReportReporter,
    type SiteReportReporter,
} from "../shared/reporting/site-report";
import { createSitesClient, type SitesClient } from "./client";
import { useDiagnosticsController } from "./diagnostics-controller";
import { DiagnosticsSection } from "./diagnostics-section";
import { useDisplayController } from "./display-controller";
import { DisplaySection } from "./display-section";
import type { OptionsNotice } from "./options-notice";
import { ResetControl } from "./reset-control";
import { useResetController } from "./reset-controller";
import { useSitesController } from "./sites-controller";
import { SitesSection } from "./sites-section";

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
}

/**
 * Renders and coordinates the options settings controls.
 *
 * @param props Optional dependencies and preloaded options state.
 * @param props.client Settings client override.
 * @param props.initialState Preloaded site settings state.
 * @param props.initialDisplayState Preloaded display settings state.
 * @param props.initialDebugState Preloaded diagnostic logging state.
 * @param props.archiveRuntime Diagnostics archive download runtime.
 * @param props.reporter Site-report service override.
 * @returns The options React view.
 */
export function OptionsApp({
    client: suppliedClient,
    initialState,
    initialDisplayState,
    initialDebugState,
    archiveRuntime,
    reporter: suppliedReporter,
}: SitesAppProps): ReactElement {
    const client = useMemo(() => suppliedClient ?? createSitesClient(), [suppliedClient]);
    const reporter = useMemo(
        () => suppliedReporter ?? createDefaultSiteReportReporter(),
        [suppliedReporter],
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

    if (sites.loading || !sites.state) {
        return (
            <MantineProvider>
                <main className="options" aria-label="No More Ago Settings">
                    <Text role="status">Loading…</Text>
                </main>
            </MantineProvider>
        );
    }

    return (
        <MantineProvider>
            <main className="options" aria-label="No More Ago Settings">
                <Paper className="options-card" shadow="sm" withBorder>
                    <Stack gap="md">
                        <SitesSection controller={sites} notice={notice} />
                        <DisplaySection controller={display} />
                        {sites.state.availability === STATE_AVAILABILITY.READY ? (
                            <DiagnosticsSection controller={diagnostics} />
                        ) : null}
                        <ResetControl controller={reset} />
                    </Stack>
                </Paper>
            </main>
        </MantineProvider>
    );
}
