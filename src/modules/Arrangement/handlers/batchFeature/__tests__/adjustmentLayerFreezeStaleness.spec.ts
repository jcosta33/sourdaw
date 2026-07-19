import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
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

import { createTrack, type Clip, type Track } from '../../../models/Track';
import { computeTrackHash } from '../../../services/computeTrackHash';
import { adjustmentLayerStore, type AdjustmentLayer, type AdjustmentLayerState } from '../../../stores/adjustmentLayer';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

let empty_track_hash = '';

function create_frozen_track(id: string): Track {
    return {
        ...createTrack({ id, name: id, kind: 'audio' }),
        frozen: true,
        frozenBufferId: `buffer-${id}`,
        freezeState: {
            status: 'frozen',
            freezeId: `freeze-${id}`,
            frozenBufferId: `buffer-${id}`,
            sourceContentHash: empty_track_hash,
            renderSettings: {
                sampleRate: 48_000,
                bitDepth: 32,
                channelCount: 2,
                tailLengthSeconds: 2,
            },
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
        staleTrackIds: ['track-b'],
    },
] satisfies AdjustmentLayerMutationCase[];

describe('adjustmentLayerFreezeStaleness', () => {
    beforeEach(async () => {
        configureAutomergeStoragePort(null);
        empty_track_hash = await computeTrackHash([], []);
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
        flushAutomergeStorageWrites();
    });

    it('unaffected: marks explicitly affected frozen tracks stale and leaves unaffected tracks current', async () => {
        await executeAppAction({ type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.75 } });

        expect(get_track('track-a').freezeState.status).toBe('stale');
        expect(get_track('track-b').freezeState.status).toBe('frozen');
        expect(get_track('track-c').freezeState.status).toBe('frozen');
    });

    it.each([
        {
            label: 'a parameter edit on a disabled layer',
            layers: [create_layer({ enabled: false })],
            action: {
                type: 'setLayerParameter',
                payload: { layerId: 'layer-1', paramName: 'Gain', value: 6 },
            } satisfies AppAction,
        },
        {
            label: 'a normalized mix no-op',
            layers: [create_layer({ mix: 1 })],
            action: {
                type: 'setLayerMix',
                payload: { layerId: 'layer-1', mix: 2 },
            } satisfies AppAction,
        },
        {
            label: 'a parameter edit behind a zero-blend region set',
            layers: [create_layer({ regions: [{ ...region, blend: 0 }] })],
            action: {
                type: 'setLayerParameter',
                payload: { layerId: 'layer-1', paramName: 'Gain', value: 6 },
            } satisfies AppAction,
        },
        {
            label: 'a parameter edit behind a zero-duration region set',
            layers: [create_layer({ regions: [{ ...region, endBeat: region.startBeat }] })],
            action: {
                type: 'setLayerParameter',
                payload: { layerId: 'layer-1', paramName: 'Gain', value: 6 },
            } satisfies AppAction,
        },
    ])('does not stale frozen tracks for $label', async ({ layers, action }) => {
        adjustmentLayerStore.set({ layers });

        await executeAppAction(action);

        expect(get_track('track-a').freezeState.status).toBe('frozen');
        expect(get_track('track-b').freezeState.status).toBe('frozen');
        expect(get_track('track-c').freezeState.status).toBe('frozen');
    });

    it('does not record a normalized adjustment no-op in undo or macro history', async () => {
        adjustmentLayerStore.set({ layers: [create_layer({ mix: 1 })] });
        macroStore.set({ macros: [], recording: true, currentRecording: [] });

        await executeAppAction({ type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 2 } });

        expect(get_layer_state().layers[0]?.mix).toBe(1);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(macroStore.value?.currentRecording).toHaveLength(0);
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

    it('undoes a multi-action adjustment group through one observable aggregate commit', async () => {
        const group_options = {
            groupId: 'aggregate-group',
            groupLabel: 'Aggregate group',
            atomicUndoGroup: true,
        };
        await executeAppAction({ type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.75 } }, group_options);
        await executeAppAction(
            { type: 'setLayerParameter', payload: { layerId: 'layer-1', paramName: 'Gain', value: 6 } },
            group_options
        );
        const observations: Array<{ mix: number; gain: number; status: Track['freezeState']['status'] }> = [];
        const observe = (): void => {
            observations.push({
                mix: get_layer_state().layers[0]?.mix ?? -1,
                gain: get_layer_state().layers[0]?.parameters[0]?.value ?? -1,
                status: get_track('track-a').freezeState.status,
            });
        };
        const unsubscribe_layer = adjustmentLayerStore.subscribe(observe);
        const unsubscribe_track = trackStore.subscribe(observe);

        await undo();

        expect(get_layer_state().layers[0]?.mix).toBe(0.25);
        expect(get_layer_state().layers[0]?.parameters[0]?.value).toBe(0);
        expect(get_track('track-a').freezeState.status).toBe('frozen');
        expect(observations).not.toContainEqual({ mix: 0.25, gain: 6, status: 'stale' });
        expect(observations).not.toContainEqual({ mix: 0.75, gain: 0, status: 'stale' });
        expect(observations.every((entry) => entry.mix === 0.25 && entry.gain === 0 && entry.status === 'frozen')).toBe(
            true
        );

        adjustmentLayerStore.set({
            layers: get_layer_state().layers.map((layer) => (layer.id === 'layer-1' ? { ...layer, mix: 0.5 } : layer)),
        });
        observations.length = 0;
        await redo();

        expect(get_layer_state().layers[0]?.mix).toBe(0.75);
        expect(get_layer_state().layers[0]?.parameters[0]?.value).toBe(6);
        expect(get_track('track-a').freezeState.status).toBe('stale');
        expect(undoStore.value?.past).toHaveLength(2);
        expect(undoStore.value?.future).toHaveLength(0);
        expect(observations).not.toContainEqual({ mix: 0.75, gain: 0, status: 'stale' });
        expect(observations).not.toContainEqual({ mix: 0.25, gain: 6, status: 'stale' });

        await undo();
        expect(get_layer_state().layers[0]?.mix).toBe(0.5);
        expect(get_layer_state().layers[0]?.parameters[0]?.value).toBe(0);

        unsubscribe_layer();
        unsubscribe_track();
    });

    it('marks a completed re-freeze stale when undo changes its adjustment render inputs', async () => {
        await executeAppAction({ type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.75 } });
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
                          frozen: true,
                          frozenBufferId: 'post-adjustment-buffer',
                          freezeState: {
                              status: 'frozen',
                              freezeId: 'post-adjustment-freeze',
                              frozenBufferId: 'post-adjustment-buffer',
                              sourceContentHash: 'freeze-v2:post-adjustment-render-input',
                          },
                      }
                    : track
            ),
        });

        await undo();

        expect(get_layer_state().layers[0]?.mix).toBe(0.25);
        expect(get_track('track-a').freezeState).toMatchObject({
            status: 'stale',
            freezeId: 'post-adjustment-freeze',
            frozenBufferId: 'post-adjustment-buffer',
        });
    });

    it('reverts and redoes a correlation-only AI adjustment group atomically', async () => {
        const group_options = { groupId: 'ai-correlation-group', groupLabel: 'AI correlation', source: 'ai' as const };
        await executeAppAction({ type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.75 } }, group_options);
        await executeAppAction(
            { type: 'setLayerParameter', payload: { layerId: 'layer-1', paramName: 'Gain', value: 6 } },
            group_options
        );

        await expect(revertActionGroup('ai-correlation-group')).resolves.toBe(true);
        expect(get_layer_state().layers[0]?.mix).toBe(0.25);
        expect(get_layer_state().layers[0]?.parameters[0]?.value).toBe(0);

        await redo();
        expect(get_layer_state().layers[0]?.mix).toBe(0.75);
        expect(get_layer_state().layers[0]?.parameters[0]?.value).toBe(6);
        expect(undoStore.value?.future).toHaveLength(0);
    });

    it('undo preserves concurrent fields and marks an incompatible newer re-freeze stale', async () => {
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
                              sourceContentHash: 'freeze-v2:newer-full-render-input',
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
            status: 'stale',
            freezeId: 'newer-freeze',
            frozenBufferId: 'newer-buffer',
            sourceContentHash: 'freeze-v2:newer-full-render-input',
        });

        await redo();
        expect(get_track('track-a').freezeState).toMatchObject({
            status: 'stale',
            freezeId: 'newer-freeze',
            frozenBufferId: 'newer-buffer',
            sourceContentHash: 'freeze-v2:newer-full-render-input',
        });

        await undo();
        expect(get_track('track-a').freezeState).toMatchObject({
            status: 'stale',
            freezeId: 'newer-freeze',
            frozenBufferId: 'newer-buffer',
            sourceContentHash: 'freeze-v2:newer-full-render-input',
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

    it.each([
        {
            label: 'track content',
            edit: (track: Track): Track => {
                const clip: Clip = {
                    id: 'content-edit',
                    trackId: track.id,
                    name: 'Content edit',
                    startBeat: 0,
                    endBeat: 4,
                    type: 'audio',
                    fadeInBeats: 0,
                    fadeOutBeats: 0,
                    gain: 1,
                    color: '#fff',
                    locked: false,
                    muted: false,
                };
                return { ...track, clips: [clip] };
            },
        },
        {
            label: 'render inputs',
            edit: (track: Track): Track => ({
                ...track,
                freezeState: {
                    ...track.freezeState,
                    renderSettings: {
                        sampleRate: 96_000,
                        bitDepth: 32,
                        channelCount: 2,
                        tailLengthSeconds: 4,
                    },
                },
            }),
        },
    ])('does not restore frozen after competing $label changes while adjustment-stale', async ({ edit }) => {
        await executeAppAction({ type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.75 } });
        const mutation_id = get_track('track-a').freezeState.adjustmentLayerMutationId;
        const track_state = trackStore.value;
        if (!track_state) {
            throw new Error('Expected track state');
        }
        trackStore.set({
            ...track_state,
            tracks: track_state.tracks.map((track) => (track.id === 'track-a' ? edit(track) : track)),
        });
        expect(get_track('track-a').freezeState.adjustmentLayerMutationId).toBe(mutation_id);

        await undo();

        expect(get_layer_state().layers[0]?.mix).toBe(0.25);
        expect(get_track('track-a').freezeState.status).toBe('stale');
        expect(get_track('track-a').freezeState.adjustmentLayerMutationId).toBeUndefined();
    });

    it('rolls back the layer mutation when an Automerge track write rejects before history commit', async () => {
        const storage_failure = new Error('track CRDT commit failed');
        const observed_layer_mixes: number[] = [];
        const observed_track_statuses: Array<'frozen' | 'stale'> = [];
        const unsubscribe_layers = adjustmentLayerStore.subscribe((state) => {
            const mix = state?.layers[0]?.mix;
            if (mix !== undefined) {
                observed_layer_mixes.push(mix);
            }
        });
        const unsubscribe_tracks = trackStore.subscribe((state) => {
            const status = state?.tracks.find((track) => track.id === 'track-a')?.freezeState.status;
            if (status === 'frozen' || status === 'stale') {
                observed_track_statuses.push(status);
            }
        });
        flushAutomergeStorageWrites();
        trackStore.set(trackStore.value);
        observed_track_statuses.length = 0;
        configureAutomergeStoragePort({
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            getDoc: () => ({}),
            mutateDoc: () => {
                throw storage_failure;
            },
        });

        await expect(
            executeAppAction({ type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.75 } })
        ).rejects.toBe(storage_failure);
        unsubscribe_layers();
        unsubscribe_tracks();

        expect(get_layer_state().layers[0]?.mix).toBe(0.25);
        expect(get_track('track-a').freezeState.status).toBe('frozen');
        expect(observed_layer_mixes).toEqual([0.25]);
        expect(observed_track_statuses).toEqual([]);
        expect(undoStore.value?.past).toHaveLength(0);

        configureAutomergeStoragePort(null);
        flushAutomergeStorageWrites();
    });

    it('commits adjustment-layer and freeze-staleness CRDT writes in one document change', async () => {
        flushAutomergeStorageWrites();
        const root_document: Record<string, unknown> = {};
        const committed_snapshots: Record<string, unknown>[] = [];
        configureAutomergeStoragePort({
            getSemanticMessage: () => 'Set adjustment-layer mix',
            hasDoc: (doc_id) => doc_id === 'root',
            getDoc: (doc_id) => (doc_id === 'root' ? root_document : undefined),
            mutateDoc: ({ docId, changeFn }) => {
                expect(docId).toBe('root');
                changeFn(root_document);
                committed_snapshots.push(structuredClone(root_document));
            },
        });

        await executeAppAction({ type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.75 } });
        flushAutomergeStorageWrites();

        expect(committed_snapshots).toHaveLength(1);
        expect(committed_snapshots[0]?.adjustmentLayers).toMatchObject({
            layers: [{ id: 'layer-1', mix: 0.75 }],
        });
        const persisted_tracks = committed_snapshots[0]?.tracks;
        expect(persisted_tracks).toMatchObject({
            tracks: expect.arrayContaining([
                expect.objectContaining({
                    id: 'track-a',
                    freezeState: expect.objectContaining({ status: 'stale' }),
                }),
            ]),
        });
    });

    it.each(['undo', 'revertActionGroup'] as const)(
        'rolls back a partially applied adjustment group through %s when an older inverse conflicts',
        async (revert_method) => {
            const group_id = `group-${revert_method}`;
            const group_options = {
                groupId: group_id,
                groupLabel: 'Adjustment group',
                atomicUndoGroup: true,
            };
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
