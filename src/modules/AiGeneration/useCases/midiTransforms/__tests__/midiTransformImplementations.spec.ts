import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    clearMidiTransformRegistry,
    getMidiTransformDescriptors,
    getMidiTransformNames,
    registerMidiTransforms,
} from '#/modules/Command/stores';
import { MIDI_NOTE_MIN_DURATION_BEATS } from '#/utils/midiNoteBatchLimits';

import {
    CHORD_PROGRESSION_STYLES,
    CHORD_RHYTHMS,
    CHORD_SCALES,
    CHORD_VOICINGS,
    DRUM_PATTERN_STYLES,
    MELODY_SCALES,
    MELODY_STYLES,
} from '../generationVocabularies';
import { MIDI_TRANSFORM_IMPLEMENTATIONS } from '../midiTransformImplementations';

type Descriptor = ReturnType<typeof getMidiTransformDescriptors>[number];
type Parameter = Descriptor['parameters']['properties'][string];
type TransformName = keyof typeof MIDI_TRANSFORM_IMPLEMENTATIONS;

const CLIP_SPAN_BEATS = 64;
const BEATS_PER_BAR = 4;

/**
 * A clip is only ever as long as the transform asked for, so the tightest clip is the honest one:
 * anything a generator pushes past its own last bar is a note the expansion has to refuse.
 */
const BOUNDS_BARS = [1, 16];
const BOUNDS_SEEDS = [1, 2, 3];

/** The arguments the contract would hand a generator: the required ones, plus every declared default. */
function publishedArguments(descriptor: Descriptor): Record<string, unknown> {
    const entries = Object.entries(descriptor.parameters.properties).map(([name, parameter]) => [
        name,
        parameter.default,
    ]);
    return { ...Object.fromEntries(entries), clipId: 'clip-a', bars: 2 };
}

function run(descriptor: Descriptor, transformArguments: Record<string, unknown>) {
    return MIDI_TRANSFORM_IMPLEMENTATIONS[descriptor.name](transformArguments, { clipSpanBeats: CLIP_SPAN_BEATS });
}

type NoteBoundsCase = { transform: TransformName; variant: string; overrides: Record<string, unknown> };

function styleCases(transform: TransformName, styles: readonly string[]): NoteBoundsCase[] {
    return styles.map((style) => ({ transform, variant: `style ${style}`, overrides: { style } }));
}

/**
 * Every published argument value a generator can be handed, because the expansion refuses the whole
 * proposal over one out-of-bounds note: a combination nothing covers is a combination that cannot be
 * asked for.
 */
const NOTE_BOUNDS_CASES: NoteBoundsCase[] = [
    ...styleCases('chordProgression', CHORD_PROGRESSION_STYLES),
    ...CHORD_RHYTHMS.map((rhythm) => ({
        transform: 'chordProgression' as const,
        variant: `rhythm ${rhythm}`,
        overrides: { rhythm },
    })),
    ...DRUM_PATTERN_STYLES.flatMap((style) =>
        [0, 1].map((swing) => ({
            transform: 'drumPattern' as const,
            variant: `style ${style} at swing ${String(swing)}`,
            overrides: { style, swing },
        }))
    ),
    { transform: 'drumPattern', variant: 'density 1', overrides: { density: 1 } },
    ...styleCases('melody', MELODY_STYLES),
    { transform: 'melody', variant: 'density 1', overrides: { density: 1 } },
];

function numericBounds(parameter: Parameter): { minimum: number; maximum: number } | null {
    return parameter.type === 'string' || parameter.minimum === undefined || parameter.maximum === undefined
        ? null
        : { minimum: parameter.minimum, maximum: parameter.maximum };
}

type ContentPin = { count: number; first: { pitch: number; startBeat: number; duration: number; velocity: number }[] };

const SEEDED_CONTENT_PINS: Record<string, ContentPin> = {
    chordProgression: {
        count: 6,
        first: [
            { pitch: 36, startBeat: 0, duration: 4, velocity: 85 },
            { pitch: 40, startBeat: 0, duration: 4, velocity: 85 },
            { pitch: 43, startBeat: 0, duration: 4, velocity: 85 },
        ],
    },
    drumPattern: {
        count: 30,
        first: [
            { pitch: 36, startBeat: 0, duration: 0.25, velocity: 105 },
            { pitch: 42, startBeat: 0, duration: 0.25, velocity: 87 },
            { pitch: 42, startBeat: 0.5, duration: 0.25, velocity: 77 },
        ],
    },
    melody: {
        count: 2,
        first: [
            { pitch: 55, startBeat: 0, duration: 2, velocity: 95 },
            { pitch: 52, startBeat: 4, duration: 0.5, velocity: 94 },
        ],
    },
};

describe('MIDI transform implementations', () => {
    beforeEach(() => {
        clearMidiTransformRegistry();
        registerMidiTransforms(MIDI_TRANSFORM_IMPLEMENTATIONS);
    });

    afterEach(() => {
        clearMidiTransformRegistry();
    });

    it('supplies an implementation for every name the contract publishes', () => {
        expect(Object.keys(MIDI_TRANSFORM_IMPLEMENTATIONS).sort()).toEqual([...getMidiTransformNames()].sort());
    });

    it('publishes a descriptor for every supplied implementation', () => {
        expect(
            getMidiTransformDescriptors()
                .map((descriptor) => descriptor.name)
                .sort()
        ).toEqual(Object.keys(MIDI_TRANSFORM_IMPLEMENTATIONS).sort());
    });

    it.each([
        { transform: 'chordProgression', argumentName: 'style', vocabulary: CHORD_PROGRESSION_STYLES },
        { transform: 'chordProgression', argumentName: 'scale', vocabulary: CHORD_SCALES },
        { transform: 'chordProgression', argumentName: 'voicing', vocabulary: CHORD_VOICINGS },
        { transform: 'chordProgression', argumentName: 'rhythm', vocabulary: CHORD_RHYTHMS },
        { transform: 'drumPattern', argumentName: 'style', vocabulary: DRUM_PATTERN_STYLES },
        { transform: 'melody', argumentName: 'style', vocabulary: MELODY_STYLES },
        { transform: 'melody', argumentName: 'scale', vocabulary: MELODY_SCALES },
    ])(
        'publishes $transform $argumentName with exactly the generation vocabulary behind it',
        ({ transform, argumentName, vocabulary }) => {
            const published = getMidiTransformDescriptors().find((candidate) => candidate.name === transform);

            expect(published?.parameters.properties[argumentName]?.enum).toEqual([...vocabulary]);
        }
    );

    it.each(NOTE_BOUNDS_CASES)('$transform writes every note inside its own bars with $variant', (boundsCase) => {
        const descriptor = getMidiTransformDescriptors().find((candidate) => candidate.name === boundsCase.transform);
        if (descriptor === undefined) {
            throw new Error(`no descriptor published for ${boundsCase.transform}`);
        }
        for (const bars of BOUNDS_BARS) {
            for (const seed of BOUNDS_SEEDS) {
                const clipSpanBeats = bars * BEATS_PER_BAR;
                const notes = MIDI_TRANSFORM_IMPLEMENTATIONS[boundsCase.transform](
                    { ...publishedArguments(descriptor), ...boundsCase.overrides, bars, seed },
                    { clipSpanBeats }
                );
                expect(notes.length).toBeGreaterThan(0);
                for (const note of notes) {
                    expect(note.startBeat).toBeGreaterThanOrEqual(0);
                    expect(note.startBeat + note.duration).toBeLessThanOrEqual(clipSpanBeats);
                    expect(note.duration).toBeGreaterThanOrEqual(MIDI_NOTE_MIN_DURATION_BEATS);
                }
            }
        }
    });

    /**
     * The bounds cases above hold for any generator that stays inside its bars, so none of them
     * would notice a changed interval, velocity or step. These literals do: they were read from a
     * real run and pin what each generator actually writes for its published defaults at seed 1.
     */
    it.each(getMidiTransformNames())('writes the same notes it always has for %s at seed 1', (name) => {
        const descriptor = getMidiTransformDescriptors().find((candidate) => candidate.name === name);
        if (descriptor === undefined) {
            throw new Error(`no descriptor published for ${name}`);
        }

        const notes = run(descriptor, { ...publishedArguments(descriptor), seed: 1 });

        expect({ count: notes.length, first: notes.slice(0, 3) }).toEqual(SEEDED_CONTENT_PINS[name]);
    });

    describe.each(getMidiTransformNames())('%s', (name) => {
        const descriptor = () => {
            const found = getMidiTransformDescriptors().find((candidate) => candidate.name === name);
            if (found === undefined) {
                throw new Error(`no descriptor published for ${name}`);
            }
            return found;
        };

        it('produces the same notes twice for the same seed', () => {
            const transformArguments = { ...publishedArguments(descriptor()), seed: 12 };

            expect(run(descriptor(), transformArguments)).toEqual(run(descriptor(), transformArguments));
        });

        it('produces notes at all', () => {
            expect(run(descriptor(), publishedArguments(descriptor())).length).toBeGreaterThan(0);
        });

        it('accepts every value its published schema declares and throws outside it', () => {
            const base = publishedArguments(descriptor());
            for (const [argumentName, parameter] of Object.entries(descriptor().parameters.properties)) {
                if (parameter.enum !== undefined) {
                    for (const value of parameter.enum) {
                        expect(() => run(descriptor(), { ...base, [argumentName]: value })).not.toThrow();
                    }
                    expect(() => run(descriptor(), { ...base, [argumentName]: 'not-a-declared-value' })).toThrow();
                    continue;
                }
                const bounds = numericBounds(parameter);
                if (bounds === null) {
                    continue;
                }
                const withinClip = argumentName === 'bars' ? CLIP_SPAN_BEATS / 4 : bounds.maximum;
                expect(() => run(descriptor(), { ...base, [argumentName]: bounds.minimum })).not.toThrow();
                expect(() => run(descriptor(), { ...base, [argumentName]: withinClip })).not.toThrow();
                expect(() => run(descriptor(), { ...base, [argumentName]: bounds.minimum - 1 })).toThrow();
                expect(() => run(descriptor(), { ...base, [argumentName]: bounds.maximum + 1 })).toThrow();
            }
        });
    });
});
