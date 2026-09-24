/**
 * @file Renders diagnostic logging, archive, and GitHub report controls.
 */

import {
    Alert, Box, Button, Group, Stack, Switch, Text, Title,
} from '@mantine/core';

import { isDiagnosticsSuccessNotice } from '../shared/diagnostics/download';
import { t } from '../shared/i18n/translator';
import { STATE_AVAILABILITY } from '../shared/messaging/view-state-values';

import { debugNoticeKey, type DiagnosticsController } from './diagnostics-controller';

import type { ReactElement } from 'react';

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
 *
 * @returns - The diagnostics section.
 */
export function DiagnosticsSection({ controller }: DiagnosticsSectionProps): ReactElement {
    const { state, diagnosticsNotice } = controller;
    const debugNotice = debugNoticeKey(controller.notice);
    const ready = !controller.loading && state?.availability === STATE_AVAILABILITY.READY;
    const enabled = ready && state.enabled;
    return (
        <Stack gap="lg" component="section" aria-labelledby="diagnostics-heading">
            <Box>
                <Title order={2} id="diagnostics-heading">
                    {t('diagnostics_heading')}
                </Title>
                <Text size="sm" c="dimmed">
                    {t('diagnostics_intro')}
                </Text>
            </Box>
            {controller.loading ? <Text role="status">{t('diagnostics_loading')}</Text> : null}
            {!controller.loading && state?.availability === STATE_AVAILABILITY.UNAVAILABLE ? (
                <Text role="status">
                    {t('diagnostics_unavailable')}
                </Text>
            ) : null}
            {ready ? (
                <Group justify="space-between" wrap="nowrap" className="nma-row">
                    <Box>
                        <Text size="sm" fw={600}>
                            {t('debug_logs_label')}
                        </Text>
                        <Text size="xs" c="dimmed">
                            {t('debug_logs_hint')}
                        </Text>
                    </Box>
                    <Switch
                        aria-label={t('debug_logs_label')}
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
                    {t('diagnostics_download')}
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
                    {t('diagnostics_clear')}
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
                    {t('diagnostics_open_issue')}
                </Button>
            </Group>
            {debugNotice ? (
                <Alert role="alert" color="red">
                    {t(debugNotice)}
                </Alert>
            ) : null}
            {diagnosticsNotice ? (
                <Alert
                    role="status"
                    color={isDiagnosticsSuccessNotice(diagnosticsNotice) ? 'signal' : 'red'}
                >
                    {t(diagnosticsNotice)}
                </Alert>
            ) : null}
            {controller.reportNotice ? (
                <Alert role="alert" color="red">
                    {t(controller.reportNotice)}
                </Alert>
            ) : null}
        </Stack>
    );
}
