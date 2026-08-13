import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { adjustmentLayerStore, type AdjustmentLayer } from '../../stores/adjustmentLayer';
import { trackStore } from '../../stores/trackStore';
import { removeAdjustmentRegion } from '../../useCases/adjustmentLayer/removeAdjustmentRegion';

type AdjustmentRegion = AdjustmentLayer['regions'][number];

function matchesExpectedRegion(current: AdjustmentRegion, expected: AdjustmentRegion): boolean {
    return (
        current.id === expected.id &&
        current.startBeat === expected.startBeat &&
        current.endBeat === expected.endBeat &&
        current.blend === expected.blend &&
        current.fadeInBeats === expected.fadeInBeats &&
        current.fadeOutBeats === expected.fadeOutBeats
    );
}

function currentStateMatches(action: Extract<AppAction, { type: 'removeAdjustmentRegion' }>): boolean {
    if (!action.payload.expectedRegion) {
        return true;
    }
    const layer = adjustmentLayerStore.value?.layers.find((candidate) => candidate.id === action.payload.layerId);
    const region = layer?.regions.find((candidate) => candidate.id === action.payload.regionId);
    const tracks = trackStore.value?.tracks ?? [];
    const tracksChanged = (action.payload.expectedTracks ?? []).some((expected) => {
        const track = tracks.find((candidate) => candidate.id === expected.trackId);
        return !track || track.frozen !== expected.frozen;
    });
    return Boolean(region && matchesExpectedRegion(region, action.payload.expectedRegion) && !tracksChanged);
}

export const handleRemoveAdjustmentRegion = createHandler<'removeAdjustmentRegion'>({
    validate: (action) => currentStateMatches(action),
    execute: (a) => {
        if (!currentStateMatches(a)) {
            return { status: 'conflict' as const };
        }
        removeAdjustmentRegion(a.payload.layerId, a.payload.regionId);
        return { status: 'written' as const };
    },
    describe: (a) => {
        if (!a.payload.expectedRegion) {
            return { label: 'Remove Adjustment Region' };
        }
        const layer = adjustmentLayerStore.value?.layers.find((candidate) => candidate.id === a.payload.layerId);
        if (!layer) {
            return { label: 'Remove Adjustment Region' };
        }
        return {
            label: 'Remove Adjustment Region',
            inverseAction: {
                type: 'addAdjustmentRegion',
                payload: {
                    layerId: a.payload.layerId,
                    startBeat: a.payload.expectedRegion.startBeat,
                    endBeat: a.payload.expectedRegion.endBeat,
                    blend: a.payload.expectedRegion.blend,
                    fadeInBeats: a.payload.expectedRegion.fadeInBeats,
                    fadeOutBeats: a.payload.expectedRegion.fadeOutBeats,
                    regionId: a.payload.regionId,
                    expectedLayer: toSnapshotWithoutRegion(layer, a.payload.regionId),
                    ...(a.payload.expectedTracks ? { expectedTracks: a.payload.expectedTracks } : {}),
                },
            },
        };
    },
    undoable: true,
});

function toSnapshotWithoutRegion(layer: AdjustmentLayer, regionId: string) {
    return {
        ...layer,
        parameters: layer.parameters.map((parameter) => ({ ...parameter })),
        affectedTrackIds: [...layer.affectedTrackIds],
        regions: layer.regions.filter((region) => region.id !== regionId).map((region) => ({ ...region })),
    };
}
