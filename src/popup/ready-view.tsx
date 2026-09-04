/**
 * @file Popup controls shown while settings are available.
 */

import { Alert, Box, Button, Group, Switch, Text } from "@mantine/core";
import type { ReactElement } from "react";
import type { MessageKey } from "../shared/i18n/translator";
import type { ReadyPopupState } from "../shared/messaging/view-state-schemas";
import { t } from "../shared/i18n/translator";
import { SCOPE_MODE_KEY } from "../shared/ui/copy";
import { NOTICE_SURFACE, mutationNoticeKey } from "../shared/ui/persistence-notice";
import { POPUP_NOTICE, type PopupNotice } from "./popup-controller";
import { popupStatusModel, siteSwitchDescriptionKey } from "./popup-status";

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
     * Key of the latest failure encountered while opening a site report.
     */
    readonly reportNotice: MessageKey | undefined;

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

/**
 * Message, alert color, and live-region role of a popup notice.
 */
export interface NoticePresentation {
    /**
     * Sentence shown to the user.
     */
    readonly text: string;

    /**
     * Mantine alert color.
     */
    readonly color: string;

    /**
     * Live-region role matching the notice severity.
     */
    readonly role: "status" | "alert";
}

/**
 * Maps a popup notice to its message and severity.
 *
 * @param notice - Outcome reported after a mutation or an external change.
 * @returns - Message with its alert color and live-region role, or undefined.
 */
export function noticePresentation(notice: PopupNotice): NoticePresentation | undefined {
    if (notice === POPUP_NOTICE.EXTERNAL_CHANGE) {
        return { text: t("settings_updated_elsewhere"), color: "gray", role: "status" };
    }
    const key = mutationNoticeKey(notice, NOTICE_SURFACE.POPUP);
    return key === undefined ? undefined : { text: t(key), color: "red", role: "alert" };
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
                    {t(status.key)}
                </Text>
            </div>
            {presented ? (
                <Alert role={presented.role} color={presented.color} className="popup-section">
                    {presented.text}
                </Alert>
            ) : null}
            <div className="popup-section">
                <Group justify="space-between" className="nma-row popup-row-summary">
                    <span className="nma-eyebrow">{t("popup_run_mode_label")}</span>
                    <Text size="xs" fw={600}>
                        {t(SCOPE_MODE_KEY[state.scopeMode])}
                    </Text>
                </Group>
                <Group justify="space-between" wrap="nowrap" className="nma-row">
                    <Box>
                        <Text size="sm" fw={600}>
                            {t("global_switch_label")}
                        </Text>
                        <Text size="xs" c="dimmed">
                            {t("popup_global_switch_hint")}
                        </Text>
                    </Box>
                    <Switch
                        checked={state.globalEnabled}
                        aria-busy={saving}
                        aria-label={t("global_switch_label")}
                        onChange={(event) => {
                            onChangeGlobal(event.currentTarget.checked);
                        }}
                    />
                </Group>
                {siteVisible ? (
                    <Group justify="space-between" wrap="nowrap" className="nma-row">
                        <Box>
                            <Text size="sm" fw={600}>
                                {t("popup_site_switch_label")}
                            </Text>
                            <Text size="xs" c="dimmed">
                                {t(siteSwitchDescriptionKey(
                                    state.scopeMode,
                                    state.siteEnabled ?? false,
                                ))}
                            </Text>
                        </Box>
                        <Switch
                            checked={state.siteEnabled ?? false}
                            disabled={!state.globalEnabled}
                            aria-busy={saving}
                            aria-label={state.hostname === null
                                ? t("popup_site_switch_label")
                                : t("popup_site_switch_aria", { hostname: state.hostname })}
                            onChange={(event) => {
                                onChangeSite(event.currentTarget.checked);
                            }}
                        />
                    </Group>
                ) : null}
            </div>
            {reportNotice ? (
                <Alert role="alert" color="red" className="popup-section">
                    {t(reportNotice)}
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
                        {t("popup_action_report_site")}
                    </Button>
                )}
                <Button type="button" variant="subtle" onClick={onOpenSettings}>
                    {t("popup_action_settings")}
                </Button>
            </Group>
        </>
    );
}
