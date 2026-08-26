/**
 * Renders the popup's status, controls, and site-report action.
 *
 * @file React popup UI for extension status, site controls, and support reporting.
 */

import { Alert, Anchor, Box, Button, MantineProvider, Paper, Stack, Switch, Text, Title } from "@mantine/core";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactElement } from "react";
import type { PopupState } from "../background/application";
import { createDefaultSiteReportReporter, type SiteReportError, type SiteReportReporter } from "../reporting/site-report";
import { createPopupClient, type PopupClient } from "./client";

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
    if (state.availability === "unavailable") {
        return state.failure === "fail-closed-cleanup"
            ? "Current processing state is unknown."
            : "Settings are unavailable. Processing is disabled.";
    }
    switch (state.status) {
        case "active": return `Active on ${state.hostname ?? "this page"}`;
        case "global-disabled": return "Extension is off";
        case "site-disabled": return `Disabled on ${state.hostname ?? "this hostname"}`;
        case "inaccessible": return "Cannot run on this page";
        case "runtime-failed": return "Could not process this page";
        case "no-rules": return `Rules are not available for ${state.hostname ?? "this hostname"} yet`;
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
        return "This hostname is invalid. Use an exact hostname without a scheme, port, path, or wildcard.";
    }
    if (notice === "interrupted") {
        return "The response was interrupted. Current state was reloaded.";
    }
    if (notice === "unknown") {
        return "Could not confirm whether the change was saved. Reopen the popup to try again. Current state is unavailable.";
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
 * @param props.reporter - Site-report service override.
 * @returns The popup React view.
 */
export function PopupApp({ client: suppliedClient, initialState, reporter: suppliedReporter }: PopupAppProps): ReactElement {
    const client = useMemo(() => suppliedClient ?? createPopupClient(), [suppliedClient]);
    const reporter = useMemo(() => suppliedReporter ?? createDefaultSiteReportReporter(), [suppliedReporter]);
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
        void client.getState().then((next) => {
            if (!mounted) {
                return;
            }
            setState(next);
            setLoading(false);
        }).catch(() => {
            if (!mounted) {
                return;
            }
            setState({ availability: "unavailable", revision: null, globalEnabled: null, hostname: null, siteEnabled: null, hasAdapter: false, status: "settings-unavailable", failure: "settings-load" });
            setLoading(false);
        });
        return () => {
            mounted = false;
        };
    }, [client, initialState]);

    useEffect(() => {
        const input = switchRef.current;
        if (!input) {
            return;
        }
        const unavailable = state?.availability !== "ready";
        input.indeterminate = unavailable;
        input.setAttribute("aria-checked", unavailable ? "mixed" : String(state.globalEnabled));
    }, [state]);

    const onChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
        if (!state || state.availability !== "ready" || saving || savingSite) {
            return;
        }
        setSaving(true);
        setNotice(undefined);
        const result = await client.setGlobalEnabled(event.currentTarget.checked);
        if (result.kind === "response") {
            const responseState = result.response.state;
            if (responseState.availability !== "ready" || responseState.revision >= state.revision) {
                setState(responseState);
            }
            if (!result.response.ok) {
                setNotice(result.response.error === "save-failed" ? "save-failed" : "unknown");
            }
        } else if (result.state) {
            if (result.state.availability !== "ready" || result.state.revision >= state.revision) {
                setState(result.state);
            }
            setNotice("interrupted");
        } else {
            setState({ availability: "unavailable", revision: null, globalEnabled: null, hostname: state.hostname, siteEnabled: null, hasAdapter: false, status: "runtime-failed", failure: "settings-load" });
            setNotice("unknown");
        }
        setSaving(false);
    };

    const onSiteChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
        if (!state || state.availability !== "ready" || state.hostname === null || state.siteEnabled === null || saving || savingSite) {
            return;
        }
        setSavingSite(true);
        setNotice(undefined);
        const result = await client.setSiteEnabled(state.hostname, event.currentTarget.checked);
        if (result.kind === "response") {
            const responseState = result.response.state;
            if (responseState.availability !== "ready" || responseState.revision >= state.revision) {
                setState(responseState);
            }
            if (!result.response.ok) {
                setNotice(result.response.error === "save-failed" ? "save-failed" : result.response.error === "invalid-hostname" ? "invalid-hostname" : "unknown");
            }
        } else if (result.state) {
            if (result.state.availability !== "ready" || result.state.revision >= state.revision) {
                setState(result.state);
            }
            setNotice("interrupted");
        } else {
            setState({ availability: "unavailable", revision: null, globalEnabled: null, hostname: state.hostname, siteEnabled: null, hasAdapter: false, status: "runtime-failed", failure: "settings-load" });
            setNotice("unknown");
        }
        setSavingSite(false);
    };

    const onReportSite = async (): Promise<void> => {
        if (!state || state.availability !== "ready" || state.hostname === null || reporting || reportInFlight.current) {
            return;
        }
        reportInFlight.current = true;
        setReporting(true);
        setReportNotice(undefined);
        try {
            const result = await reporter.openPopupReport({ hostname: state.hostname, hasAdapter: state.hasAdapter });
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
        return <MantineProvider><main className="popup"><Text role="status">Loading…</Text></main></MantineProvider>;
    }
    const checked = state.availability === "ready" && state.globalEnabled;
    const disabled = saving || savingSite || state.availability !== "ready";
    const siteSwitchVisible = state.availability === "ready" && state.hostname !== null && state.siteEnabled !== null;
    const reportVisible = state.availability === "ready" && state.hostname !== null;
    const noticeMessage = noticeText(notice);
    return (
        <MantineProvider>
            <main className="popup" aria-label="No More Ago">
                <Paper className="popup-card" shadow="sm" withBorder>
                    <Stack gap="md">
                        <Box>
                            <Title order={3}>No More Ago</Title>
                            <Text size="sm" c="dimmed">{state.hostname ?? "Current page"}</Text>
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
                                label={`Enabled on ${state.hostname}`}
                                checked={state.siteEnabled}
                                disabled={disabled}
                                onChange={(event) => {
                                    void onSiteChange(event);
                                }}
                                aria-label={`Enabled on ${state.hostname}`}
                            />
                        ) : null}
                        <Text role="status">{statusText(state)}</Text>
                        {noticeMessage ? <Alert role="alert" color="red">{noticeMessage}</Alert> : null}
                        {reportVisible ? <Button type="button" onClick={() => {
                            void onReportSite();
                        }} loading={reporting} disabled={reporting}>Report this site</Button> : null}
                        {reportNotice ? <Alert role="alert" color="red">{reportNotice}</Alert> : null}
                        <Anchor href="options.html">Settings</Anchor>
                    </Stack>
                </Paper>
            </main>
        </MantineProvider>
    );
}
