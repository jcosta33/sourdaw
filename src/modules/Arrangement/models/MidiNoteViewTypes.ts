/**
 * Arrangement-local view shape of MIDI's note model (AGENTS.md §95 — model
 * isolation). Arrangement stores clipboard / duplication records containing
 * these shapes; it does not import MIDI's model.
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
};
