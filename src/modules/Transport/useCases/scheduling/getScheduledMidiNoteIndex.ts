import type { MidiStoreState } from '#/modules/MIDI/stores';

export type ScheduledMidiNote = MidiStoreState['notesByClipId'][string][number];
type ScheduledMidiNoteIndex = {
    maxDurationBeats: number;
    maxEndpointBeat: number;
    minEndpointBeat: number;
    orderByNote: ReadonlyMap<ScheduledMidiNote, number>;
    sortedNoteEnds: readonly ScheduledMidiNote[];
    sortedNotes: readonly ScheduledMidiNote[];
};
// MIDI writes replace note arrays rather than mutating them, so array identity
// invalidates this cache whenever project truth changes.
const scheduledMidiNoteIndexes = new WeakMap<readonly ScheduledMidiNote[], ScheduledMidiNoteIndex>();
export function getScheduledMidiNoteIndex(notes: readonly ScheduledMidiNote[]): ScheduledMidiNoteIndex {
    const cached = scheduledMidiNoteIndexes.get(notes);
    if (cached) {
        return cached;
    }

    const orderByNote = new Map(notes.map((note, index) => [note, index]));
    const sortedNotes = [...notes].sort((left, right) => left.startBeat - right.startBeat);
    const sortedNoteEnds = [...notes].sort(
        (left, right) => left.startBeat + left.duration - right.startBeat - right.duration
    );
    const created = {
        maxDurationBeats: notes.reduce((maximum, note) => Math.max(maximum, note.duration), 0),
        maxEndpointBeat: notes.reduce(
            (maximum, note) => Math.max(maximum, note.startBeat, note.startBeat + note.duration),
            Number.NEGATIVE_INFINITY
        ),
        minEndpointBeat: notes.reduce(
            (minimum, note) => Math.min(minimum, note.startBeat, note.startBeat + note.duration),
            Number.POSITIVE_INFINITY
        ),
        orderByNote,
        sortedNoteEnds,
        sortedNotes,
    };
    scheduledMidiNoteIndexes.set(notes, created);
    return created;
}
