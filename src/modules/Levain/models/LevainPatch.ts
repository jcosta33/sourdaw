/**
 * Levain instrument patch data model.
 * Describes the complete state of an levain instrument — serializable, versionable.
 *
 * The levain suite is primarily a sample playback and performance intelligence
 * engine. Quality depends on sample content and playback engine intelligence
 * (legato, expression, articulation, release triggers, round-robin management).
 */

// ---------------------------------------------------------------------------
// Instrument types
// ---------------------------------------------------------------------------

export type InstrumentFamily = 'strings' | 'brass' | 'woodwinds' | 'percussion' | 'choir';

export type InstrumentId =
    // Strings
    | 'violin-1'
    | 'violin-2'
    | 'viola'
    | 'cello'
    | 'double-bass'
    | 'solo-violin'
    | 'solo-viola'
    | 'solo-cello'
    // Brass
    | 'trumpet'
    | 'horn'
    | 'trombone'
    | 'tuba'
    | 'solo-trumpet'
    | 'solo-horn'
    // Woodwinds
    | 'flute'
    | 'oboe'
    | 'clarinet'
    | 'bassoon'
    | 'piccolo'
    | 'english-horn'
    | 'bass-clarinet'
    | 'contrabassoon'
    // Percussion
    | 'timpani'
    | 'snare'
    | 'bass-drum'
    | 'cymbals'
    | 'glockenspiel'
    | 'xylophone'
    | 'marimba'
    | 'vibraphone'
    | 'celesta'
    | 'tubular-bells'
    | 'tam-tam'
    | 'triangle'
    | 'harp'
    // Choir
    | 'soprano'
    | 'alto'
    | 'tenor'
    | 'bass-voice';

// ---------------------------------------------------------------------------
// Articulation types
// ---------------------------------------------------------------------------

export type ArticulationType =
    | 'sustain'
    | 'sustain-non-vib'
    | 'con-sordino'
    | 'flautando'
    | 'sul-tasto'
    | 'sul-ponticello'
    | 'harmonics'
    | 'spiccato'
    | 'staccato'
    | 'staccatissimo'
    | 'pizzicato'
    | 'bartok-pizz'
    | 'col-legno'
    | 'tremolo'
    | 'trill-half'
    | 'trill-whole'
    | 'legato'
    | 'legato-portamento'
    | 'marcato'
    | 'sforzando'
    | 'flutter-tongue'
    | 'muted-straight'
    | 'muted-cup'
    | 'muted-harmon'
    | 'muted-plunger'
    | 'crescendo'
    | 'decrescendo'
    | 'runs';

export const ARTICULATION_ID_BY_TYPE = {
    sustain: 0,
    'sustain-non-vib': 1,
    'con-sordino': 2,
    flautando: 3,
    'sul-tasto': 4,
    'sul-ponticello': 5,
    harmonics: 6,
    spiccato: 7,
    staccato: 8,
    staccatissimo: 9,
    pizzicato: 10,
    'bartok-pizz': 11,
    'col-legno': 12,
    tremolo: 13,
    'trill-half': 14,
    'trill-whole': 15,
    legato: 16,
    'legato-portamento': 17,
    marcato: 18,
    sforzando: 19,
    'flutter-tongue': 20,
    'muted-straight': 21,
    'muted-cup': 22,
    'muted-harmon': 23,
    'muted-plunger': 24,
    crescendo: 25,
    decrescendo: 26,
    runs: 27,
} as const satisfies Record<ArticulationType, number>;

export type ArticulationEntry = {
    type: ArticulationType;
    keyswitch: number | null;
    name: string;
    enabled: boolean;
};

// ---------------------------------------------------------------------------
// Mic positions
// ---------------------------------------------------------------------------

export type MicPositionType =
    'close' | 'decca-tree' | 'room' | 'outrigger' | 'balcony' | 'leader' | 'spot' | 'surround';

export type MicPositionState = {
    type: MicPositionType;
    name: string;
    volume: number; // 0-1
    pan: number; // -1 to 1
    delayMs: number; // distance simulation (~1ms per foot)
    enabled: boolean;
    stereoWidth: number; // 0-2
    phaseInvert: boolean;
};

// ---------------------------------------------------------------------------
// Expression configuration
// ---------------------------------------------------------------------------

export type CcCurve = 'linear' | 's-curve' | 'logarithmic';

export type ExpressionConfig = {
    cc1Curve: CcCurve;
    dynamicCrossfadeTime: number; // seconds
    vibratoRateMin: number; // Hz
    vibratoRateMax: number; // Hz
    vibratoDepthMax: number; // cents
    vibratoOnsetDelay: number; // seconds
};

// ---------------------------------------------------------------------------
// Legato configuration
// ---------------------------------------------------------------------------

export type LegatoConfig = {
    enabled: boolean;
    adaptiveSpeed: boolean;
    slowThresholdMs: number;
    fastThresholdMs: number;
    portamentoVelocityThreshold: number; // 0-127
};

// ---------------------------------------------------------------------------
// Humanization
// ---------------------------------------------------------------------------

export type HumanizeConfig = {
    amount: number; // 0-1 (master humanize knob)
    timingMaxMs: number; // max timing offset
    tuningMaxCents: number; // max tuning offset
    dynamicMax: number; // max dynamic variation (0-1)
    vibratoVarMax: number; // max vibrato variation (0-1)
    seed: number; // RNG seed for deterministic renders
};

// ---------------------------------------------------------------------------
// Release trigger
// ---------------------------------------------------------------------------

export type ReleaseTriggerConfig = {
    enabled: boolean;
    durationScaleMax: number; // seconds
    dynamicScale: boolean;
};

// ---------------------------------------------------------------------------
// Main patch model
// ---------------------------------------------------------------------------

export type LevainPatch = {
    version: number;
    name: string;

    // Instrument identity
    instrumentId: InstrumentId;
    instrumentFamily: InstrumentFamily;
    keyRange: [number, number]; // MIDI note range

    // Articulations
    articulations: ArticulationEntry[];
    currentArticulation: ArticulationType;

    // Mic positions
    micPositions: MicPositionState[];

    // Expression (CC1/CC11/velocity model)
    expression: ExpressionConfig;

    // Legato
    legato: LegatoConfig;

    // Humanization
    humanize: HumanizeConfig;

    // Release triggers
    releaseTriggers: ReleaseTriggerConfig;

    // Master controls
    masterGain: number; // 0-2

    // 8 assignable macros (musical labels)
    macros: [number, number, number, number, number, number, number, number];
    macroLabels: [string, string, string, string, string, string, string, string];
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_EXPRESSION_CONFIG: ExpressionConfig = {
    cc1Curve: 's-curve',
    dynamicCrossfadeTime: 0.1,
    vibratoRateMin: 4.0,
    vibratoRateMax: 7.0,
    vibratoDepthMax: 40.0,
    vibratoOnsetDelay: 0.2,
};

export const DEFAULT_LEGATO_CONFIG: LegatoConfig = {
    enabled: true,
    adaptiveSpeed: true,
    slowThresholdMs: 300,
    fastThresholdMs: 100,
    portamentoVelocityThreshold: 64,
};

export const DEFAULT_HUMANIZE_CONFIG: HumanizeConfig = {
    amount: 0.5,
    timingMaxMs: 15,
    tuningMaxCents: 5,
    dynamicMax: 0.08,
    vibratoVarMax: 0.15,
    seed: 42,
};

export const DEFAULT_RELEASE_TRIGGER_CONFIG: ReleaseTriggerConfig = {
    enabled: true,
    durationScaleMax: 2.0,
    dynamicScale: true,
};

export const DEFAULT_MIC_POSITIONS: MicPositionState[] = [
    {
        type: 'close',
        name: 'Close',
        volume: 0.8,
        pan: 0,
        delayMs: 0,
        enabled: true,
        stereoWidth: 1,
        phaseInvert: false,
    },
    {
        type: 'decca-tree',
        name: 'Decca Tree',
        volume: 0.6,
        pan: 0,
        delayMs: 10,
        enabled: true,
        stereoWidth: 1.2,
        phaseInvert: false,
    },
    {
        type: 'room',
        name: 'Room',
        volume: 0.3,
        pan: 0,
        delayMs: 30,
        enabled: false,
        stereoWidth: 1.5,
        phaseInvert: false,
    },
];

export function createDefaultPatch(instrumentId: InstrumentId = 'violin-1'): LevainPatch {
    const family = getInstrumentFamily(instrumentId);

    return {
        version: 1,
        name: `${instrumentId} Init`,
        instrumentId,
        instrumentFamily: family,
        keyRange: getDefaultKeyRange(instrumentId),
        articulations: getDefaultArticulations(family),
        currentArticulation: 'sustain',
        micPositions: DEFAULT_MIC_POSITIONS.map((m) => ({ ...m })),
        expression: { ...DEFAULT_EXPRESSION_CONFIG },
        legato: { ...DEFAULT_LEGATO_CONFIG },
        humanize: { ...DEFAULT_HUMANIZE_CONFIG },
        releaseTriggers: { ...DEFAULT_RELEASE_TRIGGER_CONFIG },
        masterGain: 0.8,
        macros: [0.5, 1.0, 0.0, 0.5, 0.5, 0.5, 0.5, 0.5],
        macroLabels: ['Dynamics', 'Expression', 'Vibrato', 'Tightness', 'Space', 'Tone', 'Attack', 'Release'],
    };
}

function getInstrumentFamily(id: InstrumentId): InstrumentFamily {
    // Order matters: check specific matches before broad ones.
    // Choir must come before strings (to catch 'bass-voice' before 'bass').
    if (id === 'soprano' || id === 'alto' || id === 'tenor' || id === 'bass-voice') {
        return 'choir';
    }
    // Woodwinds before brass (to catch 'english-horn' before 'horn').
    if (
        id.includes('flute') ||
        id.includes('oboe') ||
        id.includes('clarinet') ||
        id.includes('bassoon') ||
        id.includes('piccolo') ||
        id === 'english-horn' ||
        id === 'bass-clarinet' ||
        id === 'contrabassoon'
    ) {
        return 'woodwinds';
    }
    if (id.includes('violin') || id.includes('viola') || id.includes('cello') || id === 'double-bass') {
        return 'strings';
    }
    if (
        id === 'trumpet' ||
        id === 'solo-trumpet' ||
        id === 'horn' ||
        id === 'solo-horn' ||
        id.includes('trombone') ||
        id.includes('tuba')
    ) {
        return 'brass';
    }
    return 'percussion';
}

function getDefaultKeyRange(id: InstrumentId): [number, number] {
    switch (id) {
        case 'violin-1':
        case 'violin-2':
        case 'solo-violin':
            return [55, 103]; // G3-G7
        case 'viola':
        case 'solo-viola':
            return [48, 93]; // C3-A6
        case 'cello':
        case 'solo-cello':
            return [36, 84]; // C2-C6
        case 'double-bass':
            return [28, 67]; // E1-G4
        case 'trumpet':
        case 'solo-trumpet':
            return [54, 82]; // F#3-Bb5
        case 'horn':
        case 'solo-horn':
            return [34, 77]; // Bb1-F5
        case 'trombone':
            return [40, 72]; // E2-C5
        case 'tuba':
            return [28, 60]; // E1-C4
        case 'flute':
            return [60, 96]; // C4-C7
        case 'oboe':
            return [58, 91]; // Bb3-G6
        case 'clarinet':
            return [50, 91]; // D3-G6
        case 'bassoon':
            return [34, 75]; // Bb1-Eb5
        case 'piccolo':
            return [74, 108]; // D5-C8
        case 'glockenspiel':
            return [72, 108]; // C5-C8
        case 'xylophone':
        case 'marimba':
            return [45, 96]; // A2-C7
        case 'vibraphone':
            return [53, 89]; // F3-F6
        case 'timpani':
            return [36, 57]; // C2-A3
        case 'english-horn':
        case 'bass-clarinet':
        case 'contrabassoon':
        case 'snare':
        case 'bass-drum':
        case 'cymbals':
        case 'celesta':
        case 'tubular-bells':
        case 'tam-tam':
        case 'triangle':
        case 'harp':
        case 'soprano':
        case 'alto':
        case 'tenor':
        case 'bass-voice':
        default:
            return [21, 108]; // full range
    }
}

function getDefaultArticulations(family: InstrumentFamily): ArticulationEntry[] {
    switch (family) {
        case 'strings':
            return [
                { type: 'sustain', keyswitch: 24, name: 'Long', enabled: true },
                { type: 'sustain-non-vib', keyswitch: 25, name: 'Long (nv)', enabled: true },
                { type: 'tremolo', keyswitch: 26, name: 'Tremolo', enabled: true },
                { type: 'trill-half', keyswitch: 27, name: 'Trill (half)', enabled: true },
                { type: 'spiccato', keyswitch: 28, name: 'Spiccato', enabled: true },
                { type: 'staccato', keyswitch: 29, name: 'Staccato', enabled: true },
                { type: 'pizzicato', keyswitch: 30, name: 'Pizzicato', enabled: true },
                { type: 'legato', keyswitch: 31, name: 'Legato', enabled: true },
                { type: 'legato-portamento', keyswitch: 32, name: 'Portamento', enabled: true },
                { type: 'con-sordino', keyswitch: 33, name: 'Con sordino', enabled: true },
                { type: 'flautando', keyswitch: 34, name: 'Flautando', enabled: true },
                { type: 'col-legno', keyswitch: 35, name: 'Col legno', enabled: true },
            ];
        case 'brass':
            return [
                { type: 'sustain', keyswitch: 24, name: 'Long', enabled: true },
                { type: 'sustain-non-vib', keyswitch: 25, name: 'Long (nv)', enabled: true },
                { type: 'staccato', keyswitch: 26, name: 'Staccato', enabled: true },
                { type: 'marcato', keyswitch: 27, name: 'Marcato', enabled: true },
                { type: 'sforzando', keyswitch: 28, name: 'Sforzando', enabled: true },
                { type: 'legato', keyswitch: 29, name: 'Legato', enabled: true },
                { type: 'flutter-tongue', keyswitch: 30, name: 'Flutter', enabled: true },
                { type: 'muted-straight', keyswitch: 31, name: 'Muted', enabled: true },
            ];
        case 'woodwinds':
            return [
                { type: 'sustain', keyswitch: 24, name: 'Long', enabled: true },
                { type: 'staccato', keyswitch: 25, name: 'Staccato', enabled: true },
                { type: 'legato', keyswitch: 26, name: 'Legato', enabled: true },
                { type: 'trill-half', keyswitch: 27, name: 'Trill (half)', enabled: true },
                { type: 'flutter-tongue', keyswitch: 28, name: 'Flutter', enabled: true },
            ];
        case 'percussion':
            return [{ type: 'sustain', keyswitch: null, name: 'Hit', enabled: true }];
        case 'choir':
            return [
                { type: 'sustain', keyswitch: 24, name: 'Ah', enabled: true },
                { type: 'sustain-non-vib', keyswitch: 25, name: 'Oh', enabled: true },
                { type: 'staccato', keyswitch: 26, name: 'Staccato', enabled: true },
            ];
    }

    return [];
}
