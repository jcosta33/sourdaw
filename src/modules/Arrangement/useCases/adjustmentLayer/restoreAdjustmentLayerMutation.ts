import { batchStoreUpdates } from '#/infra/store/createStore';
import { type AppAction } from '#/utils/handlerContract';

import { adjustmentLayerStore, type AdjustmentLayer, type AdjustmentRegion } from '../../stores/adjustmentLayer';
import { trackStore } from '../../stores/trackStore';

type RestoreAdjustmentLayerMutationPayload = Extract<AppAction, { type: 'restoreAdjustmentLayerMutation' }>['payload'];
type AdjustmentLayerUndoOperation = RestoreAdjustmentLayerMutationPayload['operation'];

type RestoreOperationResult = {
    applied: boolean;
    layers: AdjustmentLayer[];
};

function clone_layer(layer: AdjustmentLayer): AdjustmentLayer {
    return {
        ...layer,
        parameters: layer.parameters.map((parameter) => ({ ...parameter })),
        affectedTrackIds: [...layer.affectedTrackIds],
        regions: layer.regions.map((region) => ({ ...region })),
    };
}

function same_string_array(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function same_region(left: AdjustmentRegion, right: AdjustmentRegion): boolean {
    return (
        left.id === right.id &&
        left.startBeat === right.startBeat &&
        left.endBeat === right.endBeat &&
        left.blend === right.blend &&
        left.fadeInBeats === right.fadeInBeats &&
        left.fadeOutBeats === right.fadeOutBeats
    );
}

function same_layer(left: AdjustmentLayer, right: AdjustmentLayer): boolean {
    return (
        left.id === right.id &&
        left.name === right.name &&
        left.effectType === right.effectType &&
        left.insertionIndex === right.insertionIndex &&
        left.enabled === right.enabled &&
        left.mix === right.mix &&
        left.color === right.color &&
        same_string_array(left.affectedTrackIds, right.affectedTrackIds) &&
        left.parameters.length === right.parameters.length &&
        left.parameters.every((parameter, index) => {
            const expected = right.parameters[index];
            return (
                expected !== undefined &&
                parameter.name === expected.name &&
                parameter.value === expected.value &&
                parameter.min === expected.min &&
                parameter.max === expected.max &&
                parameter.unit === expected.unit
            );
        }) &&
        left.regions.length === right.regions.length &&
        left.regions.every((region, index) => {
            const expected = right.regions[index];
            return expected !== undefined && same_region(region, expected);
        })
    );
}

function get_unique_layer_index(layers: readonly AdjustmentLayer[], layer_id: string): number {
    const matches = layers.flatMap((layer, index) => (layer.id === layer_id ? [index] : []));
    return matches.length === 1 ? matches[0]! : -1;
}

function replace_layer(layers: readonly AdjustmentLayer[], index: number, layer: AdjustmentLayer): AdjustmentLayer[] {
    return layers.map((current, current_index) => (current_index === index ? layer : current));
}

function restore_operation(
    layers: readonly AdjustmentLayer[],
    operation: AdjustmentLayerUndoOperation
): RestoreOperationResult {
    if (operation.kind === 'remove-created-layer') {
        const index = get_unique_layer_index(layers, operation.layerId);
        if (index === -1 || !same_layer(layers[index]!, operation.expectedLayer)) {
            return { applied: false, layers: [...layers] };
        }
        return { applied: true, layers: layers.filter((_, current_index) => current_index !== index) };
    }

    if (operation.kind === 'restore-removed-layer') {
        if (layers.some((layer) => layer.id === operation.layer.id)) {
            return { applied: false, layers: [...layers] };
        }
        const index = Math.max(0, Math.min(operation.layerIndex, layers.length));
        const restored = [...layers];
        restored.splice(index, 0, clone_layer(operation.layer));
        return { applied: true, layers: restored };
    }

    const layer_index = get_unique_layer_index(layers, operation.layerId);
    if (layer_index === -1) {
        return { applied: false, layers: [...layers] };
    }
    const layer = layers[layer_index]!;

    switch (operation.kind) {
        case 'restore-enabled':
            if (layer.enabled !== operation.expected) {
                return { applied: false, layers: [...layers] };
            }
            return {
                applied: true,
                layers: replace_layer(layers, layer_index, { ...layer, enabled: operation.previous }),
            };
        case 'restore-parameter': {
            const parameter_index = layer.parameters.findIndex(
                (parameter) => parameter.name === operation.parameterName
            );
            const parameter = layer.parameters[parameter_index];
            if (!parameter || parameter.value !== operation.expected) {
                return { applied: false, layers: [...layers] };
            }
            const parameters = layer.parameters.map((current, index) =>
                index === parameter_index ? { ...current, value: operation.previous } : current
            );
            return {
                applied: true,
                layers: replace_layer(layers, layer_index, { ...layer, parameters }),
            };
        }
        case 'restore-mix':
            if (layer.mix !== operation.expected) {
                return { applied: false, layers: [...layers] };
            }
            return {
                applied: true,
                layers: replace_layer(layers, layer_index, { ...layer, mix: operation.previous }),
            };
        case 'remove-added-region': {
            const region_index = layer.regions.findIndex((region) => region.id === operation.regionId);
            const region = layer.regions[region_index];
            if (!region || !same_region(region, operation.expectedRegion)) {
                return { applied: false, layers: [...layers] };
            }
            const regions = layer.regions.filter((_, index) => index !== region_index);
            return {
                applied: true,
                layers: replace_layer(layers, layer_index, { ...layer, regions }),
            };
        }
        case 'restore-removed-region': {
            if (layer.regions.some((region) => region.id === operation.region.id)) {
                return { applied: false, layers: [...layers] };
            }
            const region_index = Math.max(0, Math.min(operation.regionIndex, layer.regions.length));
            const regions = [...layer.regions];
            regions.splice(region_index, 0, { ...operation.region });
            return {
                applied: true,
                layers: replace_layer(layers, layer_index, { ...layer, regions }),
            };
        }
        case 'restore-region-position': {
            const region_index = layer.regions.findIndex((region) => region.id === operation.regionId);
            const region = layer.regions[region_index];
            if (
                !region ||
                region.startBeat !== operation.expectedStartBeat ||
                region.endBeat !== operation.expectedEndBeat
            ) {
                return { applied: false, layers: [...layers] };
            }
            const regions = layer.regions
                .map((current, index) =>
                    index === region_index
                        ? {
                              ...current,
                              startBeat: operation.previousStartBeat,
                              endBeat: operation.previousEndBeat,
                          }
                        : current
                )
                .sort((left, right) => left.startBeat - right.startBeat);
            return {
                applied: true,
                layers: replace_layer(layers, layer_index, { ...layer, regions }),
            };
        }
        case 'restore-region-fades': {
            const region_index = layer.regions.findIndex((region) => region.id === operation.regionId);
            const region = layer.regions[region_index];
            if (
                !region ||
                region.fadeInBeats !== operation.expectedFadeInBeats ||
                region.fadeOutBeats !== operation.expectedFadeOutBeats
            ) {
                return { applied: false, layers: [...layers] };
            }
            const regions = layer.regions.map((current, index) =>
                index === region_index
                    ? {
                          ...current,
                          fadeInBeats: operation.previousFadeInBeats,
                          fadeOutBeats: operation.previousFadeOutBeats,
                      }
                    : current
            );
            return {
                applied: true,
                layers: replace_layer(layers, layer_index, { ...layer, regions }),
            };
        }
        case 'restore-affected-tracks':
            if (!same_string_array(layer.affectedTrackIds, operation.expected)) {
                return { applied: false, layers: [...layers] };
            }
            return {
                applied: true,
                layers: replace_layer(layers, layer_index, {
                    ...layer,
                    affectedTrackIds: [...operation.previous],
                }),
            };
        case 'restore-insertion-index':
            if (layer.insertionIndex !== operation.expected) {
                return { applied: false, layers: [...layers] };
            }
            return {
                applied: true,
                layers: replace_layer(layers, layer_index, {
                    ...layer,
                    insertionIndex: operation.previous,
                }),
            };
        default: {
            const exhaustive_operation: never = operation;
            return exhaustive_operation;
        }
    }
}

export function restoreAdjustmentLayerMutation(payload: RestoreAdjustmentLayerMutationPayload): void {
    const layer_state = adjustmentLayerStore.value;
    if (!layer_state) {
        return;
    }
    const restored = restore_operation(layer_state.layers, payload.operation);
    if (!restored.applied) {
        throw new Error('Cannot undo adjustment-layer mutation over newer adjustment-layer state');
    }

    batchStoreUpdates(() => {
        const track_state = trackStore.value;
        if (track_state && payload.staleTransitions.length > 0) {
            const stale_transitions = new Map(payload.staleTransitions.map((entry) => [entry.trackId, entry]));
            const tracks = track_state.tracks.map((track) => {
                const stale_transition = stale_transitions.get(track.id);
                if (
                    !stale_transition ||
                    track.freezeState.status !== 'stale' ||
                    track.freezeState.adjustmentLayerMutationId !== payload.adjustmentMutationId
                ) {
                    return track;
                }
                const freeze_state = {
                    ...track.freezeState,
                    status: stale_transition.previousStatus,
                };
                if (stale_transition.previousAdjustmentMutationId) {
                    freeze_state.adjustmentLayerMutationId = stale_transition.previousAdjustmentMutationId;
                } else {
                    delete freeze_state.adjustmentLayerMutationId;
                }
                return { ...track, freezeState: freeze_state };
            });
            if (tracks.some((track, index) => track !== track_state.tracks[index])) {
                trackStore.set({ ...track_state, tracks });
            }
        }

        adjustmentLayerStore.set({ layers: restored.layers });
    });
}
