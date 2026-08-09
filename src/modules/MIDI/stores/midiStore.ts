import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';
import { type Store } from '#/infra/store/types';

import { type MidiNote, type MidiCC, type MidiPitchBend } from '../models/MidiNote';

const DOC_PREFIX_ROOT = 'root';

export type MidiStoreState = {
    probabilitySeed: number;
    notesByClipId: Record<string, MidiNote[]>;
    ccByClipId: Record<string, MidiCC[]>;
    pitchBendByClipId: Record<string, MidiPitchBend[]>;
    /** Clip ids already converted by migrateAbsoluteMidiNotes — the
     * migration must run exactly once per clip or every project load
     * corrupts notes further (M-144). */
    migratedAbsoluteNoteClipIds?: string[];
};

export type MidiStoreStateInput = Omit<MidiStoreState, 'probabilitySeed'> & {
    probabilitySeed?: number;
};

export const LEGACY_MIDI_PROBABILITY_SEED = 0x6d2b79f5;

export const defaultMidiStoreState: MidiStoreState = {
    probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
    notesByClipId: {},
    ccByClipId: {},
    pitchBendByClipId: {},
};

const MIDI_STORE_STATE_KEYS = ['probabilitySeed', 'notesByClipId', 'ccByClipId', 'pitchBendByClipId'] as const;
const MIDI_STORE_STATE_OPTIONAL_KEYS = ['migratedAbsoluteNoteClipIds'] as const;
const MIDI_NOTE_REQUIRED_KEYS = ['id', 'pitch', 'startBeat', 'duration', 'velocity'] as const;
const MIDI_NOTE_OPTIONAL_KEYS = [
    'probability',
    'pressure',
    'slide',
    'pitchBend',
    'pitchBendRangeSemitones',
    'channel',
] as const;
const MIDI_CC_KEYS = ['id', 'controller', 'value', 'beat', 'channel'] as const;
const MIDI_PITCH_BEND_KEYS = ['id', 'value', 'beat', 'channel'] as const;

type HasExactKeysInput = {
    value: object;
    required_keys: readonly string[];
    optional_keys?: readonly string[];
};

function has_exact_keys({ value, required_keys, optional_keys = [] }: HasExactKeysInput): boolean {
    const value_keys = Object.keys(value);
    const allowed_keys = new Set([...required_keys, ...optional_keys]);

    return required_keys.every((key) => Object.hasOwn(value, key)) && value_keys.every((key) => allowed_keys.has(key));
}

function is_plain_object(value: unknown): value is { [key: string]: unknown } {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function is_finite_number(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

export function isValidMidiProbabilitySeed(value: unknown): value is number {
    return is_finite_number(value) && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

function is_valid_midi_note(value: unknown): value is MidiNote {
    return (
        is_plain_object(value) &&
        'id' in value &&
        typeof value.id === 'string' &&
        'pitch' in value &&
        is_finite_number(value.pitch) &&
        'startBeat' in value &&
        is_finite_number(value.startBeat) &&
        'duration' in value &&
        is_finite_number(value.duration) &&
        'velocity' in value &&
        is_finite_number(value.velocity)
    );
}

function has_valid_midi_note_optionals(value: MidiNote): boolean {
    return (
        (!('probability' in value) || value.probability === undefined || is_finite_number(value.probability)) &&
        (!('pressure' in value) || value.pressure === undefined || is_finite_number(value.pressure)) &&
        (!('slide' in value) || value.slide === undefined || is_finite_number(value.slide)) &&
        (!('pitchBend' in value) || value.pitchBend === undefined || is_finite_number(value.pitchBend)) &&
        (!('pitchBendRangeSemitones' in value) ||
            value.pitchBendRangeSemitones === undefined ||
            is_finite_number(value.pitchBendRangeSemitones)) &&
        (!('channel' in value) || value.channel === undefined || is_finite_number(value.channel))
    );
}

function is_exact_midi_note(value: unknown): value is MidiNote {
    return (
        is_valid_midi_note(value) &&
        has_valid_midi_note_optionals(value) &&
        has_exact_keys({
            value,
            required_keys: MIDI_NOTE_REQUIRED_KEYS,
            optional_keys: MIDI_NOTE_OPTIONAL_KEYS,
        })
    );
}

function normalize_midi_note(note: MidiNote): MidiNote {
    const normalized_note: MidiNote = {
        id: note.id,
        pitch: note.pitch,
        startBeat: note.startBeat,
        duration: note.duration,
        velocity: note.velocity,
    };

    if (is_finite_number(note.probability)) {
        normalized_note.probability = note.probability;
    }
    if (is_finite_number(note.pressure)) {
        normalized_note.pressure = note.pressure;
    }
    if (is_finite_number(note.slide)) {
        normalized_note.slide = note.slide;
    }
    if (is_finite_number(note.pitchBend)) {
        normalized_note.pitchBend = note.pitchBend;
    }
    if (is_finite_number(note.pitchBendRangeSemitones)) {
        normalized_note.pitchBendRangeSemitones = note.pitchBendRangeSemitones;
    }
    if (is_finite_number(note.channel)) {
        normalized_note.channel = note.channel;
    }

    return normalized_note;
}

function is_valid_midi_cc(value: unknown): value is MidiCC {
    return (
        is_plain_object(value) &&
        'id' in value &&
        typeof value.id === 'string' &&
        'controller' in value &&
        is_finite_number(value.controller) &&
        'value' in value &&
        is_finite_number(value.value) &&
        'beat' in value &&
        is_finite_number(value.beat) &&
        'channel' in value &&
        is_finite_number(value.channel)
    );
}

function is_exact_midi_cc(value: unknown): value is MidiCC {
    return is_valid_midi_cc(value) && has_exact_keys({ value, required_keys: MIDI_CC_KEYS });
}

function normalize_midi_cc(event: MidiCC): MidiCC {
    return {
        id: event.id,
        controller: event.controller,
        value: event.value,
        beat: event.beat,
        channel: event.channel,
    };
}

function is_valid_midi_pitch_bend(value: unknown): value is MidiPitchBend {
    return (
        is_plain_object(value) &&
        'id' in value &&
        typeof value.id === 'string' &&
        'value' in value &&
        is_finite_number(value.value) &&
        'beat' in value &&
        is_finite_number(value.beat) &&
        'channel' in value &&
        is_finite_number(value.channel)
    );
}

function is_exact_midi_pitch_bend(value: unknown): value is MidiPitchBend {
    return is_valid_midi_pitch_bend(value) && has_exact_keys({ value, required_keys: MIDI_PITCH_BEND_KEYS });
}

function normalize_midi_pitch_bend(event: MidiPitchBend): MidiPitchBend {
    return {
        id: event.id,
        value: event.value,
        beat: event.beat,
        channel: event.channel,
    };
}

type NormalizeClipMapInput<TRow> = {
    value: unknown;
    is_valid_row: (value: unknown) => value is TRow;
    normalize_row: (value: TRow) => TRow;
};

function normalize_clip_map<TRow>({
    value,
    is_valid_row,
    normalize_row,
}: NormalizeClipMapInput<TRow>): Record<string, TRow[]> {
    if (!is_plain_object(value)) {
        return {};
    }

    const normalized_clip_map: Record<string, TRow[]> = {};

    for (const [clip_id, rows] of Object.entries(value)) {
        if (!Array.isArray(rows)) {
            continue;
        }

        normalized_clip_map[clip_id] = rows.filter(is_valid_row).map(normalize_row);
    }

    return normalized_clip_map;
}

function is_exact_note_clip_map(value: unknown): value is Record<string, MidiNote[]> {
    return (
        is_plain_object(value) &&
        Object.values(value).every((rows) => Array.isArray(rows) && rows.every(is_exact_midi_note))
    );
}

function is_exact_cc_clip_map(value: unknown): value is Record<string, MidiCC[]> {
    return (
        is_plain_object(value) &&
        Object.values(value).every((rows) => Array.isArray(rows) && rows.every(is_exact_midi_cc))
    );
}

function is_exact_pitch_bend_clip_map(value: unknown): value is Record<string, MidiPitchBend[]> {
    return (
        is_plain_object(value) &&
        Object.values(value).every((rows) => Array.isArray(rows) && rows.every(is_exact_midi_pitch_bend))
    );
}

function is_migrated_clip_id_list(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function is_exact_midi_store_state(value: unknown): value is MidiStoreState {
    return (
        is_plain_object(value) &&
        has_exact_keys({
            value,
            required_keys: MIDI_STORE_STATE_KEYS,
            optional_keys: MIDI_STORE_STATE_OPTIONAL_KEYS,
        }) &&
        isValidMidiProbabilitySeed(value.probabilitySeed) &&
        is_exact_note_clip_map(value.notesByClipId) &&
        is_exact_cc_clip_map(value.ccByClipId) &&
        is_exact_pitch_bend_clip_map(value.pitchBendByClipId) &&
        (value.migratedAbsoluteNoteClipIds === undefined || is_migrated_clip_id_list(value.migratedAbsoluteNoteClipIds))
    );
}

export function sanitize_midi_store_state(
    value: unknown,
    probabilitySeedFallback = LEGACY_MIDI_PROBABILITY_SEED
): MidiStoreState {
    if (!is_plain_object(value)) {
        return { ...defaultMidiStoreState, probabilitySeed: probabilitySeedFallback };
    }

    let probabilitySeed = probabilitySeedFallback;
    let candidate = value;
    if (isValidMidiProbabilitySeed(value.probabilitySeed)) {
        probabilitySeed = value.probabilitySeed;
    } else {
        candidate = { ...value, probabilitySeed };
    }
    if (is_exact_midi_store_state(candidate)) {
        return candidate;
    }

    return {
        probabilitySeed,
        notesByClipId: normalize_clip_map({
            value: candidate.notesByClipId,
            is_valid_row: is_valid_midi_note,
            normalize_row: normalize_midi_note,
        }),
        ccByClipId: normalize_clip_map({
            value: candidate.ccByClipId,
            is_valid_row: is_valid_midi_cc,
            normalize_row: normalize_midi_cc,
        }),
        pitchBendByClipId: normalize_clip_map({
            value: candidate.pitchBendByClipId,
            is_valid_row: is_valid_midi_pitch_bend,
            normalize_row: normalize_midi_pitch_bend,
        }),
        ...(is_migrated_clip_id_list(candidate.migratedAbsoluteNoteClipIds)
            ? { migratedAbsoluteNoteClipIds: candidate.migratedAbsoluteNoteClipIds }
            : {}),
    };
}

// `trySet` is omitted rather than forwarded. Its boolean means "durable at the
// moment of the call", and this store is Automerge-backed: `set` only records a
// pending write that `preparePendingWrite` can later abandon, so the honest
// answer here is always `false`. `createStore` already reports exactly that for
// any adapter that did not opt in, which makes forwarding it a method that
// cannot tell a caller anything. Add it if a caller ever has a use for the
// answer. See #1557.
type MidiStore = Omit<Store<MidiStoreState>, 'set' | 'update' | 'trySet'> & {
    set(value: MidiStoreStateInput | null): void;
    update(updater: (current: MidiStoreState | null) => MidiStoreStateInput | null): void;
};

const runtimeMidiStore = createStore<MidiStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'midi', {
        hydrateMissing: () => defaultMidiStoreState,
    }),
    initialData: defaultMidiStoreState,
    sanitize: sanitize_midi_store_state,
});

export const midiStore: MidiStore = {
    get value(): MidiStoreState | null {
        return runtimeMidiStore.value;
    },

    set(value: MidiStoreStateInput | null): void {
        if (value === null) {
            runtimeMidiStore.set(null);
            return;
        }
        const probabilitySeedFallback = runtimeMidiStore.value?.probabilitySeed ?? LEGACY_MIDI_PROBABILITY_SEED;
        runtimeMidiStore.set(sanitize_midi_store_state(value, probabilitySeedFallback));
    },

    update(updater: (current: MidiStoreState | null) => MidiStoreStateInput | null): void {
        midiStore.set(updater(runtimeMidiStore.value));
    },

    clear(): void {
        runtimeMidiStore.clear();
    },

    hydrate(): void {
        runtimeMidiStore.hydrate();
    },

    subscribe(callback: (value: MidiStoreState | null) => void): () => void {
        return runtimeMidiStore.subscribe(callback);
    },

    subscribeReact(listener: () => void): () => void {
        return runtimeMidiStore.subscribeReact(listener);
    },

    getSnapshot(): MidiStoreState | null {
        return runtimeMidiStore.getSnapshot();
    },
};
