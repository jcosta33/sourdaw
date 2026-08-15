import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAddDevice } from '../handleAddDevice';

const mocks = vi.hoisted(() => ({
    abortAddedDeviceRuntime: vi.fn(),
    addDevice: vi.fn(),
}));

vi.mock('../../../useCases/device/abortAddedDeviceRuntime', () => ({
    abortAddedDeviceRuntime: mocks.abortAddedDeviceRuntime,
}));

vi.mock('../../../useCases/device/addDevice', () => ({
    addDevice: mocks.addDevice,
}));

describe('handleAddDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes addDevice with the provided payload', () => {
        mocks.addDevice.mockReturnValue({ id: 'device-1' });
        const result = handleAddDevice.execute({
            type: 'addDevice',
            payload: { trackId: 't1', deviceType: 'EQ' },
        });

        expect(mocks.addDevice).toHaveBeenCalledWith('t1', 'EQ', undefined, expect.stringMatching(/^device-/));
        expect(result).toEqual({ status: 'written' });
    });

    it('returns no-write when addDevice rejects the target track', () => {
        mocks.addDevice.mockReturnValue(null);
        const result = handleAddDevice.execute({
            type: 'addDevice',
            payload: { trackId: 'vca-1', deviceType: 'EQ' },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('provides a description reflecting the device type', () => {
        const desc = handleAddDevice.describe({
            type: 'addDevice',
            payload: { trackId: 't1', deviceType: 'EQ' },
        });
        expect(desc.label).toBe('Add EQ');
    });

    it('reserves an identity and describes an exact removal inverse', () => {
        const action = { type: 'addDevice', payload: { trackId: 't1', deviceType: 'builtin-eq' } } as const;

        const desc = handleAddDevice.describe(action);

        expect(desc.inverseAction).toEqual({
            type: 'removeDevice',
            payload: {
                deviceId: expect.stringMatching(/^device-/),
                // A bare add appends, so the guarded chain is the current
                // chain with the reserved id appended — the expecteds keep
                // the inverse reapply-safe inside atomic batches.
                expectedTrackId: 't1',
                expectedDeviceIds: [expect.stringMatching(/^device-/)],
            },
        });
    });

    it('is undoable', () => {
        expect(handleAddDevice.undoable).toBe(true);
    });

    it('makes captured exact runtime cleanup the sole abort owner', async () => {
        const action = {
            type: 'addDevice',
            payload: { trackId: 't1', deviceType: 'builtin-compressor', deviceId: 'device-1' },
        } as const;

        await handleAddDevice.prepareAbort?.(action)();

        expect(mocks.abortAddedDeviceRuntime).toHaveBeenCalledWith({ trackId: 't1', deviceId: 'device-1' });
        expect(handleAddDevice.requiresAbortCompensation).toBe(false);
    });
});
