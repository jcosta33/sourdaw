/**
 * Drum pattern generation algorithm.
 * Accepts an optional seed for deterministic, reproducible output.
 */

import { createSeededRandom, generateSeed } from '#/utils/SeededRandom/SeededRandom';

// See `AiGeneration/models/GenerationStyles.ts` for the canonical
// AiGeneration style unions.
import type { DrumPatternStyle } from '../../models/GenerationStyles';

export type { DrumPatternStyle };

/**
 * Runtime roster of every {@link DrumPatternStyle} the algorithm handles —
 * the single source the handler layer derives `VALID_DRUM_STYLES` from, so a
 * style can never be advertised as valid without a matching `switch` arm.
 *
 * The two `satisfies`-style guards below make this list and the
 * `DrumPatternStyle` union fail the type-check the moment they drift: the
 * `satisfies` clause rejects any member not in the union, and
 * `assertCoversUnion` rejects any union member missing from the list.
 */
export const DRUM_PATTERN_STYLES = [
    'four-on-floor',
    'breakbeat',
    'trap',
    'jazz',
    'latin',
    'rock',
    'dnb',
    'half-time',
    'blues',
    'reggae',
    'lofi',
    'house',
    'techno',
    'synthwave',
    'afrobeat',
    'metal',
    'punk',
] as const satisfies readonly DrumPatternStyle[];

// Compile-time exhaustiveness: fails if `DrumPatternStyle` gains a member that
// is not listed above (the `never` makes the assignment unrepresentable).
type DrumStyleNotListed = Exclude<DrumPatternStyle, (typeof DRUM_PATTERN_STYLES)[number]>;
const _assertDrumStylesCoverUnion: DrumStyleNotListed extends never ? true : never = true;
void _assertDrumStylesCoverUnion;

/**
 * Exhaustiveness guard for `switch` statements over a discriminated union:
 * reaching it is a type error, so a newly added style fails the build instead
 * of silently falling through to a runtime throw.
 */
function assertNever(value: never): never {
    throw new Error(`Unhandled drum pattern style: ${String(value)}`);
}

export type GenerateDrumPatternOptions = {
    style: DrumPatternStyle;
    bars?: number;
    density?: number;
    swing?: number;
    timeSignature?: [number, number];
    seed?: number;
};

type GeneratedNote = {
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
};

const KICK = 36;
const SNARE = 38;
const CLAP = 40;
const HIHAT = 42;
const OPEN_HH = 46;
const TOM = 45;
const RIDE = 51;

type ProbabilityMap = { pitch: number; pattern: number[]; velocityBase: number; velocityRange: number };

function buildPatternForBar(style: DrumPatternStyle): ProbabilityMap[] {
    switch (style) {
        case 'four-on-floor':
            return [
                {
                    pitch: KICK,
                    pattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
                    velocityBase: 110,
                    velocityRange: 10,
                },
                {
                    pitch: SNARE,
                    pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
                    velocityBase: 100,
                    velocityRange: 10,
                },
                {
                    pitch: HIHAT,
                    pattern: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
                    velocityBase: 80,
                    velocityRange: 15,
                },
                {
                    pitch: OPEN_HH,
                    pattern: [0, 0, 0, 0, 0, 0, 0, 0.3, 0, 0, 0, 0, 0, 0, 0, 0.3],
                    velocityBase: 75,
                    velocityRange: 10,
                },
            ];
        case 'breakbeat':
            return [
                {
                    pitch: KICK,
                    pattern: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
                    velocityBase: 110,
                    velocityRange: 10,
                },
                {
                    pitch: SNARE,
                    pattern: [0, 0, 0, 0, 1, 0, 0, 0.2, 0, 0, 0, 0, 1, 0, 0, 0.25],
                    velocityBase: 100,
                    velocityRange: 15,
                },
                {
                    pitch: HIHAT,
                    pattern: [1, 0.4, 1, 0.4, 1, 0.4, 1, 0.4, 1, 0.4, 1, 0.4, 1, 0.4, 1, 0.4],
                    velocityBase: 75,
                    velocityRange: 20,
                },
                {
                    pitch: OPEN_HH,
                    pattern: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.4, 0],
                    velocityBase: 70,
                    velocityRange: 10,
                },
            ];
        case 'trap':
            return [
                {
                    pitch: KICK,
                    pattern: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.4, 0, 0, 0, 0, 0],
                    velocityBase: 120,
                    velocityRange: 5,
                },
                {
                    pitch: SNARE,
                    pattern: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
                    velocityBase: 105,
                    velocityRange: 10,
                },
                {
                    pitch: CLAP,
                    pattern: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
                    velocityBase: 95,
                    velocityRange: 10,
                },
                {
                    pitch: HIHAT,
                    pattern: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
                    velocityBase: 70,
                    velocityRange: 25,
                },
                {
                    pitch: OPEN_HH,
                    pattern: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0],
                    velocityBase: 65,
                    velocityRange: 10,
                },
            ];
        case 'jazz':
            return [
                {
                    pitch: KICK,
                    pattern: [0.8, 0, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0, 0],
                    velocityBase: 70,
                    velocityRange: 20,
                },
                {
                    pitch: SNARE,
                    pattern: [0, 0, 0.2, 0, 0, 0, 0.2, 0, 0, 0, 0.2, 0, 0, 0, 0.2, 0],
                    velocityBase: 55,
                    velocityRange: 20,
                },
                {
                    pitch: RIDE,
                    pattern: [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
                    velocityBase: 75,
                    velocityRange: 15,
                },
                {
                    pitch: HIHAT,
                    pattern: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
                    velocityBase: 60,
                    velocityRange: 10,
                },
            ];
        case 'latin':
            return [
                {
                    pitch: KICK,
                    pattern: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0],
                    velocityBase: 95,
                    velocityRange: 15,
                },
                {
                    pitch: SNARE,
                    pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
                    velocityBase: 85,
                    velocityRange: 15,
                },
                {
                    pitch: TOM,
                    pattern: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
                    velocityBase: 75,
                    velocityRange: 10,
                },
                {
                    pitch: HIHAT,
                    pattern: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
                    velocityBase: 65,
                    velocityRange: 15,
                },
            ];
        case 'rock':
            return [
                {
                    pitch: KICK,
                    pattern: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
                    velocityBase: 115,
                    velocityRange: 10,
                },
                {
                    pitch: SNARE,
                    pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
                    velocityBase: 110,
                    velocityRange: 10,
                },
                {
                    pitch: HIHAT,
                    pattern: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
                    velocityBase: 85,
                    velocityRange: 10,
                },
            ];
        case 'dnb':
            return [
                {
                    pitch: KICK,
                    pattern: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0],
                    velocityBase: 115,
                    velocityRange: 10,
                },
                {
                    pitch: SNARE,
                    pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.3],
                    velocityBase: 105,
                    velocityRange: 15,
                },
                {
                    pitch: HIHAT,
                    pattern: [1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5],
                    velocityBase: 75,
                    velocityRange: 20,
                },
                {
                    pitch: OPEN_HH,
                    pattern: [0, 0, 0, 0, 0, 0, 0, 0.4, 0, 0, 0, 0, 0, 0, 0, 0.4],
                    velocityBase: 70,
                    velocityRange: 10,
                },
            ];
        case 'half-time':
            return [
                {
                    pitch: KICK,
                    pattern: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                    velocityBase: 115,
                    velocityRange: 10,
                },
                {
                    pitch: SNARE,
                    pattern: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
                    velocityBase: 105,
                    velocityRange: 10,
                },
                {
                    pitch: HIHAT,
                    pattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
                    velocityBase: 75,
                    velocityRange: 15,
                },
                {
                    pitch: OPEN_HH,
                    pattern: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.4],
                    velocityBase: 70,
                    velocityRange: 10,
                },
            ];
        case 'blues':
            return [
                {
                    pitch: KICK,
                    pattern: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
                    velocityBase: 100,
                    velocityRange: 15,
                },
                {
                    pitch: SNARE,
                    pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
                    velocityBase: 95,
                    velocityRange: 20,
                },
                {
                    pitch: RIDE,
                    pattern: [1, 0, 0.4, 0, 1, 0, 0.4, 0, 1, 0, 0.4, 0, 1, 0, 0.4, 0],
                    velocityBase: 80,
                    velocityRange: 15,
                },
                {
                    pitch: HIHAT,
                    pattern: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
                    velocityBase: 60,
                    velocityRange: 10,
                },
            ];
        case 'reggae':
            return [
                {
                    pitch: KICK,
                    pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
                    velocityBase: 110,
                    velocityRange: 10,
                },
                {
                    pitch: SNARE,
                    pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
                    velocityBase: 105,
                    velocityRange: 10,
                },
                {
                    pitch: HIHAT,
                    pattern: [1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5],
                    velocityBase: 80,
                    velocityRange: 20,
                },
            ];
        case 'lofi':
            return [
                {
                    pitch: KICK,
                    pattern: [1, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 1, 0, 0, 0, 0, 0],
                    velocityBase: 90,
                    velocityRange: 15,
                },
                {
                    pitch: SNARE,
                    pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.2],
                    velocityBase: 80,
                    velocityRange: 15,
                },
                {
                    pitch: HIHAT,
                    pattern: [1, 0, 0.7, 0, 1, 0, 0.7, 0, 1, 0, 0.7, 0, 1, 0, 0.7, 0],
                    velocityBase: 65,
                    velocityRange: 25,
                },
            ];
        case 'house':
            return [
                {
                    pitch: KICK,
                    pattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
                    velocityBase: 115,
                    velocityRange: 5,
                },
                {
                    pitch: CLAP,
                    pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
                    velocityBase: 100,
                    velocityRange: 10,
                },
                {
                    pitch: OPEN_HH,
                    pattern: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
                    velocityBase: 85,
                    velocityRange: 10,
                },
            ];
        case 'techno':
            return [
                {
                    pitch: KICK,
                    pattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
                    velocityBase: 120,
                    velocityRange: 2,
                },
                {
                    pitch: OPEN_HH,
                    pattern: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
                    velocityBase: 90,
                    velocityRange: 5,
                },
                {
                    pitch: HIHAT,
                    pattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
                    velocityBase: 80,
                    velocityRange: 5,
                },
            ];
        case 'synthwave':
            return [
                {
                    pitch: KICK,
                    pattern: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
                    velocityBase: 120,
                    velocityRange: 5,
                },
                {
                    pitch: SNARE,
                    pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
                    velocityBase: 110,
                    velocityRange: 5,
                },
                {
                    pitch: HIHAT,
                    pattern: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
                    velocityBase: 90,
                    velocityRange: 10,
                },
            ];
        case 'afrobeat':
            return [
                {
                    pitch: KICK,
                    pattern: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0],
                    velocityBase: 100,
                    velocityRange: 10,
                },
                {
                    pitch: SNARE,
                    pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
                    velocityBase: 90,
                    velocityRange: 10,
                },
                {
                    pitch: HIHAT,
                    pattern: [1, 0.4, 0.4, 1, 0.4, 0.4, 1, 0.4, 0.4, 1, 0.4, 0.4, 1, 0.4, 0.4, 1],
                    velocityBase: 70,
                    velocityRange: 15,
                },
            ];
        case 'metal':
            return [
                {
                    pitch: KICK,
                    pattern: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
                    velocityBase: 125,
                    velocityRange: 5,
                },
                {
                    pitch: SNARE,
                    pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
                    velocityBase: 120,
                    velocityRange: 5,
                },
                {
                    pitch: RIDE,
                    pattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
                    velocityBase: 95,
                    velocityRange: 10,
                },
            ];
        case 'punk':
            return [
                {
                    pitch: KICK,
                    pattern: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                    velocityBase: 120,
                    velocityRange: 10,
                },
                {
                    pitch: SNARE,
                    pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
                    velocityBase: 115,
                    velocityRange: 15,
                },
                {
                    pitch: HIHAT,
                    pattern: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
                    velocityBase: 100,
                    velocityRange: 20,
                },
            ];
        default:
            return assertNever(style);
    }
}

function applySwing(beat: number, subdivisionIndex: number, swingAmount: number): number {
    if (swingAmount <= 0 || subdivisionIndex % 2 === 0) {
        return beat;
    }
    return beat + swingAmount * 0.25 * 0.5;
}

function clampVelocity(value: number): number {
    return Math.max(1, Math.min(127, Math.round(value)));
}

export function generateDrumPattern(options: GenerateDrumPatternOptions): {
    notes: GeneratedNote[];
    seed: number;
} {
    const { style, bars = 4, density = 0.5, swing = 0, timeSignature = [4, 4], seed } = options;
    const usedSeed = seed ?? generateSeed();
    const rng = createSeededRandom(usedSeed);

    const [numerator] = timeSignature;
    const beatsPerBar = numerator;
    const subdivisionsPerBeat = 4;
    const subdivisionsPerBar = beatsPerBar * subdivisionsPerBeat;
    const totalSubdivisions = subdivisionsPerBar * bars;

    const baseMaps = buildPatternForBar(style);
    const notes: GeneratedNote[] = [];

    for (let sub = 0; sub < totalSubdivisions; sub++) {
        const barLocal = sub % subdivisionsPerBar;
        const beatPosition = sub / subdivisionsPerBeat;

        for (const map of baseMaps) {
            const probability = map.pattern[barLocal] ?? 0;
            if (probability <= 0) {
                continue;
            }

            const effectiveProbability = probability >= 1 ? 1 : probability * density * 2;
            if (rng() > effectiveProbability) {
                continue;
            }

            const velocityJitter = (rng() - 0.5) * map.velocityRange;
            const velocity = clampVelocity(map.velocityBase + velocityJitter);
            const startBeat = applySwing(beatPosition, barLocal, swing);

            notes.push({
                pitch: map.pitch,
                startBeat,
                duration: 0.25,
                velocity,
            });
        }
    }

    return { notes, seed: usedSeed };
}
