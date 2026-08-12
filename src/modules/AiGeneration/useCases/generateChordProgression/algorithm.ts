/**
 * Chord progression generation algorithm.
 * Accepts an optional seed for deterministic, reproducible output.
 */

import { createSeededRandom, generateSeed } from '#/utils/SeededRandom/SeededRandom';

// See `AiGeneration/models/GenerationStyles.ts` for the canonical
// AiGeneration style unions.
import type { ChordProgressionStyle, ChordVoicing } from '../../models/GenerationStyles';

export type { ChordProgressionStyle, ChordVoicing };

/**
 * Exhaustiveness guard for `switch` statements over a discriminated union:
 * reaching it is a type error, so a newly added voicing/rhythm fails the build
 * instead of silently falling through to an empty result.
 */
function assertNever(value: never): never {
    throw new Error(`Unhandled chord-progression case: ${String(value)}`);
}

export type GenerateChordProgressionOptions = {
    style: ChordProgressionStyle;
    key: number;
    scale: 'major' | 'minor';
    bars?: number;
    voicing?: ChordVoicing;
    octave?: number;
    rhythm?: 'whole' | 'half' | 'quarter' | 'syncopated';
    seed?: number;
};

type GeneratedNote = {
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
};

const CHORD_QUALITIES = {
    maj: [0, 4, 7],
    min: [0, 3, 7],
    dim: [0, 3, 6],
    maj7: [0, 4, 7, 11],
    min7: [0, 3, 7, 10],
    dom7: [0, 4, 7, 10],
    dim7: [0, 3, 6, 9],
    min9: [0, 3, 7, 10, 14],
    maj9: [0, 4, 7, 11, 14],
} as const;

type ChordQuality = keyof typeof CHORD_QUALITIES;

const MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11] as const;
const MINOR_SCALE_INTERVALS = [0, 2, 3, 5, 7, 8, 10] as const;

const MAJOR_DEGREE_QUALITIES: readonly ChordQuality[] = ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'];
const MINOR_DEGREE_QUALITIES: readonly ChordQuality[] = ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj'];

const MAJOR_DEGREE_QUALITIES_7TH: readonly ChordQuality[] = ['maj7', 'min7', 'min7', 'maj7', 'dom7', 'min7', 'dim7'];
const MINOR_DEGREE_QUALITIES_7TH: readonly ChordQuality[] = ['min7', 'dim7', 'maj7', 'min7', 'min7', 'maj7', 'dom7'];

const MAJOR_DEGREE_QUALITIES_9TH: readonly ChordQuality[] = ['maj9', 'min9', 'min9', 'maj9', 'dom7', 'min9', 'dim7'];
const MINOR_DEGREE_QUALITIES_9TH: readonly ChordQuality[] = ['min9', 'dim7', 'maj9', 'min9', 'min9', 'maj9', 'dom7'];

type Progression = readonly number[];

const PROGRESSIONS: Record<ChordProgressionStyle, readonly Progression[]> = {
    pop: [
        [0, 4, 5, 3],
        [0, 3, 5, 4],
        [5, 3, 0, 4],
    ],
    jazz: [
        [1, 4, 0, 5],
        [0, 5, 1, 4],
        [2, 5, 1, 4],
    ],
    classical: [
        [0, 3, 4, 0],
        [0, 5, 3, 4],
        [0, 1, 4, 0],
    ],
    edm: [
        [5, 3, 0, 4],
        [0, 5, 3, 4],
    ],
    blues: [
        [0, 0, 3, 0],
        [0, 3, 0, 4],
    ],
    rnb: [
        [0, 2, 5, 3],
        [1, 4, 0, 3],
    ],
    folk: [
        [0, 3, 4, 0],
        [0, 4, 5, 3],
    ],
    cinematic: [
        [0, 5, 2, 6],
        [0, 3, 5, 4],
    ],
    'neo-soul': [
        [1, 5, 2, 4],
        [3, 6, 2, 5],
    ],
    gospel: [
        [0, 3, 0, 4],
        [5, 2, 3, 4],
    ],
    rock: [
        [0, 4, 5, 3],
        [0, 5, 3, 4],
    ],
    lofi: [
        [1, 5, 4, 0],
        [3, 6, 2, 5],
    ],
};

/**
 * Runtime roster of every {@link ChordProgressionStyle} the algorithm handles,
 * derived from the {@link PROGRESSIONS} table itself so the two cannot drift.
 * `PROGRESSIONS` is a `Record<ChordProgressionStyle, …>`, so its keys are
 * exactly the union — the handler layer derives `VALID_CHORD_STYLES` from this.
 */
export const CHORD_PROGRESSION_STYLES = Object.keys(PROGRESSIONS) as ChordProgressionStyle[];

function pickProgression(style: ChordProgressionStyle, rng: () => number): Progression {
    const options = PROGRESSIONS[style];
    return options[Math.floor(rng() * options.length)]!;
}

function getQualitiesForStyle(scale: 'major' | 'minor', style: ChordProgressionStyle): readonly ChordQuality[] {
    if (style === 'rnb') {
        return scale === 'major' ? MAJOR_DEGREE_QUALITIES_9TH : MINOR_DEGREE_QUALITIES_9TH;
    }
    if (style === 'jazz') {
        return scale === 'major' ? MAJOR_DEGREE_QUALITIES_7TH : MINOR_DEGREE_QUALITIES_7TH;
    }
    return scale === 'major' ? MAJOR_DEGREE_QUALITIES : MINOR_DEGREE_QUALITIES;
}

function getScaleIntervals(scale: 'major' | 'minor'): readonly number[] {
    return scale === 'major' ? MAJOR_SCALE_INTERVALS : MINOR_SCALE_INTERVALS;
}

function clampMidi(node: number): number {
    return Math.max(0, Math.min(127, node));
}
function clampVelocity(value: number): number {
    return Math.max(1, Math.min(127, Math.round(value)));
}

function applyVoicing(intervals: readonly number[], rootMidi: number, voicing: ChordVoicing): number[] {
    switch (voicing) {
        case 'close': {
            return intervals.map((index) => clampMidi(rootMidi + index));
        }
        case 'open': {
            return intervals.map((interval, idx) => {
                const octaveShift = idx >= 2 ? 12 : 0;
                return clampMidi(rootMidi + interval + octaveShift);
            });
        }
        case 'spread': {
            return intervals.map((interval, idx) => clampMidi(rootMidi + interval + idx * 12));
        }
        case 'power': {
            const root = clampMidi(rootMidi);
            const fifth = clampMidi(rootMidi + 7);
            return [root, fifth];
        }
        default:
            return assertNever(voicing);
    }
}

type RhythmEvent = { offsetBeat: number; durationBeats: number };

function buildRhythmEvents(rhythm: 'whole' | 'half' | 'quarter' | 'syncopated', beatsPerBar: number): RhythmEvent[] {
    switch (rhythm) {
        case 'whole': {
            return [{ offsetBeat: 0, durationBeats: beatsPerBar }];
        }
        case 'half': {
            const half = beatsPerBar / 2;
            return [
                { offsetBeat: 0, durationBeats: half },
                { offsetBeat: half, durationBeats: half },
            ];
        }
        case 'quarter': {
            const events: RhythmEvent[] = [];
            for (let index = 0; index < beatsPerBar; index++) {
                events.push({ offsetBeat: index, durationBeats: 1 });
            }
            return events;
        }
        case 'syncopated': {
            return [
                { offsetBeat: 0, durationBeats: 3.5 },
                { offsetBeat: 3.5, durationBeats: 0.5 },
            ];
        }
        default:
            return assertNever(rhythm);
    }
}

export function generateChordProgression(options: GenerateChordProgressionOptions): {
    notes: GeneratedNote[];
    seed: number;
} {
    const { style, key, scale, bars = 4, voicing = 'close', octave = 3, rhythm = 'whole', seed } = options;
    const usedSeed = seed ?? generateSeed();
    const rng = createSeededRandom(usedSeed);

    const beatsPerBar = 4;
    const progression = pickProgression(style, rng);
    const qualities = getQualitiesForStyle(scale, style);
    const scaleIntervals = getScaleIntervals(scale);
    const rhythmEvents = buildRhythmEvents(rhythm, beatsPerBar);

    const notes: GeneratedNote[] = [];

    for (let bar = 0; bar < bars; bar++) {
        const degreeIndex = progression[bar % progression.length]!;
        const quality = qualities[degreeIndex]!;
        const chordIntervals = CHORD_QUALITIES[quality];
        const rootSemitone = scaleIntervals[degreeIndex]!;
        const rootMidi = key + octave * 12 + rootSemitone;
        const pitches = applyVoicing(chordIntervals, rootMidi, voicing);

        const barStart = bar * beatsPerBar;

        for (const event of rhythmEvents) {
            const startBeat = barStart + event.offsetBeat;
            const isDownbeat = event.offsetBeat === 0;
            const baseVelocity = isDownbeat ? 90 : 75;
            const velocity = clampVelocity(baseVelocity + (rng() - 0.5) * 10);

            for (const pitch of pitches) {
                notes.push({
                    pitch,
                    startBeat,
                    duration: event.durationBeats,
                    velocity,
                });
            }
        }
    }

    return { notes, seed: usedSeed };
}
