import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    getMacroHandlers,
    redo,
    revertActionGroup,
    undo,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { createTrack, type Track } from '../../../models/Track';
import { adjustmentLayerStore, type AdjustmentLayer, type AdjustmentLayerState } from '../../../stores/adjustmentLayer';
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

type AdjustmentLayerMutationCase = {
    label: string;
    layers: AdjustmentLayer[];
    action: AppAction;
    staleTrackIds: string[];
};

const region = {
    id: 'region-1',
    startBeat: 0,
    endBeat: 8,
    blend: 1,
    fadeInBeats: 0.25,
    fadeOutBeats: 0.25,
};

const adjustment_layer_mutation_cases = [
    {
        label: 'create layer',
        layers: [],
        action: { type: 'createAdjustmentLayer', payload: { name: 'Created', effectType: 'volume' } },
        staleTrackIds: ['track-a', 'track-b', 'track-c'],
    },
    {
        label: 'remove layer',
        layers: [create_layer()],
        action: { type: 'removeAdjustmentLayer', payload: { layerId: 'layer-1' } },
        staleTrackIds: ['track-a'],
    },
    {
        label: 'toggle layer',
        layers: [create_layer()],
        action: { type: 'toggleAdjustmentLayer', payload: { layerId: 'layer-1' } },
        staleTrackIds: ['track-a'],
    },
    {
        label: 'set parameter',
        layers: [create_layer()],
        action: { type: 'setLayerParameter', payload: { layerId: 'layer-1', paramName: 'Gain', value: 6 } },
        staleTrackIds: ['track-a'],
    },
    {
        label: 'set mix',
        layers: [create_layer()],
        action: { type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.75 } },
        staleTrackIds: ['track-a'],
    },
    {
        label: 'add region',
        layers: [create_layer()],
        action: { type: 'addAdjustmentRegion', payload: { layerId: 'layer-1', startBeat: 4, endBeat: 8 } },
        staleTrackIds: ['track-a'],
    },
    {
        label: 'remove region',
        layers: [create_layer({ regions: [region] })],
        action: { type: 'removeAdjustmentRegion', payload: { layerId: 'layer-1', regionId: 'region-1' } },
        staleTrackIds: ['track-a'],
    },
    {
        label: 'move region',
        layers: [create_layer({ regions: [region] })],
        action: { type: 'moveAdjustmentRegion', payload: { regionId: 'region-1', startBeat: 2, endBeat: 10 } },
        staleTrackIds: ['track-a'],
    },
    {
        label: 'set region fades',
        layers: [create_layer({ regions: [region] })],
        action: { type: 'setLayerFades', payload: { regionId: 'region-1', fadeInBeats: 1, fadeOutBeats: 2 } },
        staleTrackIds: ['track-a'],
    },
    {
        label: 'set affected tracks',
        layers: [create_layer()],
        action: { type: 'setLayerAffectedTracks', payload: { layerId: 'layer-1', trackIds: ['track-b'] } },
        staleTrackIds: ['track-a', 'track-b'],
    },
    {
        label: 'set insertion index',
        layers: [create_layer({ affectedTrackIds: [], insertionIndex: 1 })],
        action: { type: 'setLayerInsertionIndex', payload: { layerId: 'layer-1', insertionIndex: 2 } },
        staleTrackIds: ['track-b', 'track-c'],
    },
] satisfies AdjustmentLayerMutationCase[];

describe('adjustmentLayerFreezeStaleness', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
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
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
    });

    it('unaffected: marks explicitly affected frozen tracks stale and leaves unaffected tracks current', async () => {
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

    it.each(adjustment_layer_mutation_cases)(
        'marks the old/new audible scope stale and round-trips $label in one undo entry',
        async ({ layers, action, staleTrackIds }) => {
            adjustmentLayerStore.set({ layers });

            await executeAppAction(action);

            for (const track_id of ['track-a', 'track-b', 'track-c']) {
                expect(get_track(track_id).freezeState.status).toBe(
                    staleTrackIds.includes(track_id) ? 'stale' : 'frozen'
                );
            }
            expect(undoStore.value?.past).toHaveLength(1);

            await undo();

            expect(get_layer_state().layers).toEqual(layers);
            for (const track_id of ['track-a', 'track-b', 'track-c']) {
                expect(get_track(track_id).freezeState.status).toBe('frozen');
            }
            expect(undoStore.value?.past).toHaveLength(0);
            expect(undoStore.value?.future).toHaveLength(1);

            await redo();

            for (const track_id of ['track-a', 'track-b', 'track-c']) {
                expect(get_track(track_id).freezeState.status).toBe(
                    staleTrackIds.includes(track_id) ? 'stale' : 'frozen'
                );
            }
            expect(undoStore.value?.past).toHaveLength(1);
            expect(undoStore.value?.future).toHaveLength(0);
        }
    );

    it('atomicUndo: commits layer and staleness state atomically and restores both through undo', async () => {
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

    it('undo merges its operation by stable id and preserves concurrent layers, fields, and a newer refreeze', async () => {
        await executeAppAction({ type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.75 } });

        const concurrent_layer = create_layer({
            id: 'layer-2',
            name: 'Concurrent layer',
            affectedTrackIds: ['track-b'],
        });
        adjustmentLayerStore.set({
            layers: [{ ...get_layer_state().layers[0]!, name: 'Remote rename' }, concurrent_layer],
        });
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) =>
                track.id === 'track-a'
                    ? {
                          ...track,
                          freezeState: {
                              status: 'frozen',
                              freezeId: 'newer-freeze',
                              frozenBufferId: 'newer-buffer',
                              sourceContentHash: 'newer-hash',
                          },
                      }
                    : track
            ),
        });

        await undo();

        expect(get_layer_state().layers).toHaveLength(2);
        expect(get_layer_state().layers.find((layer) => layer.id === 'layer-1')).toMatchObject({
            name: 'Remote rename',
            mix: 0.25,
        });
        expect(get_layer_state().layers.find((layer) => layer.id === 'layer-2')).toEqual(concurrent_layer);
        expect(get_track('track-a').freezeState).toMatchObject({
            status: 'frozen',
            freezeId: 'newer-freeze',
            frozenBufferId: 'newer-buffer',
            sourceContentHash: 'newer-hash',
        });

        await redo();
        expect(get_track('track-a').freezeState).toMatchObject({
            status: 'stale',
            freezeId: 'newer-freeze',
            frozenBufferId: 'newer-buffer',
            sourceContentHash: 'newer-hash',
        });

        await undo();
        expect(get_track('track-a').freezeState).toMatchObject({
            status: 'frozen',
            freezeId: 'newer-freeze',
            frozenBufferId: 'newer-buffer',
            sourceContentHash: 'newer-hash',
        });
        expect(get_layer_state().layers.find((layer) => layer.id === 'layer-2')).toEqual(concurrent_layer);
    });

    it('keeps a conflicted undo in history so stale redo metadata cannot overwrite the newer target value', async () => {
        await executeAppAction({ type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.75 } });
        adjustmentLayerStore.set({
            layers: get_layer_state().layers.map((layer) => (layer.id === 'layer-1' ? { ...layer, mix: 0.5 } : layer)),
        });

        await expect(undo()).rejects.toThrow('newer adjustment-layer state');

        expect(get_layer_state().layers[0]?.mix).toBe(0.5);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
    });

    it('captures a fresh inverse on redo so the next undo restores concurrent pre-redo state', async () => {
        await executeAppAction({ type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.75 } });
        await undo();
        adjustmentLayerStore.set({
            layers: get_layer_state().layers.map((layer) => (layer.id === 'layer-1' ? { ...layer, mix: 0.5 } : layer)),
        });

        await redo();
        await undo();

        expect(get_layer_state().layers[0]?.mix).toBe(0.5);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);
    });

    it.each(['undo', 'revertActionGroup'] as const)(
        'rolls back a partially applied adjustment group through %s when an older inverse conflicts',
        async (revert_method) => {
            const group_id = `group-${revert_method}`;
            const group_options = { groupId: group_id, groupLabel: 'Adjustment group' };
            await executeAppAction({ type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.75 } }, group_options);
            await executeAppAction(
                {
                    type: 'setLayerParameter',
                    payload: { layerId: 'layer-1', paramName: 'Gain', value: 6 },
                },
                group_options
            );
            adjustmentLayerStore.set({
                layers: get_layer_state().layers.map((layer) =>
                    layer.id === 'layer-1' ? { ...layer, mix: 0.5 } : layer
                ),
            });

            const reversion = revert_method === 'undo' ? undo() : revertActionGroup(group_id);
            await expect(reversion).rejects.toThrow('newer adjustment-layer state');

            expect(get_layer_state().layers[0]?.mix).toBe(0.5);
            expect(get_layer_state().layers[0]?.parameters[0]?.value).toBe(6);
            expect(get_track('track-a').freezeState.status).toBe('stale');
            expect(undoStore.value?.past).toHaveLength(2);
            expect(undoStore.value?.future).toHaveLength(0);
        }
    );

    it('rejects missing layer and region targets without blocking an earlier valid undo', async () => {
        await executeAppAction({ type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.75 } });

        await expect(
            executeAppAction({ type: 'setLayerMix', payload: { layerId: 'missing-layer', mix: 0.5 } })
        ).rejects.toThrow('missing-layer');
        await expect(
            executeAppAction({
                type: 'moveAdjustmentRegion',
                payload: { regionId: 'missing-region', startBeat: 2, endBeat: 4 },
            })
        ).rejects.toThrow('missing-region');

        expect(undoStore.value?.past).toHaveLength(1);
        await undo();
        expect(get_layer_state().layers[0]?.mix).toBe(0.25);
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('gives every create-layer macro playback a fresh entity identity', async () => {
        adjustmentLayerStore.set({ layers: [] });
        registerHandlerMap(getMacroHandlers());
        macroStore.set({
            macros: [
                {
                    id: 'create-layer-macro',
                    name: 'Create layer',
                    actions: [
                        {
                            type: 'createAdjustmentLayer',
                            payload: {
                                name: 'Macro layer',
                                effectType: 'volume',
                                layerId: 'recorded-layer-id',
                                adjustmentMutationId: 'recorded-mutation-id',
                            },
                        },
                    ],
                    createdAt: 0,
                },
            ],
            recording: false,
            currentRecording: [],
        });

        await executeAppAction({ type: 'playMacro', payload: { macroId: 'create-layer-macro' } });
        await executeAppAction({ type: 'playMacro', payload: { macroId: 'create-layer-macro' } });

        const layer_ids = get_layer_state().layers.map((layer) => layer.id);
        expect(layer_ids).toHaveLength(2);
        expect(new Set(layer_ids).size).toBe(2);
        expect(layer_ids).not.toContain('recorded-layer-id');
    });

    it('gives every add-region macro playback a fresh entity identity', async () => {
        registerHandlerMap(getMacroHandlers());
        macroStore.set({
            macros: [
                {
                    id: 'add-region-macro',
                    name: 'Add region',
                    actions: [
                        {
                            type: 'addAdjustmentRegion',
                            payload: {
                                layerId: 'layer-1',
                                startBeat: 4,
                                endBeat: 8,
                                regionId: 'recorded-region-id',
                                adjustmentMutationId: 'recorded-mutation-id',
                            },
                        },
                    ],
                    createdAt: 0,
                },
            ],
            recording: false,
            currentRecording: [],
        });

        await executeAppAction({ type: 'playMacro', payload: { macroId: 'add-region-macro' } });
        await executeAppAction({ type: 'playMacro', payload: { macroId: 'add-region-macro' } });

        const region_ids = get_layer_state().layers[0]?.regions.map((candidate) => candidate.id) ?? [];
        expect(region_ids).toHaveLength(2);
        expect(new Set(region_ids).size).toBe(2);
        expect(region_ids).not.toContain('recorded-region-id');
    });

    it('restores nested stale-transition provenance in LIFO order', async () => {
        await executeAppAction({ type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.75 } });
        const first_mutation_id = get_track('track-a').freezeState.adjustmentLayerMutationId;
        await executeAppAction({
            type: 'setLayerParameter',
            payload: { layerId: 'layer-1', paramName: 'Gain', value: 6 },
        });
        const second_mutation_id = get_track('track-a').freezeState.adjustmentLayerMutationId;

        expect(second_mutation_id).not.toBe(first_mutation_id);
        await undo();

        expect(get_track('track-a').freezeState).toMatchObject({
            status: 'stale',
            adjustmentLayerMutationId: first_mutation_id,
        });
        expect(get_layer_state().layers[0]?.parameters[0]?.value).toBe(0);

        await undo();

        expect(get_track('track-a').freezeState.status).toBe('frozen');
        expect(get_track('track-a').freezeState.adjustmentLayerMutationId).toBeUndefined();
        expect(get_layer_state().layers[0]?.mix).toBe(0.25);
    });

    it('rejects caller-supplied layer and region id collisions without changing layer or freeze state', async () => {
        const layer_with_region = create_layer({
            id: 'layer-2',
            affectedTrackIds: ['track-b'],
            regions: [region],
        });
        adjustmentLayerStore.set({ layers: [create_layer(), layer_with_region] });

        await expect(
            executeAppAction({
                type: 'createAdjustmentLayer',
                payload: { name: 'Collision', effectType: 'volume', layerId: 'layer-1' },
            })
        ).rejects.toThrow('layer id');
        await expect(
            executeAppAction({
                type: 'addAdjustmentRegion',
                payload: { layerId: 'layer-1', startBeat: 8, endBeat: 16, regionId: 'region-1' },
            })
        ).rejects.toThrow('region id');

        expect(get_layer_state().layers).toEqual([create_layer(), layer_with_region]);
        expect(get_track('track-a').freezeState.status).toBe('frozen');
        expect(get_track('track-b').freezeState.status).toBe('frozen');
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('rejects an ambiguous legacy region id instead of mutating multiple layer scopes', async () => {
        adjustmentLayerStore.set({
            layers: [
                create_layer({ regions: [region] }),
                create_layer({ id: 'layer-2', affectedTrackIds: ['track-b'], regions: [region] }),
            ],
        });

        await expect(
            executeAppAction({
                type: 'moveAdjustmentRegion',
                payload: { regionId: 'region-1', startBeat: 4, endBeat: 12 },
            })
        ).rejects.toThrow('region id');

        expect(get_layer_state().layers.every((layer) => layer.regions[0]?.startBeat === 0)).toBe(true);
        expect(get_track('track-a').freezeState.status).toBe('frozen');
        expect(get_track('track-b').freezeState.status).toBe('frozen');
        expect(undoStore.value?.past).toHaveLength(0);
    });
});
