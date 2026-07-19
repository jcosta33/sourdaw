import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrack } from '../../../models/Track';
import { adjustmentLayerStore, type AdjustmentLayer } from '../../../stores/adjustmentLayer';
import { trackStore } from '../../../stores/trackStore';
import { restoreAdjustmentLayerMutation } from '../restoreAdjustmentLayerMutation';

const mocks = vi.hoisted(() => ({
    computeFreezeRenderInputHash: vi.fn<() => Promise<string>>(),
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
});
