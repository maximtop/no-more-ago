/**
 * @file Settings navigation listing the four sections with one visible panel.
 */

import { Tabs } from '@mantine/core';

import { t } from '../shared/i18n/translator';

import type { ReactElement, ReactNode } from 'react';

/**
 * Named settings sections in navigation order.
 */
export const SETTINGS_SECTION = {
    SITES: 'sites',
    DISPLAY: 'display',
    DIAGNOSTICS: 'diagnostics',
    RESET: 'reset',
} as const;

/**
 * Section currently visible in the settings page.
 */
export type SettingsSection = (typeof SETTINGS_SECTION)[keyof typeof SETTINGS_SECTION];

/**
 * Panels rendered by the settings navigation.
 */
export interface SettingsNavigationProps {
    /**
     * Panel for each section, in navigation order.
     */
    readonly panels: Readonly<Record<SettingsSection, ReactNode>>;

    /**
     * Optional message rendered above whichever panel is visible.
     */
    readonly banner?: ReactNode;
}

/**
 * Renders the four-section navigation beside the selected panel. The section is
 * deliberately not persisted, so every opening starts on Sites.
 *
 * @param props - Component properties.
 * @param props.panels - Panel content for each section.
 * @param props.banner - Optional message shown above the visible panel.
 *
 * @returns - The settings navigation and its visible panel.
 */
export function SettingsNavigation({ panels, banner }: SettingsNavigationProps): ReactElement {
    return (
        <Tabs
            defaultValue={SETTINGS_SECTION.SITES}
            orientation="vertical"
            className="options-layout"
            keepMounted={false}
            unstyled
        >
            <div className="options-nav">
                <p className="nma-eyebrow options-nav-title">{t('options_nav_title')}</p>
                <Tabs.List className="options-nav-list" aria-label={t('options_nav_aria')}>
                    <Tabs.Tab value={SETTINGS_SECTION.SITES}>{t('sites_heading')}</Tabs.Tab>
                    <Tabs.Tab value={SETTINGS_SECTION.DISPLAY}>{t('display_heading')}</Tabs.Tab>
                    <Tabs.Tab value={SETTINGS_SECTION.DIAGNOSTICS}>
                        {t('diagnostics_heading')}
                    </Tabs.Tab>
                    <Tabs.Tab value={SETTINGS_SECTION.RESET}>{t('reset_heading')}</Tabs.Tab>
                </Tabs.List>
            </div>
            <div className="options-content">
                {banner}
                <Tabs.Panel value={SETTINGS_SECTION.SITES}>
                    {panels[SETTINGS_SECTION.SITES]}
                </Tabs.Panel>
                <Tabs.Panel value={SETTINGS_SECTION.DISPLAY}>
                    {panels[SETTINGS_SECTION.DISPLAY]}
                </Tabs.Panel>
                <Tabs.Panel value={SETTINGS_SECTION.DIAGNOSTICS}>
                    {panels[SETTINGS_SECTION.DIAGNOSTICS]}
                </Tabs.Panel>
                <Tabs.Panel value={SETTINGS_SECTION.RESET}>
                    {panels[SETTINGS_SECTION.RESET]}
                </Tabs.Panel>
            </div>
        </Tabs>
    );
}
