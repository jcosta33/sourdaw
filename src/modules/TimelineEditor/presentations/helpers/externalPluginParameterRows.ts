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

function formatNumber(value: number, kind: ExternalPluginParameterControlKind, span: number): string {
    if (kind !== 'continuous' || Number.isInteger(value)) {
        return String(Math.round(value));
    }
    const magnitude = Math.abs(span);
    const digits = magnitude >= 1000 ? 0 : magnitude >= 100 ? 1 : magnitude >= 10 ? 2 : 3;
    return value.toFixed(digits);
}

/** The value as a plain number, with the plugin's unit when it declares one. */
export function formatExternalPluginParameterValue(
    parameter: ExternalPluginParameter,
    kind: ExternalPluginParameterControlKind
): string {
    const text = formatNumber(parameter.value, kind, parameter.maxValue - parameter.minValue);
    return parameter.unit === '' ? text : `${text} ${parameter.unit}`;
}

export function buildExternalPluginParameterRows(
    parameters: readonly ExternalPluginParameter[],
    scanParameters: readonly ExternalPluginParameterScanFacts[] | undefined
): ExternalPluginParameterRow[] {
    const scanById = new Map((scanParameters ?? []).map((scan) => [scan.id, scan]));
    return parameters.map((parameter) => {
        const kind = classify(parameter, scanById.get(parameter.id));
        const span = parameter.maxValue - parameter.minValue;
        return {
            id: parameter.id,
            name: parameter.name,
            value: parameter.value,
            min: parameter.minValue,
            max: parameter.maxValue,
            step: kind === 'continuous' ? span / CONTINUOUS_STEPS : 1,
            kind,
            valueText: formatExternalPluginParameterValue(parameter, kind),
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
