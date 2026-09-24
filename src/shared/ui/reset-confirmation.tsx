/**
 * @file Two-step reset action: a destructive trigger followed by an inline confirmation.
 */

import { Button, Group, Text } from '@mantine/core';
import { useState, type ReactElement } from 'react';

import { t } from '../i18n/translator';

/**
 * Properties for the confirmed reset action.
 */
export interface ResetConfirmationProps {
    /**
     * Whether a reset is in flight.
     */
    readonly resetting: boolean;

    /**
     * Performs the reset after the user confirms.
     */
    readonly onConfirm: () => void;
}

/**
 * Renders the reset trigger and, once activated, an inline confirmation.
 *
 * @param props - Component properties.
 * @param props.resetting - Whether a reset is in flight.
 * @param props.onConfirm - Performs the reset after confirmation.
 *
 * @returns - The reset action.
 */
export function ResetConfirmation({ resetting, onConfirm }: ResetConfirmationProps): ReactElement {
    const [confirming, setConfirming] = useState(false);
    if (!confirming && !resetting) {
        return (
            <div>
                <Button
                    type="button"
                    color="red"
                    variant="outline"
                    onClick={() => {
                        setConfirming(true);
                    }}
                >
                    {t('reset_trigger')}
                </Button>
            </div>
        );
    }
    return (
        <div className="nma-reset-confirmation" role="group" aria-label={t('reset_confirm_aria')}>
            <Text size="sm" fw={600}>
                {t('reset_confirm_question')}
            </Text>
            <Text size="xs" c="dimmed">
                {t('reset_confirm_detail')}
            </Text>
            <Group mt="sm">
                <Button
                    type="button"
                    color="red"
                    loading={resetting}
                    disabled={resetting}
                    onClick={() => {
                        setConfirming(false);
                        onConfirm();
                    }}
                >
                    {t('reset_confirm_yes')}
                </Button>
                <Button
                    type="button"
                    variant="default"
                    disabled={resetting}
                    onClick={() => {
                        setConfirming(false);
                    }}
                >
                    {t('reset_confirm_no')}
                </Button>
            </Group>
        </div>
    );
}
