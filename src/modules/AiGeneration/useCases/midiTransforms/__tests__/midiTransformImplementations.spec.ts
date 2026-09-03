import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    clearMidiTransformRegistry,
    getMidiTransformDescriptors,
    getMidiTransformNames,
    registerMidiTransforms,
} from '#/modules/Command/stores';

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

const CLIP_SPAN_BEATS = 64;

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

function numericBounds(parameter: Parameter): { minimum: number; maximum: number } | null {
    return parameter.type === 'string' || parameter.minimum === undefined || parameter.maximum === undefined
        ? null
        : { minimum: parameter.minimum, maximum: parameter.maximum };
}

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
