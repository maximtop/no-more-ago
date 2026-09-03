/**
 * @file Popup recovery view shown when settings cannot be read.
 */

import { Alert, Button, Stack, Text } from "@mantine/core";
import type { ReactElement } from "react";

/**
 * Recovery actions offered while settings are unavailable.
 */
export interface PopupUnavailablePanelProps {
    /**
     * Explanation of why no control can be shown.
     */
    readonly message: string;

    /**
     * Whether a recovery action is in flight.
     */
    readonly busy: boolean;

    /**
     * Opens a prefilled GitHub report.
     */
    readonly onReport: () => void;

    /**
     * Restores every setting to its default.
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
     * Opens the settings page, where diagnostics can be downloaded.
     */
    readonly onOpenSettings: () => void;
}

/**
 * Renders the failure explanation and its recovery actions.
 *
 * @param props - Component properties.
 * @param props.message - Explanation of the failure.
 * @param props.busy - Whether a recovery action is in flight.
 * @param props.onReport - Opens a prefilled GitHub report.
 * @param props.onReset - Restores every setting to its default.
 * @param props.onDownloadLogs - Downloads retained diagnostic logs.
 * @param props.downloading - Whether a log download is in flight.
 * @param props.downloadNotice - Outcome of the latest log download.
 * @param props.onOpenSettings - Opens the settings page.
 * @returns - The popup recovery view.
 */
export function PopupUnavailablePanel({
    message,
    busy,
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
                {message}
            </Text>
            <Text size="xs" c="dimmed">
                No page is being changed. Report the problem, download any retained logs, or
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
                <Alert role="status" color="gray">
                    {downloadNotice}
                </Alert>
            ) : null}
            <Button type="button" color="red" variant="outline" onClick={onReset} loading={busy}>
                Reset all settings
            </Button>
            <Button type="button" variant="subtle" onClick={onOpenSettings}>
                Settings
            </Button>
        </Stack>
    );
}
