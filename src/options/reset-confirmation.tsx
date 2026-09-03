/**
 * @file Two-step reset action: a destructive trigger followed by an inline confirmation.
 */

import { Button, Group, Text } from "@mantine/core";
import { useState, type ReactElement } from "react";

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
                    Reset all settings
                </Button>
            </div>
        );
    }
    return (
        <div className="reset-confirmation" role="group" aria-label="Confirm reset">
            <Text size="sm" fw={600}>
                Reset every setting to its default?
            </Text>
            <Text size="xs" c="dimmed">
                Both site lists, the run mode, display settings, appearance, and retained debug
                logs will be removed. This cannot be undone.
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
                    Reset everything
                </Button>
                <Button
                    type="button"
                    variant="default"
                    disabled={resetting}
                    onClick={() => {
                        setConfirming(false);
                    }}
                >
                    Keep settings
                </Button>
            </Group>
        </div>
    );
}
