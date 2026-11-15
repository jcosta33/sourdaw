import { type ExternalPluginParameter } from '#/modules/PluginHost/stores';

import { type Device } from '../../models/TrackViewTypes';

/** Scan-time facts about one parameter that the live snapshot does not carry. */
export type ExternalPluginParameterScanFacts = {
    id: number;
    is_stepped: boolean;
    is_enum: boolean;
};

export type ExternalPluginParameterControlKind = 'toggle' | 'stepped' | 'continuous';

export type ExternalPluginParameterRow = {
    id: number;
    name: string;
    value: number;
    min: number;
    max: number;
    step: number;
    kind: ExternalPluginParameterControlKind;
    /** The unit shown beside the value; empty when the plugin declares none or the value is normalized. */
    unit: string;
    valueText: string;
};

const CONTINUOUS_STEPS = 1000;

function classify(
    parameter: ExternalPluginParameter,
    scan: ExternalPluginParameterScanFacts | undefined
): ExternalPluginParameterControlKind {
    if (!scan || !(scan.is_stepped || scan.is_enum)) {
        return 'continuous';
    }
    const span = parameter.maxValue - parameter.minValue;
    if (span === 1 && Number.isInteger(parameter.minValue) && Number.isInteger(parameter.maxValue)) {
        return 'toggle';
    }
    return 'stepped';
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

/** A value of this row as a plain number, with the unit the row carries when it has one. */
export function formatExternalPluginParameterValue(
    row: Pick<ExternalPluginParameterRow, 'kind' | 'min' | 'max' | 'unit'>,
    value: number
): string {
    const text = formatNumber(value, row.kind, row.max - row.min);
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
    scanParameters: readonly ExternalPluginParameterScanFacts[] | undefined,
    options: BuildExternalPluginParameterRowsOptions = { valuesAreNormalized: false }
): ExternalPluginParameterRow[] {
    const scanById = new Map((scanParameters ?? []).map((scan) => [scan.id, scan]));
    return parameters.map((parameter) => {
        const kind = classify(parameter, scanById.get(parameter.id));
        const span = parameter.maxValue - parameter.minValue;
        const row = {
            id: parameter.id,
            name: parameter.name,
            value: parameter.value,
            min: parameter.minValue,
            max: parameter.maxValue,
            step: kind === 'continuous' ? span / CONTINUOUS_STEPS : 1,
            kind,
            unit: options.valuesAreNormalized ? '' : parameter.unit,
        };
        return { ...row, valueText: formatExternalPluginParameterValue(row, parameter.value) };
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
