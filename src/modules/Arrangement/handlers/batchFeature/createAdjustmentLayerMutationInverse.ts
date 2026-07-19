import { type AppAction } from '#/utils/handlerContract';

import { type AdjustmentLayer, type AdjustmentLayerState } from '../../stores/adjustmentLayer';
import { adjustmentLayerStore } from '../../stores/adjustmentLayer';
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

function clone_layer_state(state: AdjustmentLayerState): AdjustmentLayerState {
    return {
        layers: state.layers.map((layer) => ({
            ...layer,
            parameters: layer.parameters.map((parameter) => ({ ...parameter })),
            affectedTrackIds: [...layer.affectedTrackIds],
            regions: layer.regions.map((region) => ({ ...region })),
        })),
    };
}

function resolve_affected_track_ids(layer: AdjustmentLayer, tracks: readonly Track[]): string[] {
    if (layer.affectedTrackIds.length > 0) {
        const track_ids = new Set(tracks.map((track) => track.id));
        return layer.affectedTrackIds.filter((track_id) => track_ids.has(track_id));
    }
    return tracks.slice(layer.insertionIndex).map((track) => track.id);
}

function find_region_layer(layers: readonly AdjustmentLayer[], region_id: string): AdjustmentLayer | undefined {
    return layers.find((layer) => layer.regions.some((region) => region.id === region_id));
}

function get_affected_track_ids(action: AdjustmentLayerMutationAction, tracks: readonly Track[]): Set<string> {
    const layers = adjustmentLayerStore.value?.layers ?? [];
    const affected = new Set<string>();
    const add_layer = (layer: AdjustmentLayer | undefined): void => {
        if (!layer) {
            return;
        }
        for (const track_id of resolve_affected_track_ids(layer, tracks)) {
            affected.add(track_id);
        }
    };

    switch (action.type) {
        case 'createAdjustmentLayer':
            for (const track of tracks) {
                affected.add(track.id);
            }
            break;
        case 'removeAdjustmentLayer':
        case 'toggleAdjustmentLayer':
        case 'setLayerParameter':
        case 'setLayerMix':
        case 'addAdjustmentRegion':
        case 'removeAdjustmentRegion':
            add_layer(layers.find((layer) => layer.id === action.payload.layerId));
            break;
        case 'moveAdjustmentRegion':
        case 'setLayerFades':
            add_layer(find_region_layer(layers, action.payload.regionId));
            break;
        case 'setLayerAffectedTracks': {
            const layer = layers.find((candidate) => candidate.id === action.payload.layerId);
            add_layer(layer);
            if (layer) {
                add_layer({ ...layer, affectedTrackIds: Array.from(new Set(action.payload.trackIds)) });
            }
            break;
        }
        case 'setLayerInsertionIndex': {
            const layer = layers.find((candidate) => candidate.id === action.payload.layerId);
            add_layer(layer);
            if (layer) {
                add_layer({ ...layer, insertionIndex: Math.max(0, Math.floor(action.payload.insertionIndex)) });
            }
            break;
        }
    }

    return affected;
}

export function createAdjustmentLayerMutationInverse(
    action: AdjustmentLayerMutationAction
): RestoreAdjustmentLayerMutationAction | null {
    const layer_state = adjustmentLayerStore.value;
    const track_state = trackStore.value;
    if (!layer_state || !track_state) {
        return null;
    }

    const affected_track_ids = get_affected_track_ids(action, track_state.tracks);
    return {
        type: 'restoreAdjustmentLayerMutation',
        payload: {
            layerState: clone_layer_state(layer_state),
            freezeStates: track_state.tracks.flatMap((track) =>
                affected_track_ids.has(track.id) && track.freezeState.status === 'frozen'
                    ? [{ trackId: track.id, freezeState: { ...track.freezeState } }]
                    : []
            ),
        },
    };
}
