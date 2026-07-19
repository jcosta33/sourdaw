import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, revertActionGroup, undo } from '#/modules/Command/useCases';

import { createTrack } from '../../../models/Track';
import { adjustmentLayerStore, type AdjustmentLayer } from '../../../stores/adjustmentLayer';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../getArrangementHandlers';
import { restoreAdjustmentLayerMutation } from '../restoreAdjustmentLayerMutation';

const mocks = vi.hoisted(() => ({
    computeFreezeRenderInputHash: vi.fn<() => Promise<string>>(),
    concurrentValues: [] as number[],
}));

vi.mock('../../../services/computeFreezeRenderInputHash', () => ({
    computeFreezeRenderInputHash: mocks.computeFreezeRenderInputHash,
}));

vi.mock('../../../services/computeTrackHash', () => ({
    computeTrackHash: vi.fn().mockResolvedValue('unversioned-hash'),
}));

vi.mock('../../../services/computeLegacyTrackHash', () => ({
    computeLegacyTrackHash: vi.fn().mockResolvedValue('legacy-hash'),
}));

function create_layer(mix: number): AdjustmentLayer {
    return {
        id: 'layer-1',
        name: 'Layer',
        effectType: 'volume',
        parameters: [{ name: 'Gain', value: 0, min: -60, max: 12, unit: 'dB' }],
        affectedTrackIds: [],
        insertionIndex: 0,
        regions: [],
        enabled: true,
        mix,
        color: '#fff',
    };
}

describe('restoreAdjustmentLayerMutation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.concurrentValues.length = 0;
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap({
            setSnapValue: {
                undoable: true,
                execute: (action) => {
                    mocks.concurrentValues.push(action.payload.value);
                },
                describe: () => ({
                    label: 'Set concurrent value',
                    inverseAction: { type: 'setSnapValue', payload: { value: -1 } },
                }),
            },
        });
        clearUndoHistory();
        adjustmentLayerStore.set({ layers: [create_layer(0.75)] });
        const target = {
            ...createTrack({ id: 'track-a', name: 'Target', kind: 'audio' }),
            frozen: true,
            frozenBufferId: 'frozen-buffer',
            freezeState: {
                status: 'stale' as const,
                freezeId: 'freeze-id',
                frozenBufferId: 'frozen-buffer',
                sourceContentHash: 'freeze-v2:current-hash',
                adjustmentLayerMutationId: 'mutation-1',
            },
        };
        const other = createTrack({ id: 'track-b', name: 'Other', kind: 'audio' });
        trackStore.set({ tracks: [target, other], selectedTrackId: null, ghostClips: [] });
        clearUndoHistory();
    });

    afterEach(() => {
        clearUndoHistory();
        clearHandlerRegistry();
        adjustmentLayerStore.set({ layers: [] });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
    });

    it('rejects undo when ordered track scope changes during frozen-input validation', async () => {
        let finish_hash!: (hash: string) => void;
        mocks.computeFreezeRenderInputHash.mockReturnValueOnce(
            new Promise<string>((resolve) => {
                finish_hash = resolve;
            })
        );
        const restoring = restoreAdjustmentLayerMutation({
            adjustmentMutationId: 'mutation-1',
            operation: { kind: 'restore-mix', layerId: 'layer-1', previous: 0.25, expected: 0.75 },
            staleTransitions: [
                {
                    trackId: 'track-a',
                    previousStatus: 'frozen',
                    frozenArtifact: {
                        trackFrozenBufferId: 'frozen-buffer',
                        freezeId: 'freeze-id',
                        frozenBufferId: 'frozen-buffer',
                        sourceContentHash: 'freeze-v2:current-hash',
                    },
                },
            ],
        });
        await vi.waitFor(() => expect(mocks.computeFreezeRenderInputHash).toHaveBeenCalledOnce());
        const evaluating_state = trackStore.value;
        if (!evaluating_state) {
            throw new Error('Expected evaluating track state');
        }
        trackStore.set({ ...evaluating_state, tracks: [...evaluating_state.tracks].reverse() });
        finish_hash('freeze-v2:current-hash');

        await expect(restoring).rejects.toThrow('newer ordered track state');
        expect(adjustmentLayerStore.value?.layers[0]?.mix).toBe(0.75);
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-a')?.freezeState.status).toBe('stale');
    });

    it.each(['undo', 'revertActionGroup'] as const)(
        'serializes concurrent executeAppAction behind deferred-hash %s and preserves coherent history',
        async (revert_method) => {
            adjustmentLayerStore.set({ layers: [create_layer(0.25)] });
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
                                  freezeId: 'freeze-id',
                                  frozenBufferId: 'frozen-buffer',
                                  sourceContentHash: 'freeze-v2:current-hash',
                              },
                          }
                        : track
                ),
            });
            const group_id = `deferred-${revert_method}`;
            await executeAppAction(
                { type: 'setLayerMix', payload: { layerId: 'layer-1', mix: 0.75 } },
                { groupId: group_id, groupLabel: 'Deferred group' }
            );
            let finish_hash!: (hash: string) => void;
            mocks.computeFreezeRenderInputHash.mockReturnValueOnce(
                new Promise<string>((resolve) => {
                    finish_hash = resolve;
                })
            );

            const reverting = revert_method === 'undo' ? undo() : revertActionGroup(group_id);
            await vi.waitFor(() => expect(mocks.computeFreezeRenderInputHash).toHaveBeenCalledOnce());
            let concurrent_settled = false;
            const concurrent = executeAppAction({ type: 'setSnapValue', payload: { value: 1 } }).then(() => {
                concurrent_settled = true;
                return undefined;
            });
            await Promise.resolve();
            await Promise.resolve();
            const settled_before_hash = concurrent_settled;
            finish_hash('freeze-v2:current-hash');
            await Promise.all([reverting, concurrent]);

            expect(settled_before_hash).toBe(false);
            expect(mocks.concurrentValues).toEqual([1]);
            expect(adjustmentLayerStore.value?.layers[0]?.mix).toBe(0.25);
            expect(undoStore.value?.past.map((entry) => entry.label)).toEqual(['Set concurrent value']);
            expect(undoStore.value?.future).toEqual([]);
        }
    );

    it('rolls back the track store when the layer-store half of undo fails', async () => {
        const before_track_state = trackStore.value;
        const layer_failure = new Error('layer restore failed');
        const layer_set = vi.spyOn(adjustmentLayerStore, 'set').mockImplementationOnce(() => {
            throw layer_failure;
        });

        await expect(
            restoreAdjustmentLayerMutation({
                adjustmentMutationId: 'mutation-1',
                operation: { kind: 'restore-mix', layerId: 'layer-1', previous: 0.25, expected: 0.75 },
                staleTransitions: [
                    {
                        trackId: 'track-a',
                        previousStatus: 'stale',
                        previousAdjustmentMutationId: 'older-mutation',
                    },
                ],
            })
        ).rejects.toBe(layer_failure);

        expect(trackStore.value).toBe(before_track_state);
        layer_set.mockRestore();
    });

    it('reports both the store failure and a failed track rollback', async () => {
        const layer_failure = new Error('layer restore failed');
        const rollback_failure = new Error('track rollback failed');
        const original_track_set = trackStore.set.bind(trackStore);
        const track_set = vi
            .spyOn(trackStore, 'set')
            .mockImplementationOnce(original_track_set)
            .mockImplementationOnce(() => {
                throw rollback_failure;
            });
        const layer_set = vi.spyOn(adjustmentLayerStore, 'set').mockImplementationOnce(() => {
            throw layer_failure;
        });

        const restoring = restoreAdjustmentLayerMutation({
            adjustmentMutationId: 'mutation-1',
            operation: { kind: 'restore-mix', layerId: 'layer-1', previous: 0.25, expected: 0.75 },
            staleTransitions: [
                {
                    trackId: 'track-a',
                    previousStatus: 'stale',
                    previousAdjustmentMutationId: 'older-mutation',
                },
            ],
        });

        await expect(restoring).rejects.toMatchObject({
            errors: [layer_failure, rollback_failure],
            message: 'Adjustment-layer undo rollback failed',
        });
        layer_set.mockRestore();
        track_set.mockRestore();
    });
});
