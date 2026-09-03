/**
 * @file Renders date-format and time-zone controls with a live preview.
 */

import { Alert, Box, Button, NativeSelect, Stack, Text, TextInput, Title } from "@mantine/core";
import { useMemo, type ReactElement } from "react";
import type { DisplayState } from "../shared/messaging/view-state-schemas";
import {
    SETTINGS_STATE_FAILURE,
    STATE_AVAILABILITY,
} from "../shared/messaging/view-state-values";
import { UNAVAILABLE_TIME_ZONE_ERROR } from "../shared/date/presentation-errors";
import { FORMAT_MODE, TIME_ZONE_MODE } from "../shared/settings/snapshot";
import type { DisplayController } from "./display-controller";
import {
    DISPLAY_NOTICE,
    DISPLAY_PREVIEW_SOURCE,
    customPatternError,
    displayNoticeText,
    previewDisplayDraft,
    type DisplayDraft,
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
    if (notice === DISPLAY_NOTICE.SAVED) {
        return { color: "signal", role: "status" };
    }
    if (notice === DISPLAY_NOTICE.PARTIAL_REFRESH || notice === DISPLAY_NOTICE.EXTERNAL_CHANGE) {
        return { color: "yellow", role: "status" };
    }
    return { color: "red", role: "alert" };
}

/**
 * Validates the draft once per change and renders its preview.
 *
 * @param draft - Current display form fields, when loaded.
 * @returns - Pattern error and preview, or undefined without a draft.
 */
function useDraftAnalysis(draft: DisplayDraft | undefined): {
    readonly patternError: string | undefined;
    readonly preview: ReturnType<typeof previewDisplayDraft>;
} | undefined {
    return useMemo(() => {
        if (!draft) {
            return undefined;
        }
        const patternError = draft.formatMode === FORMAT_MODE.CUSTOM
            ? customPatternError(draft.pattern)
            : undefined;
        return { patternError, preview: previewDisplayDraft(draft, patternError) };
    }, [draft]);
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
    const analysis = useDraftAnalysis(draft);
    const inlineNotice = notice === DISPLAY_NOTICE.INVALID_TIME_ZONE
        || notice === DISPLAY_NOTICE.INVALID_FORMAT;
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
            {!loading && state?.availability === STATE_AVAILABILITY.READY && draft && analysis ? (
                <Stack gap="md">
                    <NativeSelect
                        id="date-format-select"
                        label="Date format"
                        aria-label="Date format"
                        className="options-select"
                        value={draft.formatMode}
                        data={[
                            { value: FORMAT_MODE.SYSTEM, label: "System" },
                            { value: FORMAT_MODE.CUSTOM, label: "Custom format" },
                        ]}
                        onChange={(event) => {
                            const value = event.currentTarget.value;
                            if (value === FORMAT_MODE.SYSTEM || value === FORMAT_MODE.CUSTOM) {
                                controller.setFormatMode(value);
                            }
                        }}
                        disabled={saving}
                    />
                    {draft.formatMode === FORMAT_MODE.CUSTOM ? (
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
                                analysis.patternError
                                ?? (notice === DISPLAY_NOTICE.INVALID_FORMAT
                                    ? displayNoticeText(DISPLAY_NOTICE.INVALID_FORMAT)
                                    : undefined)
                            }
                            disabled={saving}
                        />
                    ) : null}
                    <NativeSelect
                        id="time-zone-select"
                        label="Time zone"
                        aria-label="Time zone"
                        className="options-select"
                        value={draft.timeZoneMode}
                        data={[
                            { value: TIME_ZONE_MODE.SYSTEM, label: "System" },
                            { value: TIME_ZONE_MODE.UTC, label: "UTC" },
                            { value: TIME_ZONE_MODE.IANA, label: "IANA" },
                        ]}
                        onChange={(event) => {
                            const value = event.currentTarget.value;
                            if (
                                value === TIME_ZONE_MODE.SYSTEM
                                || value === TIME_ZONE_MODE.UTC
                                || value === TIME_ZONE_MODE.IANA
                            ) {
                                controller.setTimeZoneMode(value);
                            }
                        }}
                        disabled={saving}
                    />
                    {draft.timeZoneMode === TIME_ZONE_MODE.IANA ? (
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
                                notice === DISPLAY_NOTICE.INVALID_TIME_ZONE
                                    ? displayNoticeText(notice)
                                    : undefined
                            }
                            disabled={saving}
                        />
                    ) : null}
                    <div className="options-preview" data-ok={analysis.preview.ok}>
                        <div>
                            <div className="nma-eyebrow">Preview</div>
                            <div
                                className="options-preview-value nma-mono"
                                role="status"
                                aria-label="Preview"
                            >
                                {analysis.preview.text}
                            </div>
                        </div>
                        <span className="options-preview-source nma-mono">
                            {DISPLAY_PREVIEW_SOURCE}
                        </span>
                    </div>
                    {state.error === UNAVAILABLE_TIME_ZONE_ERROR ? (
                        <Alert role="alert" color="yellow">
                            {displayNoticeText(DISPLAY_NOTICE.UNAVAILABLE_TIME_ZONE)}
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
