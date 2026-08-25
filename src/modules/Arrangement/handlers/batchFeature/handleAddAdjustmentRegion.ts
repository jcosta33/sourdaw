import { createHandler } from '#/utils/createHandler';
import { type AdjustmentLayerSnapshot, type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { adjustmentLayerStore, getNextRegionId, type AdjustmentLayer } from '../../stores/adjustmentLayer';
import { trackStore } from '../../stores/trackStore';
import { addAdjustmentRegion } from '../../useCases/adjustmentLayer/addAdjustmentRegion';

function matchesExpectedLayer(layer: AdjustmentLayer, expected: AdjustmentLayerSnapshot): boolean {
    if (
        layer.id !== expected.id ||
        layer.name !== expected.name ||
        layer.effectType !== expected.effectType ||
        layer.insertionIndex !== expected.insertionIndex ||
        layer.enabled !== expected.enabled ||
        layer.mix !== expected.mix ||
        layer.color !== expected.color ||
        layer.parameters.length !== expected.parameters.length ||
        layer.affectedTrackIds.length !== expected.affectedTrackIds.length ||
        layer.regions.length !== expected.regions.length
    ) {
        return false;
    }
    if (layer.affectedTrackIds.some((trackId, index) => trackId !== expected.affectedTrackIds[index])) {
        return false;
    }
    if (
        layer.parameters.some((parameter, index) => {
            const expectedParameter = expected.parameters[index];
            return (
                !expectedParameter ||
                parameter.name !== expectedParameter.name ||
                parameter.value !== expectedParameter.value ||
                parameter.min !== expectedParameter.min ||
                parameter.max !== expectedParameter.max ||
                parameter.unit !== expectedParameter.unit
            );
        })
    ) {
        return false;
    }
    return !layer.regions.some((region, index) => {
        const expectedRegion = expected.regions[index];
        return (
            !expectedRegion ||
            region.id !== expectedRegion.id ||
            region.startBeat !== expectedRegion.startBeat ||
            region.endBeat !== expectedRegion.endBeat ||
            region.blend !== expectedRegion.blend ||
            region.fadeInBeats !== expectedRegion.fadeInBeats ||
            region.fadeOutBeats !== expectedRegion.fadeOutBeats
        );
    });
}

function expectedLayerAtExecution(
    action: Extract<AppAction, { type: 'addAdjustmentRegion' }>,
    context?: HandlerValidationContext
): AdjustmentLayerSnapshot | undefined {
    if (!action.payload.expectedLayer) {
        return undefined;
    }
    const expectedLayer = structuredClone(action.payload.expectedLayer);
    let expectedRegions = [...expectedLayer.regions];
    if (!context) {
        return expectedLayer;
    }
    for (const priorAction of context.actions.slice(0, context.actionIndex)) {
        if (
            priorAction.type !== 'addAdjustmentRegion' ||
            priorAction.payload.layerId !== action.payload.layerId ||
            !priorAction.payload.regionId
        ) {
            continue;
        }
        if (!expectedRegions.some((region) => region.id === priorAction.payload.regionId)) {
            expectedRegions.push({
                id: priorAction.payload.regionId,
                startBeat: priorAction.payload.startBeat,
                endBeat: priorAction.payload.endBeat,
                blend: priorAction.payload.blend ?? 1,
                fadeInBeats: priorAction.payload.fadeInBeats ?? 0.25,
                fadeOutBeats: priorAction.payload.fadeOutBeats ?? 0.25,
            });
        }
        expectedRegions = expectedRegions.toSorted((alpha, beta) => alpha.startBeat - beta.startBeat);
    }
    return { ...expectedLayer, regions: expectedRegions };
}

function expectedLayerAtValidation(
    action: Extract<AppAction, { type: 'addAdjustmentRegion' }>,
    context: HandlerValidationContext
): AdjustmentLayerSnapshot | undefined {
    if (!action.payload.expectedLayer) {
        return undefined;
    }
    const priorRegionIds = new Set(
        context.actions
            .slice(0, context.actionIndex)
            .filter(
                (priorAction) =>
                    priorAction.type === 'addAdjustmentRegion' &&
                    priorAction.payload.layerId === action.payload.layerId &&
                    priorAction.payload.regionId !== undefined
            )
            .map((priorAction) =>
                priorAction.type === 'addAdjustmentRegion' ? priorAction.payload.regionId : undefined
            )
            .filter((regionId): regionId is string => regionId !== undefined)
    );
    return {
        ...structuredClone(action.payload.expectedLayer),
        regions: action.payload.expectedLayer.regions.filter((region) => !priorRegionIds.has(region.id)),
    };
}

function currentStateMatches(
    action: Extract<AppAction, { type: 'addAdjustmentRegion' }>,
    expectedLayer = action.payload.expectedLayer
): boolean {
    if (!expectedLayer) {
        return true;
    }
    const currentLayer = adjustmentLayerStore.value?.layers.find((layer) => layer.id === action.payload.layerId);
    if (!currentLayer || !matchesExpectedLayer(currentLayer, expectedLayer)) {
        return false;
    }
    const tracks = trackStore.value?.tracks ?? [];
    const tracksChanged = (action.payload.expectedTracks ?? []).some((expected) => {
        const track = tracks.find((candidate) => candidate.id === expected.trackId);
        return !track || track.frozen !== expected.frozen;
    });
    const regionIdInUse =
        action.payload.regionId !== undefined &&
        (adjustmentLayerStore.value?.layers ?? []).some((layer) =>
            layer.regions.some((region) => region.id === action.payload.regionId)
        );
    return !tracksChanged && !regionIdInUse;
}

export const handleAddAdjustmentRegion = createHandler<'addAdjustmentRegion'>({
    canReapplyAfterDivergence: (action) => action.payload.expectedLayer !== undefined,
    validate: (action, context) => currentStateMatches(action, expectedLayerAtValidation(action, context)),
    execute: (a, context) => {
        const expectedLayer = expectedLayerAtExecution(a, context);
        if (!currentStateMatches(a, expectedLayer)) {
            return { status: 'conflict' as const };
        }
        a.payload.regionId ??= getNextRegionId();
        addAdjustmentRegion({
            layerId: a.payload.layerId,
            startBeat: a.payload.startBeat,
            endBeat: a.payload.endBeat,
            blend: a.payload.blend,
            fadeInBeats: a.payload.fadeInBeats,
            fadeOutBeats: a.payload.fadeOutBeats,
            regionId: a.payload.regionId,
        });
        return { status: 'written' as const };
    },
    describe: (a) => {
        if (!a.payload.regionId || !a.payload.expectedLayer) {
            return { label: 'Add Adjustment Region' };
        }
        return {
            label: 'Add Adjustment Region',
            inverseAction: {
                type: 'removeAdjustmentRegion',
                payload: {
                    layerId: a.payload.layerId,
                    regionId: a.payload.regionId,
                    expectedRegion: {
                        id: a.payload.regionId,
                        startBeat: a.payload.startBeat,
                        endBeat: a.payload.endBeat,
                        blend: a.payload.blend ?? 1,
                        fadeInBeats: a.payload.fadeInBeats ?? 0.25,
                        fadeOutBeats: a.payload.fadeOutBeats ?? 0.25,
                    },
                    ...(a.payload.expectedTracks ? { expectedTracks: a.payload.expectedTracks } : {}),
                },
            },
        };
    },
    undoable: true,
});
