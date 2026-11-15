import { type MaterializableRuntimeAction } from '../../models/ExecutableRuntimeAction';

import { type MaterializationState, type MaterializationStep } from './MaterializationState';

type Action = Extract<MaterializableRuntimeAction, { type: 'addAdjustmentRegion' }>;

export function materializeAdjustmentRegion(action: Action, state: MaterializationState): MaterializationStep {
    const { options, tracksById, reservedAdjustmentRegionIds, projectedAdjustmentLayers } = state;
    const scope = options.bassProcessingCopyScope;
    const entry = scope?.entries.find(
        (candidate) =>
            candidate.layer.id === action.payload.layerId &&
            candidate.targetRegion.startBeat === action.payload.startBeat &&
            candidate.targetRegion.endBeat === action.payload.endBeat &&
            candidate.targetRegion.blend === action.payload.blend &&
            candidate.targetRegion.fadeInBeats === action.payload.fadeInBeats &&
            candidate.targetRegion.fadeOutBeats === action.payload.fadeOutBeats
    );
    const layer = projectedAdjustmentLayers.get(action.payload.layerId);
    if (!scope || !entry || !layer) {
        return { status: 'rejected', reason: 'EX-03 adjustment-layer scope is unavailable' };
    }
    const expectedTracks = layer.affectedTrackIds.flatMap((trackId) => {
        const track = tracksById.get(trackId);
        return track ? [{ trackId: track.id, trackName: track.name, frozen: track.frozen ?? false }] : [];
    });
    if (expectedTracks.length !== layer.affectedTrackIds.length) {
        return { status: 'rejected', reason: `EX-03 target track is unavailable: ${layer.id}` };
    }
    let regionId = `adjr-${crypto.randomUUID()}`;
    while (reservedAdjustmentRegionIds.has(regionId)) {
        regionId = `adjr-${crypto.randomUUID()}`;
    }
    reservedAdjustmentRegionIds.add(regionId);
    const region = {
        id: regionId,
        startBeat: action.payload.startBeat,
        endBeat: action.payload.endBeat,
        blend: action.payload.blend,
        fadeInBeats: action.payload.fadeInBeats,
        fadeOutBeats: action.payload.fadeOutBeats,
    };
    projectedAdjustmentLayers.set(layer.id, {
        ...layer,
        regions: [...layer.regions, region].sort((alpha, beta) => alpha.startBeat - beta.startBeat),
    });
    return {
        status: 'accepted',
        actions: [
            {
                type: 'addAdjustmentRegion',
                payload: {
                    ...action.payload,
                    regionId,
                    sourceRegionId: entry.sourceRegion.id,
                    sourceSection: structuredClone(scope.sourceSection),
                    targetSection: structuredClone(scope.targetSection),
                    expectedLayer: structuredClone(layer),
                    expectedTracks,
                },
            },
        ],
    };
}
