/**
 * @file Renders diagnostic logging, archive, and GitHub report controls.
 */

import { Alert, Box, Button, Group, Stack, Switch, Text, Title } from "@mantine/core";
import type { ReactElement } from "react";
import { STATE_AVAILABILITY } from "../shared/messaging/view-state-values";
import { isDiagnosticsSuccessNotice } from "../shared/diagnostics/download";
import { debugNoticeText, type DiagnosticsController } from "./diagnostics-controller";

/**
 * Properties for the diagnostics section.
 */
export interface DiagnosticsSectionProps {
    /**
     * State and commands owned by the diagnostics controller.
     */
    readonly controller: DiagnosticsController;
}

/**
 * Renders opt-in diagnostic logging, archive management, and site reporting.
 *
 * @param props - Component properties.
 * @param props.controller - State and commands for diagnostics and reporting.
 * @returns - The diagnostics section.
 */
export function DiagnosticsSection({ controller }: DiagnosticsSectionProps): ReactElement {
    const { state, diagnosticsNotice } = controller;
    const debugNotice = debugNoticeText(controller.notice);
    const ready = !controller.loading && state?.availability === STATE_AVAILABILITY.READY;
    const enabled = ready && state.enabled;
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
                <Group justify="space-between" wrap="nowrap" className="nma-row">
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
            {diagnosticsNotice ? (
                <Alert
                    role="status"
                    color={isDiagnosticsSuccessNotice(diagnosticsNotice) ? "signal" : "red"}
                >
                    {diagnosticsNotice}
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
