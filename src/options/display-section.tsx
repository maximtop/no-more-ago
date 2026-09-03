/**
 * @file Renders date-format and time-zone controls with a live preview.
 */

import { Alert, Box, Button, Stack, Text, TextInput, Title } from "@mantine/core";
import type { ReactElement } from "react";
import type { DisplayState } from "../shared/messaging/view-state-schemas";
import {
    SETTINGS_STATE_FAILURE,
    STATE_AVAILABILITY,
} from "../shared/messaging/view-state-values";
import { UNAVAILABLE_TIME_ZONE_ERROR } from "../shared/date/presentation-errors";
import type { DisplayController } from "./display-controller";
import {
    DISPLAY_PREVIEW_SOURCE,
    customPatternError,
    displayNoticeText,
    previewDisplayDraft,
    type DisplayNotice,
} from "./display-form";

/**
 * Properties for the display-settings section.
 */
export interface DisplaySectionProps {
    /**
     * State and commands owned by the display-settings controller.
     */
    readonly controller: DisplayController;
}

const CUSTOM_FORMAT_EXAMPLES = "Examples: yyyy-MM-dd HH:mm · EEEE, d MMMM yyyy";

/**
 * Explains why display settings cannot currently be changed.
 *
 * @param state - Unavailable display state returned by the background service.
 * @returns - The message displayed instead of the display controls.
 */
function unavailableDisplayText(
    state: Extract<DisplayState, { availability: typeof STATE_AVAILABILITY.UNAVAILABLE }>,
): string {
    return state.failure === SETTINGS_STATE_FAILURE.FAIL_CLOSED_CLEANUP
        ? "Current display settings are unavailable while processing state is being recovered."
        : "Display settings are unavailable. Processing is disabled.";
}

/**
 * Chooses the alert color and live-region role for a save outcome.
 *
 * @param notice - Outcome reported after saving display settings.
 * @returns - Alert color and role conveying the outcome's severity.
 */
function noticePresentation(notice: DisplayNotice): {
    readonly color: string;
    readonly role: "status" | "alert";
} {
    if (notice === "saved") {
        return { color: "signal", role: "status" };
    }
    if (notice === "partial-refresh" || notice === "external-change") {
        return { color: "yellow", role: "status" };
    }
    return { color: "red", role: "alert" };
}

/**
 * Renders the editable date presentation settings and their preview.
 *
 * @param props - Component properties.
 * @param props.controller - State and commands for display settings.
 * @returns - The display-settings section.
 */
export function DisplaySection({ controller }: DisplaySectionProps): ReactElement {
    const { state, draft, loading, saving, notice } = controller;
    const patternError = draft?.formatMode === "custom"
        ? customPatternError(draft.pattern)
        : undefined;
    const preview = draft ? previewDisplayDraft(draft) : undefined;
    const inlineNotice = notice === "invalid-time-zone" || notice === "invalid-format";
    return (
        <Stack gap="lg" component="section" aria-labelledby="display-heading">
            <Box>
                <Title order={2} id="display-heading">
                    Display
                </Title>
                <Text size="sm" c="dimmed">
                    Choose how exact dates are shown.
                </Text>
            </Box>
            {loading ? <Text role="status">Loading display settings…</Text> : null}
            {!loading && state?.availability === STATE_AVAILABILITY.UNAVAILABLE ? (
                <Text role="status">{unavailableDisplayText(state)}</Text>
            ) : null}
            {!loading && state?.availability === STATE_AVAILABILITY.READY && draft && preview ? (
                <Stack gap="md">
                    <label className="options-field-label" htmlFor="date-format-select">
                        Date format
                        <select
                            id="date-format-select"
                            aria-label="Date format"
                            value={draft.formatMode}
                            onChange={(event) => {
                                const value = event.currentTarget.value;
                                if (value === "system" || value === "custom") {
                                    controller.setFormatMode(value);
                                }
                            }}
                            disabled={saving}
                        >
                            <option value="system">System</option>
                            <option value="custom">Custom format</option>
                        </select>
                    </label>
                    {draft.formatMode === "custom" ? (
                        <TextInput
                            label="Format pattern"
                            aria-label="Format pattern"
                            description={CUSTOM_FORMAT_EXAMPLES}
                            value={draft.pattern}
                            classNames={{ input: "nma-mono" }}
                            onChange={(event) => {
                                controller.setPattern(event.currentTarget.value);
                            }}
                            error={
                                patternError ??
                                (notice === "invalid-format"
                                    ? displayNoticeText("invalid-format")
                                    : undefined)
                            }
                            disabled={saving}
                        />
                    ) : null}
                    <label className="options-field-label" htmlFor="time-zone-select">
                        Time zone
                        <select
                            id="time-zone-select"
                            aria-label="Time zone"
                            value={draft.timeZoneMode}
                            onChange={(event) => {
                                const value = event.currentTarget.value;
                                if (value === "system" || value === "utc" || value === "iana") {
                                    controller.setTimeZoneMode(value);
                                }
                            }}
                            disabled={saving}
                        >
                            <option value="system">System</option>
                            <option value="utc">UTC</option>
                            <option value="iana">IANA</option>
                        </select>
                    </label>
                    {draft.timeZoneMode === "iana" ? (
                        <TextInput
                            label="IANA time zone identifier"
                            aria-label="IANA time zone identifier"
                            placeholder="America/New_York"
                            value={draft.identifier}
                            classNames={{ input: "nma-mono" }}
                            onChange={(event) => {
                                controller.setIdentifier(event.currentTarget.value);
                            }}
                            error={
                                notice === "invalid-time-zone"
                                    ? displayNoticeText(notice)
                                    : undefined
                            }
                            disabled={saving}
                        />
                    ) : null}
                    <div className="display-preview" data-ok={preview.ok}>
                        <div>
                            <div className="nma-eyebrow">Preview</div>
                            <div className="display-preview-value nma-mono" role="status">
                                {preview.text}
                            </div>
                        </div>
                        <span className="display-preview-source nma-mono">
                            {DISPLAY_PREVIEW_SOURCE}
                        </span>
                    </div>
                    {state.error === UNAVAILABLE_TIME_ZONE_ERROR ? (
                        <Alert role="alert" color="yellow">
                            {displayNoticeText(UNAVAILABLE_TIME_ZONE_ERROR)}
                        </Alert>
                    ) : null}
                    {notice && !inlineNotice && state.error !== UNAVAILABLE_TIME_ZONE_ERROR ? (
                        <Alert
                            role={noticePresentation(notice).role}
                            color={noticePresentation(notice).color}
                        >
                            {displayNoticeText(notice)}
                        </Alert>
                    ) : null}
                    <div>
                        <Button
                            onClick={() => {
                                void controller.save();
                            }}
                            loading={saving}
                            disabled={saving}
                        >
                            Save display settings
                        </Button>
                    </div>
                </Stack>
            ) : null}
        </Stack>
    );
}
