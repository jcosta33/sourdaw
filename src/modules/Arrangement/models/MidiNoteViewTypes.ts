/**
 * Arrangement-local view shapes of MIDI's note and controller-event models
 * (AGENTS.md §95 — model isolation). Arrangement stores clipboard /
 * duplication records containing these shapes; it does not import MIDI's
 * model.
 */

export type MidiNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
    probability?: number;
    pressure?: number;
    slide?: number;
    pitchBend?: number;
    /** Semitone range `pitchBend` was performed against; absent means ±48 (audit MD-8). */
    pitchBendRangeSemitones?: number;
    channel?: number;
    articulation?: string;
    /** Expression changes after note-on, per dimension; offsets are beats after `startBeat`. */
    expression?: {
        pressure?: { offsetBeats: number; value: number }[];
        slide?: { offsetBeats: number; value: number }[];
        pitchBend?: { offsetBeats: number; value: number }[];
    };
};

/** View shape of MIDI's controller-change point; clip association is the store's clip-id key. */
export type MidiCC = {
    id: string;
    controller: number;
    value: number;
    beat: number;
    channel: number;
};

/** View shape of MIDI's pitch-bend point; clip association is the store's clip-id key. */
export type MidiPitchBend = {
    id: string;
    value: number;
    beat: number;
    channel: number;
};
