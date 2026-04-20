/**
 * Project-local view shapes used by demo-project builders (AGENTS.md §95 —
 * model isolation). These are NOT re-exports of MIDI / Arrangement models.
 */

export type MidiNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
    probability: number;
    pressure: number;
    slide: number;
    pitchBend: number;
};

export type StretchMode = 'off' | 'repitch' | 'timestretch';
