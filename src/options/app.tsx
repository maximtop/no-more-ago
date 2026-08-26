/**
 * Renders settings for site processing, date display, diagnostics, and reporting.
 *
 * @file React settings UI for global, per-site, display, diagnostics, and reporting controls.
 */

import { Alert, Box, Button, MantineProvider, Paper, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactElement } from "react";
import type { DebugState, DisplaySettings, DisplayState, SitesState } from "../background/application";
import { DEFAULT_CUSTOM_FORMAT_PATTERN, validateCustomFormatPattern } from "../settings/custom-format";
import { formatDateWithPresentation } from "../core/format-default-date";
import { DiagnosticArchiveError, createDiagnosticsZip, downloadDiagnosticsZip, type DownloadRuntime } from "../diagnostics/archive";
import { createDefaultSiteReportReporter, type SiteReportReporter } from "../reporting/site-report";
import { createSitesClient, type SitesClient } from "./client";

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
 * User-visible outcome of a site or debug-settings mutation.
 */
type Notice = "save-failed" | "invalid-hostname" | "interrupted" | "unknown" | "debug-save-failed" | "debug-interrupted" | "debug-unknown" | undefined;

/**
 * User-visible outcome of resetting all settings.
 */
type ResetNotice = "save-failed" | "ambiguous" | undefined;

/**
 * Availability state from which a reset was initiated.
 */
type ResetOrigin = "ready" | "unavailable";

/**
 * Maps a site or debug-settings outcome to its user-visible error message.
 *
 * @param notice Outcome reported after a settings mutation.
 * @returns An error message, or undefined when there is no notice to show.
 */
function noticeText(notice: Notice): string | undefined {
    if (notice === "save-failed") return "Could not save this change. Try again.";
    if (notice === "invalid-hostname") return "This hostname is invalid. Use an exact hostname without a scheme, port, path, or wildcard.";
    if (notice === "interrupted") return "The response was interrupted. Current state was reloaded.";
    if (notice === "unknown") return "Could not confirm whether the change was saved. Reopen Settings to try again. Current state is unavailable.";
    if (notice === "debug-save-failed") return "Could not save the Debug logs setting. Try again.";
    if (notice === "debug-interrupted") return "The Debug logs response was interrupted. Current state was reloaded.";
    if (notice === "debug-unknown") return "Could not confirm the Debug logs setting. Reopen Settings to try again.";
    return undefined;
}

/**
 * Maps a reset outcome and its starting availability to an error message.
 *
 * @param notice Outcome reported after resetting settings.
 * @param origin Availability state before the reset was requested.
 * @returns An error message, or undefined when there is no notice to show.
 */
function resetNoticeText(notice: ResetNotice, origin: ResetOrigin): string | undefined {
    if (origin === "ready" && notice === "save-failed") return "Could not reset settings. Your current settings remain active. Try again.";
    if (origin === "ready" && notice === "ambiguous") return "Could not confirm whether settings were reset. Reopen Settings to check their current state.";
    if (notice === "save-failed") return "Could not reset settings. Processing remains disabled. Try again.";
    if (notice === "ambiguous") return "The reset response could not be confirmed. Processing remains disabled. Try again.";
    return undefined;
}

/**
 * Explains why site settings cannot currently be changed.
 *
 * @param state Unavailable sites state returned by the background service.
 * @returns The message displayed instead of the site controls.
 */
function unavailableText(state: Extract<SitesState, { availability: "unavailable" }>): string {
    return state.failure === "fail-closed-cleanup"
        ? "Current processing state is unknown. Site controls are unavailable."
        : "Sites settings are unavailable. Processing is disabled.";
}

/**
 * User-visible outcome of saving display settings.
 */
type DisplayNotice =
  | "invalid-time-zone"
  | "invalid-format"
  | "unavailable-time-zone"
  | "save-failed"
  | "interrupted"
  | "partial-refresh"
  | "unknown"
  | undefined;

/**
 * Editable representation of the display settings form.
 */
interface DisplayDraft {
    /**
     * Whether dates use the browser format or a custom pattern.
     */
    readonly formatMode: "system" | "custom";

    /**
     * Custom date format pattern, retained while system formatting is selected.
     */
    readonly pattern: string;

    /**
     * Whether dates use the system zone, UTC, or a named IANA zone.
     */
    readonly timeZoneMode: "system" | "utc" | "iana";

    /**
     * IANA zone identifier when the named-zone mode is selected.
     */
    readonly identifier: string;
}

/**
 * Converts saved display settings into fields for the editable form.
 *
 * @param display Persisted display settings.
 * @returns The corresponding form draft, with a default custom pattern when needed.
 */
function draftFromDisplay(display: DisplaySettings): DisplayDraft {
    return {
        formatMode: display.formatMode,
        pattern: display.formatMode === "custom" ? display.pattern : DEFAULT_CUSTOM_FORMAT_PATTERN,
        timeZoneMode: display.timeZone.mode,
        identifier: display.timeZone.mode === "iana" ? display.timeZone.identifier : ""
    };
}

/**
 * Converts the display form fields into settings for persistence.
 *
 * @param draft Current form draft.
 * @returns Display settings represented by the draft.
 */
function displayFromDraft(draft: DisplayDraft): DisplaySettings {
    const timeZone = draft.timeZoneMode === "iana"
        ? { mode: "iana" as const, identifier: draft.identifier }
        : { mode: draft.timeZoneMode };
    return draft.formatMode === "custom"
        ? { formatMode: "custom", pattern: draft.pattern, timeZone }
        : { formatMode: "system", timeZone };
}

/**
 * Validates an IANA time-zone identifier before settings are saved.
 *
 * @param identifier Candidate IANA time-zone identifier.
 * @returns A user-visible validation error, or undefined when the identifier is usable.
 */
function validateIdentifier(identifier: string): string | undefined {
    if (identifier.length === 0 || identifier.trim() !== identifier) {
        return "Enter an IANA time zone identifier, for example America/New_York.";
    }
    const components = identifier.split("/");
    if (components.some((component) => component === "." || component === "..")) {
        return "Use a valid IANA time zone identifier without path traversal.";
    }
    if (!/^[A-Za-z][A-Za-z0-9_.+-]*(?:\/[A-Za-z][A-Za-z0-9_.+-]*)*$/.test(identifier)) {
        return "Use a valid IANA time zone identifier, such as America/New_York.";
    }
    try {
        new Intl.DateTimeFormat(undefined, { timeZone: identifier }).resolvedOptions();
    } catch {
        return "This time zone is not available in the current browser. Choose another identifier.";
    }
    return undefined;
}

/**
 * Maps a display-settings outcome to its user-visible error message.
 *
 * @param notice Outcome reported after saving display settings.
 * @returns An error message, or undefined when there is no notice to show.
 */
function displayNoticeText(notice: DisplayNotice): string | undefined {
    if (notice === "invalid-time-zone") return "This time zone is invalid or unavailable. Enter a supported IANA identifier and try again.";
    if (notice === "invalid-format") return "The date format is invalid. Correct the pattern and try again.";
    if (notice === "unavailable-time-zone") return "The saved time zone is unavailable in this browser. Choose System or another supported zone, then save.";
    if (notice === "save-failed") return "Could not save the display settings. Your previous format remains active. Try again.";
    if (notice === "interrupted") return "The response was interrupted. Display settings were reread.";
    if (notice === "partial-refresh") return "Display settings were saved, but one or more open pages could not be refreshed. New dates will use the saved setting.";
    if (notice === "unknown") return "Could not confirm whether the display settings were saved. Reopen Settings to try again.";
    return undefined;
}

/**
 * Maps custom date-format validation failures to form errors.
 *
 * @param pattern Candidate custom date-format pattern.
 * @returns A validation error, or undefined when the pattern is valid.
 */
function customPatternError(pattern: string): string | undefined {
    const result = validateCustomFormatPattern(pattern);
    if (result.ok) return undefined;
    switch (result.error) {
        case "empty": return "Enter a date format pattern.";
        case "too-long": return "Use a date format pattern of 256 characters or fewer.";
        case "control-character": return "Remove control characters from the date format pattern.";
        case "unclosed-quote": return "Close the quoted text in the date format pattern.";
        case "missing-date-token": return "Include at least one date or time token, such as yyyy or HH:mm.";
        case "legacy-token": return "Use Unicode date tokens, such as yyyy instead of YYYY or DD.";
        case "invalid-token": return "Use supported Unicode date and time tokens in the pattern.";
        case "empty-output": return "The date format must produce visible text.";
    }
}

const PREVIEW_INSTANT = new Date("2026-08-25T12:34:00.000Z");

/**
 * Selects browser locales for the display-format preview.
 *
 * @returns Browser preference locales, or en-US when browser information is unavailable.
 */
function previewLocales(): readonly string[] {
    if (typeof navigator === "undefined") return ["en-US"];
    const locales = Array.isArray(navigator.languages) ? navigator.languages.filter((value): value is string => typeof value === "string") : [];
    return locales.length > 0 ? locales : (navigator.language ? [navigator.language] : ["en-US"]);
}

/**
 * Explains why display settings cannot currently be changed.
 *
 * @param state Unavailable display state returned by the background service.
 * @returns The message displayed instead of the display controls.
 */
function unavailableDisplayText(state: Extract<DisplayState, { availability: "unavailable" }>): string {
    return state.failure === "fail-closed-cleanup"
        ? "Current display settings are unavailable while processing state is being recovered."
        : "Display settings are unavailable. Processing is disabled.";
}

/**
 * Maps a site-report failure to guidance shown in settings.
 *
 * @param error Failure returned by the site-report service.
 * @returns The error message displayed to the user.
 */
function siteReportErrorText(error: string): string {
    if (error === "busy") return "A GitHub report is already being opened.";
    if (error === "open-failed") return "Could not open the GitHub report. Try again.";
    if (error === "browser-unavailable") return "Could not open the GitHub report in this browser.";
    return "Could not open the GitHub report. Check the browser context and try again.";
}

/**
 * Renders and coordinates the options settings controls.
 *
 * @returns The options React view.
 */
export function OptionsApp({ client: suppliedClient, initialState, initialDisplayState, initialDebugState, archiveRuntime, reporter: suppliedReporter }: SitesAppProps): ReactElement {
    const client = useMemo(() => suppliedClient ?? createSitesClient(), [suppliedClient]);
    const reporter = useMemo(() => suppliedReporter ?? createDefaultSiteReportReporter(), [suppliedReporter]);
    const [state, setState] = useState<SitesState | undefined>(initialState);
    const [displayState, setDisplayState] = useState<DisplayState | undefined>(initialDisplayState);
    const [displayLoading, setDisplayLoading] = useState(initialDisplayState === undefined);
    const [debugState, setDebugState] = useState<DebugState | undefined>(initialDebugState);
    const [debugLoading, setDebugLoading] = useState(initialDebugState === undefined);
    const [displayDraft, setDisplayDraft] = useState<DisplayDraft | undefined>(initialDisplayState?.availability === "ready" ? draftFromDisplay(initialDisplayState.display) : undefined);
    const [loading, setLoading] = useState(initialState === undefined);
    const [savingHostname, setSavingHostname] = useState<string | undefined>();
    const [notice, setNotice] = useState<Notice>();
    const [displayNotice, setDisplayNotice] = useState<DisplayNotice>();
    const [savingDisplay, setSavingDisplay] = useState(false);
    const [savingDebug, setSavingDebug] = useState(false);
    const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
    const [diagnosticsNotice, setDiagnosticsNotice] = useState<string>();
    const [resetting, setResetting] = useState(false);
    const [resetNotice, setResetNotice] = useState<ResetNotice>();
    const [reporting, setReporting] = useState(false);
    const [reportNotice, setReportNotice] = useState<string>();
    const [resetOrigin, setResetOrigin] = useState<ResetOrigin>(initialState?.availability ?? "unavailable");
    const resetInFlight = useRef(false);
    const debugInFlight = useRef(false);
    const diagnosticsInFlight = useRef(false);
    const reportInFlight = useRef(false);

    useEffect(() => {
        if (initialState) return;
        let mounted = true;
        void client.getState().then((next) => {
            if (!mounted) return;
            setState(next);
            setLoading(false);
        }).catch(() => {
            if (!mounted) return;
            setState({ availability: "unavailable", revision: null, globalEnabled: null, sites: [], failure: "settings-load" });
            setLoading(false);
        });
        return () => { mounted = false; };
    }, [client, initialState]);

    useEffect(() => {
    // Production mounts without injected state and hydrates through the
    // background read. Tests and embedders that inject the existing Sites
    // projection can inject Display independently without a second transport
    // request.
        if (initialDisplayState || initialState) {
            setDisplayLoading(false);
            return;
        }
        let mounted = true;
        void client.getDisplayState().then((next) => {
            if (!mounted) return;
            setDisplayState(next);
            if (next.availability === "ready") setDisplayDraft(draftFromDisplay(next.display));
            setDisplayLoading(false);
        }).catch(() => {
            if (!mounted) return;
            setDisplayState({ availability: "unavailable", revision: null, display: null, failure: "settings-load" });
            setDisplayLoading(false);
        });
        return () => { mounted = false; };
    }, [client, initialDisplayState]);

    useEffect(() => {
        if (initialDebugState) return;
        let mounted = true;
        void client.getDebugState().then((next) => {
            if (!mounted) return;
            setDebugState(next);
            setDebugLoading(false);
        }).catch(() => {
            if (!mounted) return;
            setDebugState({ availability: "unavailable", revision: null, enabled: null, failure: "settings-load" });
            setDebugLoading(false);
        });
        return () => { mounted = false; };
    }, [client, initialDebugState]);

    const onSiteChange = async (hostname: string, event: ChangeEvent<HTMLInputElement>): Promise<void> => {
        if (!state || state.availability !== "ready" || savingHostname !== undefined) return;
        setSavingHostname(hostname);
        setNotice(undefined);
        const result = await client.setSiteEnabled(hostname, event.currentTarget.checked);
        if (result.kind === "response") {
            const responseState = result.response.state;
            if (responseState.availability !== "ready" || responseState.revision >= state.revision) setState(responseState);
            if (!result.response.ok) {
                setNotice(result.response.error === "save-failed" ? "save-failed" : result.response.error === "invalid-hostname" ? "invalid-hostname" : "unknown");
            }
        } else if (result.state) {
            if (result.state.availability !== "ready" || result.state.revision >= state.revision) setState(result.state);
            setNotice("interrupted");
        } else {
            setState({ availability: "unavailable", revision: null, globalEnabled: null, sites: [], failure: "settings-load" });
            setNotice("unknown");
        }
        setSavingHostname(undefined);
    };

    const onResetAllSettings = async (): Promise<void> => {
        if (!state || resetting || resetInFlight.current) return;
        const origin = state.availability;
        setResetOrigin(origin);
        resetInFlight.current = true;
        setResetting(true);
        setResetNotice(undefined);
        const result = await client.resetAllSettings();
        if (result.kind === "response") {
            if (result.response.ok) {
                setState(result.response.state);
                setNotice(undefined);
                setDisplayNotice(undefined);
                setDiagnosticsNotice(undefined);
                setReportNotice(undefined);
                setResetNotice(undefined);
                setDisplayDraft(draftFromDisplay({ formatMode: "system", timeZone: { mode: "system" } }));
                setDisplayLoading(true);
                setDebugLoading(true);
                try {
                    const nextDisplay = await client.getDisplayState();
                    setDisplayState(nextDisplay);
                    if (nextDisplay.availability === "ready") setDisplayDraft(draftFromDisplay(nextDisplay.display));
                    setResetNotice(undefined);
                } catch {
                    setDisplayState({ availability: "unavailable", revision: null, display: null, failure: "settings-load" });
                    setDisplayNotice("unknown");
                } finally {
                    setDisplayLoading(false);
                }
                try {
                    setDebugState(await client.getDebugState());
                } catch {
                    setDebugState({ availability: "unavailable", revision: null, enabled: null, failure: "settings-load" });
                    setNotice("debug-unknown");
                } finally {
                    setDebugLoading(false);
                }
            } else {
                if (origin === "unavailable") setState(result.response.state);
                setResetNotice(result.response.error === "save-failed" ? "save-failed" : "ambiguous");
            }
        } else {
            // Do not retry: the reset may already have been committed before the
            // response was lost or rejected by the guard.
            if (origin === "unavailable") setState({ availability: "unavailable", revision: null, globalEnabled: null, sites: [], failure: "settings-load" });
            setResetNotice("ambiguous");
        }
        resetInFlight.current = false;
        setResetting(false);
    };

    const onDisplaySave = async (): Promise<void> => {
        if (!displayState || displayState.availability !== "ready" || !displayDraft || savingDisplay) return;
        if (displayDraft.formatMode === "custom") {
            const patternError = customPatternError(displayDraft.pattern);
            if (patternError) {
                setDisplayNotice("invalid-format");
                return;
            }
        }
        if (displayDraft.timeZoneMode === "iana") {
            const error = validateIdentifier(displayDraft.identifier);
            if (error) {
                setDisplayNotice("invalid-time-zone");
                return;
            }
        }
        setSavingDisplay(true);
        setDisplayNotice(undefined);
        const result = await client.setDisplaySettings(displayFromDraft(displayDraft));
        if (result.kind === "response") {
            const responseState = result.response.state;
            if (responseState.availability !== "ready" || responseState.revision >= displayState.revision) {
                setDisplayState(responseState);
                // Keep an invalid custom draft visible so the user can correct it;
                // every successful or other authoritative failure response restores
                // the committed draft as before.
                if (responseState.availability === "ready" && (result.response.ok || result.response.error !== "invalid-format")) {
                    setDisplayDraft(draftFromDisplay(responseState.display));
                }
            }
            if (!result.response.ok) {
                setDisplayNotice(result.response.error === "invalid-time-zone" || result.response.error === "invalid-display-settings" ? "invalid-time-zone" : result.response.error === "invalid-format" ? "invalid-format" : result.response.error === "save-failed" ? "save-failed" : "unknown");
            } else if (result.response.refreshFailures.length > 0) {
                setDisplayNotice("partial-refresh");
            }
        } else if (result.state) {
            if (result.state.availability !== "ready" || result.state.revision >= displayState.revision) {
                setDisplayState(result.state);
                if (result.state.availability === "ready") setDisplayDraft(draftFromDisplay(result.state.display));
            }
            setDisplayNotice("interrupted");
        } else {
            setDisplayState({ availability: "unavailable", revision: null, display: null, failure: "settings-load" });
            setDisplayNotice("unknown");
        }
        setSavingDisplay(false);
    };

    const onDebugChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
        if (!debugState || debugState.availability !== "ready" || savingDebug || debugInFlight.current) return;
        const enabled = event.currentTarget.checked;
        debugInFlight.current = true;
        setSavingDebug(true);
        setNotice(undefined);
        const result = await client.setDebugEnabled(enabled);
        if (result.kind === "response") {
            if (result.response.state.availability !== "ready" || result.response.state.revision >= debugState.revision) setDebugState(result.response.state);
            if (!result.response.ok) setNotice("debug-save-failed");
        } else if (result.state) {
            if (result.state.availability !== "ready" || result.state.revision >= debugState.revision) setDebugState(result.state);
            setNotice("debug-interrupted");
        } else {
            setDebugState({ availability: "unavailable", revision: null, enabled: null, failure: "settings-load" });
            setNotice("debug-unknown");
        }
        debugInFlight.current = false;
        setSavingDebug(false);
    };

    const diagnosticsErrorText = (error: "disabled" | "unavailable" | "empty" | "invalid-journal" | "storage-failed"): string => {
        if (error === "disabled") return "Debug logs are off. Turn them on to use saved diagnostics.";
        if (error === "empty") return "There are no diagnostic logs to download yet.";
        if (error === "invalid-journal") return "Saved diagnostic logs are invalid. Clear logs and try again.";
        if (error === "storage-failed") return "Saved diagnostic logs could not be read. Try again later.";
        return "Diagnostic logs are unavailable. Try again later.";
    };

    const onDownloadDiagnostics = async (): Promise<void> => {
        if (!debugState || debugState.availability !== "ready" || !debugState.enabled || diagnosticsInFlight.current) return;
        diagnosticsInFlight.current = true;
        setDiagnosticsBusy(true);
        setDiagnosticsNotice(undefined);
        try {
            const result = await client.getDiagnosticsSnapshot();
            if (result.kind === "error") {
                setDiagnosticsNotice(diagnosticsErrorText(result.error));
                return;
            }
            try {
                const bytes = createDiagnosticsZip(result.snapshot);
                downloadDiagnosticsZip(bytes, archiveRuntime);
            } catch (error) {
                setDiagnosticsNotice(error instanceof DiagnosticArchiveError ? error.message : "The diagnostic archive could not be downloaded. Try again later.");
            }
        } finally {
            diagnosticsInFlight.current = false;
            setDiagnosticsBusy(false);
        }
    };

    const onClearDiagnostics = async (): Promise<void> => {
        if (!debugState || debugState.availability !== "ready" || !debugState.enabled || diagnosticsInFlight.current) return;
        diagnosticsInFlight.current = true;
        setDiagnosticsBusy(true);
        setDiagnosticsNotice(undefined);
        try {
            const result = await client.clearDiagnostics();
            if (result.kind === "error") setDiagnosticsNotice(diagnosticsErrorText(result.error));
            else setDiagnosticsNotice("Diagnostic logs cleared.");
        } finally {
            diagnosticsInFlight.current = false;
            setDiagnosticsBusy(false);
        }
    };

    const onOpenGitHubIssue = async (): Promise<void> => {
        if (reporting || reportInFlight.current) return;
        reportInFlight.current = true;
        setReporting(true);
        setReportNotice(undefined);
        try {
            const result = await reporter.openOptionsReport();
            if (!result.ok) setReportNotice(siteReportErrorText(result.error));
        } catch {
            setReportNotice("Could not open the GitHub report. Try again.");
        } finally {
            reportInFlight.current = false;
            setReporting(false);
        }
    };

    if (loading || !state) {
        return <MantineProvider><main className="options" aria-label="No More Ago Settings"><Text role="status">Loading…</Text></main></MantineProvider>;
    }

    const message = noticeText(notice);
    const patternError = displayDraft?.formatMode === "custom" ? customPatternError(displayDraft.pattern) : undefined;
    const preview = displayDraft?.formatMode === "custom" && !patternError
        ? formatDateWithPresentation(PREVIEW_INSTANT, previewLocales(), displayFromDraft(displayDraft))
        : undefined;
    return (
        <MantineProvider>
            <main className="options" aria-label="No More Ago Settings">
                <Paper className="options-card" shadow="sm" withBorder>
                    <Stack gap="md">
                        <Box>
                            <Title order={2}>Settings</Title>
                            <Text id="sites-heading" size="lg" fw={600}>Sites</Text>
                            <Text size="sm" c="dimmed">Choose which exact hostnames may be processed.</Text>
                        </Box>
                        {state.availability === "unavailable" ? (
                            <>
                                <Text role="status">{unavailableText(state)}</Text>
                            </>
                        ) : (
                            <>
                                {!state.globalEnabled ? <Alert color="blue">The extension is off. Site preferences are saved and will apply when the extension is enabled.</Alert> : null}
                                <Stack component="section" aria-labelledby="sites-heading" gap="sm">
                                    {state.sites.map((site) => (
                                        <Switch
                                            key={site.hostname}
                                            label={site.hostname}
                                            checked={site.enabled}
                                            disabled={savingHostname !== undefined}
                                            onChange={(event) => { void onSiteChange(site.hostname, event); }}
                                            aria-label={`Enabled on ${site.hostname}`}
                                        />
                                    ))}
                                    {state.sites.length === 0 ? <Text role="status">No site preferences have been saved.</Text> : null}
                                </Stack>
                            </>
                        )}
                        {message ? <Alert role="alert" color="red">{message}</Alert> : null}
                        <Box component="section" aria-labelledby="display-heading">
                            <Text id="display-heading" size="lg" fw={600}>Display</Text>
                            <Text size="sm" c="dimmed">Choose how dates are shown.</Text>
                            {displayLoading ? <Text role="status">Loading display settings…</Text> : null}
                            {!displayLoading && displayState?.availability === "unavailable" ? <Text role="status">{unavailableDisplayText(displayState)}</Text> : null}
                            {!displayLoading && displayState?.availability === "ready" && displayDraft ? (
                                <Stack gap="sm" mt="sm">
                                    <label className="options-field-label" htmlFor="date-format-select">Date format
                                        <select
                                            id="date-format-select"
                                            aria-label="Date format"
                                            value={displayDraft.formatMode}
                                            onChange={(event) => {
                                                const value = event.currentTarget.value;
                                                if (value === "system" || value === "custom") setDisplayDraft((draft) => draft ? { ...draft, formatMode: value } : draft);
                                                setDisplayNotice(undefined);
                                            }}
                                            onInput={(event) => {
                                                const value = event.currentTarget.value;
                                                if (value === "system" || value === "custom") setDisplayDraft((draft) => draft ? { ...draft, formatMode: value } : draft);
                                            }}
                                            disabled={savingDisplay}
                                        >
                                            <option value="system">System</option>
                                            <option value="custom">Custom format</option>
                                        </select>
                                    </label>
                                    {displayDraft.formatMode === "custom" ? (
                                        <Box>
                                            <TextInput
                                                label="Format pattern"
                                                aria-label="Format pattern"
                                                description="Examples: yyyy-MM-dd HH:mm · EEEE, d MMMM yyyy"
                                                value={displayDraft.pattern}
                                                onChange={(event) => {
                                                    const value = event.currentTarget.value;
                                                    setDisplayDraft((draft) => draft ? { ...draft, pattern: value } : draft);
                                                    setDisplayNotice(undefined);
                                                }}
                                                error={patternError ?? (displayNotice === "invalid-format" ? displayNoticeText("invalid-format") : undefined)}
                                                disabled={savingDisplay}
                                            />
                                            {preview ? (
                                                <Text role="status" mt="xs"><Text span fw={600}>Preview:</Text> {preview.text}</Text>
                                            ) : null}
                                        </Box>
                                    ) : null}
                                    <label className="options-field-label" htmlFor="time-zone-select">Time zone
                                        <select
                                            id="time-zone-select"
                                            aria-label="Time zone"
                                            value={displayDraft.timeZoneMode}
                                            onChange={(event) => {
                                                const value = event.currentTarget.value;
                                                if (value === "system" || value === "utc" || value === "iana") setDisplayDraft((draft) => draft ? { ...draft, timeZoneMode: value } : draft);
                                                setDisplayNotice(undefined);
                                            }}
                                            onInput={(event) => {
                                                const value = event.currentTarget.value;
                                                if (value === "system" || value === "utc" || value === "iana") setDisplayDraft((draft) => draft ? { ...draft, timeZoneMode: value } : draft);
                                            }}
                                            disabled={savingDisplay}
                                        >
                                            <option value="system">System</option>
                                            <option value="utc">UTC</option>
                                            <option value="iana">IANA</option>
                                        </select>
                                    </label>
                                    {displayDraft.timeZoneMode === "iana" ? (
                                        <TextInput
                                            label="IANA time zone identifier"
                                            aria-label="IANA time zone identifier"
                                            placeholder="America/New_York"
                                            value={displayDraft.identifier}
                                            onChange={(event) => { const value = event.currentTarget.value; setDisplayDraft((draft) => draft ? { ...draft, identifier: value } : draft); setDisplayNotice(undefined); }}
                                            error={displayNotice === "invalid-time-zone" ? displayNoticeText(displayNotice) : undefined}
                                            disabled={savingDisplay}
                                        />
                                    ) : null}
                                    {displayState.error === "unavailable-time-zone" ? <Alert role="alert" color="yellow">{displayNoticeText("unavailable-time-zone")}</Alert> : null}
                                    {displayNotice && displayNotice !== "invalid-time-zone" && displayState.error !== "unavailable-time-zone" ? <Alert role="alert" color={displayNotice === "partial-refresh" ? "yellow" : "red"}>{displayNoticeText(displayNotice)}</Alert> : null}
                                    <Button onClick={() => { void onDisplaySave(); }} loading={savingDisplay} disabled={savingDisplay}>Save</Button>
                                </Stack>
                            ) : null}
                        </Box>
                        {state.availability === "ready" ? <Box component="section" aria-labelledby="debug-heading">
                            <Text id="debug-heading" size="lg" fw={600}>Diagnostics</Text>
                            <Button type="button" onClick={() => { void onOpenGitHubIssue(); }} loading={reporting} disabled={reporting}>Open GitHub issue</Button>
                            {reportNotice ? <Alert role="alert" color="red">{reportNotice}</Alert> : null}
                            {debugLoading ? <Text role="status">Loading debug settings…</Text> : null}
                            {!debugLoading && debugState?.availability === "unavailable" ? <Text role="status">Debug logs are unavailable. Processing remains unchanged.</Text> : null}
                            {!debugLoading && debugState?.availability === "ready" ? (
                                <Stack gap="xs" mt="xs">
                                    <Switch
                                        label="Debug logs"
                                        aria-label="Debug logs"
                                        checked={debugState.enabled}
                                        disabled={savingDebug}
                                        onChange={(event) => { void onDebugChange(event); }}
                                    />
                                    <Stack gap="xs" style={{ flexDirection: "row" }}>
                                        <Button type="button" onClick={() => { void onDownloadDiagnostics(); }} loading={diagnosticsBusy} disabled={!debugState.enabled || diagnosticsBusy}>Download logs</Button>
                                        <Button type="button" variant="default" onClick={() => { void onClearDiagnostics(); }} loading={diagnosticsBusy} disabled={!debugState.enabled || diagnosticsBusy}>Clear logs</Button>
                                    </Stack>
                                    {diagnosticsNotice ? <Alert role="status" color={diagnosticsNotice === "Diagnostic logs cleared." ? "green" : "red"}>{diagnosticsNotice}</Alert> : null}
                                </Stack>
                            ) : null}
                        </Box> : null}
                        <Button type="button" onClick={() => { void onResetAllSettings(); }} loading={resetting} disabled={resetting}>
                            Reset all settings
                        </Button>
                        {resetNotice ? <Alert role="alert" color="red">{resetNoticeText(resetNotice, resetOrigin)}</Alert> : null}
                    </Stack>
                </Paper>
            </main>
        </MantineProvider>
    );
}
