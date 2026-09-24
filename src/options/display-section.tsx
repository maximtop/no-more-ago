/**
 * @file Renders date-format and time-zone controls with a live preview.
 */

import {
    Alert, Box, Button, NativeSelect, Stack, Text, TextInput, Title,
} from '@mantine/core';
import { useMemo, type ReactElement } from 'react';

import { UNAVAILABLE_TIME_ZONE_ERROR } from '../shared/date/presentation-errors';
import { t, type MessageKey } from '../shared/i18n/translator';
import {
    SETTINGS_STATE_FAILURE,
    STATE_AVAILABILITY,
} from '../shared/messaging/view-state-values';
import { CUSTOM_FORMAT_MAX_LENGTH } from '../shared/settings/custom-format';
import { FORMAT_MODE, TIME_ZONE_MODE } from '../shared/settings/snapshot';

import {
    DISPLAY_NOTICE,
    DISPLAY_PREVIEW_SOURCE,
    customPatternError,
    displayNoticeKey,
    previewDisplayDraft,
    type DisplayDraft,
    type DisplayNotice,
} from './display-form';
import { PrecisionControls } from './precision-controls';

import type { DisplayController } from './display-controller';
import type { DisplayState } from '../shared/messaging/view-state';

/**
 * Properties for the display-settings section.
 */
export interface DisplaySectionProps {
    /**
     * State and commands owned by the display-settings controller.
     */
    readonly controller: DisplayController;
}

/**
 * Renders the custom-pattern field error, supplying the length limit.
 *
 * @param patternError - Key of the draft's pattern error, when any.
 * @param formatRejected - Whether the background rejected the saved pattern.
 *
 * @returns - Error text for the field, or undefined when it has none.
 */
function patternErrorText(
    patternError: MessageKey | undefined,
    formatRejected: boolean,
): string | undefined {
    if (patternError !== undefined) {
        return t(patternError, { max: CUSTOM_FORMAT_MAX_LENGTH });
    }
    return formatRejected ? t('display_error_format_invalid') : undefined;
}

/**
 * Renders one display notice.
 *
 * @param notice - Outcome reported after saving display settings.
 *
 * @returns - Notice text, or undefined when there is nothing to show.
 */
function noticeText(notice: DisplayNotice): string | undefined {
    const key = displayNoticeKey(notice);
    return key === undefined ? undefined : t(key);
}

/**
 * Explains why display settings cannot currently be changed.
 *
 * @param state - Unavailable display state returned by the background service.
 *
 * @returns - The message displayed instead of the display controls.
 */
function unavailableDisplayText(
    state: Extract<DisplayState, { availability: typeof STATE_AVAILABILITY.UNAVAILABLE }>,
): string {
    return t(state.failure === SETTINGS_STATE_FAILURE.FAIL_CLOSED_CLEANUP
        ? 'display_unavailable_recovering'
        : 'display_unavailable_disabled');
}

/**
 * Chooses the alert color and live-region role for a save outcome.
 *
 * @param notice - Outcome reported after saving display settings.
 *
 * @returns - Alert color and role conveying the outcome's severity.
 */
function noticePresentation(notice: DisplayNotice): {
    readonly color: string;
    readonly role: 'status' | 'alert';
} {
    if (notice === DISPLAY_NOTICE.SAVED) {
        return { color: 'signal', role: 'status' };
    }
    if (notice === DISPLAY_NOTICE.PARTIAL_REFRESH || notice === DISPLAY_NOTICE.EXTERNAL_CHANGE) {
        return { color: 'yellow', role: 'status' };
    }
    return { color: 'red', role: 'alert' };
}

/**
 * Validates the draft once per change and renders its preview.
 *
 * @param draft - Current display form fields, when loaded.
 *
 * @returns - Pattern error and preview, or undefined without a draft.
 */
function useDraftAnalysis(draft: DisplayDraft | undefined): {
    readonly patternError: MessageKey | undefined;
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
 *
 * @returns - The display-settings section.
 */
export function DisplaySection({ controller }: DisplaySectionProps): ReactElement {
    const {
        state, draft, loading, saving, notice,
    } = controller;
    const analysis = useDraftAnalysis(draft);
    const inlineNotice = notice === DISPLAY_NOTICE.INVALID_TIME_ZONE
        || notice === DISPLAY_NOTICE.INVALID_FORMAT;
    return (
        <Stack gap="lg" component="section" aria-labelledby="display-heading">
            <Box>
                <Title order={2} id="display-heading">
                    {t('display_heading')}
                </Title>
                <Text size="sm" c="dimmed">
                    {t('display_intro')}
                </Text>
            </Box>
            {loading ? <Text role="status">{t('display_loading')}</Text> : null}
            {!loading && state?.availability === STATE_AVAILABILITY.UNAVAILABLE ? (
                <Text role="status">{unavailableDisplayText(state)}</Text>
            ) : null}
            {!loading && state?.availability === STATE_AVAILABILITY.READY && draft && analysis ? (
                <Stack gap="md">
                    <NativeSelect
                        id="date-format-select"
                        label={t('display_format_label')}
                        aria-label={t('display_format_label')}
                        className="options-select"
                        value={draft.formatMode}
                        data={[
                            { value: FORMAT_MODE.SYSTEM, label: t('display_format_system') },
                            { value: FORMAT_MODE.CUSTOM, label: t('display_format_custom') },
                        ]}
                        onChange={(event) => {
                            const { value } = event.currentTarget;
                            if (value === FORMAT_MODE.SYSTEM || value === FORMAT_MODE.CUSTOM) {
                                controller.setFormatMode(value);
                            }
                        }}
                        disabled={saving}
                    />
                    {draft.formatMode === FORMAT_MODE.CUSTOM ? (
                        <TextInput
                            label={t('display_pattern_label')}
                            aria-label={t('display_pattern_label')}
                            description={t('display_pattern_examples')}
                            value={draft.pattern}
                            classNames={{ input: 'nma-mono' }}
                            onChange={(event) => {
                                controller.setPattern(event.currentTarget.value);
                            }}
                            error={patternErrorText(
                                analysis.patternError,
                                notice === DISPLAY_NOTICE.INVALID_FORMAT,
                            )}
                            disabled={saving}
                        />
                    ) : null}
                    <NativeSelect
                        id="time-zone-select"
                        label={t('display_zone_label')}
                        aria-label={t('display_zone_label')}
                        className="options-select"
                        value={draft.timeZoneMode}
                        data={[
                            { value: TIME_ZONE_MODE.SYSTEM, label: t('display_zone_system') },
                            { value: TIME_ZONE_MODE.UTC, label: 'UTC' },
                            { value: TIME_ZONE_MODE.IANA, label: 'IANA' },
                        ]}
                        onChange={(event) => {
                            const { value } = event.currentTarget;
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
                            label={t('display_zone_identifier_label')}
                            aria-label={t('display_zone_identifier_label')}
                            placeholder="America/New_York"
                            value={draft.identifier}
                            classNames={{ input: 'nma-mono' }}
                            onChange={(event) => {
                                controller.setIdentifier(event.currentTarget.value);
                            }}
                            error={
                                notice === DISPLAY_NOTICE.INVALID_TIME_ZONE
                                    ? t('display_error_zone_rejected')
                                    : undefined
                            }
                            disabled={saving}
                        />
                    ) : null}
                    <PrecisionControls
                        policy={draft.precisionPolicy}
                        disabled={saving}
                        onChange={(policy) => {
                            controller.setPrecisionPolicy(policy);
                        }}
                    />
                    <div className="options-preview" data-ok={analysis.preview.ok}>
                        <div>
                            <div className="nma-eyebrow">{t('display_preview_label')}</div>
                            <div
                                className={analysis.preview.ok
                                    ? 'options-preview-value nma-mono'
                                    : 'options-preview-value'}
                                role="status"
                                aria-label={t('display_preview_label')}
                            >
                                {analysis.preview.ok
                                    ? analysis.preview.text : t(analysis.preview.key)}
                            </div>
                        </div>
                        <span className="options-preview-source nma-mono">
                            {DISPLAY_PREVIEW_SOURCE}
                        </span>
                    </div>
                    {state.error === UNAVAILABLE_TIME_ZONE_ERROR ? (
                        <Alert role="alert" color="yellow">
                            {t('display_error_zone_saved_unavailable')}
                        </Alert>
                    ) : null}
                    {notice && !inlineNotice && state.error !== UNAVAILABLE_TIME_ZONE_ERROR ? (
                        <Alert
                            role={noticePresentation(notice).role}
                            color={noticePresentation(notice).color}
                        >
                            {noticeText(notice)}
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
                            {t('display_save_action')}
                        </Button>
                    </div>
                </Stack>
            ) : null}
        </Stack>
    );
}
