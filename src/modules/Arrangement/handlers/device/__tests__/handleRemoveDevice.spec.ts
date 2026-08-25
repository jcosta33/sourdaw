import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleRemoveDevice } from '../handleRemoveDevice';

const mocks = vi.hoisted(() => ({
    prepareRemoveDevice: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('../../../useCases/device/prepareRemoveDevice', () => ({
    prepareRemoveDevice: mocks.prepareRemoveDevice,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleRemoveDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each([
        ['written', { status: 'written' }],
        ['missing', { status: 'no-write' }],
        ['conflict', { status: 'conflict' }],
    ] as const)('maps the %s outcome to the handler result', (outcome, expected) => {
        mocks.prepareRemoveDevice.mockReturnValue(outcome);

        const result = handleRemoveDevice.execute({
            type: 'removeDevice',
            payload: { deviceId: 'd1' },
        });

        expect(mocks.prepareRemoveDevice).toHaveBeenCalledWith('d1', undefined);
        expect(result).toEqual(expected);
    });

    it('defers external unload until commit and preserves ambiguous-commit reconciliation', () => {
        const afterCommit = vi.fn();
        const afterAmbiguousCommit = vi.fn();
        mocks.prepareRemoveDevice.mockReturnValue({ outcome: 'written', afterCommit, afterAmbiguousCommit });

        const result = handleRemoveDevice.execute({
            type: 'removeDevice',
            payload: { deviceId: 'd1' },
        });

        expect(result).toEqual({ status: 'written', afterCommit, afterAmbiguousCommit });
    });

    it('provides a description', () => {
        const desc = handleRemoveDevice.describe({
            type: 'removeDevice',
            payload: { deviceId: 'd1' },
        });
        expect(desc.label).toBe('Remove device');
    });

    it('snapshots the exact device and chain index for undo', () => {
        const device = {
            id: 'd1',
            name: 'EQ',
            type: 'builtin-eq',
            bypassed: true,
            parameterValues: { frequency: 2400 },
        };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'before' }, device, { id: 'after' }] }],
        });

        const desc = handleRemoveDevice.describe({ type: 'removeDevice', payload: { deviceId: 'd1' } });

        expect(desc.inverseAction).toEqual({
            type: 'restoreDevice',
            payload: {
                trackId: 't1',
                deviceSnapshot: device,
                deviceIndex: 1,
                expectedDeviceIds: ['before', 'after'],
            },
        });
    });

    it('is undoable', () => {
        expect(handleRemoveDevice.undoable).toBe(true);
        expect(handleRemoveDevice.requiresAbortCompensation).toBe(false);
    });
});
