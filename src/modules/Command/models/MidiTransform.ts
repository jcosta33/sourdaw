/**
 * The contract for a deterministic MIDI transform: a named, bounded, seeded generator that the
 * command compiler expands into ordinary `addNotes` commands before anything executes.
 *
 * Command owns the contract because the catalog a planner searches and the compiler that expands a
 * transform both read it, and neither may depend on the module that supplies the generators. The
 * style vocabularies below are therefore re-declared here rather than imported; a spec in the
 * supplying module asserts the two agree, which is what keeps the duplication honest.
 */

export const MIDI_TRANSFORM_NAMES = ['chordProgression', 'drumPattern', 'melody'] as const;

export type MidiTransformName = (typeof MIDI_TRANSFORM_NAMES)[number];

/** Common time is what `bars` means everywhere in this contract. */
export const MIDI_TRANSFORM_BEATS_PER_BAR = 4;

export const MIDI_TRANSFORM_CLIP_ARGUMENT = 'clipId';
export const MIDI_TRANSFORM_BARS_ARGUMENT = 'bars';
export const MIDI_TRANSFORM_SEED_ARGUMENT = 'seed';

/**
 * The largest seed a caller may supply: the seeded generators consume a 32-bit signed state, so a
 * wider integer would silently fold onto a seed the caller never asked for — and a proposal a
 * musician cannot reproduce from the seed it carries is not deterministic.
 */
export const MIDI_TRANSFORM_MAX_SEED = 2_147_483_647;

/**
 * The longest span any transform may be asked for. Sixteen bars of common time is a section, which
 * is the unit a planner writes a part in; a longer part is more than one accepted proposal.
 */
export const MIDI_TRANSFORM_MAX_BARS = 16;

export const MIDI_TRANSFORM_CHORD_PROGRESSION_STYLES = [
    'pop',
    'jazz',
    'classical',
    'edm',
    'blues',
    'rnb',
    'folk',
    'cinematic',
    'neo-soul',
    'gospel',
    'rock',
    'lofi',
] as const;

export const MIDI_TRANSFORM_CHORD_VOICINGS = ['close', 'open', 'spread', 'power'] as const;

export const MIDI_TRANSFORM_CHORD_SCALES = ['major', 'minor'] as const;

export const MIDI_TRANSFORM_CHORD_RHYTHMS = ['whole', 'half', 'quarter', 'syncopated'] as const;

export const MIDI_TRANSFORM_DRUM_PATTERN_STYLES = [
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
] as const;

export const MIDI_TRANSFORM_MELODY_STYLES = ['simple', 'arpeggiated', 'stepwise', 'rhythmic', 'ambient'] as const;

export const MIDI_TRANSFORM_MELODY_SCALES = [
    'major',
    'minor',
    'pentatonic',
    'minor-pentatonic',
    'blues',
    'dorian',
    'mixolydian',
    'lydian',
    'phrygian',
    'locrian',
    'harmonic-minor',
    'melodic-minor',
    'whole-tone',
    'chromatic',
] as const;

/**
 * One parameter of a transform, written in the JSON-schema dialect the command registry already uses
 * for command parameters, so a planner reads a transform's schema exactly as it reads a command's.
 * A parameter outside `required` carries a `default`: the generator runs on explicit values only,
 * and an omitted argument with no stated default would leave the generator to choose one.
 */
export type MidiTransformParameter = {
    readonly type: 'string' | 'integer' | 'number';
    readonly description: string;
    readonly enum?: readonly string[];
    readonly minimum?: number;
    readonly maximum?: number;
    readonly default?: string | number;
};

export type MidiTransformParameterSchema = {
    readonly properties: Readonly<Record<string, MidiTransformParameter>>;
    readonly required: readonly string[];
};

export type MidiTransformDescriptor = {
    readonly name: MidiTransformName;
    readonly description: string;
    readonly intentPhrases: readonly string[];
    readonly parameters: MidiTransformParameterSchema;
    /** The longest span this transform may be asked for, in bars of common time. */
    readonly maxBars: number;
};

/** A note in the clip's own content coordinates, before the MIDI owner gives it an identity. */
export type MaterializedMidiNote = {
    readonly pitch: number;
    readonly startBeat: number;
    readonly duration: number;
    readonly velocity: number;
};

export type MidiTransformRequest = {
    readonly name: string;
    readonly arguments: Readonly<Record<string, unknown>>;
    readonly clipSpanBeats: number;
};

/**
 * The generator itself. It receives arguments already validated against its descriptor, so it never
 * clamps and never defaults; anything it cannot honour it throws, and the expansion turns that throw
 * into a refusal naming the transform.
 */
export type MidiTransformImplementation = (
    transformArguments: Readonly<Record<string, unknown>>,
    context: { readonly clipSpanBeats: number }
) => readonly MaterializedMidiNote[];

/** Every name is supplied at once, so a published descriptor can never outlive its generator. */
export type MidiTransformImplementationMap = Readonly<Record<MidiTransformName, MidiTransformImplementation>>;

export type MidiTransformRegistration = {
    readonly descriptor: MidiTransformDescriptor;
    readonly implementation: MidiTransformImplementation;
};

/** The arguments of one expanded `addNotes` command. */
export type MidiTransformAddNotesArguments = {
    readonly clipId: string;
    readonly notes: readonly MaterializedMidiNote[];
};

const clipParameter = {
    type: 'string',
    description: 'The MIDI clip the generated notes are written into, by ID or batch-local $binding.',
} as const satisfies MidiTransformParameter;

const barsParameter = {
    type: 'integer',
    minimum: 1,
    maximum: MIDI_TRANSFORM_MAX_BARS,
    description: 'How many bars of common time to generate; it must fit inside the target clip.',
} as const satisfies MidiTransformParameter;

const seedParameter = {
    type: 'integer',
    minimum: 0,
    maximum: MIDI_TRANSFORM_MAX_SEED,
    default: 1,
    description: 'The seed the generator runs from. The same seed and arguments always produce the same notes.',
} as const satisfies MidiTransformParameter;

const keyParameter = {
    type: 'integer',
    minimum: 0,
    maximum: 11,
    default: 0,
    description: 'Root pitch class, 0 for C through 11 for B.',
} as const satisfies MidiTransformParameter;

const densityParameter = {
    type: 'number',
    minimum: 0,
    maximum: 1,
    default: 0.5,
    description: 'How much of the available rhythmic grid is played, from sparse at 0 to full at 1.',
} as const satisfies MidiTransformParameter;

const SHARED_REQUIRED_ARGUMENTS = [MIDI_TRANSFORM_CLIP_ARGUMENT, MIDI_TRANSFORM_BARS_ARGUMENT] as const;

const CHORD_PROGRESSION_DESCRIPTOR = {
    name: 'chordProgression',
    description:
        'Generate a seeded chord progression in a style, key and scale, and write it into one MIDI clip as notes.',
    intentPhrases: [
        'chord progression',
        'chord changes',
        'twelve bar blues',
        'blues progression',
        'harmony part',
        'backing chords',
    ],
    maxBars: MIDI_TRANSFORM_MAX_BARS,
    parameters: {
        properties: {
            clipId: clipParameter,
            bars: barsParameter,
            seed: seedParameter,
            key: keyParameter,
            style: {
                type: 'string',
                enum: MIDI_TRANSFORM_CHORD_PROGRESSION_STYLES,
                default: 'pop',
                description: 'The harmonic idiom the progression is drawn from.',
            },
            scale: {
                type: 'string',
                enum: MIDI_TRANSFORM_CHORD_SCALES,
                default: 'major',
                description: 'Whether the progression is built on the major or the minor scale.',
            },
            voicing: {
                type: 'string',
                enum: MIDI_TRANSFORM_CHORD_VOICINGS,
                default: 'close',
                description: 'How the notes of each chord are spread.',
            },
            octave: {
                type: 'integer',
                minimum: 2,
                maximum: 6,
                default: 3,
                description: 'The octave the chord roots sit in.',
            },
            rhythm: {
                type: 'string',
                enum: MIDI_TRANSFORM_CHORD_RHYTHMS,
                default: 'whole',
                description: 'How often a chord is restruck within a bar.',
            },
        },
        required: SHARED_REQUIRED_ARGUMENTS,
    },
} as const satisfies MidiTransformDescriptor;

const DRUM_PATTERN_DESCRIPTOR = {
    name: 'drumPattern',
    description: 'Generate a seeded drum pattern in a style, and write it into one MIDI clip as notes.',
    intentPhrases: ['drum pattern', 'drum beat', 'drum groove', 'beat', 'rhythm part', 'percussion part'],
    maxBars: MIDI_TRANSFORM_MAX_BARS,
    parameters: {
        properties: {
            clipId: clipParameter,
            bars: barsParameter,
            seed: seedParameter,
            density: densityParameter,
            style: {
                type: 'string',
                enum: MIDI_TRANSFORM_DRUM_PATTERN_STYLES,
                default: 'four-on-floor',
                description: 'The rhythmic idiom the pattern is drawn from.',
            },
            swing: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                default: 0,
                description: 'How far offbeat subdivisions are pushed late; 0 is straight.',
            },
        },
        required: SHARED_REQUIRED_ARGUMENTS,
    },
} as const satisfies MidiTransformDescriptor;

const MELODY_DESCRIPTOR = {
    name: 'melody',
    description: 'Generate a seeded melody line in a style, key and scale, and write it into one MIDI clip as notes.',
    intentPhrases: ['melody', 'melody line', 'lead line', 'topline', 'tune', 'hook'],
    maxBars: MIDI_TRANSFORM_MAX_BARS,
    parameters: {
        properties: {
            clipId: clipParameter,
            bars: barsParameter,
            seed: seedParameter,
            key: keyParameter,
            density: densityParameter,
            style: {
                type: 'string',
                enum: MIDI_TRANSFORM_MELODY_STYLES,
                default: 'simple',
                description: 'The melodic contour the line is drawn from.',
            },
            scale: {
                type: 'string',
                enum: MIDI_TRANSFORM_MELODY_SCALES,
                default: 'major',
                description: 'The scale the line is drawn from.',
            },
            octave: {
                type: 'integer',
                minimum: 2,
                maximum: 6,
                default: 4,
                description: 'The octave the line starts in.',
            },
            range: {
                type: 'integer',
                minimum: 1,
                maximum: 36,
                default: 12,
                description: 'How many semitones above the starting octave the line may reach.',
            },
        },
        required: SHARED_REQUIRED_ARGUMENTS,
    },
} as const satisfies MidiTransformDescriptor;

/**
 * The published contract for every transform name, keyed so a registration can only pair a generator
 * with the descriptor that bounds it.
 */
export const MIDI_TRANSFORM_DESCRIPTORS: Readonly<Record<MidiTransformName, MidiTransformDescriptor>> = {
    chordProgression: CHORD_PROGRESSION_DESCRIPTOR,
    drumPattern: DRUM_PATTERN_DESCRIPTOR,
    melody: MELODY_DESCRIPTOR,
};
