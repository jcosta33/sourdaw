import { type MidiNote } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';

type AppendMidiNotesInput = {
    clipId: string;
    notes: unknown[];
};

const REQUIRED_MIDI_NOTE_KEYS = ['id', 'pitch', 'startBeat', 'duration', 'velocity'] as const;
const OPTIONAL_MIDI_NOTE_KEYS = ['probability', 'pressure', 'slide', 'pitchBend', 'channel'] as const;
const ALLOWED_MIDI_NOTE_KEYS = new Set<string>([...REQUIRED_MIDI_NOTE_KEYS, ...OPTIONAL_MIDI_NOTE_KEYS]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function hasExactMidiNoteKeys(value: Record<string, unknown>): boolean {
    return (
        REQUIRED_MIDI_NOTE_KEYS.every((key) => Object.hasOwn(value, key)) &&
        Object.keys(value).every((key) => ALLOWED_MIDI_NOTE_KEYS.has(key))
    );
}

function isExactMidiNote(value: unknown): value is MidiNote {
    if (!isPlainObject(value) || !hasExactMidiNoteKeys(value)) {
        return false;
    }

    return (
        typeof value.id === 'string' &&
        isFiniteNumber(value.pitch) &&
        isFiniteNumber(value.startBeat) &&
        isFiniteNumber(value.duration) &&
        isFiniteNumber(value.velocity) &&
        (!Object.hasOwn(value, 'probability') || isFiniteNumber(value.probability)) &&
        (!Object.hasOwn(value, 'pressure') || isFiniteNumber(value.pressure)) &&
        (!Object.hasOwn(value, 'slide') || isFiniteNumber(value.slide)) &&
        (!Object.hasOwn(value, 'pitchBend') || isFiniteNumber(value.pitchBend)) &&
        (!Object.hasOwn(value, 'channel') || isFiniteNumber(value.channel))
    );
}

export function appendMidiNotes({ clipId, notes }: AppendMidiNotesInput): void {
    const midiState = midiStore.value;
    if (!midiState || notes.length === 0) {
        return;
    }

    const validatedNotes: MidiNote[] = [];
    for (const note of notes) {
        if (!isExactMidiNote(note)) {
            throw new Error('Invalid MIDI note batch');
        }
        validatedNotes.push(note);
    }

    const appendedNotes = validatedNotes.map((note) => ({
        ...note,
        id: `note-${crypto.randomUUID().slice(0, 8)}`,
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
