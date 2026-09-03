/**
 * @file Renders global activation, the run mode, and the active hostname list.
 */

import {
    Alert,
    Box,
    Button,
    Group,
    Radio,
    Stack,
    Switch,
    Text,
    TextInput,
    Title,
} from "@mantine/core";
import { useState, type ReactElement, type SyntheticEvent } from "react";
import { STATE_AVAILABILITY } from "../shared/messaging/view-state-values";
import { SITE_SCOPE_MODE, parseSiteScopeMode } from "../shared/settings/site-scope";
import { GLOBAL_BUSY_KEY, SCOPE_BUSY_KEY } from "./sites-controller";
import { isDebugNotice, optionsNoticeText, type OptionsNotice } from "./options-notice";
import { activeListCopy, validateHostnameEntry } from "./site-scope-form";
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
     * Shared site or Debug logs mutation notice.
     */
    readonly notice: OptionsNotice;
}

/**
 * Renders the run mode, the add-hostname form, and the active list.
 *
 * @param props - Component properties.
 * @param props.controller - State and commands for the site settings.
 * @param props.notice - Shared mutation notice.
 * @returns - The Sites section.
 */
export function SitesSection({ controller, notice }: SitesSectionProps): ReactElement {
    const [draft, setDraft] = useState("");
    const [formError, setFormError] = useState<string>();
    const [confirmation, setConfirmation] = useState<string>();
    const { state } = controller;
    if (!state || state.availability !== STATE_AVAILABILITY.READY) {
        return (
            <Text role="status">
                Sites settings are unavailable. Processing is disabled.
            </Text>
        );
    }
    const copy = activeListCopy(state.scopeMode);
    const hosts = controller.activeHostnames;
    const scopeBusy = controller.busy === SCOPE_BUSY_KEY;
    const noticeMessage = isDebugNotice(notice) ? undefined : optionsNoticeText(notice);
    const onSubmit = (event: SyntheticEvent<HTMLFormElement>): void => {
        event.preventDefault();
        const result = validateHostnameEntry(draft, hosts);
        if (!result.ok) {
            setFormError(result.error);
            setConfirmation(undefined);
            return;
        }
        setFormError(undefined);
        setDraft("");
        setConfirmation(`${result.hostname} was added to ${copy.title}.`);
        void controller.changeSiteProcessing(result.hostname, copy.addEnables);
    };
    return (
        <Stack gap="lg" component="section" aria-labelledby="sites-heading">
            <Box>
                <Title order={2} id="sites-heading">
                    Sites
                </Title>
                <Text size="sm" c="dimmed">
                    Choose where the extension runs, then manage exact hostnames for that rule.
                </Text>
            </Box>
            <Group justify="space-between" wrap="nowrap" className="settings-row">
                <Box>
                    <Text size="sm" fw={600}>
                        Enable extension globally
                    </Text>
                    <Text size="xs" c="dimmed" aria-live="polite">
                        {state.globalEnabled
                            ? "Processing is enabled on supported sites under the run mode below."
                            : "Processing is paused. The run mode and both site lists are kept. "
                            + "They apply once processing is enabled."}
                    </Text>
                </Box>
                <Switch
                    checked={state.globalEnabled}
                    aria-busy={controller.busy === GLOBAL_BUSY_KEY}
                    aria-label="Enable extension globally"
                    onChange={(event) => {
                        void controller.changeGlobal(event.currentTarget.checked);
                    }}
                />
            </Group>
            <Radio.Group
                label="Run on"
                description="Each mode keeps its own list. Switching modes never moves a hostname."
                value={state.scopeMode}
                onChange={(value) => {
                    const mode = parseSiteScopeMode(value);
                    if (mode) {
                        void controller.changeScopeMode(mode);
                    }
                }}
            >
                <Stack gap="xs" mt="xs">
                    <Radio
                        value={SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED}
                        label="All supported sites"
                        description="Run everywhere except hostnames in Excluded sites."
                        aria-busy={scopeBusy}
                    />
                    <Radio
                        value={SITE_SCOPE_MODE.SELECTED_ONLY}
                        label="Selected sites only"
                        description="Run only on hostnames in Allowed sites."
                        aria-busy={scopeBusy}
                    />
                </Stack>
            </Radio.Group>
            <form onSubmit={onSubmit} noValidate>
                <Text component="label" htmlFor="hostname-entry" size="sm" fw={600}>
                    {copy.fieldLabel}
                </Text>
                <Text id="hostname-entry-hint" size="xs" c="dimmed" mb="xs">
                    Enter an exact hostname without https:// or a path.
                </Text>
                <Group align="flex-start" gap="sm" wrap="nowrap">
                    <TextInput
                        id="hostname-entry"
                        className="settings-grow"
                        aria-label={copy.fieldLabel}
                        aria-describedby="hostname-entry-hint"
                        placeholder="example.com"
                        value={draft}
                        error={formError}
                        autoComplete="off"
                        spellCheck={false}
                        classNames={{ input: "nma-mono settings-hostname-input" }}
                        onChange={(event) => {
                            setDraft(event.currentTarget.value);
                            setFormError(undefined);
                        }}
                    />
                    <Button type="submit" variant="default" className="settings-form-submit">
                        {copy.submitLabel}
                    </Button>
                </Group>
            </form>
            <Box>
                <Group justify="space-between" align="flex-end">
                    <Title order={3}>{copy.title}</Title>
                    <Text size="xs" c="dimmed">
                        {copy.description}
                    </Text>
                </Group>
                {confirmation ? (
                    <Text role="status" size="xs" c="dimmed" mt="xs">
                        {confirmation}
                    </Text>
                ) : null}
                {hosts.length === 0 ? (
                    <Alert
                        role="status"
                        color={state.scopeMode === SITE_SCOPE_MODE.SELECTED_ONLY
                            ? "yellow"
                            : "gray"}
                        mt="sm"
                    >
                        {copy.emptyState}
                    </Alert>
                ) : (
                    <ul className="site-list">
                        {hosts.map((hostname) => (
                            <li className="site-row" key={hostname}>
                                <span className="nma-mono site-row-hostname">{hostname}</span>
                                <Button
                                    type="button"
                                    variant="subtle"
                                    loading={controller.busy === hostname}
                                    aria-label={`${copy.rowAction} ${hostname}`}
                                    onClick={() => {
                                        setConfirmation(undefined);
                                        void controller.changeSiteProcessing(
                                            hostname,
                                            !copy.addEnables,
                                        );
                                    }}
                                >
                                    {copy.rowAction}
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
            </Box>
            {noticeMessage ? (
                <Alert role="alert" color="red">
                    {noticeMessage}
                </Alert>
            ) : null}
        </Stack>
    );
}
