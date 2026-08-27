/**
 * @file Renders date-format and time-zone controls on the options page.
 */

import { Alert, Box, Button, Stack, Text, TextInput } from "@mantine/core";
import type { ReactElement } from "react";
import type { DisplayState } from "../shared/messages";
import { UNAVAILABLE_TIME_ZONE_ERROR } from "../shared/date/presentation-errors";
import type { DisplayController } from "./display-controller";
import {
    customPatternError,
    displayNoticeText,
    previewDisplayDraft,
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
 * @param state Unavailable display state returned by the background service.
 * @returns The message displayed instead of the display controls.
 */
function unavailableDisplayText(
    state: Extract<DisplayState, { availability: "unavailable" }>,
): string {
    return state.failure === "fail-closed-cleanup"
        ? "Current display settings are unavailable while processing state is being recovered."
        : "Display settings are unavailable. Processing is disabled.";
}

/**
 * Renders the editable date presentation settings and preview.
 *
 * @param props Component properties.
 * @param props.controller State and commands for display settings.
 * @returns The display-settings section.
 */
export function DisplaySection({ controller }: DisplaySectionProps): ReactElement {
    const { state, draft, loading, saving, notice } = controller;
    const patternError = draft?.formatMode === "custom"
        ? customPatternError(draft.pattern)
        : undefined;
    const preview = draft ? previewDisplayDraft(draft) : undefined;
    return (
        <Box component="section" aria-labelledby="display-heading">
            <Text id="display-heading" size="lg" fw={600}>
                Display
            </Text>
            <Text size="sm" c="dimmed">
                Choose how dates are shown.
            </Text>
            {loading ? <Text role="status">Loading display settings…</Text> : null}
            {!loading && state?.availability === "unavailable" ? (
                <Text role="status">{unavailableDisplayText(state)}</Text>
            ) : null}
            {!loading && state?.availability === "ready" && draft ? (
                <Stack gap="sm" mt="sm">
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
                            onInput={(event) => {
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
                        <Box>
                            <TextInput
                                label="Format pattern"
                                aria-label="Format pattern"
                                description={CUSTOM_FORMAT_EXAMPLES}
                                value={draft.pattern}
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
                            {preview ? (
                                <Text role="status" mt="xs">
                                    <Text span fw={600}>
                                        Preview:
                                    </Text>{" "}
                                    {preview.text}
                                </Text>
                            ) : null}
                        </Box>
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
                            onInput={(event) => {
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
                    {state.error === UNAVAILABLE_TIME_ZONE_ERROR ? (
                        <Alert role="alert" color="yellow">
                            {displayNoticeText(UNAVAILABLE_TIME_ZONE_ERROR)}
                        </Alert>
                    ) : null}
                    {notice &&
                    notice !== "invalid-time-zone" &&
                    state.error !== UNAVAILABLE_TIME_ZONE_ERROR ? (
                            <Alert
                                role="alert"
                                color={notice === "partial-refresh" ? "yellow" : "red"}
                            >
                                {displayNoticeText(notice)}
                            </Alert>
                        ) : null}
                    <Button
                        onClick={() => {
                            void controller.save();
                        }}
                        loading={saving}
                        disabled={saving}
                    >
                        Save
                    </Button>
                </Stack>
            ) : null}
        </Box>
    );
}
