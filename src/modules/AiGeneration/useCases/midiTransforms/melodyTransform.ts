import {
    readTransformChoice,
    readTransformInteger,
    readTransformNumber,
} from '../../transformers/midiTransformArguments';
import { generateMelody } from '../generateMelody/algorithm';

import { MELODY_SCALES, MELODY_STYLES } from './generationVocabularies';

const TRANSFORM = 'melody';
const MAX_BARS = 16;
const MAX_RANGE_SEMITONES = 36;
const MAX_SEED = 2_147_483_647;

/** Adapts the pure melody generator to the command contract, passing every argument explicitly. */
export function generateMelodyTransform(transformArguments: Readonly<Record<string, unknown>>) {
    const result = generateMelody({
        bars: readTransformInteger({
            argumentName: 'bars',
            maximum: MAX_BARS,
            minimum: 1,
            transform: TRANSFORM,
            value: transformArguments.bars,
        }),
        density: readTransformNumber({
            argumentName: 'density',
            maximum: 1,
            minimum: 0,
            transform: TRANSFORM,
            value: transformArguments.density,
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
        range: readTransformInteger({
            argumentName: 'range',
            maximum: MAX_RANGE_SEMITONES,
            minimum: 1,
            transform: TRANSFORM,
            value: transformArguments.range,
        }),
        scale: readTransformChoice({
            argumentName: 'scale',
            choices: MELODY_SCALES,
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
            choices: MELODY_STYLES,
            transform: TRANSFORM,
            value: transformArguments.style,
        }),
    });
    return result.notes;
}
