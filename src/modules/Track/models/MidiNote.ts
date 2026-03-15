export type MidiNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
};

let nextNoteId = 1;

export const createMidiNote = (
    pitch: number,
    startBeat: number,
    duration: number,
    velocity = 100,
): MidiNote => ({
    id: `note-${nextNoteId++}`,
    pitch,
    startBeat,
    duration,
    velocity,
});
