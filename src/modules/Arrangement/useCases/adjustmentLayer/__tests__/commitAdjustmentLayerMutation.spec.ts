import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrack } from '../../../models/Track';
import { commitAdjustmentLayerMutation } from '../commitAdjustmentLayerMutation';

import type { AdjustmentLayerState } from '../../../stores/adjustmentLayer';
import type { TrackStoreState } from '../../../stores/trackStore';

const mocks = vi.hoisted(() => ({
    layerState: { value: null as AdjustmentLayerState | null },
    trackState: { value: null as TrackStoreState | null },
    adjustmentLayerStoreSet: vi.fn<(value: AdjustmentLayerState | null) => void>(),
    trackStoreSet: vi.fn<(value: TrackStoreState | null) => void>(),
}));

vi.mock('../../../stores/adjustmentLayer', () => ({
    adjustmentLayerStore: {
        get value() {
            return mocks.layerState.value;
        },
        set: mocks.adjustmentLayerStoreSet,
    },
}));

vi.mock('../../../stores/trackStore', () => ({
    trackStore: {
        get value() {
            return mocks.trackState.value;
        },
        set: mocks.trackStoreSet,
    },
}));

describe('commitAdjustmentLayerMutation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.layerState.value = { layers: [] };
        mocks.trackState.value = { tracks: [], selectedTrackId: null, ghostClips: [] };
        mocks.adjustmentLayerStoreSet.mockImplementation((value) => {
            mocks.layerState.value = value;
        });
        mocks.trackStoreSet.mockImplementation((value) => {
            mocks.trackState.value = value;
        });
    });

    it('reports both the commit failure and a failed layer rollback', () => {
        const commit_failure = new Error('track commit failed');
        const rollback_failure = new Error('layer rollback failed');
        const changed_state: AdjustmentLayerState = {
            layers: [
                {
                    id: 'layer-1',
                    name: 'Layer',
                    effectType: 'volume',
                    parameters: [{ name: 'Gain', value: 0, min: -60, max: 12, unit: 'dB' }],
                    affectedTrackIds: [],
                    insertionIndex: 0,
                    regions: [],
                    enabled: true,
                    mix: 1,
                    color: '#fff',
                },
            ],
        };
        const frozen_track = createTrack({ id: 'track-1', name: 'Track', kind: 'audio' });
        mocks.trackState.value = {
            tracks: [{ ...frozen_track, frozen: true, freezeState: { status: 'frozen' } }],
            selectedTrackId: null,
            ghostClips: [],
        };
        mocks.trackStoreSet.mockImplementationOnce(() => {
            throw commit_failure;
        });
        mocks.adjustmentLayerStoreSet
            .mockImplementationOnce((value) => {
                mocks.layerState.value = value;
            })
            .mockImplementationOnce(() => {
                throw rollback_failure;
            });

        let thrown: unknown;
        try {
            commitAdjustmentLayerMutation({
                adjustmentMutationId: 'mutation-1',
                mutation: () => {
                    mocks.adjustmentLayerStoreSet(changed_state);
                },
            });
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(AggregateError);
        if (!(thrown instanceof AggregateError)) {
            throw new Error('Expected rollback to throw AggregateError');
        }
        expect(thrown.message).toBe('Adjustment-layer mutation rollback failed');
        expect(thrown.cause).toBe(commit_failure);
        expect(thrown.errors).toEqual(expect.arrayContaining([commit_failure, rollback_failure]));
    });
});
