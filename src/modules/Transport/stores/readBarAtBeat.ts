import { getBarAtBeat } from '../models/TimeSignatureMap';

import { timeSignatureMapStore } from './timeSignatureMapStore';
import { transportStore } from './transportStore';

type ReadBarAtBeatInput = {
    beat: number;
};

/**
 * The 1-based bar a beat falls in through the project's meter map, and whether the beat is that
 * bar's bar line. A foreign handler reads it for the same reason it reads `readBarStartBeat`.
 */
export function readBarAtBeat({ beat }: ReadBarAtBeatInput): { bar: number; opensBar: boolean } {
    return getBarAtBeat(
        timeSignatureMapStore.value?.changes ?? [],
        beat,
        transportStore.value?.timeSignatureNumerator ?? 4,
        transportStore.value?.timeSignatureDenominator ?? 4
    );
}
