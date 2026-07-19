import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, redo, undo } from '#/modules/Command/useCases';

import { createTrack, type Track } from '../../../models/Track';
import {
    adjustmentLayerStore,
    type AdjustmentLayer,
    type AdjustmentLayerState,
} from '../../../stores/adjustmentLayer';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

function create_frozen_track(id: string): Track {
    return {
        ...createTrack({ id, name: id, kind: 'audio' }),
        frozen: true,
        frozenBufferId: `buffer-${id}`,
        freezeState: {
            status: 'frozen',
            freezeId: `freeze-${id}`,
            frozenBufferId: `buffer-${id}`,
            sourceContentHash: `hash-${id}`,
        },
    };
}

function create_layer(overrides: Partial<AdjustmentLayer> = {}): AdjustmentLayer {
    return {
        id: 'layer-1',
        name: 'Volume layer',
        effectType: 'volume',
        parameters: [{ name: 'Gain', value: 0, min: -60, max: 12, unit: 'dB' }],
        affectedTrackIds: ['track-a'],
        insertionIndex: 0,
        regions: [],
        enabled: true,
        mix: 0.25,
        color: '#fff',
        ...overrides,
    };
}

function get_track(id: string): Track {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === id);
    if (!track) {
        throw new Error(`Expected track ${id}`);
    }
    return track;
}

function get_layer_state(): AdjustmentLayerState {
    const state = adjustmentLayerStore.value;
    if (!state) {
        throw new Error('Expected adjustment-layer state');
    }
    return state;
}

describe('adjustmentLayerFreezeStaleness', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        trackStore.set({
            tracks: [create_frozen_track('track-a'), create_frozen_track('track-b'), create_frozen_track('track-c')],
            selectedTrackId: null,
            ghostClips: [],
        });
        adjustmentLayerStore.set({ layers: [create_layer()] });
    });

    afterEach(() => {
        adjustmentLayerStore.set({ layers: [] });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        clearUndoHistory();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
    });

    it('marks explicitly affected frozen tracks stale and leaves unaffected tracks current', async () => {
        await executeAppAction({ type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.75 } });

        expect(get_track('track-a').freezeState.status).toBe('stale');
        expect(get_track('track-b').freezeState.status).toBe('frozen');
        expect(get_track('track-c').freezeState.status).toBe('frozen');
    });

    it('uses the current insertion scope when affectedTrackIds is empty', async () => {
        adjustmentLayerStore.set({ layers: [create_layer({ affectedTrackIds: [], insertionIndex: 1 })] });

        await executeAppAction({
            type: 'setLayerParameter',
            payload: { layerId: 'layer-1', paramName: 'Gain', value: 6 },
        });

        expect(get_track('track-a').freezeState.status).toBe('frozen');
        expect(get_track('track-b').freezeState.status).toBe('stale');
        expect(get_track('track-c').freezeState.status).toBe('stale');
    });

    it('commits layer and staleness state atomically and restores both through undo', async () => {
        const observations: Array<{ mix: number; freezeStatus: Track['freezeState']['status'] }> = [];
        const observe = (): void => {
            observations.push({
                mix: get_layer_state().layers[0]?.mix ?? -1,
                freezeStatus: get_track('track-a').freezeState.status,
            });
        };
        const unsubscribe_layer = adjustmentLayerStore.subscribe(observe);
        const unsubscribe_track = trackStore.subscribe(observe);

        await executeAppAction({ type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.75 } });

        expect(observations).not.toContainEqual({ mix: 0.75, freezeStatus: 'frozen' });
        expect(get_layer_state().layers[0]?.mix).toBe(0.75);
        expect(get_track('track-a').freezeState.status).toBe('stale');
        expect(undoStore.value?.past).toHaveLength(1);

        await undo();

        expect(get_layer_state().layers[0]?.mix).toBe(0.25);
        expect(get_track('track-a').freezeState.status).toBe('frozen');
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);

        await redo();

        expect(get_layer_state().layers[0]?.mix).toBe(0.75);
        expect(get_track('track-a').freezeState.status).toBe('stale');
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);

        unsubscribe_layer();
        unsubscribe_track();
    });
});
