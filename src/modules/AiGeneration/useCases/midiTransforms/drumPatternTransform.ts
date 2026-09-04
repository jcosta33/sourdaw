import {
    readTransformChoice,
    readTransformInteger,
    readTransformNumber,
} from '../../transformers/midiTransformArguments';
import { generateDrumPattern } from '../generateDrumPattern/algorithm';

import { DRUM_PATTERN_STYLES } from './generationVocabularies';

const TRANSFORM = 'drumPattern';
const MAX_BARS = 16;
const MAX_SEED = 2_147_483_647;

/**
 * Adapts the pure drum-pattern generator to the command contract. The generator counts bars in common
 * time, which is what `bars` means in the contract, so its time signature is not a transform
 * argument and stays at the generator's own default.
 */
export function generateDrumPatternTransform(transformArguments: Readonly<Record<string, unknown>>) {
    const result = generateDrumPattern({
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
        seed: readTransformInteger({
            argumentName: 'seed',
            maximum: MAX_SEED,
            minimum: 0,
            transform: TRANSFORM,
            value: transformArguments.seed,
        }),
        style: readTransformChoice({
            argumentName: 'style',
            choices: DRUM_PATTERN_STYLES,
            transform: TRANSFORM,
            value: transformArguments.style,
        }),
        swing: readTransformNumber({
            argumentName: 'swing',
            maximum: 1,
            minimum: 0,
            transform: TRANSFORM,
            value: transformArguments.swing,
        }),
    });
    return result.notes;
}
