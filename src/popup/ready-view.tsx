/**
 * @file Popup controls shown while settings are available.
 */

import { Alert, Box, Button, Group, Switch, Text } from "@mantine/core";
import type { ReactElement } from "react";
import type { ReadyPopupState } from "../shared/messaging/view-state-schemas";
import { SITE_SCOPE_MODE_LABEL } from "../shared/settings/site-scope";
import { GLOBAL_SWITCH_LABEL, updatedInAnotherWindow } from "../shared/ui/copy";
import { mutationNoticeText } from "../shared/ui/persistence-notice";
import { POPUP_NOTICE, type PopupNotice } from "./popup-controller";
import { popupStatusModel, siteControlDescription } from "./popup-status";

/**
 * Properties for the ready popup view.
 */
export interface PopupReadyViewProps {
    /**
     * Ready popup projection.
     */
    readonly state: ReadyPopupState;

    /**
     * Whether a settings mutation is in flight.
     */
    readonly saving: boolean;

    /**
     * Latest mutation outcome needing user guidance.
     */
    readonly notice: PopupNotice;

    /**
     * Whether a site report is being opened.
     */
    readonly reporting: boolean;

    /**
     * Latest failure encountered while opening a site report.
     */
    readonly reportNotice: string | undefined;

    /**
     * Changes global activation.
     */
    readonly onChangeGlobal: (enabled: boolean) => void;

    /**
     * Changes processing for the current hostname.
     */
    readonly onChangeSite: (enabled: boolean) => void;

    /**
     * Opens a prefilled report for the current site.
     */
    readonly onReportSite: () => void;

    /**
     * Opens the settings page.
     */
    readonly onOpenSettings: () => void;
}

const RETRY_HINT = "Reopen the popup to try again.";

/**
 * Maps a popup notice to its message and severity.
 *
 * @param notice - Outcome reported after a mutation or an external change.
 * @returns - Message with its alert color and live-region role, or undefined.
 */
function noticePresentation(notice: PopupNotice): {
    readonly text: string;
    readonly color: string;
    readonly role: "status" | "alert";
} | undefined {
    if (notice === POPUP_NOTICE.EXTERNAL_CHANGE) {
        return { text: updatedInAnotherWindow("Settings"), color: "gray", role: "status" };
    }
    const text = mutationNoticeText(notice, RETRY_HINT);
    return text === undefined ? undefined : { text, color: "red", role: "alert" };
}

/**
 * Renders the status line, both switches, and the report and settings actions.
 *
 * @param props - Component properties.
 * @param props.state - Ready popup projection.
 * @param props.saving - Whether a settings mutation is in flight.
 * @param props.notice - Latest mutation outcome.
 * @param props.reporting - Whether a site report is being opened.
 * @param props.reportNotice - Latest site-report failure.
 * @param props.onChangeGlobal - Changes global activation.
 * @param props.onChangeSite - Changes processing for the current hostname.
 * @param props.onReportSite - Opens a prefilled site report.
 * @param props.onOpenSettings - Opens the settings page.
 * @returns - The ready popup view.
 */
export function PopupReadyView({
    state,
    saving,
    notice,
    reporting,
    reportNotice,
    onChangeGlobal,
    onChangeSite,
    onReportSite,
    onOpenSettings,
}: PopupReadyViewProps): ReactElement {
    const status = popupStatusModel(state);
    const presented = noticePresentation(notice);
    const siteVisible = state.hostname !== null && state.siteEnabled !== null;
    return (
        <>
            <div className="popup-status" data-tone={status.tone}>
                <span className="popup-status-dot" aria-hidden="true" />
                <Text role="status" size="sm" fw={600}>
                    {status.text}
                </Text>
            </div>
            {presented ? (
                <Alert role={presented.role} color={presented.color} className="popup-section">
                    {presented.text}
                </Alert>
            ) : null}
            <div className="popup-section">
                <Group justify="space-between" className="nma-row popup-row-summary">
                    <span className="nma-eyebrow">Run mode</span>
                    <Text size="xs" fw={600}>
                        {SITE_SCOPE_MODE_LABEL[state.scopeMode]}
                    </Text>
                </Group>
                <Group justify="space-between" wrap="nowrap" className="nma-row">
                    <Box>
                        <Text size="sm" fw={600}>
                            {GLOBAL_SWITCH_LABEL}
                        </Text>
                        <Text size="xs" c="dimmed">
                            Pause or resume all site rules.
                        </Text>
                    </Box>
                    <Switch
                        checked={state.globalEnabled}
                        aria-busy={saving}
                        aria-label={GLOBAL_SWITCH_LABEL}
                        onChange={(event) => {
                            onChangeGlobal(event.currentTarget.checked);
                        }}
                    />
                </Group>
                {siteVisible ? (
                    <Group justify="space-between" wrap="nowrap" className="nma-row">
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
                            aria-busy={saving}
                            aria-label={`Enabled on ${state.hostname ?? "this site"}`}
                            onChange={(event) => {
                                onChangeSite(event.currentTarget.checked);
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
                        onClick={onReportSite}
                    >
                        Report this site
                    </Button>
                )}
                <Button type="button" variant="subtle" onClick={onOpenSettings}>
                    Settings
                </Button>
            </Group>
        </>
    );
}
