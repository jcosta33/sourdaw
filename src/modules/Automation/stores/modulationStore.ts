import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import {
    type EnvelopeModulator,
    type LfoModulator,
    type LfoWaveform,
    type Modulator,
    type ModulatorKind,
    type ModulatorMapping,
    type StepModulator,
} from '../models/Modulator';

const DOC_PREFIX_ROOT = 'root';

export type ModulationStoreState = {
    modulators: Modulator[];
};

export const defaultModulationStoreState: ModulationStoreState = {
    modulators: [],
};

const MODULATION_STORE_STATE_KEYS = ['modulators'] as const;
const MODULATOR_KEYS = ['id', 'name', 'trackId', 'kind', 'config', 'mappings', 'enabled'] as const;
const LFO_CONFIG_KEYS = ['kind', 'waveform', 'rate', 'sync', 'phase', 'depth'] as const;
const ENVELOPE_CONFIG_KEYS = ['kind', 'attack', 'decay', 'sustain', 'release', 'triggerMode'] as const;
const STEP_CONFIG_KEYS = ['kind', 'steps', 'rate', 'smooth'] as const;
const MAPPING_KEYS = ['targetTrackId', 'targetDeviceId', 'targetParamId', 'amount'] as const;

function has_exact_keys(value: object, keys: readonly string[]): boolean {
    const value_keys = Object.keys(value);
    return value_keys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function is_unknown_array(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function is_finite_number(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function get_modulator_values(value: unknown): unknown[] | null {
    if (value === null || typeof value !== 'object') {
        return null;
    }

    if (!('modulators' in value) || !is_unknown_array(value.modulators)) {
        return null;
    }

    return value.modulators;
}

function is_modulator_kind(value: unknown): value is ModulatorKind {
    return value === 'lfo' || value === 'envelope' || value === 'step';
}

function is_lfo_waveform(value: unknown): value is LfoWaveform {
    return value === 'sine' || value === 'square' || value === 'saw' || value === 'triangle' || value === 'random';
}

function is_trigger_mode(value: unknown): value is EnvelopeModulator['triggerMode'] {
    return value === 'midi' || value === 'audio' || value === 'sync';
}

function is_valid_lfo_config(value: unknown): value is LfoModulator {
    return (
        value !== null &&
        typeof value === 'object' &&
        'kind' in value &&
        value.kind === 'lfo' &&
        'waveform' in value &&
        is_lfo_waveform(value.waveform) &&
        'rate' in value &&
        is_finite_number(value.rate) &&
        'sync' in value &&
        typeof value.sync === 'boolean' &&
        'phase' in value &&
        is_finite_number(value.phase) &&
        'depth' in value &&
        is_finite_number(value.depth)
    );
}

function is_valid_envelope_config(value: unknown): value is EnvelopeModulator {
    return (
        value !== null &&
        typeof value === 'object' &&
        'kind' in value &&
        value.kind === 'envelope' &&
        'attack' in value &&
        is_finite_number(value.attack) &&
        'decay' in value &&
        is_finite_number(value.decay) &&
        'sustain' in value &&
        is_finite_number(value.sustain) &&
        'release' in value &&
        is_finite_number(value.release) &&
        'triggerMode' in value &&
        is_trigger_mode(value.triggerMode)
    );
}

function is_valid_step_config(value: unknown): value is StepModulator {
    return (
        value !== null &&
        typeof value === 'object' &&
        'kind' in value &&
        value.kind === 'step' &&
        'steps' in value &&
        is_unknown_array(value.steps) &&
        value.steps.every(is_finite_number) &&
        'rate' in value &&
        is_finite_number(value.rate) &&
        'smooth' in value &&
        is_finite_number(value.smooth)
    );
}

function is_exact_modulator_config(value: Modulator['config']): boolean {
    if (value.kind === 'lfo') {
        return has_exact_keys(value, LFO_CONFIG_KEYS);
    }
    if (value.kind === 'envelope') {
        return has_exact_keys(value, ENVELOPE_CONFIG_KEYS);
    }
    return has_exact_keys(value, STEP_CONFIG_KEYS);
}

function normalize_modulator_config(config: Modulator['config']): Modulator['config'] {
    if (config.kind === 'lfo') {
        return {
            kind: config.kind,
            waveform: config.waveform,
            rate: config.rate,
            sync: config.sync,
            phase: config.phase,
            depth: config.depth,
        };
    }

    if (config.kind === 'envelope') {
        return {
            kind: config.kind,
            attack: config.attack,
            decay: config.decay,
            sustain: config.sustain,
            release: config.release,
            triggerMode: config.triggerMode,
        };
    }

    return {
        kind: config.kind,
        steps: [...config.steps],
        rate: config.rate,
        smooth: config.smooth,
    };
}

function is_valid_modulator_mapping(value: unknown): value is ModulatorMapping {
    return (
        value !== null &&
        typeof value === 'object' &&
        'targetTrackId' in value &&
        typeof value.targetTrackId === 'string' &&
        'targetDeviceId' in value &&
        typeof value.targetDeviceId === 'string' &&
        'targetParamId' in value &&
        typeof value.targetParamId === 'string' &&
        'amount' in value &&
        is_finite_number(value.amount)
    );
}

function is_exact_modulator_mapping(value: unknown): value is ModulatorMapping {
    return is_valid_modulator_mapping(value) && has_exact_keys(value, MAPPING_KEYS);
}

function normalize_modulator_mapping(mapping: ModulatorMapping): ModulatorMapping {
    return {
        targetTrackId: mapping.targetTrackId,
        targetDeviceId: mapping.targetDeviceId,
        targetParamId: mapping.targetParamId,
        amount: mapping.amount,
    };
}

function is_valid_modulator(value: unknown): value is Modulator {
    return (
        value !== null &&
        typeof value === 'object' &&
        'id' in value &&
        typeof value.id === 'string' &&
        'name' in value &&
        typeof value.name === 'string' &&
        'trackId' in value &&
        typeof value.trackId === 'string' &&
        value.trackId.length > 0 &&
        'kind' in value &&
        is_modulator_kind(value.kind) &&
        'config' in value &&
        (is_valid_lfo_config(value.config) ||
            is_valid_envelope_config(value.config) ||
            is_valid_step_config(value.config)) &&
        value.config.kind === value.kind &&
        'mappings' in value &&
        is_unknown_array(value.mappings) &&
        'enabled' in value &&
        typeof value.enabled === 'boolean'
    );
}

function is_exact_modulator(value: unknown): value is Modulator {
    return (
        is_valid_modulator(value) &&
        has_exact_keys(value, MODULATOR_KEYS) &&
        is_exact_modulator_config(value.config) &&
        value.mappings.every(is_exact_modulator_mapping)
    );
}

function normalize_modulator(modulator: Modulator): Modulator {
    return {
        id: modulator.id,
        name: modulator.name,
        trackId: modulator.trackId,
        kind: modulator.kind,
        config: normalize_modulator_config(modulator.config),
        mappings: modulator.mappings.filter(is_valid_modulator_mapping).map(normalize_modulator_mapping),
        enabled: modulator.enabled,
    };
}

function is_exact_modulation_store_state(value: unknown): value is ModulationStoreState {
    const modulators = get_modulator_values(value);

    return (
        value !== null &&
        typeof value === 'object' &&
        has_exact_keys(value, MODULATION_STORE_STATE_KEYS) &&
        modulators !== null &&
        modulators.every(is_exact_modulator)
    );
}

export function sanitize_modulation_store_state(value: unknown): ModulationStoreState {
    if (is_exact_modulation_store_state(value)) {
        return value;
    }

    const modulators = get_modulator_values(value);
    if (modulators === null) {
        return defaultModulationStoreState;
    }

    return {
        modulators: modulators.filter(is_valid_modulator).map(normalize_modulator),
    };
}

/**
 * A modulator mapping carries no id of its own — it is identified by the
 * parameter it targets. Naming that identity lets two peers map different
 * parameters of the same modulator without overwriting each other.
 */
function modulator_mapping_identity(row: Record<string, unknown>): string | null {
    const { targetTrackId, targetDeviceId, targetParamId } = row;
    if (typeof targetTrackId !== 'string' || typeof targetDeviceId !== 'string') {
        return null;
    }
    if (typeof targetParamId !== 'string') {
        return null;
    }
    return [targetTrackId, targetDeviceId, targetParamId].join(' ');
}

export const modulationStore = createStore<ModulationStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'modulation', {
        crdtEntityIdentity: {
            mappings: modulator_mapping_identity,
        },
        // A document without the `modulation` slot (fresh or legacy project)
        // resets the store to its empty default rather than back-writing the
        // stale cache into the new document — projection stays a pure reader,
        // never a second writer (audit CC-2).
        hydrateMissing: () => ({ modulators: [] }),
    }),
    initialData: defaultModulationStoreState,
    sanitize: sanitize_modulation_store_state,
});

/** Ephemeral runtime values for modulators (0..1), updated at 30fps. Not persisted. */
export const modulationRuntimeStore = createStore<{ runtimeValues: Record<string, number> }>({
    initialData: {
        runtimeValues: {},
    },
});
