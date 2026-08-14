/**
 * Note shape consumed by the MIDI effect chain.
 *
 * Deliberately distinct from the arrangement note model in `MidiNote.ts`: an
 * effect operates on transient, id-less notes and measures length in beats.
 */
export type MidiEffectNote = {
    pitch: number;
    velocity: number;
    startBeat: number;
    durationBeats: number;
    channel: number;
};

export type MidiEffect = {
    id: string;
    name: string;
    process: (notes: MidiEffectNote[]) => MidiEffectNote[];
};

export const SCALES: Record<string, number[]> = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    pentatonic: [0, 2, 4, 7, 9],
    blues: [0, 3, 5, 6, 7, 10],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
