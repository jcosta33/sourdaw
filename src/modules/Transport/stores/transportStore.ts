import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import { defaultTransportState, type TransportState } from '../models/TransportState';

export { defaultTransportState, type TransportState };

const DOC_PREFIX_ROOT = 'root';
export const MIN_TEMPO = 20;
export const MAX_TEMPO = 300;
const MIN_TIME_SIGNATURE_NUMERATOR = 1;
const MAX_TIME_SIGNATURE_NUMERATOR = 32;
const MIN_BARS = 1;
const MAX_BARS = 8;

const RUNTIME_TRANSPORT_KEYS = [
    'isPlaying',
    'isRecording',
    'overdubEnabled',
    'playheadPosition',
    'scheduleGrainMs',
] as const;

const DURABLE_TRANSPORT_KEYS = [
    'tempo',
    'timeSignatureNumerator',
    'timeSignatureDenominator',
    'isLooping',
    'loopStart',
    'loopEnd',
    'metronomeEnabled',
    'metronomeVolume',
    'punchInEnabled',
    'punchInBeat',
    'punchOutBeat',
    'countInEnabled',
    'countInBars',
    'preRollEnabled',
    'preRollBars',
    'masterGain',
] as const;

const TRANSPORT_STATE_KEYS = [...RUNTIME_TRANSPORT_KEYS, ...DURABLE_TRANSPORT_KEYS] as const;

type OwnValue = { found: true; value: unknown } | { found: false };

type ApplyDurableFieldInput<TValue> = {
    source: object;
    key: (typeof DURABLE_TRANSPORT_KEYS)[number];
    is_valid: (value: unknown) => value is TValue;
    assign_value: (value: TValue) => void;
};

type GetOwnValueInput = {
    value: object;
    key: string;
};

type HasExactKeysInput = {
    value: object;
    keys: readonly string[];
};

type HasTransportStateValuesInput = {
    value: object;
    state: TransportState;
};

function create_default_transport_state(): TransportState {
    return { ...defaultTransportState };
}

function is_transport_object(value: unknown): value is object {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function get_own_value(input: GetOwnValueInput): OwnValue {
    const descriptor = Object.getOwnPropertyDescriptor(input.value, input.key);
    if (!descriptor) {
        return { found: false };
    }

    if (!('value' in descriptor)) {
        return { found: true, value: undefined };
    }

    return { found: true, value: descriptor.value };
}

function has_exact_keys(input: HasExactKeysInput): boolean {
    const value_keys = Object.keys(input.value);
    return value_keys.length === input.keys.length && input.keys.every((key) => Object.hasOwn(input.value, key));
}

function is_finite_number(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function is_valid_tempo(value: unknown): value is number {
    return is_finite_number(value) && value >= MIN_TEMPO && value <= MAX_TEMPO;
}

function is_valid_time_signature_numerator(value: unknown): value is number {
    return (
        is_finite_number(value) &&
        Number.isInteger(value) &&
        value >= MIN_TIME_SIGNATURE_NUMERATOR &&
        value <= MAX_TIME_SIGNATURE_NUMERATOR
    );
}

function is_valid_time_signature_denominator(value: unknown): value is number {
    return value === 2 || value === 4 || value === 8 || value === 16;
}

function is_boolean(value: unknown): value is boolean {
    return typeof value === 'boolean';
}

function is_non_negative_finite_number(value: unknown): value is number {
    return is_finite_number(value) && value >= 0;
}

function is_unit_interval_number(value: unknown): value is number {
    return is_finite_number(value) && value >= 0 && value <= 1;
}

function is_valid_bar_count(value: unknown): value is number {
    return is_finite_number(value) && Number.isInteger(value) && value >= MIN_BARS && value <= MAX_BARS;
}

// Per-field fallback: an absent or invalid field simply leaves `next_state`'s
// seeded default in place. Nothing here can fail the overall normalization —
// one bad field must not wipe every other durable setting in the snapshot.
function apply_durable_field<TValue>(input: ApplyDurableFieldInput<TValue>): void {
    const property = get_own_value({ value: input.source, key: input.key });
    if (!property.found) {
        return;
    }

    if (!input.is_valid(property.value)) {
        return;
    }

    input.assign_value(property.value);
}

function has_valid_loop_configuration(state: TransportState): boolean {
    if (state.loopEnd < state.loopStart) {
        return false;
    }

    if (state.isLooping && state.loopEnd <= state.loopStart) {
        return false;
    }

    return true;
}

function has_valid_punch_configuration(state: TransportState): boolean {
    return state.punchOutBeat > state.punchInBeat;
}

function normalize_transport_object(value: object): TransportState {
    const next_state = create_default_transport_state();

    apply_durable_field({
        source: value,
        key: 'tempo',
        is_valid: is_valid_tempo,
        assign_value: (tempo) => {
            next_state.tempo = tempo;
        },
    });
    apply_durable_field({
        source: value,
        key: 'timeSignatureNumerator',
        is_valid: is_valid_time_signature_numerator,
        assign_value: (numerator) => {
            next_state.timeSignatureNumerator = numerator;
        },
    });
    apply_durable_field({
        source: value,
        key: 'timeSignatureDenominator',
        is_valid: is_valid_time_signature_denominator,
        assign_value: (denominator) => {
            next_state.timeSignatureDenominator = denominator;
        },
    });
    apply_durable_field({
        source: value,
        key: 'isLooping',
        is_valid: is_boolean,
        assign_value: (is_looping) => {
            next_state.isLooping = is_looping;
        },
    });
    apply_durable_field({
        source: value,
        key: 'loopStart',
        is_valid: is_non_negative_finite_number,
        assign_value: (loop_start) => {
            next_state.loopStart = loop_start;
        },
    });
    apply_durable_field({
        source: value,
        key: 'loopEnd',
        is_valid: is_non_negative_finite_number,
        assign_value: (loop_end) => {
            next_state.loopEnd = loop_end;
        },
    });
    apply_durable_field({
        source: value,
        key: 'metronomeEnabled',
        is_valid: is_boolean,
        assign_value: (metronome_enabled) => {
            next_state.metronomeEnabled = metronome_enabled;
        },
    });
    apply_durable_field({
        source: value,
        key: 'metronomeVolume',
        is_valid: is_unit_interval_number,
        assign_value: (metronome_volume) => {
            next_state.metronomeVolume = metronome_volume;
        },
    });
    apply_durable_field({
        source: value,
        key: 'punchInEnabled',
        is_valid: is_boolean,
        assign_value: (punch_in_enabled) => {
            next_state.punchInEnabled = punch_in_enabled;
        },
    });
    apply_durable_field({
        source: value,
        key: 'punchInBeat',
        is_valid: is_non_negative_finite_number,
        assign_value: (punch_in_beat) => {
            next_state.punchInBeat = punch_in_beat;
        },
    });
    apply_durable_field({
        source: value,
        key: 'punchOutBeat',
        is_valid: is_non_negative_finite_number,
        assign_value: (punch_out_beat) => {
            next_state.punchOutBeat = punch_out_beat;
        },
    });
    apply_durable_field({
        source: value,
        key: 'countInEnabled',
        is_valid: is_boolean,
        assign_value: (count_in_enabled) => {
            next_state.countInEnabled = count_in_enabled;
        },
    });
    apply_durable_field({
        source: value,
        key: 'countInBars',
        is_valid: is_valid_bar_count,
        assign_value: (count_in_bars) => {
            next_state.countInBars = count_in_bars;
        },
    });
    apply_durable_field({
        source: value,
        key: 'preRollEnabled',
        is_valid: is_boolean,
        assign_value: (pre_roll_enabled) => {
            next_state.preRollEnabled = pre_roll_enabled;
        },
    });
    apply_durable_field({
        source: value,
        key: 'preRollBars',
        is_valid: is_valid_bar_count,
        assign_value: (pre_roll_bars) => {
            next_state.preRollBars = pre_roll_bars;
        },
    });
    apply_durable_field({
        source: value,
        key: 'masterGain',
        is_valid: is_non_negative_finite_number,
        assign_value: (master_gain) => {
            next_state.masterGain = master_gain;
        },
    });

    // Cross-field invariants narrow to only the fields they own: an invalid
    // loop pair must not wipe punch/tempo/etc, and vice versa.
    if (!has_valid_loop_configuration(next_state)) {
        next_state.isLooping = defaultTransportState.isLooping;
        next_state.loopStart = defaultTransportState.loopStart;
        next_state.loopEnd = defaultTransportState.loopEnd;
    }

    if (!has_valid_punch_configuration(next_state)) {
        next_state.punchInEnabled = defaultTransportState.punchInEnabled;
        next_state.punchInBeat = defaultTransportState.punchInBeat;
        next_state.punchOutBeat = defaultTransportState.punchOutBeat;
    }

    return next_state;
}

function has_transport_state_values(input: HasTransportStateValuesInput): boolean {
    return TRANSPORT_STATE_KEYS.every((key) => {
        const property = get_own_value({ value: input.value, key });
        return property.found && property.value === input.state[key];
    });
}

function is_exact_clean_transport_state(value: unknown): value is TransportState {
    if (!is_transport_object(value)) {
        return false;
    }

    if (!has_exact_keys({ value, keys: TRANSPORT_STATE_KEYS })) {
        return false;
    }

    const normalized = normalize_transport_object(value);
    return has_transport_state_values({ value, state: normalized });
}

export function sanitize_transport_snapshot(value: unknown): TransportState {
    if (!is_transport_object(value)) {
        return create_default_transport_state();
    }

    return normalize_transport_object(value);
}

function sanitize_transport_state(value: unknown): TransportState {
    if (is_exact_clean_transport_state(value)) {
        return value;
    }

    return sanitize_transport_snapshot(value);
}

export const transportStore = createStore<TransportState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'transport', {
        fromCrdt: sanitize_transport_state,
        // Audit CC-2 — projection default for a document without this slot, so
        // hydrate never writes the previous project's cache back into truth.
        hydrateMissing: () => defaultTransportState,
        toCrdt: ({
            tempo,
            timeSignatureNumerator,
            timeSignatureDenominator,
            isLooping,
            loopStart,
            loopEnd,
            metronomeEnabled,
            metronomeVolume,
            punchInEnabled,
            punchInBeat,
            punchOutBeat,
            countInEnabled,
            countInBars,
            preRollEnabled,
            preRollBars,
            masterGain,
        }) => ({
            tempo,
            timeSignatureNumerator,
            timeSignatureDenominator,
            isLooping,
            loopStart,
            loopEnd,
            metronomeEnabled,
            metronomeVolume,
            punchInEnabled,
            punchInBeat,
            punchOutBeat,
            countInEnabled,
            countInBars,
            preRollEnabled,
            preRollBars,
            masterGain,
        }),
    }),
    initialData: defaultTransportState,
    sanitize: sanitize_transport_state,
});
