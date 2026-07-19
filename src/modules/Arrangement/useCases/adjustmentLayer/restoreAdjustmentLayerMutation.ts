import { batchStoreUpdates } from '#/infra/store/createStore';
import { type AdjustmentLayerMutationRestorePayload } from '#/utils/handlerContract';

import { computeFreezeRenderInputHash } from '../../services/computeFreezeRenderInputHash';
import { computeLegacyTrackHash } from '../../services/computeLegacyTrackHash';
import { computeTrackHash } from '../../services/computeTrackHash';
import {
    adjustmentLayerStore,
    createEffectiveAdjustmentLayerSignature,
    type AdjustmentLayer,
    type AdjustmentRegion,
} from '../../stores/adjustmentLayer';
import { trackStore, type Track } from '../../stores/trackStore';

type RestoreAdjustmentLayerMutationPayload = AdjustmentLayerMutationRestorePayload;
type AdjustmentLayerUndoOperation = RestoreAdjustmentLayerMutationPayload['operation'];
type StaleTransition = RestoreAdjustmentLayerMutationPayload['staleTransitions'][number];
type FrozenArtifact = NonNullable<StaleTransition['frozenArtifact']>;

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

function same_render_settings(
    left: Track['freezeState']['renderSettings'],
    right: FrozenArtifact['renderSettings']
): boolean {
    if (!left || !right) {
        return left === right;
    }
    return (
        left.sampleRate === right.sampleRate &&
        left.bitDepth === right.bitDepth &&
        left.channelCount === right.channelCount &&
        left.tailLengthSeconds === right.tailLengthSeconds
    );
}

function same_frozen_artifact(track: Track, artifact: FrozenArtifact): boolean {
    return (
        track.frozen &&
        track.frozenBufferId === artifact.trackFrozenBufferId &&
        track.freezeState.freezeId === artifact.freezeId &&
        track.freezeState.frozenBufferId === artifact.frozenBufferId &&
        track.freezeState.frozenAudioHash === artifact.frozenAudioHash &&
        track.freezeState.sourceContentHash === artifact.sourceContentHash &&
        track.freezeState.deviceChainHash === artifact.deviceChainHash &&
        same_render_settings(track.freezeState.renderSettings, artifact.renderSettings) &&
        track.freezeState.renderedAt === artifact.renderedAt
    );
}

type FrozenRestoreEvaluation = {
    artifact: FrozenArtifact;
    clips: Track['clips'];
    devices: Track['devices'];
    currentInputHash: string;
    inputsMatch: boolean;
};

function frozen_restore_evaluation_key(adjustment_mutation_id: string, track_id: string): string {
    return `${adjustment_mutation_id}:${track_id}`;
}

async function evaluate_frozen_restores(
    payloads: readonly RestoreAdjustmentLayerMutationPayload[],
    restoredLayers: readonly AdjustmentLayer[]
): Promise<Map<string, FrozenRestoreEvaluation>> {
    const evaluations = new Map<string, FrozenRestoreEvaluation>();
    const track_state = trackStore.value;
    if (!track_state) {
        return evaluations;
    }
    const ordered_track_ids = track_state.tracks.map((track) => track.id);

    await Promise.all(
        payloads.flatMap((payload) =>
            payload.staleTransitions.map(async (transition) => {
                if (transition.previousStatus !== 'frozen' || !transition.frozenArtifact) {
                    return;
                }
                const track = track_state.tracks.find((candidate) => candidate.id === transition.trackId);
                if (!track) {
                    return;
                }
                const adjustment_signature = createEffectiveAdjustmentLayerSignature(
                    restoredLayers,
                    ordered_track_ids,
                    track.id
                );
                const [current_hash, unversioned_render_hash, content_hash, legacy_content_hash] = await Promise.all([
                    computeFreezeRenderInputHash(track.clips, track.devices, adjustment_signature),
                    computeTrackHash(track.clips, track.devices, adjustment_signature),
                    computeTrackHash(track.clips, track.devices),
                    computeLegacyTrackHash(track.clips, track.devices),
                ]);
                evaluations.set(frozen_restore_evaluation_key(payload.adjustmentMutationId, track.id), {
                    artifact: transition.frozenArtifact,
                    clips: track.clips,
                    devices: track.devices,
                    currentInputHash: current_hash,
                    inputsMatch:
                        transition.frozenArtifact.sourceContentHash !== undefined &&
                        (current_hash === transition.frozenArtifact.sourceContentHash ||
                            unversioned_render_hash === transition.frozenArtifact.sourceContentHash ||
                            content_hash === transition.frozenArtifact.sourceContentHash ||
                            legacy_content_hash === transition.frozenArtifact.sourceContentHash) &&
                        same_frozen_artifact(track, transition.frozenArtifact),
                });
            })
        )
    );
    return evaluations;
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

export async function restoreAdjustmentLayerMutation(
    payload: RestoreAdjustmentLayerMutationPayload | RestoreAdjustmentLayerMutationPayload[]
): Promise<void> {
    const payloads = Array.isArray(payload) ? payload : [payload];
    const current_layer_state = adjustmentLayerStore.value;
    if (!current_layer_state) {
        return;
    }
    let restored_layers = current_layer_state.layers;
    for (const current_payload of payloads) {
        const restored = restore_operation(restored_layers, current_payload.operation);
        if (!restored.applied) {
            throw new Error('Cannot undo adjustment-layer mutation over newer adjustment-layer state');
        }
        restored_layers = restored.layers;
    }
    const frozen_restore_evaluations = await evaluate_frozen_restores(payloads, restored_layers);
    if (adjustmentLayerStore.value !== current_layer_state) {
        throw new Error('Cannot undo adjustment-layer mutation over newer adjustment-layer state');
    }

    batchStoreUpdates(() => {
        const track_state = trackStore.value;
        if (track_state && payloads.some((current_payload) => current_payload.staleTransitions.length > 0)) {
            let tracks = track_state.tracks;
            for (const current_payload of payloads) {
                const stale_transitions = new Map(
                    current_payload.staleTransitions.map((entry) => [entry.trackId, entry])
                );
                tracks = tracks.map((track) => {
                    const stale_transition = stale_transitions.get(track.id);
                    if (!stale_transition) {
                        return track;
                    }
                    const frozen_evaluation = frozen_restore_evaluations.get(
                        frozen_restore_evaluation_key(current_payload.adjustmentMutationId, track.id)
                    );
                    if (
                        track.freezeState.status === 'frozen' &&
                        stale_transition.previousStatus === 'frozen' &&
                        frozen_evaluation &&
                        (track.clips !== frozen_evaluation.clips ||
                            track.devices !== frozen_evaluation.devices ||
                            (track.freezeState.sourceContentHash?.startsWith('freeze-v2:') === true &&
                                frozen_evaluation.currentInputHash !== track.freezeState.sourceContentHash))
                    ) {
                        return {
                            ...track,
                            freezeState: {
                                ...track.freezeState,
                                status: 'stale' as const,
                                adjustmentLayerMutationId: current_payload.adjustmentMutationId,
                            },
                        };
                    }
                    if (
                        track.freezeState.status !== 'stale' ||
                        track.freezeState.adjustmentLayerMutationId !== current_payload.adjustmentMutationId
                    ) {
                        return track;
                    }
                    const can_restore_frozen =
                        stale_transition.previousStatus !== 'frozen' ||
                        (frozen_evaluation !== undefined &&
                            frozen_evaluation.inputsMatch &&
                            track.clips === frozen_evaluation.clips &&
                            track.devices === frozen_evaluation.devices &&
                            same_frozen_artifact(track, frozen_evaluation.artifact));
                    const freeze_state = {
                        ...track.freezeState,
                        status: can_restore_frozen ? stale_transition.previousStatus : ('stale' as const),
                    };
                    if (stale_transition.previousAdjustmentMutationId) {
                        freeze_state.adjustmentLayerMutationId = stale_transition.previousAdjustmentMutationId;
                    } else {
                        delete freeze_state.adjustmentLayerMutationId;
                    }
                    return { ...track, freezeState: freeze_state };
                });
            }
            if (tracks.some((track, index) => track !== track_state.tracks[index])) {
                trackStore.set({ ...track_state, tracks });
            }
        }

        adjustmentLayerStore.set({ layers: restored_layers });
    });
}
