import { type TempoAudioSourcePresenceSnapshot } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { type CompRegion } from '../models/TakeLane';

import { type TakeLaneWriteOperation } from './takeLaneWriteTypes';

function captureRegionSourcePresence(region: CompRegion): TempoAudioSourcePresenceSnapshot {
    if (region.audioSource === undefined) {
        return { present: false };
    }
    return { present: true, value: structuredClone(region.audioSource) };
}

export function captureCompRegionSourceOperations(
    laneId: string,
    before: readonly CompRegion[],
    next: readonly CompRegion[]
): TakeLaneWriteOperation[] | null {
    const geometry = (regions: readonly CompRegion[]) => regions.map(({ audioSource: _source, ...row }) => row);
    if (!valuesEqual(geometry(before), geometry(next))) {
        return null;
    }
    const operations: TakeLaneWriteOperation[] = [];
    for (const [index, region] of before.entries()) {
        const replacement = next[index];
        if (!replacement) {
            return null;
        }
        const expected = captureRegionSourcePresence(region);
        const source = captureRegionSourcePresence(replacement);
        if (!valuesEqual(expected, source)) {
            operations.push({
                kind: 'comp-region-audio-source',
                laneId,
                takeId: region.takeId,
                startBeat: region.startBeat,
                endBeat: region.endBeat,
                expected,
                replacement: source,
            });
        }
    }
    return operations;
}
