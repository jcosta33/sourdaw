import { readTransformChoice, readTransformInteger } from '../../transformers/midiTransformArguments';
import { generateChordProgression } from '../generateChordProgression/algorithm';

import { CHORD_PROGRESSION_STYLES, CHORD_RHYTHMS, CHORD_SCALES, CHORD_VOICINGS } from './generationVocabularies';

const TRANSFORM = 'chordProgression';
const MAX_BARS = 16;
const MAX_SEED = 2_147_483_647;

/**
 * Adapts the pure chord-progression generator to the command contract. Every argument is passed on
 * explicitly — the seed included — so two runs of the same proposal write the same notes.
 */
export function generateChordProgressionTransform(transformArguments: Readonly<Record<string, unknown>>) {
    const result = generateChordProgression({
        bars: readTransformInteger({
            argumentName: 'bars',
            maximum: MAX_BARS,
            minimum: 1,
            transform: TRANSFORM,
            value: transformArguments.bars,
        }),
        key: readTransformInteger({
            argumentName: 'key',
            maximum: 11,
            minimum: 0,
            transform: TRANSFORM,
            value: transformArguments.key,
        }),
        octave: readTransformInteger({
            argumentName: 'octave',
            maximum: 6,
            minimum: 2,
            transform: TRANSFORM,
            value: transformArguments.octave,
        }),
        rhythm: readTransformChoice({
            argumentName: 'rhythm',
            choices: CHORD_RHYTHMS,
            transform: TRANSFORM,
            value: transformArguments.rhythm,
        }),
        scale: readTransformChoice({
            argumentName: 'scale',
            choices: CHORD_SCALES,
            transform: TRANSFORM,
            value: transformArguments.scale,
        }),
        seed: readTransformInteger({
            argumentName: 'seed',
            maximum: MAX_SEED,
            minimum: 0,
            transform: TRANSFORM,
            value: transformArguments.seed,
        }),
        style: readTransformChoice({
            argumentName: 'style',
            choices: CHORD_PROGRESSION_STYLES,
            transform: TRANSFORM,
            value: transformArguments.style,
        }),
        voicing: readTransformChoice({
            argumentName: 'voicing',
            choices: CHORD_VOICINGS,
            transform: TRANSFORM,
            value: transformArguments.voicing,
        }),
    });
    return result.notes;
}
