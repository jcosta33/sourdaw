import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';
import { type Store } from '#/infra/store/types';

import { isValidMidiArticulation, type MidiNote, type MidiCC, type MidiPitchBend } from '../models/MidiNote';

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
    'articulation',
] as const;
const MIDI_CC_KEYS = ['id', 'controller', 'value', 'beat', 'channel'] as const;
const MIDI_PITCH_BEND_KEYS = ['id', 'value', 'beat', 'channel'] as const;

type HasExactKeysInput = {
    value: object;
    requiredKeys: readonly string[];
    optionalKeys?: readonly string[];
};

function hasExactKeys({ value, requiredKeys, optionalKeys = [] }: HasExactKeysInput): boolean {
    const valueKeys = Object.keys(value);
    const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);

    return requiredKeys.every((key) => Object.hasOwn(value, key)) && valueKeys.every((key) => allowedKeys.has(key));
}

function isPlainObject(value: unknown): value is { [key: string]: unknown } {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

export function isValidMidiProbabilitySeed(value: unknown): value is number {
    return isFiniteNumber(value) && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

function isValidMidiNote(value: unknown): value is MidiNote {
    return (
        isPlainObject(value) &&
        'id' in value &&
        typeof value.id === 'string' &&
        'pitch' in value &&
        isFiniteNumber(value.pitch) &&
        'startBeat' in value &&
        isFiniteNumber(value.startBeat) &&
        'duration' in value &&
        isFiniteNumber(value.duration) &&
        'velocity' in value &&
        isFiniteNumber(value.velocity)
    );
}

function hasValidMidiNoteOptionals(value: MidiNote): boolean {
    return (
        (!('probability' in value) || value.probability === undefined || isFiniteNumber(value.probability)) &&
        (!('pressure' in value) || value.pressure === undefined || isFiniteNumber(value.pressure)) &&
        (!('slide' in value) || value.slide === undefined || isFiniteNumber(value.slide)) &&
        (!('pitchBend' in value) || value.pitchBend === undefined || isFiniteNumber(value.pitchBend)) &&
        (!('pitchBendRangeSemitones' in value) ||
            value.pitchBendRangeSemitones === undefined ||
            isFiniteNumber(value.pitchBendRangeSemitones)) &&
        (!('channel' in value) || value.channel === undefined || isFiniteNumber(value.channel)) &&
        (!('articulation' in value) || value.articulation === undefined || isValidMidiArticulation(value.articulation))
    );
}

function isExactMidiNote(value: unknown): value is MidiNote {
    return (
        isValidMidiNote(value) &&
        hasValidMidiNoteOptionals(value) &&
        hasExactKeys({
            value,
            requiredKeys: MIDI_NOTE_REQUIRED_KEYS,
            optionalKeys: MIDI_NOTE_OPTIONAL_KEYS,
        })
    );
}

function normalizeMidiNote(note: MidiNote): MidiNote {
    const normalizedNote: MidiNote = {
        id: note.id,
        pitch: note.pitch,
        startBeat: note.startBeat,
        duration: note.duration,
        velocity: note.velocity,
    };

    if (isFiniteNumber(note.probability)) {
        normalizedNote.probability = note.probability;
    }
    if (isFiniteNumber(note.pressure)) {
        normalizedNote.pressure = note.pressure;
    }
    if (isFiniteNumber(note.slide)) {
        normalizedNote.slide = note.slide;
    }
    if (isFiniteNumber(note.pitchBend)) {
        normalizedNote.pitchBend = note.pitchBend;
    }
    if (isFiniteNumber(note.pitchBendRangeSemitones)) {
        normalizedNote.pitchBendRangeSemitones = note.pitchBendRangeSemitones;
    }
    if (isFiniteNumber(note.channel)) {
        normalizedNote.channel = note.channel;
    }
    if (isValidMidiArticulation(note.articulation)) {
        normalizedNote.articulation = note.articulation;
    }

    return normalizedNote;
}

function isValidMidiCc(value: unknown): value is MidiCC {
    return (
        isPlainObject(value) &&
        'id' in value &&
        typeof value.id === 'string' &&
        'controller' in value &&
        isFiniteNumber(value.controller) &&
        'value' in value &&
        isFiniteNumber(value.value) &&
        'beat' in value &&
        isFiniteNumber(value.beat) &&
        'channel' in value &&
        isFiniteNumber(value.channel)
    );
}

function isExactMidiCc(value: unknown): value is MidiCC {
    return isValidMidiCc(value) && hasExactKeys({ value, requiredKeys: MIDI_CC_KEYS });
}

function normalizeMidiCc(event: MidiCC): MidiCC {
    return {
        id: event.id,
        controller: event.controller,
        value: event.value,
        beat: event.beat,
        channel: event.channel,
    };
}

function isValidMidiPitchBend(value: unknown): value is MidiPitchBend {
    return (
        isPlainObject(value) &&
        'id' in value &&
        typeof value.id === 'string' &&
        'value' in value &&
        isFiniteNumber(value.value) &&
        'beat' in value &&
        isFiniteNumber(value.beat) &&
        'channel' in value &&
        isFiniteNumber(value.channel)
    );
}

function isExactMidiPitchBend(value: unknown): value is MidiPitchBend {
    return isValidMidiPitchBend(value) && hasExactKeys({ value, requiredKeys: MIDI_PITCH_BEND_KEYS });
}

function normalizeMidiPitchBend(event: MidiPitchBend): MidiPitchBend {
    return {
        id: event.id,
        value: event.value,
        beat: event.beat,
        channel: event.channel,
    };
}

type NormalizeClipMapInput<TRow> = {
    value: unknown;
    isValidRow: (value: unknown) => value is TRow;
    normalizeRow: (value: TRow) => TRow;
};

function normalizeClipMap<TRow>({
    value,
    isValidRow,
    normalizeRow,
}: NormalizeClipMapInput<TRow>): Record<string, TRow[]> {
    if (!isPlainObject(value)) {
        return {};
    }

    const normalizedClipMap: Record<string, TRow[]> = {};

    for (const [clipId, rows] of Object.entries(value)) {
        if (!Array.isArray(rows)) {
            continue;
        }

        normalizedClipMap[clipId] = rows.filter(isValidRow).map(normalizeRow);
    }

    return normalizedClipMap;
}

function isExactNoteClipMap(value: unknown): value is Record<string, MidiNote[]> {
    return (
        isPlainObject(value) && Object.values(value).every((rows) => Array.isArray(rows) && rows.every(isExactMidiNote))
    );
}

function isExactCcClipMap(value: unknown): value is Record<string, MidiCC[]> {
    return (
        isPlainObject(value) && Object.values(value).every((rows) => Array.isArray(rows) && rows.every(isExactMidiCc))
    );
}

function isExactPitchBendClipMap(value: unknown): value is Record<string, MidiPitchBend[]> {
    return (
        isPlainObject(value) &&
        Object.values(value).every((rows) => Array.isArray(rows) && rows.every(isExactMidiPitchBend))
    );
}

function isMigratedClipIdList(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isExactMidiStoreState(value: unknown): value is MidiStoreState {
    return (
        isPlainObject(value) &&
        hasExactKeys({
            value,
            requiredKeys: MIDI_STORE_STATE_KEYS,
            optionalKeys: MIDI_STORE_STATE_OPTIONAL_KEYS,
        }) &&
        isValidMidiProbabilitySeed(value.probabilitySeed) &&
        isExactNoteClipMap(value.notesByClipId) &&
        isExactCcClipMap(value.ccByClipId) &&
        isExactPitchBendClipMap(value.pitchBendByClipId) &&
        (value.migratedAbsoluteNoteClipIds === undefined || isMigratedClipIdList(value.migratedAbsoluteNoteClipIds))
    );
}

export function sanitizeMidiStoreState(
    value: unknown,
    probabilitySeedFallback = LEGACY_MIDI_PROBABILITY_SEED
): MidiStoreState {
    if (!isPlainObject(value)) {
        return { ...defaultMidiStoreState, probabilitySeed: probabilitySeedFallback };
    }

    let probabilitySeed = probabilitySeedFallback;
    let candidate = value;
    if (isValidMidiProbabilitySeed(value.probabilitySeed)) {
        probabilitySeed = value.probabilitySeed;
    } else {
        candidate = { ...value, probabilitySeed };
    }
    if (isExactMidiStoreState(candidate)) {
        return candidate;
    }

    return {
        probabilitySeed,
        notesByClipId: normalizeClipMap({
            value: candidate.notesByClipId,
            isValidRow: isValidMidiNote,
            normalizeRow: normalizeMidiNote,
        }),
        ccByClipId: normalizeClipMap({
            value: candidate.ccByClipId,
            isValidRow: isValidMidiCc,
            normalizeRow: normalizeMidiCc,
        }),
        pitchBendByClipId: normalizeClipMap({
            value: candidate.pitchBendByClipId,
            isValidRow: isValidMidiPitchBend,
            normalizeRow: normalizeMidiPitchBend,
        }),
        ...(isMigratedClipIdList(candidate.migratedAbsoluteNoteClipIds)
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
    sanitize: sanitizeMidiStoreState,
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
        runtimeMidiStore.set(sanitizeMidiStoreState(value, probabilitySeedFallback));
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
