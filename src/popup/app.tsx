/**
 * Renders the popup's status, controls, and site-report action.
 *
 * @file React popup UI for extension status, site controls, and support reporting.
 */

import {
    Alert,
    Box,
    Button,
    MantineProvider,
    Paper,
    Stack,
    Switch,
    Text,
    Title,
} from "@mantine/core";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactElement } from "react";
import {
    POPUP_STATUS,
    SETTINGS_STATE_FAILURE,
    STATE_AVAILABILITY,
} from "../shared/messaging/view-state-values";
import {
    createUnavailablePopupState,
    type PopupState,
} from "../shared/messaging/view-state-schemas";
import {
    createDefaultSiteReportReporter,
    type SiteReportError,
    type SiteReportReporter,
} from "../shared/reporting/site-report";
import { CLIENT_RESULT_KIND } from "../shared/client-result";
import { createPopupClient, type PopupClient } from "./client";
import {
    openBrowserOptionsPage,
    type OpenOptionsPage,
} from "./options-page";

const POPUP_STATE_LOAD_TIMEOUT_MS = 5_000;

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
}

/**
 * User-visible outcome of a settings mutation.
 */
type Notice = "save-failed" | "invalid-hostname" | "interrupted" | "unknown" | undefined;

/**
 * Maps popup state to the status text shown below the controls.
 *
 * @param state Current popup state.
 * @returns A concise description of the extension's state on the current page.
 */
function statusText(state: PopupState): string {
    if (state.availability === STATE_AVAILABILITY.UNAVAILABLE) {
        return state.failure === SETTINGS_STATE_FAILURE.FAIL_CLOSED_CLEANUP
            ? "Current processing state is unknown."
            : "Settings are unavailable. Processing is disabled.";
    }
    switch (state.status) {
        case POPUP_STATUS.ACTIVE:
            return `Active on ${state.hostname ?? "this page"}`;
        case POPUP_STATUS.GLOBAL_DISABLED:
            return "Extension is off";
        case POPUP_STATUS.SITE_DISABLED:
            return `Disabled on ${state.hostname ?? "this hostname"}`;
        case POPUP_STATUS.INACCESSIBLE:
            return "Cannot run on this page";
        case POPUP_STATUS.RUNTIME_FAILED:
            return "Could not process this page";
    }
}

/**
 * Maps a settings-mutation outcome to its user-visible error message.
 *
 * @param notice Outcome reported after a settings mutation.
 * @returns An error message, or undefined when there is no notice to show.
 */
function noticeText(notice: Notice): string | undefined {
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
        return "Could not confirm whether the change was saved. Reopen the popup to try again. "
            + "Current state is unavailable.";
    }
    return undefined;
}

/**
 * Maps a site-report failure to guidance shown in the popup.
 *
 * @param error Failure returned by the site-report service.
 * @returns The error message displayed to the user.
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
 * Renders and coordinates the popup settings controls.
 *
 * @param props - Optional dependencies and preloaded popup state.
 * @param props.client - Popup settings client override.
 * @param props.initialState - Preloaded popup state.
 * @param props.openOptionsPage - Browser Options-page function override.
 * @param props.reporter - Site-report service override.
 * @returns The popup React view.
 */
export function PopupApp({
    client: suppliedClient,
    initialState,
    openOptionsPage = openBrowserOptionsPage,
    reporter: suppliedReporter,
}: PopupAppProps): ReactElement {
    const client = useMemo(() => suppliedClient ?? createPopupClient(), [suppliedClient]);
    const reporter = useMemo(
        () => suppliedReporter ?? createDefaultSiteReportReporter(),
        [suppliedReporter],
    );
    const [state, setState] = useState<PopupState | undefined>(initialState);
    const [loading, setLoading] = useState(initialState === undefined);
    const [saving, setSaving] = useState(false);
    const [savingSite, setSavingSite] = useState(false);
    const [reporting, setReporting] = useState(false);
    const [reportNotice, setReportNotice] = useState<string>();
    const [notice, setNotice] = useState<Notice>();
    const switchRef = useRef<HTMLInputElement>(null);
    const reportInFlight = useRef(false);

    useEffect(() => {
        if (initialState) {
            return;
        }
        let mounted = true;
        const loadTimeout = globalThis.setTimeout(() => {
            if (!mounted) {
                return;
            }
            setState(createUnavailablePopupState());
            setLoading(false);
        }, POPUP_STATE_LOAD_TIMEOUT_MS);
        void client
            .getState()
            .then((next) => {
                if (!mounted) {
                    return;
                }
                globalThis.clearTimeout(loadTimeout);
                setState(next);
                setLoading(false);
            })
            .catch(() => {
                if (!mounted) {
                    return;
                }
                globalThis.clearTimeout(loadTimeout);
                setState(createUnavailablePopupState());
                setLoading(false);
            });
        return () => {
            mounted = false;
            globalThis.clearTimeout(loadTimeout);
        };
    }, [client, initialState]);

    useEffect(() => {
        const input = switchRef.current;
        if (!input) {
            return;
        }
        const unavailable = state?.availability !== STATE_AVAILABILITY.READY;
        input.indeterminate = unavailable;
        input.setAttribute("aria-checked", unavailable ? "mixed" : String(state.globalEnabled));
    }, [state]);

    const onChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
        if (!state || state.availability !== STATE_AVAILABILITY.READY || saving || savingSite) {
            return;
        }
        setSaving(true);
        setNotice(undefined);
        const result = await client.setGlobalEnabled(event.currentTarget.checked);
        if (result.kind === CLIENT_RESULT_KIND.RESPONSE) {
            const responseState = result.response.state;
            if (
                responseState.availability !== STATE_AVAILABILITY.READY ||
                responseState.revision >= state.revision
            ) {
                setState(responseState);
            }
            if (!result.response.ok) {
                setNotice(result.response.error === "save-failed" ? "save-failed" : "unknown");
            }
        } else if (result.state) {
            if (
                result.state.availability !== STATE_AVAILABILITY.READY
                || result.state.revision >= state.revision
            ) {
                setState(result.state);
            }
            setNotice("interrupted");
        } else {
            setState({
                availability: STATE_AVAILABILITY.UNAVAILABLE,
                revision: null,
                globalEnabled: null,
                hostname: state.hostname,
                siteEnabled: null,
                status: POPUP_STATUS.RUNTIME_FAILED,
                failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
            });
            setNotice("unknown");
        }
        setSaving(false);
    };

    const onSiteChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
        if (
            !state ||
            state.availability !== STATE_AVAILABILITY.READY ||
            state.hostname === null ||
            state.siteEnabled === null ||
            saving ||
            savingSite
        ) {
            return;
        }
        setSavingSite(true);
        setNotice(undefined);
        const result = await client.setSiteEnabled(state.hostname, event.currentTarget.checked);
        if (result.kind === CLIENT_RESULT_KIND.RESPONSE) {
            const responseState = result.response.state;
            if (
                responseState.availability !== STATE_AVAILABILITY.READY ||
                responseState.revision >= state.revision
            ) {
                setState(responseState);
            }
            if (!result.response.ok) {
                setNotice(
                    result.response.error === "save-failed"
                        ? "save-failed"
                        : result.response.error === "invalid-hostname"
                            ? "invalid-hostname"
                            : "unknown",
                );
            }
        } else if (result.state) {
            if (
                result.state.availability !== STATE_AVAILABILITY.READY
                || result.state.revision >= state.revision
            ) {
                setState(result.state);
            }
            setNotice("interrupted");
        } else {
            setState({
                availability: STATE_AVAILABILITY.UNAVAILABLE,
                revision: null,
                globalEnabled: null,
                hostname: state.hostname,
                siteEnabled: null,
                status: POPUP_STATUS.RUNTIME_FAILED,
                failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
            });
            setNotice("unknown");
        }
        setSavingSite(false);
    };

    const onReportSite = async (): Promise<void> => {
        if (
            !state ||
            state.availability !== STATE_AVAILABILITY.READY ||
            state.hostname === null ||
            reporting ||
            reportInFlight.current
        ) {
            return;
        }
        reportInFlight.current = true;
        setReporting(true);
        setReportNotice(undefined);
        try {
            const result = await reporter.openPopupReport({
                hostname: state.hostname,
            });
            if (!result.ok) {
                setReportNotice(siteReportErrorText(result.error));
            }
        } catch {
            setReportNotice("Could not open the GitHub report. Try again.");
        } finally {
            reportInFlight.current = false;
            setReporting(false);
        }
    };

    if (loading || !state) {
        return (
            <MantineProvider>
                <main className="popup">
                    <Text role="status">Loading…</Text>
                </main>
            </MantineProvider>
        );
    }
    const checked = state.availability === STATE_AVAILABILITY.READY && state.globalEnabled;
    const disabled = saving || savingSite || state.availability !== STATE_AVAILABILITY.READY;
    const siteSwitchVisible =
        state.availability === STATE_AVAILABILITY.READY
        && state.hostname !== null && state.siteEnabled !== null;
    const reportVisible = state.availability === STATE_AVAILABILITY.READY
        && state.hostname !== null;
    const noticeMessage = noticeText(notice);
    return (
        <MantineProvider>
            <main className="popup" aria-label="No More Ago">
                <Paper className="popup-card" shadow="sm" withBorder>
                    <Stack gap="md">
                        <Box>
                            <Title order={3}>No More Ago</Title>
                            <Text size="sm" c="dimmed">
                                {state.hostname ?? "Current page"}
                            </Text>
                        </Box>
                        <Switch
                            ref={switchRef}
                            label="Global enabled"
                            checked={checked}
                            disabled={disabled}
                            onChange={(event) => {
                                void onChange(event);
                            }}
                            aria-label="Global enabled"
                        />
                        {siteSwitchVisible ? (
                            <Switch
                                label={`Enabled on ${state.hostname ?? "current site"}`}
                                checked={state.siteEnabled ?? false}
                                disabled={disabled}
                                onChange={(event) => {
                                    void onSiteChange(event);
                                }}
                                aria-label={`Enabled on ${state.hostname ?? "current site"}`}
                            />
                        ) : null}
                        <Text role="status">{statusText(state)}</Text>
                        {noticeMessage ? (
                            <Alert role="alert" color="red">
                                {noticeMessage}
                            </Alert>
                        ) : null}
                        {reportVisible ? (
                            <Button
                                type="button"
                                onClick={() => {
                                    void onReportSite();
                                }}
                                loading={reporting}
                                disabled={reporting}
                            >
                                Report this site
                            </Button>
                        ) : null}
                        {reportNotice ? (
                            <Alert role="alert" color="red">
                                {reportNotice}
                            </Alert>
                        ) : null}
                        <Button
                            type="button"
                            variant="default"
                            onClick={() => {
                                void openOptionsPage().catch(() => undefined);
                            }}
                        >
                            Settings
                        </Button>
                    </Stack>
                </Paper>
            </main>
        </MantineProvider>
    );
}
