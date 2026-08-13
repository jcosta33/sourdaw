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
    channel?: number;
    articulation?: string;
};

type AppendMidiNotesInput = {
    clipId: string;
    notes: AppendMidiNoteInput[];
};

const REQUIRED_APPEND_NOTE_KEYS = ['pitch', 'startBeat', 'duration', 'velocity'] as const;
const OPTIONAL_APPEND_NOTE_KEYS = ['probability', 'pressure', 'slide', 'pitchBend', 'channel', 'articulation'] as const;
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

function isExactAppendNote(value: unknown): value is AppendMidiNoteInput {
    if (!isPlainObject(value) || !hasExactAppendNoteKeys(value)) {
        return false;
    }

    return (
        isFiniteNumber(value.pitch) &&
        isFiniteNumber(value.startBeat) &&
        isFiniteNumber(value.duration) &&
        isFiniteNumber(value.velocity) &&
        (!Object.hasOwn(value, 'probability') || isFiniteNumber(value.probability)) &&
        (!Object.hasOwn(value, 'pressure') || isFiniteNumber(value.pressure)) &&
        (!Object.hasOwn(value, 'slide') || isFiniteNumber(value.slide)) &&
        (!Object.hasOwn(value, 'pitchBend') || isFiniteNumber(value.pitchBend)) &&
        (!Object.hasOwn(value, 'channel') || isFiniteNumber(value.channel)) &&
        (!Object.hasOwn(value, 'articulation') || isValidMidiArticulation(value.articulation))
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
