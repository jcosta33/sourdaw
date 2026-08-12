import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleRestoreDevice } from '../handleRestoreDevice';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    restoreDevice: vi.fn(),
}));

vi.mock('../../../useCases/device/restoreDevice', () => ({ restoreDevice: mocks.restoreDevice }));
vi.mock('../../../useCases/getTrackStoreState', () => ({ getTrackStoreState: mocks.getTrackStoreState }));

const restoreAction = {
    type: 'restoreDevice',
    payload: {
        trackId: 'track-vocal',
        deviceSnapshot: {
            id: 'reverb',
            name: 'Reverb',
            type: 'builtin-reverb',
            bypassed: false,
            parameterValues: {},
        },
        deviceIndex: 2,
        expectedDeviceIds: ['eq', 'delay'],
        batchRestoreDevices: [
            { trackId: 'track-vocal', deviceId: 'delay', deviceIndex: 1 },
            { trackId: 'track-vocal', deviceId: 'reverb', deviceIndex: 2 },
        ],
    },
} as const;

describe('handleRestoreDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('restores a sibling device at its effective batch-local index after commit', () => {
        const afterCommit = vi.fn();
        const afterAmbiguousCommit = vi.fn();
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 'track-vocal', devices: [{ id: 'eq' }] }] });
        mocks.restoreDevice.mockReturnValue({ outcome: 'written', afterCommit, afterAmbiguousCommit });

        const result = handleRestoreDevice.execute(restoreAction);

        expect(mocks.restoreDevice).toHaveBeenCalledWith(
            {
                trackId: 'track-vocal',
                deviceSnapshot: restoreAction.payload.deviceSnapshot,
                deviceIndex: 1,
            },
            { deferRuntimeEffects: true }
        );
        expect(result).toEqual({ status: 'written', afterCommit, afterAmbiguousCommit });
    });

    it('rejects an unrelated collaborator chain change before project or runtime mutation', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'track-vocal', devices: [{ id: 'eq' }, { id: 'collaborator-compressor' }] }],
        });

        expect(handleRestoreDevice.execute(restoreAction)).toEqual({ status: 'conflict' });
        expect(mocks.restoreDevice).not.toHaveBeenCalled();
    });

    it('uses deferred runtime reconciliation as the sole abort-safe owner', () => {
        expect(handleRestoreDevice.requiresAbortCompensation).toBe(false);
        expect(handleRestoreDevice.undoable).toBe(false);
    });
});
