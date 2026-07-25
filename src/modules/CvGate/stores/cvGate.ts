/**
 * CV/Gate output store — modular synth control via DC-coupled audio interfaces.
 *
 * Extracted from cvGateUseCases.ts
 */

import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

export type VoltageStandard = '1v-per-octave' | 'hz-per-volt';

export type CvOutputChannel = {
    id: string;
    name: string;
    outputChannel: number;
    type: 'cv-pitch' | 'cv-velocity' | 'cv-modulation' | 'gate' | 'trigger' | 'clock';
    minVoltage: number;
    maxVoltage: number;
    value: number;
    active: boolean;
};

export type CvGateState = {
    outputs: CvOutputChannel[];
    voltageStandard: VoltageStandard;
    clockDivision: number;
    triggerPulseMs: number;
    gateThreshold: number;
};

export const defaultCvGateState: CvGateState = {
    outputs: [],
    voltageStandard: '1v-per-octave',
    clockDivision: 1,
    triggerPulseMs: 5,
    gateThreshold: 1,
};

type UnknownRecord = {
    readonly [key: string]: unknown;
};

const CV_GATE_STATE_KEYS = ['outputs', 'voltageStandard', 'clockDivision', 'triggerPulseMs', 'gateThreshold'] as const;
const CV_OUTPUT_CHANNEL_KEYS = [
    'id',
    'name',
    'outputChannel',
    'type',
    'minVoltage',
    'maxVoltage',
    'value',
    'active',
] as const;

type HasExactKeysInput = {
    value: object;
    keys: readonly string[];
};

function has_exact_keys(input: HasExactKeysInput): boolean {
    const value_keys = Object.keys(input.value);
    return value_keys.length === input.keys.length && input.keys.every((key) => Object.hasOwn(input.value, key));
}

function is_record(value: unknown): value is UnknownRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function get_record(value: unknown): UnknownRecord | null {
    return is_record(value) ? value : null;
}

function is_finite_number(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function is_voltage_standard(value: unknown): value is VoltageStandard {
    return value === '1v-per-octave' || value === 'hz-per-volt';
}

function is_cv_output_type(value: unknown): value is CvOutputChannel['type'] {
    return (
        value === 'cv-pitch' ||
        value === 'cv-velocity' ||
        value === 'cv-modulation' ||
        value === 'gate' ||
        value === 'trigger' ||
        value === 'clock'
    );
}

function is_valid_cv_output_channel(value: unknown): value is CvOutputChannel {
    const record = get_record(value);

    return (
        record !== null &&
        typeof record.id === 'string' &&
        typeof record.name === 'string' &&
        is_finite_number(record.outputChannel) &&
        is_cv_output_type(record.type) &&
        is_finite_number(record.minVoltage) &&
        is_finite_number(record.maxVoltage) &&
        is_finite_number(record.value) &&
        typeof record.active === 'boolean'
    );
}

function normalize_cv_output_channel(output: CvOutputChannel): CvOutputChannel {
    return {
        id: output.id,
        name: output.name,
        outputChannel: output.outputChannel,
        type: output.type,
        minVoltage: output.minVoltage,
        maxVoltage: output.maxVoltage,
        value: output.value,
        active: output.active,
    };
}

function is_exact_cv_gate_state(value: unknown): value is CvGateState {
    const record = get_record(value);

    return (
        record !== null &&
        has_exact_keys({ value: record, keys: CV_GATE_STATE_KEYS }) &&
        Array.isArray(record.outputs) &&
        record.outputs.every(
            (output) =>
                is_valid_cv_output_channel(output) && has_exact_keys({ value: output, keys: CV_OUTPUT_CHANNEL_KEYS })
        ) &&
        is_voltage_standard(record.voltageStandard) &&
        is_finite_number(record.clockDivision) &&
        is_finite_number(record.triggerPulseMs) &&
        is_finite_number(record.gateThreshold)
    );
}

export function sanitize_cv_gate_state(value: unknown): CvGateState {
    if (is_exact_cv_gate_state(value)) {
        return value;
    }

    const record = get_record(value);
    if (record === null) {
        return defaultCvGateState;
    }

    return {
        outputs: Array.isArray(record.outputs)
            ? record.outputs.filter(is_valid_cv_output_channel).map(normalize_cv_output_channel)
            : [],
        voltageStandard: is_voltage_standard(record.voltageStandard)
            ? record.voltageStandard
            : defaultCvGateState.voltageStandard,
        clockDivision: is_finite_number(record.clockDivision) ? record.clockDivision : defaultCvGateState.clockDivision,
        triggerPulseMs: is_finite_number(record.triggerPulseMs)
            ? record.triggerPulseMs
            : defaultCvGateState.triggerPulseMs,
        gateThreshold: is_finite_number(record.gateThreshold) ? record.gateThreshold : defaultCvGateState.gateThreshold,
    };
}

export const cvGateStore = createStore<CvGateState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'cvGate', {
        // Audit CC-2 — projection default for a document without this slot, so
        // hydrate never writes the previous project's cache back into truth.
        hydrateMissing: () => defaultCvGateState,
    }),
    initialData: defaultCvGateState,
    sanitize: sanitize_cv_gate_state,
});

// §122.1 — UUID instead of module-level counter that reset on HMR.
export function getNextOutputId(): string {
    return `cv-${crypto.randomUUID()}`;
}

export const VOLTAGE_RANGES: Record<CvOutputChannel['type'], [number, number]> = {
    'cv-pitch': [-2, 8],
    'cv-velocity': [0, 5],
    'cv-modulation': [0, 5],
    gate: [0, 5],
    trigger: [0, 5],
    clock: [0, 5],
};
