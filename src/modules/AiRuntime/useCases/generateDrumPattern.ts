import { addClip } from "#/modules/Track/useCases/clipUseCases";
import { addMidiNote } from "#/modules/Track/useCases/midiUseCases";

export type DrumPatternStyle =
    | "four-on-floor"
    | "breakbeat"
    | "trap"
    | "jazz"
    | "latin"
    | "rock"
    | "dnb"
    | "half-time";

export type GenerateDrumPatternOptions = {
    style: DrumPatternStyle;
    bars?: number;
    density?: number;
    swing?: number;
    timeSignature?: [number, number];
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

// Each slot in a probability map represents one 16th-note subdivision.
// Values 0–1 represent the probability of that hit occurring.
type ProbabilityMap = { pitch: number; pattern: number[]; velocityBase: number; velocityRange: number };

const buildPatternForBar = (style: DrumPatternStyle): ProbabilityMap[] => {
    switch (style) {
        case "four-on-floor":
            return [
                { pitch: KICK,    pattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],       velocityBase: 110, velocityRange: 10 },
                { pitch: SNARE,   pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],       velocityBase: 100, velocityRange: 10 },
                { pitch: HIHAT,   pattern: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],       velocityBase: 80,  velocityRange: 15 },
                { pitch: OPEN_HH, pattern: [0, 0, 0, 0, 0, 0, 0, 0.3, 0, 0, 0, 0, 0, 0, 0, 0.3],   velocityBase: 75,  velocityRange: 10 },
            ];

        case "breakbeat":
            return [
                { pitch: KICK,    pattern: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],       velocityBase: 110, velocityRange: 10 },
                { pitch: SNARE,   pattern: [0, 0, 0, 0, 1, 0, 0, 0.2, 0, 0, 0, 0, 1, 0, 0, 0.25],  velocityBase: 100, velocityRange: 15 },
                { pitch: HIHAT,   pattern: [1, 0.4, 1, 0.4, 1, 0.4, 1, 0.4, 1, 0.4, 1, 0.4, 1, 0.4, 1, 0.4], velocityBase: 75, velocityRange: 20 },
                { pitch: OPEN_HH, pattern: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.4, 0],     velocityBase: 70,  velocityRange: 10 },
            ];

        case "trap":
            return [
                { pitch: KICK,    pattern: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.4, 0, 0, 0, 0, 0],     velocityBase: 120, velocityRange: 5 },
                { pitch: SNARE,   pattern: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],       velocityBase: 105, velocityRange: 10 },
                { pitch: CLAP,    pattern: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],       velocityBase: 95,  velocityRange: 10 },
                { pitch: HIHAT,   pattern: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],       velocityBase: 70,  velocityRange: 25 },
                { pitch: OPEN_HH, pattern: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0],     velocityBase: 65,  velocityRange: 10 },
            ];

        case "jazz":
            return [
                { pitch: KICK,    pattern: [0.8, 0, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0, 0],   velocityBase: 70,  velocityRange: 20 },
                { pitch: SNARE,   pattern: [0, 0, 0.2, 0, 0, 0, 0.2, 0, 0, 0, 0.2, 0, 0, 0, 0.2, 0], velocityBase: 55, velocityRange: 20 },
                { pitch: RIDE,    pattern: [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],       velocityBase: 75,  velocityRange: 15 },
                { pitch: HIHAT,   pattern: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],       velocityBase: 60,  velocityRange: 10 },
            ];

        case "latin":
            return [
                // Son clave: 3-2 pattern mapped to 16th grid
                { pitch: KICK,    pattern: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0],       velocityBase: 95,  velocityRange: 15 },
                { pitch: SNARE,   pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],       velocityBase: 85,  velocityRange: 15 },
                { pitch: TOM,     pattern: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],       velocityBase: 75,  velocityRange: 10 },
                { pitch: HIHAT,   pattern: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],       velocityBase: 65,  velocityRange: 15 },
            ];

        case "rock":
            return [
                { pitch: KICK,    pattern: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],       velocityBase: 115, velocityRange: 10 },
                { pitch: SNARE,   pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],       velocityBase: 110, velocityRange: 10 },
                { pitch: HIHAT,   pattern: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],       velocityBase: 85,  velocityRange: 10 },
            ];

        case "dnb":
            return [
                { pitch: KICK,    pattern: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0],       velocityBase: 115, velocityRange: 10 },
                { pitch: SNARE,   pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.3],     velocityBase: 105, velocityRange: 15 },
                { pitch: HIHAT,   pattern: [1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5], velocityBase: 75, velocityRange: 20 },
                { pitch: OPEN_HH, pattern: [0, 0, 0, 0, 0, 0, 0, 0.4, 0, 0, 0, 0, 0, 0, 0, 0.4],   velocityBase: 70,  velocityRange: 10 },
            ];

        case "half-time":
            return [
                { pitch: KICK,    pattern: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],       velocityBase: 115, velocityRange: 10 },
                { pitch: SNARE,   pattern: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],       velocityBase: 105, velocityRange: 10 },
                { pitch: HIHAT,   pattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],       velocityBase: 75,  velocityRange: 15 },
                { pitch: OPEN_HH, pattern: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.4],     velocityBase: 70,  velocityRange: 10 },
            ];
    }
};

const applySwing = (beat: number, subdivisionIndex: number, swingAmount: number): number => {
    if (swingAmount <= 0 || subdivisionIndex % 2 === 0) {
        return beat;
    }
    return beat + swingAmount * 0.25 * 0.5;
};

const clampVelocity = (v: number): number => Math.max(1, Math.min(127, Math.round(v)));

export const generateDrumPattern = (options: GenerateDrumPatternOptions): GeneratedNote[] => {
    const {
        style,
        bars = 4,
        density = 0.5,
        swing = 0,
        timeSignature = [4, 4],
    } = options;

    const [numerator] = timeSignature;
    const beatsPerBar = numerator;
    const subdivisionsPerBeat = 4; // 16th notes
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

            // Density scales optional hits (probability < 1). Certain hits (probability === 1) always fire.
            const effectiveProbability = probability >= 1 ? 1 : probability * density * 2;
            if (Math.random() > effectiveProbability) {
                continue;
            }

            const velocityJitter = (Math.random() - 0.5) * map.velocityRange;
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

    return notes;
};

export const applyDrumPatternToTrack = (trackId: string, options: GenerateDrumPatternOptions): void => {
    const bars = options.bars ?? 4;
    const [numerator] = options.timeSignature ?? [4, 4];
    const totalBeats = bars * numerator;

    const clip = addClip({
        trackId,
        startBeat: 0,
        endBeat: totalBeats,
        name: `${options.style} drums`,
        type: "midi",
    });

    if (!clip) {
        return;
    }

    const notes = generateDrumPattern(options);
    for (const note of notes) {
        addMidiNote(clip.id, note.pitch, note.startBeat, note.duration, note.velocity);
    }
};
