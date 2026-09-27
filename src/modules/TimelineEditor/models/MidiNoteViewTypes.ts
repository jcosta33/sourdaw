/**
 * Workspace-local view shape of MIDI's note/CC/pitch-bend models
 * (AGENTS.md §95 — model isolation). Not re-exports.
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
    pitchBendRangeSemitones?: number;
    channel?: number;
    articulation?: string;
    expression?: {
        pressure?: Array<{ offsetBeats: number; value: number }>;
        slide?: Array<{ offsetBeats: number; value: number }>;
        pitchBend?: Array<{ offsetBeats: number; value: number }>;
    };
};

export type MidiCC = {
    id: string;
    controller: number;
    value: number;
    beat: number;
    channel: number;
};

export type MidiPitchBend = {
    id: string;
    value: number;
    beat: number;
    channel: number;
};
