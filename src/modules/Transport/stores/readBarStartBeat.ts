import { getBarStartBeat } from '../models/TimeSignatureMap';

import { timeSignatureMapStore } from './timeSignatureMapStore';
import { transportStore } from './transportStore';

type ReadBarStartBeatInput = {
    bar: number;
};

/**
 * The beat a 1-based bar opens on through the project's meter map, or `null` for a bar number
 * that names no bar.
 *
 * The read a foreign handler wants when it has to turn a bar the user named into a timeline
 * position: a handler cannot reach Transport's use-case barrel without closing an import cycle
 * through `ensureTrackStrips`, and a flat `numerator * 4 / denominator` per bar is wrong as soon as
 * the meter changes.
 */
export function readBarStartBeat({ bar }: ReadBarStartBeatInput): number | null {
    return getBarStartBeat(
        timeSignatureMapStore.value?.changes ?? [],
        bar,
        transportStore.value?.timeSignatureNumerator ?? 4,
        transportStore.value?.timeSignatureDenominator ?? 4
    );
}
