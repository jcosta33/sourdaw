import { hasValidAudioSourceTiles } from '#/utils/audioSourceTime';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { decodeExactTakeLaneSnapshots } from '../stores/takeLaneStore';

import type { TakeLane } from '../models/TakeLane';

function optionalField(value: Record<string, unknown>, key: string, accepts: (field: unknown) => boolean): boolean {
    return !Object.hasOwn(value, key) || value[key] === undefined || accepts(value[key]);
}

function isRetiredTakeLane(value: unknown, lane: TakeLane, clipId: string, trackId?: string): boolean {
    if (
        !isRecord(value) ||
        typeof value.laneIndex !== 'number' ||
        !Number.isSafeInteger(value.laneIndex) ||
        value.laneIndex < 0
    ) {
        return false;
    }
    if (trackId !== undefined && lane.trackId !== trackId) {
        return false;
    }
    return (
        optionalField(
            value,
            'retiredTakeIds',
            (ids) =>
                Array.isArray(ids) &&
                ids.every(
                    (id) =>
                        typeof id === 'string' && lane.takes.some((take) => take.id === id && take.clipId === clipId)
                )
        ) &&
        optionalField(
            value,
            'retiredBaseGapAudioSources',
            (tiles) =>
                hasValidAudioSourceTiles(tiles) &&
                tiles.every(
                    (tile) =>
                        tile.clipId === clipId && lane.baseGapAudioSources?.some((saved) => valuesEqual(saved, tile))
                )
        ) &&
        Object.keys(value).every((key) =>
            ['laneIndex', 'lane', 'retiredTakeIds', 'retiredBaseGapAudioSources'].includes(key)
        )
    );
}

export function isRetiredTakeLanes(value: unknown, clipId: string, trackId?: string): boolean {
    if (!Array.isArray(value)) {
        return false;
    }
    const lanes = decodeExactTakeLaneSnapshots(value.map((entry) => (isRecord(entry) ? entry.lane : undefined)));
    return (
        lanes !== null &&
        new Set(lanes.map((lane) => lane.id)).size === lanes.length &&
        new Set(lanes.map((lane) => lane.trackId)).size === lanes.length &&
        value.every((entry, index) => isRetiredTakeLane(entry, lanes[index]!, clipId, trackId))
    );
}
