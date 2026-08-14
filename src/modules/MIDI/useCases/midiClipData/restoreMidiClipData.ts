import { type MidiCC, type MidiNote, type MidiPitchBend } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';

const INVALID_MIDI_CLIP_DATA_SNAPSHOT = 'Invalid MIDI clip data snapshot';
const MIDI_NOTE_REQUIRED_KEYS = ['id', 'pitch', 'startBeat', 'duration', 'velocity'] as const;
// Must stay in step with `MidiNote` and with the equivalent allowlist in
// `midiStore.ts`. This list had drifted: a note carrying
// `pitchBendRangeSemitones` or `articulation` — both long-standing model
// fields, and both now preserved across a split — failed the exact-keys gate,
// so undo/redo of a cut on such a clip threw instead of restoring.
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

type RestoreMidiClipDataInput = {
    clipId: string;
    notesSnapshot: readonly unknown[] | null;
    controlChangeSnapshot: readonly unknown[] | null;
    pitchBendSnapshot: readonly unknown[] | null;
};

type PlainObject = Record<string, unknown>;

type HasExactKeysInput = {
    value: PlainObject;
    requiredKeys: readonly string[];
    optionalKeys?: readonly string[];
};

type HasValidOptionalNumberInput = {
    value: PlainObject;
    key: string;
};

type ValidateSnapshotInput<TRow> = {
    snapshot: unknown;
    isValidRow: (value: unknown) => value is TRow;
};

function isPlainObject(value: unknown): value is PlainObject {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    const prototype = Reflect.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function hasExactKeys({ value, requiredKeys, optionalKeys = [] }: HasExactKeysInput): boolean {
    const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);

    return (
        requiredKeys.every((key) => Object.hasOwn(value, key)) &&
        Reflect.ownKeys(value).every((key) => typeof key === 'string' && allowedKeys.has(key))
    );
}

function hasValidOptionalNumber({ value, key }: HasValidOptionalNumberInput): boolean {
    return !Object.hasOwn(value, key) || value[key] === undefined || isFiniteNumber(value[key]);
}

function hasValidOptionalString({ value, key }: HasValidOptionalNumberInput): boolean {
    return !Object.hasOwn(value, key) || value[key] === undefined || typeof value[key] === 'string';
}

function isValidMidiNote(value: unknown): value is MidiNote {
    return (
        isPlainObject(value) &&
        hasExactKeys({
            value,
            requiredKeys: MIDI_NOTE_REQUIRED_KEYS,
            optionalKeys: MIDI_NOTE_OPTIONAL_KEYS,
        }) &&
        typeof value.id === 'string' &&
        isFiniteNumber(value.pitch) &&
        isFiniteNumber(value.startBeat) &&
        isFiniteNumber(value.duration) &&
        isFiniteNumber(value.velocity) &&
        hasValidOptionalNumber({ value, key: 'probability' }) &&
        hasValidOptionalNumber({ value, key: 'pressure' }) &&
        hasValidOptionalNumber({ value, key: 'slide' }) &&
        hasValidOptionalNumber({ value, key: 'pitchBend' }) &&
        hasValidOptionalNumber({ value, key: 'pitchBendRangeSemitones' }) &&
        hasValidOptionalNumber({ value, key: 'channel' }) &&
        hasValidOptionalString({ value, key: 'articulation' })
    );
}

function isValidMidiControlChange(value: unknown): value is MidiCC {
    return (
        isPlainObject(value) &&
        hasExactKeys({ value, requiredKeys: MIDI_CC_KEYS }) &&
        typeof value.id === 'string' &&
        isFiniteNumber(value.controller) &&
        isFiniteNumber(value.value) &&
        isFiniteNumber(value.beat) &&
        isFiniteNumber(value.channel)
    );
}

function isValidMidiPitchBend(value: unknown): value is MidiPitchBend {
    return (
        isPlainObject(value) &&
        hasExactKeys({ value, requiredKeys: MIDI_PITCH_BEND_KEYS }) &&
        typeof value.id === 'string' &&
        isFiniteNumber(value.value) &&
        isFiniteNumber(value.beat) &&
        isFiniteNumber(value.channel)
    );
}

function validateSnapshot<TRow>({ snapshot, isValidRow }: ValidateSnapshotInput<TRow>): readonly TRow[] {
    if (!Array.isArray(snapshot)) {
        throw new TypeError(INVALID_MIDI_CLIP_DATA_SNAPSHOT);
    }

    const validatedRows: TRow[] = [];
    for (let index = 0; index < snapshot.length; index += 1) {
        if (!Object.hasOwn(snapshot, index)) {
            throw new TypeError(INVALID_MIDI_CLIP_DATA_SNAPSHOT);
        }

        const value: unknown = snapshot[index];
        if (!isValidRow(value)) {
            throw new TypeError(INVALID_MIDI_CLIP_DATA_SNAPSHOT);
        }

        validatedRows.push(value);
    }

    return validatedRows;
}

export function restoreMidiClipData({
    clipId,
    notesSnapshot,
    controlChangeSnapshot,
    pitchBendSnapshot,
}: RestoreMidiClipDataInput): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    if (notesSnapshot === null && controlChangeSnapshot === null && pitchBendSnapshot === null) {
        return;
    }

    const validatedNotes =
        notesSnapshot === null ? null : validateSnapshot({ snapshot: notesSnapshot, isValidRow: isValidMidiNote });
    const validatedControlChanges =
        controlChangeSnapshot === null
            ? null
            : validateSnapshot({ snapshot: controlChangeSnapshot, isValidRow: isValidMidiControlChange });
    const validatedPitchBends =
        pitchBendSnapshot === null
            ? null
            : validateSnapshot({ snapshot: pitchBendSnapshot, isValidRow: isValidMidiPitchBend });

    midiStore.set({
        ...state,
        notesByClipId:
            validatedNotes === null ? state.notesByClipId : { ...state.notesByClipId, [clipId]: [...validatedNotes] },
        ccByClipId:
            validatedControlChanges === null
                ? state.ccByClipId
                : { ...state.ccByClipId, [clipId]: [...validatedControlChanges] },
        pitchBendByClipId:
            validatedPitchBends === null
                ? state.pitchBendByClipId
                : { ...state.pitchBendByClipId, [clipId]: [...validatedPitchBends] },
    });
}
