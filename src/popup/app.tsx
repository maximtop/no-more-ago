/**
 * @file React popup UI for extension status, site controls, and reporting.
 */

import {
    Alert,
    Box,
    Button,
    Group,
    MantineProvider,
    Stack,
    Switch,
    Text,
    Title,
} from "@mantine/core";
import { useMemo, useState, type ReactElement } from "react";
import { STATE_AVAILABILITY } from "../shared/messaging/view-state-values";
import { APPEARANCE } from "../shared/settings/snapshot";
import {
    createDefaultSiteReportReporter,
    type SiteReportError,
    type SiteReportReporter,
} from "../shared/reporting/site-report";
import type { SubscribeSettingsChanged } from "../shared/messaging/settings-notifications";
import type { DownloadRuntime } from "../shared/diagnostics/archive";
import { BrandMark } from "../shared/ui/brand-mark";
import { NO_MORE_AGO_THEME, forcedColorScheme } from "../shared/ui/theme";
import type { PopupClient } from "./client";
import type { PopupState } from "../shared/messaging/view-state-schemas";
import { usePopupController, type PopupNotice } from "./popup-controller";
import { popupStatusModel, runModeLabel, siteControlDescription } from "./popup-status";
import { PopupUnavailablePanel } from "./unavailable-panel";
import { openBrowserOptionsPage, type OpenOptionsPage } from "./options-page";

/**
 * Optional dependencies and initial state for the popup UI.
 */
export interface PopupAppProps {
    /**
     * Client used to load and change popup settings.
     */
    readonly client?: PopupClient;

    /**
     * State to render without an initial background request.
     */
    readonly initialState?: PopupState;

    /**
     * Function used to open the browser-managed Options page.
     */
    readonly openOptionsPage?: OpenOptionsPage;

    /**
     * Service used to open a GitHub report for the current site.
     */
    readonly reporter?: SiteReportReporter;

    /**
     * Subscriber used to observe committed settings changes.
     */
    readonly subscribe?: SubscribeSettingsChanged;

    /**
     * Runtime used to hand a diagnostics archive to the browser.
     */
    readonly archiveRuntime?: DownloadRuntime;
}

/**
 * Maps a settings-mutation outcome to its user-visible message.
 *
 * @param notice - Outcome reported after a settings mutation.
 * @returns - Message to display, or undefined when there is nothing to show.
 */
function noticeText(notice: PopupNotice): string | undefined {
    if (notice === "save-failed") {
        return "Could not save this change. Try again.";
    }
    if (notice === "invalid-hostname") {
        return "This hostname is invalid. Use an exact hostname without a scheme, port, path, "
            + "or wildcard.";
    }
    if (notice === "interrupted") {
        return "The response was interrupted. Current state was reloaded.";
    }
    if (notice === "unknown") {
        return "Could not confirm whether the change was saved. Reopen the popup to try again.";
    }
    if (notice === "external-change") {
        return "Updated from another No More Ago window.";
    }
    return undefined;
}

/**
 * Maps a site-report failure to guidance shown in the popup.
 *
 * @param error - Failure returned by the site-report service.
 * @returns - The error message displayed to the user.
 */
function siteReportErrorText(error: SiteReportError): string {
    if (error === "missing-tab") {
        return "Could not find the current site. Reopen the popup and try again.";
    }
    if (error === "restricted-page") {
        return "This page cannot be reported. Open an HTTP or HTTPS site.";
    }
    if (error === "hostname-mismatch") {
        return "The current site changed. Reopen the popup and try again.";
    }
    if (error === "private-window") {
        return "Could not safely open the report in this private window.";
    }
    if (error === "browser-unavailable") {
        return "Site reporting is unavailable in this browser.";
    }
    if (error === "invalid-context") {
        return "Could not identify this site or extension. Reopen the popup and try again.";
    }
    if (error === "busy") {
        return "A site report is already being opened.";
    }
    return "Could not open the GitHub report. Try again.";
}

/**
 * Renders and coordinates the popup controls.
 *
 * @param props - Optional dependencies and preloaded popup state.
 * @param props.client - Popup settings client override.
 * @param props.initialState - Preloaded popup state.
 * @param props.openOptionsPage - Browser Options-page function override.
 * @param props.reporter - Site-report service override.
 * @param props.subscribe - Settings change subscriber override.
 * @param props.archiveRuntime - Diagnostics archive download runtime override.
 * @returns - The popup React view.
 */
export function PopupApp({
    client,
    initialState,
    openOptionsPage = openBrowserOptionsPage,
    reporter: suppliedReporter,
    subscribe,
    archiveRuntime,
}: PopupAppProps): ReactElement {
    const controller = usePopupController({
        ...(client ? { client } : {}),
        ...(initialState ? { initialState } : {}),
        ...(subscribe ? { subscribe } : {}),
        ...(archiveRuntime ? { archiveRuntime } : {}),
    });
    const reporter = useMemo(
        () => suppliedReporter ?? createDefaultSiteReportReporter(),
        [suppliedReporter],
    );
    const [reporting, setReporting] = useState(false);
    const [reportNotice, setReportNotice] = useState<string>();
    const { state } = controller;
    const appearance = state?.appearance ?? APPEARANCE.SYSTEM;

    const onReportSite = async (): Promise<void> => {
        if (
            !state
            || state.availability !== STATE_AVAILABILITY.READY
            || state.hostname === null
            || reporting
        ) {
            return;
        }
        setReporting(true);
        setReportNotice(undefined);
        try {
            const result = await reporter.openPopupReport({ hostname: state.hostname });
            if (!result.ok) {
                setReportNotice(siteReportErrorText(result.error));
            }
        } catch {
            setReportNotice("Could not open the GitHub report. Try again.");
        } finally {
            setReporting(false);
        }
    };

    const onReportGeneric = (): void => {
        void reporter.openOptionsReport().catch(() => undefined);
    };

    const body = (): ReactElement => {
        if (controller.loading || !state) {
            return (
                <Text role="status" className="popup-section">
                    Loading current site…
                </Text>
            );
        }
        if (state.availability !== STATE_AVAILABILITY.READY) {
            return (
                <PopupUnavailablePanel
                    message={popupStatusModel(state).text}
                    busy={controller.saving}
                    onReport={onReportGeneric}
                    onReset={() => {
                        void controller.resetAll();
                    }}
                    onDownloadLogs={() => {
                        void controller.downloadLogs();
                    }}
                    downloading={controller.downloading}
                    downloadNotice={controller.downloadNotice}
                    onOpenSettings={() => {
                        void openOptionsPage().catch(() => undefined);
                    }}
                />
            );
        }
        const status = popupStatusModel(state);
        const noticeMessage = noticeText(controller.notice);
        const siteVisible = state.hostname !== null && state.siteEnabled !== null;
        return (
            <>
                <div className="popup-status" data-tone={status.tone}>
                    <span className="popup-status-dot" aria-hidden="true" />
                    <Text role="status" size="sm" fw={600}>
                        {status.text}
                    </Text>
                </div>
                {noticeMessage ? (
                    <Alert role="status" color="gray" className="popup-section">
                        {noticeMessage}
                    </Alert>
                ) : null}
                <div className="popup-section">
                    <Group justify="space-between" className="popup-row popup-row-summary">
                        <span className="nma-eyebrow">Run mode</span>
                        <Text size="xs" fw={600}>
                            {runModeLabel(state.scopeMode)}
                        </Text>
                    </Group>
                    <Group justify="space-between" wrap="nowrap" className="popup-row">
                        <Box>
                            <Text size="sm" fw={600}>
                                Extension enabled
                            </Text>
                            <Text size="xs" c="dimmed">
                                Pause or resume all site rules.
                            </Text>
                        </Box>
                        <Switch
                            checked={state.globalEnabled}
                            aria-label="Extension enabled"
                            onChange={(event) => {
                                void controller.changeGlobal(event.currentTarget.checked);
                            }}
                        />
                    </Group>
                    {siteVisible ? (
                        <Group justify="space-between" wrap="nowrap" className="popup-row">
                            <Box>
                                <Text size="sm" fw={600}>
                                    Enabled on this site
                                </Text>
                                <Text size="xs" c="dimmed">
                                    {siteControlDescription(
                                        state.scopeMode,
                                        state.siteEnabled ?? false,
                                    )}
                                </Text>
                            </Box>
                            <Switch
                                checked={state.siteEnabled ?? false}
                                disabled={!state.globalEnabled}
                                aria-label={`Enabled on ${state.hostname ?? "this site"}`}
                                onChange={(event) => {
                                    void controller.changeSite(event.currentTarget.checked);
                                }}
                            />
                        </Group>
                    ) : null}
                </div>
                {reportNotice ? (
                    <Alert role="alert" color="red" className="popup-section">
                        {reportNotice}
                    </Alert>
                ) : null}
                <Group justify="space-between" className="popup-section">
                    {state.hostname === null ? <span /> : (
                        <Button
                            type="button"
                            variant="default"
                            loading={reporting}
                            disabled={reporting}
                            onClick={() => {
                                void onReportSite();
                            }}
                        >
                            Report this site
                        </Button>
                    )}
                    <Button
                        type="button"
                        variant="subtle"
                        onClick={() => {
                            void openOptionsPage().catch(() => undefined);
                        }}
                    >
                        Settings
                    </Button>
                </Group>
            </>
        );
    };

    return (
        <MantineProvider
            theme={NO_MORE_AGO_THEME}
            defaultColorScheme="auto"
            {...forcedColorScheme(appearance)}
        >
            <main className="popup" aria-label="No More Ago">
                <header className="popup-header">
                    <BrandMark size={40} />
                    <div className="popup-identity">
                        <Title order={1}>No More Ago</Title>
                        <p className="popup-hostname nma-mono" title={state?.hostname ?? undefined}>
                            {state?.hostname ?? "Current page"}
                        </p>
                    </div>
                </header>
                <Stack gap={0}>{body()}</Stack>
            </main>
        </MantineProvider>
    );
}
