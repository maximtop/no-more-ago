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
import {
    memo,
    useCallback,
    useEffect,
    useRef,
    useState,
    type ReactElement,
    type SyntheticEvent,
} from "react";
import { STATE_AVAILABILITY } from "../shared/messaging/view-state-values";
import {
    SITE_SCOPE_LIST_LABEL,
    SITE_SCOPE_MODE,
    SITE_SCOPE_MODE_LABEL,
    parseSiteScopeMode,
} from "../shared/settings/site-scope";
import { GLOBAL_SWITCH_LABEL } from "../shared/ui/copy";
import { mutationNoticeText } from "../shared/ui/persistence-notice";
import { activeListCopy, validateHostnameEntry, type ActiveListCopy } from "./site-scope-form";
import { SITES_BUSY_KIND, type SitesController } from "./sites-controller";

/**
 * Properties for the site-settings section.
 */
export interface SitesSectionProps {
    /**
     * State and commands owned by the site-settings controller.
     */
    readonly controller: SitesController;
}

const RETRY_HINT = "Reopen Settings to try again. Current state is unavailable.";

/**
 * Properties for the hostname entry form.
 */
interface HostnameEntryFormProps {
    /**
     * Labels of the list the active mode owns.
     */
    readonly copy: ActiveListCopy;

    /**
     * Hostnames already in that list.
     */
    readonly hosts: readonly string[];

    /**
     * Adds a validated hostname and reports whether the background confirmed it.
     */
    readonly onAdd: (hostname: string) => Promise<boolean>;

    /**
     * Called when the entry was rejected before it reached the background.
     */
    readonly onRejected: () => void;
}

/**
 * Renders the hostname field and its submit action. The draft lives here so a
 * keystroke re-renders the form alone, not the hostname list beside it.
 *
 * @param props - Component properties.
 * @param props.copy - Labels of the list the active mode owns.
 * @param props.hosts - Hostnames already in that list.
 * @param props.onAdd - Adds a validated hostname.
 * @param props.onRejected - Called when the entry was rejected locally.
 * @returns - The entry form.
 */
function HostnameEntryForm({
    copy,
    hosts,
    onAdd,
    onRejected,
}: HostnameEntryFormProps): ReactElement {
    const [draft, setDraft] = useState("");
    const [formError, setFormError] = useState<string>();
    const onSubmit = (event: SyntheticEvent<HTMLFormElement>): void => {
        event.preventDefault();
        const result = validateHostnameEntry(draft, hosts);
        if (!result.ok) {
            setFormError(result.error);
            onRejected();
            return;
        }
        setFormError(undefined);
        void onAdd(result.hostname).then((added) => {
            if (added) {
                setDraft("");
            }
        });
    };
    return (
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
                    className="options-grow"
                    aria-label={copy.fieldLabel}
                    aria-describedby="hostname-entry-hint"
                    placeholder="example.com"
                    value={draft}
                    error={formError}
                    autoComplete="off"
                    spellCheck={false}
                    classNames={{ input: "nma-mono options-hostname-input" }}
                    onChange={(event) => {
                        setDraft(event.currentTarget.value);
                        setFormError(undefined);
                    }}
                />
                <Button type="submit" variant="default">
                    {copy.submitLabel}
                </Button>
            </Group>
        </form>
    );
}

/**
 * Properties for the active hostname list.
 */
interface SiteListProps {
    /**
     * Hostnames in the list the active mode owns.
     */
    readonly hosts: readonly string[];

    /**
     * Title of that list, used to label each removal.
     */
    readonly title: string;

    /**
     * Hostname whose removal is in flight, when any.
     */
    readonly busyHostname: string | undefined;

    /**
     * Removes one hostname from the list.
     */
    readonly onRemove: (hostname: string) => void;
}

/**
 * Renders one row per hostname. Memoized so only list changes rebuild the rows.
 *
 * @param props - Component properties.
 * @param props.hosts - Hostnames in the active list.
 * @param props.title - Title of the active list.
 * @param props.busyHostname - Hostname whose removal is in flight.
 * @param props.onRemove - Removes one hostname.
 * @returns - The hostname list.
 */
const SiteList = memo(function SiteList({
    hosts,
    title,
    busyHostname,
    onRemove,
}: SiteListProps): ReactElement {
    return (
        <ul className="options-site-list">
            {hosts.map((hostname) => (
                <li className="options-site-row" key={hostname}>
                    <span className="nma-mono options-site-hostname">{hostname}</span>
                    <Button
                        type="button"
                        variant="subtle"
                        loading={busyHostname === hostname}
                        aria-label={`Remove ${hostname} from ${title}`}
                        onClick={() => {
                            onRemove(hostname);
                        }}
                    >
                        Remove
                    </Button>
                </li>
            ))}
        </ul>
    );
});

/**
 * Renders the run mode, the add-hostname form, and the active list.
 *
 * @param props - Component properties.
 * @param props.controller - State and commands for the site settings.
 * @returns - The Sites section.
 */
export function SitesSection({ controller }: SitesSectionProps): ReactElement {
    const [confirmation, setConfirmation] = useState<string>();
    const { state, notice, busy } = controller;
    const scopeMode = state?.availability === STATE_AVAILABILITY.READY
        ? state.scopeMode
        : undefined;
    // A confirmation names the list it was added to, so it is dropped as soon
    // as the mode changes or a failure notice replaces it.
    useEffect(() => {
        setConfirmation(undefined);
    }, [scopeMode, notice]);
    // The controller's commands are recreated on every render; the list gets
    // one stable callback that reads the latest ones.
    const latest = useRef(controller);
    useEffect(() => {
        latest.current = controller;
    });
    const onRemove = useCallback((hostname: string) => {
        setConfirmation(undefined);
        const current = latest.current.state;
        if (current?.availability !== STATE_AVAILABILITY.READY) {
            return;
        }
        void latest.current.changeSiteProcessing(
            hostname,
            !activeListCopy(current.scopeMode).addEnables,
        );
    }, []);
    if (!state || state.availability !== STATE_AVAILABILITY.READY) {
        return (
            <Text role="status">
                Sites settings are unavailable. Processing is disabled.
            </Text>
        );
    }
    const copy = activeListCopy(state.scopeMode);
    const hosts = controller.activeHostnames;
    const scopeBusy = busy?.kind === SITES_BUSY_KIND.SCOPE;
    const noticeMessage = mutationNoticeText(notice, RETRY_HINT);
    const onAdd = async (hostname: string): Promise<boolean> => {
        setConfirmation(undefined);
        const added = await controller.changeSiteProcessing(hostname, copy.addEnables);
        if (added) {
            setConfirmation(`${hostname} was added to ${copy.title}.`);
        }
        return added;
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
            <Group justify="space-between" wrap="nowrap" className="nma-row">
                <Box>
                    <Text size="sm" fw={600}>
                        {GLOBAL_SWITCH_LABEL}
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
                    aria-busy={busy?.kind === SITES_BUSY_KIND.GLOBAL}
                    aria-label={GLOBAL_SWITCH_LABEL}
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
                        label={SITE_SCOPE_MODE_LABEL[SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED]}
                        description={"Run everywhere except hostnames in "
                            + `${SITE_SCOPE_LIST_LABEL[SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED]}.`}
                        aria-busy={scopeBusy}
                    />
                    <Radio
                        value={SITE_SCOPE_MODE.SELECTED_ONLY}
                        label={SITE_SCOPE_MODE_LABEL[SITE_SCOPE_MODE.SELECTED_ONLY]}
                        description={"Run only on hostnames in "
                            + `${SITE_SCOPE_LIST_LABEL[SITE_SCOPE_MODE.SELECTED_ONLY]}.`}
                        aria-busy={scopeBusy}
                    />
                </Stack>
            </Radio.Group>
            <HostnameEntryForm
                copy={copy}
                hosts={hosts}
                onAdd={onAdd}
                onRejected={() => {
                    setConfirmation(undefined);
                }}
            />
            <Box>
                <Group justify="space-between" align="flex-end">
                    <Title order={3}>{copy.title}</Title>
                    <Text size="xs" c="dimmed">
                        {copy.description}
                    </Text>
                </Group>
                <Text size="xs" c="dimmed" mt={4}>
                    {copy.removalEffect}
                </Text>
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
                    <SiteList
                        hosts={hosts}
                        title={copy.title}
                        busyHostname={busy?.kind === SITES_BUSY_KIND.SITE
                            ? busy.hostname
                            : undefined}
                        onRemove={onRemove}
                    />
                )}
                {confirmation ? (
                    <Text role="status" size="xs" c="dimmed" mt="xs">
                        {confirmation}
                    </Text>
                ) : null}
            </Box>
            {noticeMessage ? (
                <Alert role="alert" color="red">
                    {noticeMessage}
                </Alert>
            ) : null}
        </Stack>
    );
}
