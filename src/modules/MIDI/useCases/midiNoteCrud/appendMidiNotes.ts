import { isValidMidiArticulation } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';

type AppendMidiNoteInput = {
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
    probability?: number;
    pressure?: number;
    slide?: number;
    pitchBend?: number;
    pitchBendRangeSemitones?: number;
    channel?: number;
    articulation?: string;
};

type AppendMidiNotesInput = {
    clipId: string;
    notes: AppendMidiNoteInput[];
};

const REQUIRED_APPEND_NOTE_KEYS = ['pitch', 'startBeat', 'duration', 'velocity'] as const;
// `pitchBendRangeSemitones` is stamped onto a note by `handleWebMidiPitchBend`,
// cloned whole by `copySelectedNotes` and not stripped by `pasteNotes`, so
// refusing the key here throws on pasting any MPE-recorded note.
const OPTIONAL_APPEND_NOTE_KEYS = [
    'probability',
    'pressure',
    'slide',
    'pitchBend',
    'pitchBendRangeSemitones',
    'channel',
    'articulation',
] as const;
const ALLOWED_APPEND_NOTE_KEYS = new Set<string>([...REQUIRED_APPEND_NOTE_KEYS, ...OPTIONAL_APPEND_NOTE_KEYS]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function hasExactAppendNoteKeys(value: Record<string, unknown>): boolean {
    return (
        REQUIRED_APPEND_NOTE_KEYS.every((key) => Object.hasOwn(value, key)) &&
        Object.keys(value).every((key) => ALLOWED_APPEND_NOTE_KEYS.has(key))
    );
}

// `midiStore.hasValidMidiNoteOptionals` treats an optional key present with the
// value `undefined` as absent, so the store holds notes in that shape — every
// producer that spreads a source note onto a fresh one writes them, and
// `pasteNotes` re-emits the ones it does not strip. Reading the key as
// present-and-invalid instead would throw on pasting a note the store itself
// accepts.
function isAbsentOrValid(value: Record<string, unknown>, key: string, isValid: (candidate: unknown) => boolean) {
    return !Object.hasOwn(value, key) || value[key] === undefined || isValid(value[key]);
}

function isExactAppendNote(value: unknown): value is AppendMidiNoteInput {
    if (!isPlainObject(value) || !hasExactAppendNoteKeys(value)) {
        return false;
    }

    return (
        isFiniteNumber(value.pitch) &&
        isFiniteNumber(value.startBeat) &&
        isFiniteNumber(value.duration) &&
        isFiniteNumber(value.velocity) &&
        isAbsentOrValid(value, 'probability', isFiniteNumber) &&
        isAbsentOrValid(value, 'pressure', isFiniteNumber) &&
        isAbsentOrValid(value, 'slide', isFiniteNumber) &&
        isAbsentOrValid(value, 'pitchBend', isFiniteNumber) &&
        isAbsentOrValid(value, 'pitchBendRangeSemitones', isFiniteNumber) &&
        isAbsentOrValid(value, 'channel', isFiniteNumber) &&
        isAbsentOrValid(value, 'articulation', isValidMidiArticulation)
    );
}

export function appendMidiNotes({ clipId, notes }: AppendMidiNotesInput): void {
    const midiState = midiStore.value;
    if (!midiState || notes.length === 0) {
        return;
    }

    const validatedNotes: AppendMidiNoteInput[] = [];
    for (const note of notes) {
        if (!isExactAppendNote(note)) {
            throw new Error('Invalid MIDI note batch');
        }
        validatedNotes.push(note);
    }

    const appendedNotes = validatedNotes.map((note) => ({
        ...note,
        // Full UUID, like every other note-id mint in this module. Truncating
        // to 32 bits made repeated pastes into one clip birthday-bound: two
        // notes sharing an id merge under selection, removeNotesByIds and undo.
        id: `note-${crypto.randomUUID()}`,
    }));
    const existing = midiState.notesByClipId[clipId] ?? [];

    midiStore.set({
        ...midiState,
        notesByClipId: {
            ...midiState.notesByClipId,
            [clipId]: [...existing, ...appendedNotes],
        },
    });
}
