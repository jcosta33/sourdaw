/**
 * AI Fill & Transition Generation shared data.
 */

/** Standard GM drum map pitches */
export const DRUM_MAP = {
    kick: 36,
    snare: 38,
    hiHat: 42,
    hiHatOpen: 46,
    ride: 51,
    crash: 49,
    tom1: 48,
    tom2: 45,
    tom3: 41,
    floorTom: 43,
} as const;

export type DrumFillStyle = 'simple' | 'descending' | 'sixteenth' | 'syncopated';

export type DrumFillPatternHit = {
    offset: number;
    pitch: number;
    velocity: number;
};

export const FILL_PATTERNS: Record<DrumFillStyle, DrumFillPatternHit[]> = {
    simple: [
        { offset: 0, pitch: DRUM_MAP.snare, velocity: 100 },
        { offset: 0.5, pitch: DRUM_MAP.snare, velocity: 90 },
    ],
    descending: [
        { offset: 0, pitch: DRUM_MAP.tom1, velocity: 110 },
        { offset: 0.25, pitch: DRUM_MAP.tom2, velocity: 105 },
        { offset: 0.5, pitch: DRUM_MAP.tom3, velocity: 100 },
        { offset: 0.75, pitch: DRUM_MAP.floorTom, velocity: 95 },
    ],
    sixteenth: [
        { offset: 0, pitch: DRUM_MAP.snare, velocity: 110 },
        { offset: 0.25, pitch: DRUM_MAP.snare, velocity: 85 },
        { offset: 0.5, pitch: DRUM_MAP.snare, velocity: 100 },
        { offset: 0.75, pitch: DRUM_MAP.snare, velocity: 90 },
    ],
    syncopated: [
        { offset: 0, pitch: DRUM_MAP.kick, velocity: 110 },
        { offset: 0.25, pitch: DRUM_MAP.snare, velocity: 95 },
        { offset: 0.75, pitch: DRUM_MAP.tom1, velocity: 100 },
    ],
};
