/**
 * @file Renders diagnostic logging, archive, and GitHub report controls.
 */

import { Alert, Box, Button, Group, Stack, Switch, Text, Title } from "@mantine/core";
import type { ReactElement } from "react";
import { STATE_AVAILABILITY } from "../shared/messaging/view-state-values";
import {
    DIAGNOSTICS_CLEARED_NOTICE,
    DIAGNOSTICS_DOWNLOADED_NOTICE,
    type DiagnosticsController,
} from "./diagnostics-controller";
import { isDebugNotice, optionsNoticeText, type OptionsNotice } from "./options-notice";

/**
 * Properties for the diagnostics section.
 */
export interface DiagnosticsSectionProps {
    /**
     * State and commands owned by the diagnostics controller.
     */
    readonly controller: DiagnosticsController;

    /**
     * Shared mutation notice; only Debug logs outcomes are rendered here.
     */
    readonly notice: OptionsNotice;
}

/**
 * Renders opt-in diagnostic logging, archive management, and site reporting.
 *
 * @param props - Component properties.
 * @param props.controller - State and commands for diagnostics and reporting.
 * @param props.notice - Shared mutation notice.
 * @returns - The diagnostics section.
 */
export function DiagnosticsSection({ controller, notice }: DiagnosticsSectionProps): ReactElement {
    const { state } = controller;
    const debugNotice = isDebugNotice(notice) ? optionsNoticeText(notice) : undefined;
    const ready = !controller.loading && state?.availability === STATE_AVAILABILITY.READY;
    const enabled = ready && state.enabled;
    const success = controller.diagnosticsNotice === DIAGNOSTICS_CLEARED_NOTICE
        || controller.diagnosticsNotice === DIAGNOSTICS_DOWNLOADED_NOTICE;
    return (
        <Stack gap="lg" component="section" aria-labelledby="diagnostics-heading">
            <Box>
                <Title order={2} id="diagnostics-heading">
                    Diagnostics
                </Title>
                <Text size="sm" c="dimmed">
                    Logs stay on this device and are never submitted automatically. Attach a
                    downloaded archive to a report only if you choose to.
                </Text>
            </Box>
            {controller.loading ? <Text role="status">Loading debug settings…</Text> : null}
            {!controller.loading && state?.availability === STATE_AVAILABILITY.UNAVAILABLE ? (
                <Text role="status">
                    Debug logs are unavailable. Processing remains unchanged.
                </Text>
            ) : null}
            {ready ? (
                <Group justify="space-between" wrap="nowrap" className="settings-row">
                    <Box>
                        <Text size="sm" fw={600}>
                            Debug logs
                        </Text>
                        <Text size="xs" c="dimmed">
                            Keep a bounded local record of what the extension did on each page.
                        </Text>
                    </Box>
                    <Switch
                        aria-label="Debug logs"
                        checked={state.enabled}
                        aria-busy={controller.saving}
                        onChange={(event) => {
                            void controller.changeDebug(event.currentTarget.checked);
                        }}
                    />
                </Group>
            ) : null}
            <Group>
                <Button
                    type="button"
                    variant="default"
                    onClick={() => {
                        void controller.downloadDiagnostics();
                    }}
                    loading={controller.diagnosticsBusy}
                    disabled={!enabled || controller.diagnosticsBusy}
                >
                    Download logs
                </Button>
                <Button
                    type="button"
                    variant="default"
                    onClick={() => {
                        void controller.clearDiagnostics();
                    }}
                    loading={controller.diagnosticsBusy}
                    disabled={!enabled || controller.diagnosticsBusy}
                >
                    Clear logs
                </Button>
                <Button
                    type="button"
                    variant="subtle"
                    onClick={() => {
                        void controller.openGitHubIssue();
                    }}
                    loading={controller.reporting}
                    disabled={controller.reporting}
                >
                    Open GitHub issue
                </Button>
            </Group>
            {debugNotice ? (
                <Alert role="alert" color="red">
                    {debugNotice}
                </Alert>
            ) : null}
            {controller.diagnosticsNotice ? (
                <Alert role="status" color={success ? "signal" : "red"}>
                    {controller.diagnosticsNotice}
                </Alert>
            ) : null}
            {controller.reportNotice ? (
                <Alert role="alert" color="red">
                    {controller.reportNotice}
                </Alert>
            ) : null}
        </Stack>
    );
}
