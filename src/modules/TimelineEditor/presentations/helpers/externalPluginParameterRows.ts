import { type ExternalPluginParameter } from '#/modules/PluginHost/stores';

import { type Device } from '../../models/TrackViewTypes';

export type ExternalPluginParameterControlKind = 'toggle' | 'stepped' | 'continuous';

export type ExternalPluginParameterRow = {
    id: number;
    name: string;
    value: number;
    min: number;
    max: number;
    step: number;
    kind: ExternalPluginParameterControlKind;
    /** The number of steps the plugin declares; 0 when it declares none. */
    stepCount: number;
    /** The host reports `value` normalized to 0..1, so a stepped value is shown as its step index. */
    valuesAreNormalized: boolean;
    /** The unit shown beside the value; empty when the plugin declares none or the value is normalized. */
    unit: string;
    /** The plugin's own text for `value`, or the plain number when it offers none. */
    valueText: string;
    /** The plugin's own text for `value`; null when it offers none. */
    displayText: string | null;
    /** The plugin reports this parameter and nobody edits it, such as a meter. */
    readOnly: boolean;
};

const CONTINUOUS_STEPS = 1000;

function classify(parameter: ExternalPluginParameter): ExternalPluginParameterControlKind {
    if (parameter.stepCount === 1) {
        return 'toggle';
    }
    if (parameter.stepCount > 1) {
        return 'stepped';
    }
    return 'continuous';
}

/** One step between neighbouring settings: the span divided by the plugin's step count. */
function stepFor(parameter: ExternalPluginParameter, kind: ExternalPluginParameterControlKind): number {
    const span = parameter.maxValue - parameter.minValue;
    if (kind === 'continuous') {
        return span / CONTINUOUS_STEPS;
    }
    return span / parameter.stepCount;
}

/** A wider range needs fewer decimals to tell neighbouring settings apart. */
function fractionDigitsForSpan(span: number): number {
    const magnitude = Math.abs(span);
    if (magnitude >= 1000) {
        return 0;
    }
    if (magnitude >= 100) {
        return 1;
    }
    if (magnitude >= 10) {
        return 2;
    }
    return 3;
}

function formatNumber(value: number, kind: ExternalPluginParameterControlKind, span: number): string {
    if (kind !== 'continuous' || Number.isInteger(value)) {
        return String(Math.round(value));
    }
    return value.toFixed(fractionDigitsForSpan(span));
}

function formatPlainValue(
    row: Pick<ExternalPluginParameterRow, 'kind' | 'min' | 'max' | 'stepCount' | 'valuesAreNormalized'>,
    value: number
): string {
    if (row.valuesAreNormalized && row.kind !== 'continuous' && row.stepCount > 0) {
        return String(Math.round(value * row.stepCount));
    }
    return formatNumber(value, row.kind, row.max - row.min);
}

/**
 * A value of this row as a plain number, with the unit the row carries when it has one. A normalized
 * stepped value is shown as its step index; rounding the 0..1 value itself would show 0 or 1.
 */
export function formatExternalPluginParameterValue(
    row: Pick<ExternalPluginParameterRow, 'kind' | 'min' | 'max' | 'unit' | 'stepCount' | 'valuesAreNormalized'>,
    value: number
): string {
    const text = formatPlainValue(row, value);
    return row.unit === '' ? text : `${text} ${row.unit}`;
}

export type BuildExternalPluginParameterRowsOptions = {
    /**
     * The host reports this plugin's values normalized to 0..1 (VST3), so the unit the plugin declares
     * describes its plain-domain value, not the number shown, and is left off.
     */
    valuesAreNormalized: boolean;
};

export function buildExternalPluginParameterRows(
    parameters: readonly ExternalPluginParameter[],
    options: BuildExternalPluginParameterRowsOptions = { valuesAreNormalized: false }
): ExternalPluginParameterRow[] {
    return parameters.map((parameter) => {
        const kind = classify(parameter);
        const row = {
            id: parameter.id,
            name: parameter.name,
            value: parameter.value,
            min: parameter.minValue,
            max: parameter.maxValue,
            step: stepFor(parameter, kind),
            kind,
            stepCount: parameter.stepCount,
            valuesAreNormalized: options.valuesAreNormalized,
            unit: options.valuesAreNormalized ? '' : parameter.unit,
            displayText: parameter.displayText,
            readOnly: parameter.isReadOnly,
        };
        return {
            ...row,
            valueText: parameter.displayText ?? formatExternalPluginParameterValue(row, parameter.value),
        };
    });
}

export function filterExternalPluginParameterRows(
    rows: readonly ExternalPluginParameterRow[],
    query: string
): ExternalPluginParameterRow[] {
    const needle = query.trim().toLowerCase();
    if (needle === '') {
        return [...rows];
    }
    return rows.filter((row) => row.name.toLowerCase().includes(needle));
}

export type ExternalPluginParameterStatus =
    | { kind: 'not-loaded'; message: string }
    | { kind: 'loading'; message: string }
    | { kind: 'failed'; message: string }
    | { kind: 'unavailable'; message: string }
    | { kind: 'empty'; message: string }
    | { kind: 'list' };

type ActivationFact = { status: 'loading' | 'active' | 'error'; message?: string } | undefined;

/** Why a device's parameters can or cannot be listed, from the facts the inspector already holds. */
export function resolveExternalPluginParameterStatus(input: {
    device: Pick<Device, 'externalPluginId' | 'externalInstanceId'>;
    pluginSupported: boolean;
    activation: ActivationFact;
    parameterCount: number | undefined;
}): ExternalPluginParameterStatus {
    const { device, pluginSupported, activation, parameterCount } = input;
    if (!device.externalInstanceId || !device.externalPluginId || !pluginSupported || !activation) {
        return { kind: 'not-loaded', message: 'This plugin is not loaded, so its parameters are not listed.' };
    }
    if (activation.status === 'loading') {
        return { kind: 'loading', message: 'Loading this plugin...' };
    }
    if (activation.status === 'error') {
        const reason = activation.message ? `: ${activation.message}` : '.';
        return { kind: 'failed', message: `This plugin failed to load${reason}` };
    }
    if (parameterCount === undefined) {
        return { kind: 'unavailable', message: 'Reading this plugin’s parameters...' };
    }
    if (parameterCount === 0) {
        return { kind: 'empty', message: 'This plugin reports no parameters.' };
    }
    return { kind: 'list' };
}
