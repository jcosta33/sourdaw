import { type AppAction } from '#/utils/handlerContract';

import {
    EFFECT_PRESETS,
    LAYER_COLORS,
    adjustmentLayerStore,
    type AdjustmentEffectType,
    type AdjustmentLayer,
    type AdjustmentRegion,
} from '../../stores/adjustmentLayer';
import { trackStore, type Track } from '../../stores/trackStore';

type AdjustmentLayerMutationAction = Extract<
    AppAction,
    {
        type:
            | 'createAdjustmentLayer'
            | 'removeAdjustmentLayer'
            | 'toggleAdjustmentLayer'
            | 'setLayerParameter'
            | 'setLayerMix'
            | 'addAdjustmentRegion'
            | 'removeAdjustmentRegion'
            | 'moveAdjustmentRegion'
            | 'setLayerFades'
            | 'setLayerAffectedTracks'
            | 'setLayerInsertionIndex';
    }
>;

type RestoreAdjustmentLayerMutationAction = Extract<AppAction, { type: 'restoreAdjustmentLayerMutation' }>;
type AdjustmentLayerUndoOperation = RestoreAdjustmentLayerMutationAction['payload']['operation'];

type RegionLocation = {
    layer: AdjustmentLayer;
    region: AdjustmentRegion;
    regionIndex: number;
};

function clone_layer(layer: AdjustmentLayer): AdjustmentLayer {
    return {
        ...layer,
        parameters: layer.parameters.map((parameter) => ({ ...parameter })),
        affectedTrackIds: [...layer.affectedTrackIds],
        regions: layer.regions.map((region) => ({ ...region })),
    };
}

function resolve_affected_track_ids(layer: AdjustmentLayer, tracks: readonly Track[]): string[] {
    if (layer.affectedTrackIds.length > 0) {
        const track_ids = new Set(tracks.map((track) => track.id));
        return layer.affectedTrackIds.filter((track_id) => track_ids.has(track_id));
    }
    return tracks.slice(layer.insertionIndex).map((track) => track.id);
}

function get_unique_layer(layers: readonly AdjustmentLayer[], layer_id: string): AdjustmentLayer | undefined {
    const matches = layers.filter((layer) => layer.id === layer_id);
    if (matches.length > 1) {
        throw new Error(`Ambiguous adjustment layer id: ${layer_id}`);
    }
    return matches[0];
}

function get_unique_region_location(layers: readonly AdjustmentLayer[], region_id: string): RegionLocation | undefined {
    const matches = layers.flatMap((layer) =>
        layer.regions.flatMap((region, regionIndex) =>
            region.id === region_id ? [{ layer, region, regionIndex }] : []
        )
    );
    if (matches.length > 1) {
        throw new Error(`Ambiguous adjustment region id: ${region_id}`);
    }
    return matches[0];
}

function add_affected_tracks(target: Set<string>, layer: AdjustmentLayer, tracks: readonly Track[]): void {
    for (const track_id of resolve_affected_track_ids(layer, tracks)) {
        target.add(track_id);
    }
}

function is_adjustment_effect_type(value: string): value is AdjustmentEffectType {
    return Object.prototype.hasOwnProperty.call(EFFECT_PRESETS, value);
}

function create_undo_operation(
    action: AdjustmentLayerMutationAction,
    layers: readonly AdjustmentLayer[],
    tracks: readonly Track[],
    affected_track_ids: Set<string>
): AdjustmentLayerUndoOperation | null {
    switch (action.type) {
        case 'createAdjustmentLayer': {
            const layer_id = action.payload.layerId;
            if (!layer_id) {
                throw new Error('Adjustment layer id is required before execution');
            }
            if (layers.some((layer) => layer.id === layer_id)) {
                throw new Error(`Adjustment layer id collision: ${layer_id}`);
            }
            if (!is_adjustment_effect_type(action.payload.effectType)) {
                return null;
            }
            const effect_type = action.payload.effectType;
            const parameters = EFFECT_PRESETS[effect_type];
            const expected_layer: AdjustmentLayer = {
                id: layer_id,
                name: action.payload.name,
                effectType: effect_type,
                parameters: parameters.map((parameter) => ({ ...parameter })),
                affectedTrackIds: [],
                insertionIndex: 0,
                regions: [],
                enabled: true,
                mix: 1,
                color: LAYER_COLORS[layers.length % LAYER_COLORS.length]!,
            };
            add_affected_tracks(affected_track_ids, expected_layer, tracks);
            return { kind: 'remove-created-layer', layerId: layer_id, expectedLayer: expected_layer };
        }
        case 'removeAdjustmentLayer': {
            const layer = get_unique_layer(layers, action.payload.layerId);
            if (!layer) {
                return null;
            }
            add_affected_tracks(affected_track_ids, layer, tracks);
            return {
                kind: 'restore-removed-layer',
                layer: clone_layer(layer),
                layerIndex: layers.indexOf(layer),
            };
        }
        case 'toggleAdjustmentLayer': {
            const layer = get_unique_layer(layers, action.payload.layerId);
            if (!layer) {
                return null;
            }
            add_affected_tracks(affected_track_ids, layer, tracks);
            return { kind: 'restore-enabled', layerId: layer.id, previous: layer.enabled, expected: !layer.enabled };
        }
        case 'setLayerParameter': {
            const layer = get_unique_layer(layers, action.payload.layerId);
            const parameter = layer?.parameters.find((candidate) => candidate.name === action.payload.paramName);
            if (!layer || !parameter) {
                return null;
            }
            add_affected_tracks(affected_track_ids, layer, tracks);
            return {
                kind: 'restore-parameter',
                layerId: layer.id,
                parameterName: parameter.name,
                previous: parameter.value,
                expected: Math.max(parameter.min, Math.min(parameter.max, action.payload.value)),
            };
        }
        case 'setLayerMix': {
            const layer = get_unique_layer(layers, action.payload.layerId);
            if (!layer) {
                return null;
            }
            add_affected_tracks(affected_track_ids, layer, tracks);
            return {
                kind: 'restore-mix',
                layerId: layer.id,
                previous: layer.mix,
                expected: Math.max(0, Math.min(1, action.payload.mix)),
            };
        }
        case 'addAdjustmentRegion': {
            const layer = get_unique_layer(layers, action.payload.layerId);
            const region_id = action.payload.regionId;
            if (!layer || !region_id) {
                return null;
            }
            if (get_unique_region_location(layers, region_id)) {
                throw new Error(`Adjustment region id collision: ${region_id}`);
            }
            add_affected_tracks(affected_track_ids, layer, tracks);
            return {
                kind: 'remove-added-region',
                layerId: layer.id,
                regionId: region_id,
                expectedRegion: {
                    id: region_id,
                    startBeat: action.payload.startBeat,
                    endBeat: action.payload.endBeat,
                    blend: action.payload.blend ?? 1,
                    fadeInBeats: 0.25,
                    fadeOutBeats: 0.25,
                },
            };
        }
        case 'removeAdjustmentRegion': {
            const layer = get_unique_layer(layers, action.payload.layerId);
            const location = get_unique_region_location(layers, action.payload.regionId);
            if (!layer || !location || location.layer.id !== layer.id) {
                return null;
            }
            add_affected_tracks(affected_track_ids, layer, tracks);
            return {
                kind: 'restore-removed-region',
                layerId: layer.id,
                region: { ...location.region },
                regionIndex: location.regionIndex,
            };
        }
        case 'moveAdjustmentRegion': {
            const location = get_unique_region_location(layers, action.payload.regionId);
            if (!location) {
                return null;
            }
            get_unique_layer(layers, location.layer.id);
            add_affected_tracks(affected_track_ids, location.layer, tracks);
            const expected_start = Math.max(0, Math.min(action.payload.startBeat, action.payload.endBeat));
            return {
                kind: 'restore-region-position',
                layerId: location.layer.id,
                regionId: location.region.id,
                previousStartBeat: location.region.startBeat,
                previousEndBeat: location.region.endBeat,
                expectedStartBeat: expected_start,
                expectedEndBeat: Math.max(expected_start, action.payload.endBeat),
            };
        }
        case 'setLayerFades': {
            const location = get_unique_region_location(layers, action.payload.regionId);
            if (!location) {
                return null;
            }
            get_unique_layer(layers, location.layer.id);
            add_affected_tracks(affected_track_ids, location.layer, tracks);
            return {
                kind: 'restore-region-fades',
                layerId: location.layer.id,
                regionId: location.region.id,
                previousFadeInBeats: location.region.fadeInBeats,
                previousFadeOutBeats: location.region.fadeOutBeats,
                expectedFadeInBeats: Math.max(0, action.payload.fadeInBeats),
                expectedFadeOutBeats: Math.max(0, action.payload.fadeOutBeats),
            };
        }
        case 'setLayerAffectedTracks': {
            const layer = get_unique_layer(layers, action.payload.layerId);
            if (!layer) {
                return null;
            }
            const expected = Array.from(new Set(action.payload.trackIds));
            add_affected_tracks(affected_track_ids, layer, tracks);
            add_affected_tracks(affected_track_ids, { ...layer, affectedTrackIds: expected }, tracks);
            return {
                kind: 'restore-affected-tracks',
                layerId: layer.id,
                previous: [...layer.affectedTrackIds],
                expected,
            };
        }
        case 'setLayerInsertionIndex': {
            const layer = get_unique_layer(layers, action.payload.layerId);
            if (!layer) {
                return null;
            }
            const expected = Math.max(0, Math.floor(action.payload.insertionIndex));
            add_affected_tracks(affected_track_ids, layer, tracks);
            add_affected_tracks(affected_track_ids, { ...layer, insertionIndex: expected }, tracks);
            return {
                kind: 'restore-insertion-index',
                layerId: layer.id,
                previous: layer.insertionIndex,
                expected,
            };
        }
        default: {
            const exhaustive_action: never = action;
            return exhaustive_action;
        }
    }
}

export function getAdjustmentLayerMutationId(action: AdjustmentLayerMutationAction): string {
    action.payload.adjustmentMutationId ??= crypto.randomUUID();
    return action.payload.adjustmentMutationId;
}

export function createAdjustmentLayerMutationInverse(
    action: AdjustmentLayerMutationAction
): RestoreAdjustmentLayerMutationAction | null {
    const layer_state = adjustmentLayerStore.value;
    const track_state = trackStore.value;
    if (!layer_state || !track_state) {
        return null;
    }

    const affected_track_ids = new Set<string>();
    const operation = create_undo_operation(action, layer_state.layers, track_state.tracks, affected_track_ids);
    if (!operation) {
        return null;
    }

    const adjustment_mutation_id = getAdjustmentLayerMutationId(action);
    return {
        type: 'restoreAdjustmentLayerMutation',
        payload: {
            adjustmentMutationId: adjustment_mutation_id,
            operation,
            staleTransitions: track_state.tracks.flatMap((track) => {
                if (
                    !affected_track_ids.has(track.id) ||
                    !track.frozen ||
                    (track.freezeState.status !== 'frozen' && track.freezeState.status !== 'stale')
                ) {
                    return [];
                }
                return [
                    {
                        trackId: track.id,
                        previousStatus: track.freezeState.status,
                        ...(track.freezeState.adjustmentLayerMutationId
                            ? { previousAdjustmentMutationId: track.freezeState.adjustmentLayerMutationId }
                            : {}),
                    },
                ];
            }),
        },
    };
}
