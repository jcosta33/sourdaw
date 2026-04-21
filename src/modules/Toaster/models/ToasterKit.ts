/**
 * Grinder drum machine domain models.
 * Plain types describing kit state — no behavior, no framework dependencies.
 */

export type DrumEngineType =
    // Circuit-faithful 808
    | 'kick-808'
    | 'snare-808'
    | 'hihat-closed'
    | 'hihat-open'
    | 'clap'
    | 'cowbell'
    | 'clave'
    | 'rimshot'
    | 'maracas'
    | 'tom-808-low'
    | 'tom-808-mid'
    | 'tom-808-high'
    // Circuit-faithful 909
    | 'kick-909'
    | 'clap-909'
    | 'hihat-909'
    // CR-78
    | 'cr78-drum'
    | 'cr78-metallic'
    // Generic / analog voices
    | 'kick-analog'
    | 'snare-analog'
    | 'tom'
    | 'cymbal'
    | 'shaker'
    | 'perc-generic'
    // Melodic / textural
    | 'modal-tabla'
    | 'modal-bongo'
    | 'modal-woodblock'
    | 'modal-metal'
    | 'fm-perc'
    | 'sample';

export type PadState = {
    id: number;
    name: string;
    color: string;
    engineType: DrumEngineType;
    chokeGroup: number; // 0 = none, 1-16
    midiNote: number; // default: 36 + pad index (GM drum map)
    volume: number; // 0-1
    pan: number; // -1 to 1
    muted: boolean;
    soloed: boolean;

    // Engine params (subset exposed to UI — full set sent via set_pad_param)
    tune: number; // -24 to +24 semitones
    decay: number; // 0-1 (mapped to engine-specific range)
    tone: number; // 0-1 (brightness / color)
    drive: number; // 0-10
    filterCutoff: number; // 20-20000 Hz
    filterResonance: number; // 0.5-20
    sendReverb: number; // 0-1
    sendDelay: number; // 0-1

    // Engine-specific params (vary by engine type)
    engineParams: Record<string, number>;
};

export type StepCondition = 'always' | 'fill' | 'not-fill' | 'first' | 'not-first';

export type Step = {
    active: boolean;
    velocity: number; // 0-1
    probability: number; // 0-1
    microTiming: number; // -0.5 to +0.5 steps
    retriggerCount: number; // 0 = none, 1-16
    condition: StepCondition;
    paramLocks: Record<string, number>;
    soundLock?: DrumEngineType; // Elektron-style per-step engine override
};

export type Pattern = {
    id: string;
    name: string;
    stepsPerBar: number; // 16, 32
    bars: number; // 1-4
    tracks: Array<{
        padIndex: number;
        steps: Step[];
        stepsOverride?: number; // polymetric: per-track step count
    }>;
};

export type ToasterKit = {
    version: number;
    name: string;
    pads: PadState[];
    patterns: Pattern[];
    activePatternId: string;
    swing: number; // 0-1
    masterGain: number; // 0-2
    reverbMix: number; // 0-1
    reverbDecay: number; // 0-0.99
    delayTime: number; // 10-2000 ms
    delayFeedback: number; // 0-0.95
    delayMix: number; // 0-1
    // Lo-fi vintage processing
    lofiBits: number; // 4-16 (16 = off)
    lofiRate: number; // 4000-44100 Hz (44100 = off)
    lofiMix: number; // 0-1

    macros: [number, number, number, number, number, number, number, number];
};

export const PAD_COLORS = [
    '#E06060',
    '#E08860',
    '#E0B060',
    '#B0E060',
    '#60E080',
    '#60C8E0',
    '#6088E0',
    '#8860E0',
    '#E060B0',
    '#E06080',
    '#C0C060',
    '#60E0C0',
    '#A080E0',
    '#E0A080',
    '#80C0E0',
    '#C080E0',
];

export const DEFAULT_PAD_NAMES = [
    'Kick',
    'Snare',
    'Closed HH',
    'Open HH',
    'Clap',
    'Rim',
    'Low Tom',
    'Mid Tom',
    'Hi Tom',
    'Crash',
    'Ride',
    'Cowbell',
    'Clave',
    'Shaker',
    'Perc 1',
    'Perc 2',
];

export const DEFAULT_ENGINE_TYPES: DrumEngineType[] = [
    'kick-808',
    'snare-808',
    'hihat-closed',
    'hihat-open',
    'clap',
    'rimshot',
    'tom-808-low',
    'tom-808-mid',
    'tom-808-high',
    'cymbal',
    'cymbal',
    'cowbell',
    'clave',
    'shaker',
    'perc-generic',
    'perc-generic',
];

export function createDefaultPad(index: number): PadState {
    return {
        id: index,
        name: DEFAULT_PAD_NAMES[index] ?? `Pad ${index + 1}`,
        color: PAD_COLORS[index] ?? '#888',
        engineType: DEFAULT_ENGINE_TYPES[index] ?? 'perc-generic',
        chokeGroup: index === 2 || index === 3 ? 1 : 0, // hats share choke group
        midiNote: 36 + index,
        volume: 0.8,
        pan: 0,
        muted: false,
        soloed: false,
        tune: 0,
        decay: 0.5,
        tone: 0.5,
        drive: 0,
        filterCutoff: 20000,
        filterResonance: 1,
        sendReverb: 0.1,
        sendDelay: 0,
        engineParams: {},
    };
}

function createDefaultStep(): Step {
    return {
        active: false,
        velocity: 0.8,
        probability: 1,
        microTiming: 0,
        retriggerCount: 0,
        condition: 'always',
        paramLocks: {},
    };
}

export function createDefaultPattern(numPads: number): Pattern {
    return {
        id: 'A1',
        name: 'Pattern A1',
        stepsPerBar: 16,
        bars: 1,
        tracks: Array.from({ length: numPads }, (_, index) => ({
            padIndex: index,
            steps: Array.from({ length: 16 }, () => createDefaultStep()),
        })),
    };
}

export function createDefaultKit(): ToasterKit {
    const numPads = 16;
    return {
        version: 1,
        name: 'Plain Bread',
        pads: Array.from({ length: numPads }, (_, index) => createDefaultPad(index)),
        patterns: [createDefaultPattern(numPads)],
        activePatternId: 'A1',
        swing: 0,
        masterGain: 1,
        reverbMix: 0.15,
        reverbDecay: 0.5,
        delayTime: 375,
        delayFeedback: 0.35,
        delayMix: 0,
        lofiBits: 16,
        lofiRate: 44100,
        lofiMix: 0,
        macros: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    };
}
