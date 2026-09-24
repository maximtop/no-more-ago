/**
 * @file React popup UI for extension status, site controls, and reporting.
 */

import {
    DirectionProvider, MantineProvider, Stack, Text, Title,
} from '@mantine/core';
import {
    useMemo, useState, type ReactElement, type ReactNode,
} from 'react';

import { t, uiDirection, type MessageKey } from '../shared/i18n/translator';
import { STATE_AVAILABILITY } from '../shared/messaging/view-state-values';
import {
    SITE_REPORT_ERROR,
    createDefaultSiteReportReporter,
    type SiteReportError,
    type SiteReportReporter,
} from '../shared/reporting/site-report';
import { APPEARANCE } from '../shared/settings/snapshot';
import { BrandMark } from '../shared/ui/brand-mark';
import { unavailableSettingsKeys } from '../shared/ui/copy';
import { NO_MORE_AGO_THEME, forcedColorScheme } from '../shared/ui/theme';

import { openBrowserOptionsPage, type OpenOptionsPage } from './options-page';
import { usePopupController } from './popup-controller';
import { popupStatusModel } from './popup-status';
import { PopupReadyView, noticePresentation } from './ready-view';
import { PopupUnavailablePanel } from './unavailable-panel';

import type { PopupClient } from './client';
import type { DownloadRuntime } from '../shared/diagnostics/archive';
import type { SubscribeSettingsChanged } from '../shared/messaging/settings-notifications';
import type { PopupState } from '../shared/messaging/view-state';

/**
 * Optional dependencies and initial state for the popup UI.
 */
export interface PopupAppProps {
    /**
     * Client used to load and change popup settings.
     */
    readonly client?: PopupClient;

    /**
     * State to render without an initial background request.
     */
    readonly initialState?: PopupState;

    /**
     * Function used to open the browser-managed Options page.
     */
    readonly openOptionsPage?: OpenOptionsPage;

    /**
     * Service used to open a GitHub report for the current site.
     */
    readonly reporter?: SiteReportReporter;

    /**
     * Subscriber used to observe committed settings changes.
     */
    readonly subscribe?: SubscribeSettingsChanged;

    /**
     * Runtime used to hand a diagnostics archive to the browser.
     */
    readonly archiveRuntime?: DownloadRuntime;
}

/**
 * Message mapping for every supported outcome.
 */
const SITE_REPORT_ERROR_KEYS = {
    [SITE_REPORT_ERROR.MISSING_TAB]: 'report_error_missing_tab',
    [SITE_REPORT_ERROR.RESTRICTED_PAGE]: 'report_error_restricted_page',
    [SITE_REPORT_ERROR.HOSTNAME_MISMATCH]: 'report_error_hostname_mismatch',
    [SITE_REPORT_ERROR.PRIVATE_WINDOW]: 'report_error_private_window',
    [SITE_REPORT_ERROR.BROWSER_UNAVAILABLE]: 'report_error_browser_unavailable',
    [SITE_REPORT_ERROR.INVALID_CONTEXT]: 'report_error_invalid_context',
    [SITE_REPORT_ERROR.BUSY]: 'report_error_busy',
    [SITE_REPORT_ERROR.OPEN_FAILED]: 'report_error_generic',
} as const satisfies Record<SiteReportError, MessageKey>;

/**
 * Maps a site-report failure to the guidance key shown in the popup.
 *
 * @param error - Failure returned by the site-report service.
 *
 * @returns - Message key displayed to the user.
 */
function siteReportErrorKey(error: SiteReportError): MessageKey {
    return SITE_REPORT_ERROR_KEYS[error];
}

/**
 * Renders and coordinates the popup controls.
 *
 * @param props - Optional dependencies and preloaded popup state.
 * @param props.client - Popup settings client override.
 * @param props.initialState - Preloaded popup state.
 * @param props.openOptionsPage - Browser Options-page function override.
 * @param props.reporter - Site-report service override.
 * @param props.subscribe - Settings change subscriber override.
 * @param props.archiveRuntime - Diagnostics archive download runtime override.
 *
 * @returns - The popup React view.
 */
export function PopupApp({
    client,
    initialState,
    openOptionsPage = openBrowserOptionsPage,
    reporter: suppliedReporter,
    subscribe,
    archiveRuntime,
}: PopupAppProps): ReactElement {
    const controller = usePopupController({
        ...(client ? { client } : {}),
        ...(initialState ? { initialState } : {}),
        ...(subscribe ? { subscribe } : {}),
        ...(archiveRuntime ? { archiveRuntime } : {}),
    });
    const reporter = useMemo(
        () => suppliedReporter ?? createDefaultSiteReportReporter(),
        [suppliedReporter],
    );
    const [reporting, setReporting] = useState(false);
    const [reportNotice, setReportNotice] = useState<MessageKey>();
    const { state } = controller;
    const appearance = state?.appearance ?? APPEARANCE.SYSTEM;

    /**
     * Opens a prefilled GitHub report for the current site.
     *
     * @returns - A promise that settles after the report attempt.
     */
    const onReportSite = async (): Promise<void> => {
        if (
            !state
            || state.availability !== STATE_AVAILABILITY.READY
            || state.hostname === null
            || reporting
        ) {
            return;
        }
        setReporting(true);
        setReportNotice(undefined);
        try {
            const result = await reporter.openPopupReport({ hostname: state.hostname });
            if (!result.ok) {
                setReportNotice(siteReportErrorKey(result.error));
            }
        } catch {
            setReportNotice('report_error_generic');
        } finally {
            setReporting(false);
        }
    };

    /**
     * Opens the Options page, ignoring browser failures.
     */
    const onOpenSettings = (): void => {
        void openOptionsPage().catch(() => undefined);
    };

    let content: ReactNode;
    if (controller.loading || !state) {
        content = (
            <Text role="status" className="popup-section">
                {t('popup_loading')}
            </Text>
        );
    } else if (state.availability !== STATE_AVAILABILITY.READY) {
        content = (
            <PopupUnavailablePanel
                copy={{
                    status: popupStatusModel(state).text,
                    consequence: t(
                        unavailableSettingsKeys(state.failure).consequence,
                    ),
                }}
                busy={controller.saving}
                notice={noticePresentation(controller.notice)}
                onReport={() => {
                    void reporter.openOptionsReport().catch(() => undefined);
                }}
                onReset={() => {
                    void controller.resetAll();
                }}
                onDownloadLogs={() => {
                    void controller.downloadLogs();
                }}
                downloading={controller.downloading}
                downloadNotice={controller.downloadNotice}
                onOpenSettings={onOpenSettings}
            />
        );
    } else {
        content = (
            <PopupReadyView
                state={state}
                saving={controller.saving}
                notice={controller.notice}
                reporting={reporting}
                reportNotice={reportNotice}
                onChangeGlobal={(enabled) => {
                    void controller.changeGlobal(enabled);
                }}
                onChangeSite={(enabled) => {
                    void controller.changeSite(enabled);
                }}
                onReportSite={() => {
                    void onReportSite();
                }}
                onOpenSettings={onOpenSettings}
            />
        );
    }

    return (
        <DirectionProvider initialDirection={uiDirection()} detectDirection={false}>
            <MantineProvider
                theme={NO_MORE_AGO_THEME}
                defaultColorScheme="auto"
                {...forcedColorScheme(appearance)}
            >
                <main className="popup" aria-label={t('extension_name')}>
                    <header className="popup-header">
                        <BrandMark size={40} />
                        <div className="popup-identity">
                            <Title order={1}>{t('extension_name')}</Title>
                            <p
                                className={state?.hostname
                                    ? 'popup-hostname nma-mono' : 'popup-hostname'}
                                title={state?.hostname ?? undefined}
                            >
                                {state?.hostname ?? t('popup_current_page')}
                            </p>
                        </div>
                    </header>
                    <Stack gap={0}>
                        {content}
                    </Stack>
                </main>
            </MantineProvider>
        </DirectionProvider>
    );
}
