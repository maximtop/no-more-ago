/**
 * @file Edits independent absolute-label and age-based precision choices.
 */

import {
    Button, Group, NativeSelect, NumberInput, Stack, Switch, Text,
} from '@mantine/core';

import { t } from '../shared/i18n/translator';
import {
    DATE_PRECISION,
    DATE_PRECISIONS,
    MAX_AGE_RANGES,
    type PrecisionPolicy,
    type DatePrecision,
} from '../shared/settings/precision-policy';

import type { ReactElement } from 'react';

/**
 * Localized names of precision choices.
 */
const PRECISION_KEYS = {
    [DATE_PRECISION.SECONDS]: 'display_precision_seconds',
    [DATE_PRECISION.MINUTES]: 'display_precision_minutes',
    [DATE_PRECISION.DAY]: 'display_precision_day',
    [DATE_PRECISION.YEAR]: 'display_precision_year',
} as const;

/**
 * Properties for the precision policy editor.
 */
interface PrecisionControlsProps {
    /**
     * Current unsaved policy.
     */
    readonly policy: PrecisionPolicy;

    /**
     * Whether a settings write is in progress.
     */
    readonly disabled: boolean;

    /**
     * Updates the draft owned by the display state machine.
     */
    readonly onChange: (policy: PrecisionPolicy) => void;
}

/**
 * Renders a bounded age-range editor and independent opt-in switches.
 *
 * @param props - Current draft, persistence state, and edit callback.
 * @param props.policy - Current policy.
 * @param props.disabled - Whether saving prevents edits.
 * @param props.onChange - Draft update callback.
 *
 * @returns - Precision settings controls.
 */
export function PrecisionControls({
    policy, disabled, onChange,
}: PrecisionControlsProps): ReactElement {
    const choices = DATE_PRECISIONS.map((precision) => ({
        value: precision, label: t(PRECISION_KEYS[precision]),
    }));
    return (
        <Stack gap="md">
            <Switch
                label={t('display_absolute_label')}
                description={t('display_absolute_hint')}
                checked={policy.absoluteLabels}
                disabled={disabled}
                onChange={(event) => {
                    onChange({
                        ...policy, absoluteLabels: event.currentTarget.checked,
                    });
                }}
            />
            <Switch
                label={t('display_age_label')}
                description={t('display_age_hint')}
                checked={policy.agePrecision}
                disabled={disabled}
                onChange={(event) => {
                    onChange({
                        ...policy, agePrecision: event.currentTarget.checked,
                    });
                }}
            />
            {policy.agePrecision ? (
                <Stack gap="sm">
                    <Text size="sm" c="dimmed">{t('display_age_custom_hint')}</Text>
                    {policy.ranges.map((range, index) => (
                        <Group key={index} align="end" grow>
                            <NumberInput
                                label={t('display_age_hours')}
                                aria-label={`${t('display_age_hours')} ${String(index + 1)}`}
                                value={range.hours || ''}
                                disabled={disabled}
                                min={0}
                                onChange={(value) => {
                                    onChange({
                                        ...policy,
                                        ranges: policy.ranges.map((item, position) => (position === index
                                            ? { ...item, hours: Number(value) } : item)),
                                    });
                                }}
                            />
                            <NativeSelect
                                label={t('display_age_precision')}
                                aria-label={`${t('display_age_precision')} ${String(index + 1)}`}
                                value={range.precision}
                                disabled={disabled}
                                data={choices}
                                onChange={(event) => {
                                    onChange({
                                        ...policy,
                                        ranges: policy.ranges.map((item, position) => (position === index
                                            ? {
                                                ...item,
                                                precision: (
                                                    event.currentTarget.value as DatePrecision
                                                ),
                                            } : item)),
                                    });
                                }}
                            />
                            <Button
                                variant="subtle"
                                disabled={disabled || policy.ranges.length === 1}
                                onClick={() => {
                                    onChange({
                                        ...policy,
                                        ranges: policy.ranges.filter(
                                            (_, position) => position !== index,
                                        ),
                                    });
                                }}
                            >
                                {t('display_age_remove')}
                            </Button>
                        </Group>
                    ))}
                    <Button
                        variant="light"
                        disabled={disabled || policy.ranges.length >= MAX_AGE_RANGES}
                        onClick={() => {
                            onChange({
                                ...policy,
                                ranges: [...policy.ranges, {
                                    hours: (policy.ranges.at(-1)?.hours ?? 0) + 24,
                                    precision: policy.older,
                                }],
                            });
                        }}
                    >
                        {t('display_age_add')}
                    </Button>
                    <NativeSelect
                        label={t('display_age_older')}
                        value={policy.older}
                        disabled={disabled}
                        data={choices}
                        onChange={(event) => {
                            onChange({
                                ...policy, older: event.currentTarget.value as typeof policy.older,
                            });
                        }}
                    />
                </Stack>
            ) : null}
        </Stack>
    );
}
