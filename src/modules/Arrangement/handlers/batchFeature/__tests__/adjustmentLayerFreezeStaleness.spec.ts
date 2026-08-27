import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, redo, undo } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { createTrack, type Track } from '../../../models/Track';
import { createTrackFreezeSourceSignature } from '../../../services/createTrackFreezeSourceSignature';
import { adjustmentLayerStore, type AdjustmentLayer, type AdjustmentLayerState } from '../../../stores/adjustmentLayer';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

function createFrozenTrack(id: string): Track {
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

function createLayer(overrides: Partial<AdjustmentLayer> = {}): AdjustmentLayer {
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

function getTrack(id: string): Track {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === id);
    if (!track) {
        throw new Error(`Expected track ${id}`);
    }
    return track;
}

function getLayerState(): AdjustmentLayerState {
    const state = adjustmentLayerStore.value;
    if (!state) {
        throw new Error('Expected adjustment-layer state');
    }
    return state;
}

type MutationCase = {
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

const mutationCases = [
    {
        label: 'create layer',
        layers: [],
        action: { type: 'createAdjustmentLayer', payload: { name: 'Created', effectType: 'volume' } },
        staleTrackIds: ['track-a', 'track-b', 'track-c'],
    },
    {
        // The destroy case: the layer carries authored regions, so the inverse has to
        // put the whole layer back, regions included, not just an empty shell.
        label: 'remove layer',
        layers: [createLayer({ regions: [region] })],
        action: { type: 'removeAdjustmentLayer', payload: { layerId: 'layer-1' } },
        staleTrackIds: ['track-a'],
    },
    {
        label: 'toggle layer',
        layers: [createLayer()],
        action: { type: 'toggleAdjustmentLayer', payload: { layerId: 'layer-1' } },
        staleTrackIds: ['track-a'],
    },
    {
        label: 'set parameter',
        layers: [createLayer()],
        action: { type: 'setLayerParameter', payload: { layerId: 'layer-1', paramName: 'Gain', value: 6 } },
        staleTrackIds: ['track-a'],
    },
    {
        label: 'set mix',
        layers: [createLayer()],
        action: { type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.75 } },
        staleTrackIds: ['track-a'],
    },
    {
        label: 'add region',
        layers: [createLayer()],
        action: { type: 'addAdjustmentRegion', payload: { layerId: 'layer-1', startBeat: 4, endBeat: 8 } },
        staleTrackIds: ['track-a'],
    },
    {
        label: 'remove region',
        layers: [createLayer({ regions: [region] })],
        action: { type: 'removeAdjustmentRegion', payload: { layerId: 'layer-1', regionId: 'region-1' } },
        staleTrackIds: ['track-a'],
    },
    {
        label: 'move region',
        layers: [createLayer({ regions: [region] })],
        action: { type: 'moveAdjustmentRegion', payload: { regionId: 'region-1', startBeat: 2, endBeat: 10 } },
        staleTrackIds: ['track-a'],
    },
    {
        label: 'set region fades',
        layers: [createLayer({ regions: [region] })],
        action: { type: 'setLayerFades', payload: { regionId: 'region-1', fadeInBeats: 1, fadeOutBeats: 2 } },
        staleTrackIds: ['track-a'],
    },
    {
        label: 'set affected tracks',
        layers: [createLayer()],
        action: { type: 'setLayerAffectedTracks', payload: { layerId: 'layer-1', trackIds: ['track-b'] } },
        staleTrackIds: ['track-a', 'track-b'],
    },
    {
        label: 'set insertion index',
        layers: [createLayer({ affectedTrackIds: [], insertionIndex: 1 })],
        action: { type: 'setLayerInsertionIndex', payload: { layerId: 'layer-1', insertionIndex: 2 } },
        staleTrackIds: ['track-b'],
    },
] satisfies MutationCase[];

describe('adjustmentLayerFreezeStaleness', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        trackStore.set({
            tracks: [createFrozenTrack('track-a'), createFrozenTrack('track-b'), createFrozenTrack('track-c')],
            selectedTrackId: null,
            ghostClips: [],
        });
        adjustmentLayerStore.set({ layers: [createLayer()] });
    });

    afterEach(() => {
        adjustmentLayerStore.set({ layers: [] });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        clearUndoHistory();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
    });

    it('marks affected frozen tracks stale and leaves unaffected tracks current', async () => {
        await executeAppAction({ type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.75 } });

        expect(getTrack('track-a').freezeState.status).toBe('stale');
        expect(getTrack('track-b').freezeState.status).toBe('frozen');
        expect(getTrack('track-c').freezeState.status).toBe('frozen');
    });

    it('unaffected: uses the current insertion scope when affectedTrackIds is empty', async () => {
        adjustmentLayerStore.set({ layers: [createLayer({ affectedTrackIds: [], insertionIndex: 1 })] });

        await executeAppAction({
            type: 'setLayerParameter',
            payload: { layerId: 'layer-1', paramName: 'Gain', value: 6 },
        });

        expect(getTrack('track-a').freezeState.status).toBe('frozen');
        expect(getTrack('track-b').freezeState.status).toBe('stale');
        expect(getTrack('track-c').freezeState.status).toBe('stale');
    });

    it.each(mutationCases)('round-trips $label and stales only its old/new audible scope', async (testCase) => {
        adjustmentLayerStore.set({ layers: testCase.layers });

        await executeAppAction(testCase.action);

        for (const trackId of ['track-a', 'track-b', 'track-c']) {
            const expectedStatus = testCase.staleTrackIds.includes(trackId) ? 'stale' : 'frozen';
            expect(getTrack(trackId).freezeState.status).toBe(expectedStatus);
        }
        expect(undoStore.value?.past).toHaveLength(1);

        await undo();

        expect(getLayerState().layers).toEqual(testCase.layers);
        for (const trackId of ['track-a', 'track-b', 'track-c']) {
            expect(getTrack(trackId).freezeState.status).toBe('frozen');
        }

        await redo();

        for (const trackId of ['track-a', 'track-b', 'track-c']) {
            const expectedStatus = testCase.staleTrackIds.includes(trackId) ? 'stale' : 'frozen';
            expect(getTrack(trackId).freezeState.status).toBe(expectedStatus);
        }
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
    });

    it('unaffected: does not stale tracks when a disabled layer changes', async () => {
        adjustmentLayerStore.set({ layers: [createLayer({ enabled: false })] });

        await executeAppAction({ type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.75 } });

        expect(getTrack('track-a').freezeState.status).toBe('frozen');
        expect(getTrack('track-b').freezeState.status).toBe('frozen');
        expect(getTrack('track-c').freezeState.status).toBe('frozen');
    });

    it('unaffected: does not stale tracks when a zero-mix layer changes', async () => {
        adjustmentLayerStore.set({ layers: [createLayer({ mix: 0 })] });

        await executeAppAction({
            type: 'setLayerParameter',
            payload: { layerId: 'layer-1', paramName: 'Gain', value: 6 },
        });

        expect(getTrack('track-a').freezeState.status).toBe('frozen');
        expect(getTrack('track-b').freezeState.status).toBe('frozen');
        expect(getTrack('track-c').freezeState.status).toBe('frozen');
    });

    it('unaffected: keeps tracks current when they remain in the changed scope', async () => {
        adjustmentLayerStore.set({
            layers: [createLayer({ affectedTrackIds: ['track-a', 'track-b'] })],
        });

        await executeAppAction({
            type: 'setLayerAffectedTracks',
            payload: { layerId: 'layer-1', trackIds: ['track-a', 'track-c'] },
        });

        expect(getTrack('track-a').freezeState.status).toBe('frozen');
        expect(getTrack('track-b').freezeState.status).toBe('stale');
        expect(getTrack('track-c').freezeState.status).toBe('stale');
    });

    it('marks affected frozen tracks stale when an inverse action is dispatched directly', async () => {
        await executeAppAction({
            type: 'restoreAdjustmentLayerMutation',
            payload: {
                layers: [createLayer({ mix: 0.75 })],
                expectedLayersFingerprint: JSON.stringify([createLayer()]),
                freezeTransitions: [],
            },
        });

        expect(getTrack('track-a').freezeState.status).toBe('stale');
        expect(getTrack('track-b').freezeState.status).toBe('frozen');
        expect(getTrack('track-c').freezeState.status).toBe('frozen');
    });

    it('rejects an old inverse instead of overwriting a later adjustment edit', async () => {
        await executeAppAction({ type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.5 } });
        const oldInverse: AppAction = {
            type: 'restoreAdjustmentLayerMutation',
            payload: {
                layers: [createLayer()],
                expectedLayersFingerprint: JSON.stringify([createLayer({ mix: 0.5 })]),
                freezeTransitions: [
                    {
                        trackId: 'track-a',
                        previousStatus: 'frozen',
                        expectedSourceSignature: createTrackFreezeSourceSignature(getTrack('track-a')),
                    },
                ],
            },
        };

        await executeAppAction({
            type: 'setLayerParameter',
            payload: { layerId: 'layer-1', paramName: 'Gain', value: 6 },
        });

        await expect(executeAppAction(oldInverse, { skipUndo: true })).rejects.toThrow(
            'Adjustment-layer state changed after this action was committed'
        );
        expect(getLayerState().layers[0]).toEqual(
            expect.objectContaining({
                mix: 0.5,
                parameters: [expect.objectContaining({ name: 'Gain', value: 6 })],
            })
        );
    });

    it('declines undo through the undo path when a newer edit changed the layers', async () => {
        await executeAppAction({ type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.5 } });

        // A write that never went through this command — a collaborator's CRDT change
        // landing between the edit and the undo. The fingerprint the inverse captured
        // at commit time no longer describes the live layers.
        const layerState = getLayerState();
        adjustmentLayerStore.set({
            layers: layerState.layers.map((layer) =>
                layer.id === 'layer-1' ? { ...layer, name: 'Renamed elsewhere' } : layer
            ),
        });

        await expect(undo()).rejects.toThrow('Adjustment-layer state changed after this action was committed');

        // The guard declined: the newer edit stands and the entry stays undoable
        // rather than being consumed by a no-op.
        expect(getLayerState().layers[0]?.name).toBe('Renamed elsewhere');
        expect(getLayerState().layers[0]?.mix).toBe(0.5);
        expect(undoStore.value?.past).toHaveLength(1);
    });

    it('re-creates an undone layer with the same id on redo', async () => {
        adjustmentLayerStore.set({ layers: [] });

        await executeAppAction({ type: 'createAdjustmentLayer', payload: { name: 'Created', effectType: 'volume' } });
        const created = getLayerState().layers[0];
        if (!created) {
            throw new Error('Expected the created layer');
        }

        await undo();
        expect(getLayerState().layers).toEqual([]);

        await redo();

        // Redo replays the entry's own action object, whose payload kept the id the
        // first execute minted. A fresh id here would orphan every reference other
        // state still holds to this layer.
        expect(getLayerState().layers).toEqual([created]);
        expect(getLayerState().layers[0]?.id).toBe(created.id);
    });

    it('keeps a track stale when its freeze source changes after an adjustment edit', async () => {
        await executeAppAction({ type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.5 } });
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) => {
                if (track.id !== 'track-a') {
                    return track;
                }
                return {
                    ...track,
                    clips: [
                        ...track.clips,
                        {
                            id: 'later-clip',
                            trackId: track.id,
                            name: 'Later edit',
                            startBeat: 0,
                            endBeat: 4,
                            type: 'audio' as const,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            gain: 1,
                            color: '#fff',
                            locked: false,
                            muted: false,
                        },
                    ],
                };
            }),
        });

        await undo();

        expect(getLayerState().layers[0]?.mix).toBe(0.25);
        expect(getTrack('track-a').freezeState.status).toBe('stale');
    });

    it('atomicUndo: commits both stores atomically and restores both through undo', async () => {
        const observations: Array<{ mix: number; freezeStatus: Track['freezeState']['status'] }> = [];
        const observe = (): void => {
            observations.push({
                mix: getLayerState().layers[0]?.mix ?? -1,
                freezeStatus: getTrack('track-a').freezeState.status,
            });
        };
        const unsubscribeLayer = adjustmentLayerStore.subscribe(observe);
        const unsubscribeTrack = trackStore.subscribe(observe);

        await executeAppAction({ type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.75 } });

        expect(observations).not.toContainEqual({ mix: 0.75, freezeStatus: 'frozen' });
        expect(getLayerState().layers[0]?.mix).toBe(0.75);
        expect(getTrack('track-a').freezeState.status).toBe('stale');
        expect(undoStore.value?.past).toHaveLength(1);

        await undo();

        expect(getLayerState().layers[0]?.mix).toBe(0.25);
        expect(getTrack('track-a').freezeState.status).toBe('frozen');
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);

        await redo();

        expect(getLayerState().layers[0]?.mix).toBe(0.75);
        expect(getTrack('track-a').freezeState.status).toBe('stale');
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);

        unsubscribeLayer();
        unsubscribeTrack();
    });
});
