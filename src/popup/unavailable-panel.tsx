/**
 * @file Popup recovery view shown when settings cannot be read.
 */

import { Alert, Button, Stack, Text } from "@mantine/core";
import type { ReactElement } from "react";
import { isDiagnosticsSuccessNotice } from "../shared/diagnostics/download";
import type { UnavailableSettingsCopy } from "../shared/ui/copy";
import { ResetConfirmation } from "../shared/ui/reset-confirmation";
import type { NoticePresentation } from "./ready-view";

/**
 * Recovery actions offered while settings are unavailable.
 */
export interface PopupUnavailablePanelProps {
    /**
     * Status and consequence of the failure.
     */
    readonly copy: UnavailableSettingsCopy;

    /**
     * Whether a recovery action is in flight.
     */
    readonly busy: boolean;

    /**
     * Outcome of the latest recovery attempt, when it needs guidance.
     */
    readonly notice: NoticePresentation | undefined;

    /**
     * Opens a prefilled GitHub report.
     */
    readonly onReport: () => void;

    /**
     * Restores every setting to its default after the user confirmed.
     */
    readonly onReset: () => void;

    /**
     * Downloads retained diagnostic logs.
     */
    readonly onDownloadLogs: () => void;

    /**
     * Whether a log download is in flight.
     */
    readonly downloading: boolean;

    /**
     * Outcome of the latest log download, when any.
     */
    readonly downloadNotice: string | undefined;

    /**
     * Opens the settings page and its full recovery view.
     */
    readonly onOpenSettings: () => void;
}

/**
 * Renders the failure explanation and its recovery actions.
 *
 * @param props - Component properties.
 * @param props.copy - Status and consequence of the failure.
 * @param props.busy - Whether a recovery action is in flight.
 * @param props.notice - Outcome of the latest recovery attempt.
 * @param props.onReport - Opens a prefilled GitHub report.
 * @param props.onReset - Restores every setting to its default after confirmation.
 * @param props.onDownloadLogs - Downloads retained diagnostic logs.
 * @param props.downloading - Whether a log download is in flight.
 * @param props.downloadNotice - Outcome of the latest log download.
 * @param props.onOpenSettings - Opens the settings page.
 * @returns - The popup recovery view.
 */
export function PopupUnavailablePanel({
    copy,
    busy,
    notice,
    onReport,
    onReset,
    onDownloadLogs,
    downloading,
    downloadNotice,
    onOpenSettings,
}: PopupUnavailablePanelProps): ReactElement {
    return (
        <Stack gap="sm" className="popup-section">
            <Text role="status" size="sm">
                {copy.status}
            </Text>
            <Text size="xs" c="dimmed">
                {copy.consequence} Report the problem, download any retained logs, or
                restore the default settings and reopen the popup.
            </Text>
            <Button type="button" variant="default" onClick={onReport} disabled={busy}>
                Open GitHub issue
            </Button>
            <Button
                type="button"
                variant="default"
                onClick={onDownloadLogs}
                loading={downloading}
                disabled={busy || downloading}
            >
                Download logs
            </Button>
            {downloadNotice ? (
                <Alert
                    role="status"
                    color={isDiagnosticsSuccessNotice(downloadNotice) ? "signal" : "red"}
                >
                    {downloadNotice}
                </Alert>
            ) : null}
            <ResetConfirmation resetting={busy} onConfirm={onReset} />
            {notice ? (
                <Alert role={notice.role} color={notice.color}>
                    {notice.text}
                </Alert>
            ) : null}
            <Button type="button" variant="subtle" onClick={onOpenSettings}>
                Settings
            </Button>
        </Stack>
    );
}
