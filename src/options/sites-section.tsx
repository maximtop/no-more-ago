/**
 * @file Renders global status and exact-host controls on the options page.
 */

import { Alert, Box, Stack, Switch, Text, Title } from "@mantine/core";
import type { ReactElement } from "react";
import type { SitesState } from "../shared/messages";
import type { OptionsNotice } from "./options-notice";
import { optionsNoticeText } from "./options-notice";
import type { SitesController } from "./sites-controller";

/**
 * Properties for the site-settings section.
 */
export interface SitesSectionProps {
    /**
     * State and commands owned by the site-settings controller.
     */
    readonly controller: SitesController;

    /**
     * Shared site or Debug logs mutation notice rendered after the site controls.
     */
    readonly notice: OptionsNotice;
}

/**
 * Explains why site settings cannot currently be changed.
 *
 * @param state Unavailable sites state returned by the background service.
 * @returns The message displayed instead of the site controls.
 */
function unavailableText(state: Extract<SitesState, { availability: "unavailable" }>): string {
    return state.failure === "fail-closed-cleanup"
        ? "Current processing state is unknown. Site controls are unavailable."
        : "Sites settings are unavailable. Processing is disabled.";
}

/**
 * Renders exact-host preferences and their current save state.
 *
 * @param props Component properties.
 * @param props.controller State and commands for the site settings.
 * @param props.notice Shared site or Debug logs mutation notice.
 * @returns The site-settings section.
 */
export function SitesSection({ controller, notice }: SitesSectionProps): ReactElement {
    const { state, savingHostname } = controller;
    if (!state) {
        return <Text role="status">Loading…</Text>;
    }
    const message = optionsNoticeText(notice);
    return (
        <>
            <Box>
                <Title order={2}>Settings</Title>
                <Text id="sites-heading" size="lg" fw={600}>
                    Sites
                </Text>
                <Text size="sm" c="dimmed">
                    Choose which exact hostnames may be processed.
                </Text>
            </Box>
            {state.availability === "unavailable" ? (
                <Text role="status">{unavailableText(state)}</Text>
            ) : (
                <>
                    {!state.globalEnabled ? (
                        <Alert color="blue">
                            The extension is off. Site preferences are saved and will apply when
                            the extension is enabled.
                        </Alert>
                    ) : null}
                    <Stack component="section" aria-labelledby="sites-heading" gap="sm">
                        {state.sites.map((site) => (
                            <Switch
                                key={site.hostname}
                                label={site.hostname}
                                checked={site.enabled}
                                disabled={savingHostname !== undefined}
                                onChange={(event) => {
                                    void controller.changeSite(
                                        site.hostname,
                                        event.currentTarget.checked,
                                    );
                                }}
                                aria-label={`Enabled on ${site.hostname}`}
                            />
                        ))}
                        {state.sites.length === 0 ? (
                            <Text role="status">No site preferences have been saved.</Text>
                        ) : null}
                    </Stack>
                </>
            )}
            {message ? (
                <Alert role="alert" color="red">
                    {message}
                </Alert>
            ) : null}
        </>
    );
}
