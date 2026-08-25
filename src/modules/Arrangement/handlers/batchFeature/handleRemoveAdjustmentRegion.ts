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

function tracksMatchExpectedState(action: Extract<AppAction, { type: 'removeAdjustmentRegion' }>): boolean {
    const tracks = trackStore.value?.tracks ?? [];
    return !(action.payload.expectedTracks ?? []).some((expected) => {
        const track = tracks.find((candidate) => candidate.id === expected.trackId);
        return !track || track.frozen !== expected.frozen;
    });
}

function getRegionOwners(
    action: Extract<AppAction, { type: 'removeAdjustmentRegion' }>
): Array<{ layerId: string; region: AdjustmentRegion }> {
    return (adjustmentLayerStore.value?.layers ?? []).flatMap((layer) =>
        layer.regions
            .filter((region) => region.id === action.payload.regionId)
            .map((region) => ({ layerId: layer.id, region }))
    );
}

function canReapplyAfterDivergence(action: Extract<AppAction, { type: 'removeAdjustmentRegion' }>): boolean {
    const expectedRegion = action.payload.expectedRegion;
    const layers = adjustmentLayerStore.value?.layers;
    if (
        !expectedRegion ||
        expectedRegion.id !== action.payload.regionId ||
        layers?.filter((layer) => layer.id === action.payload.layerId).length !== 1 ||
        !tracksMatchExpectedState(action)
    ) {
        return false;
    }
    const owners = getRegionOwners(action);
    if (owners.length === 0) {
        return true;
    }
    const owner = owners[0];
    return (
        owners.length === 1 &&
        owner?.layerId === action.payload.layerId &&
        matchesExpectedRegion(owner.region, expectedRegion)
    );
}

function currentStateMatches(action: Extract<AppAction, { type: 'removeAdjustmentRegion' }>): boolean {
    if (!action.payload.expectedRegion) {
        return true;
    }
    const owners = getRegionOwners(action);
    const owner = owners[0];
    return Boolean(
        owners.length === 1 &&
        owner?.layerId === action.payload.layerId &&
        matchesExpectedRegion(owner.region, action.payload.expectedRegion) &&
        tracksMatchExpectedState(action)
    );
}

export const handleRemoveAdjustmentRegion = createHandler<'removeAdjustmentRegion'>({
    canReapplyAfterDivergence,
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
