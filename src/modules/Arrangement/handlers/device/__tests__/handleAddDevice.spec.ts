import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAddDevice } from '../handleAddDevice';

const mocks = vi.hoisted(() => ({
    addDevice: vi.fn(),
    applyDeviceChainRuntimeDelta: vi.fn(() => ({ acceptance: 'accepted', application: 'applied' })),
    updateDeviceParam: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('../../../useCases/device/addDevice', () => ({
    addDevice: mocks.addDevice,
}));

vi.mock('../../../useCases/device/applyDeviceChainRuntimeDelta', () => ({
    applyDeviceChainRuntimeDelta: mocks.applyDeviceChainRuntimeDelta,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: mocks.updateDeviceParam,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleAddDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('finalizes the bare chain from the actual post-add chain at execute', () => {
        // The store as it stands after the add — including any chain mutations
        // earlier batch actions made — is what undo's validation compares
        // against, so that is what the inverse must carry.
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'device-existing' }] }],
        });
        const action = { type: 'addDevice', payload: { trackId: 't1', deviceType: 'builtin-eq' } };
        const desc = handleAddDevice.describe(action as never);
        mocks.addDevice.mockReturnValue({ id: 'device-new', parameterValues: {} });

        const result = handleAddDevice.execute(action as never);

        expect(result).toMatchObject({ status: 'written' });
        const inverse = desc?.inverseAction;
        if (!inverse || inverse.type !== 'removeDevice') {
            throw new Error('Expected a removeDevice inverse');
        }
        // Finalized from the store chain, not from the describe-time
        // reserved id — proving the placeholder was filled at execute.
        expect(inverse.payload.expectedDeviceIds).toEqual(['device-existing']);
    });

    it('executes addDevice with the provided payload', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', devices: [] }] });
        mocks.addDevice.mockReturnValue({ id: 'device-1', parameterValues: {} });
        const result = handleAddDevice.execute({
            type: 'addDevice',
            payload: { trackId: 't1', deviceType: 'EQ' },
        });

        expect(mocks.addDevice).toHaveBeenCalledWith(
            't1',
            'EQ',
            undefined,
            expect.stringMatching(/^device-/),
            undefined,
            undefined,
            { projectOnly: true }
        );
        expect(result).toMatchObject({ status: 'written' });
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
                // A bare add has no pre-declared chain: describe embeds an
                // empty placeholder so the compensation is guarded for atomic
                // batches, and execute finalizes it from the actual post-add
                // chain (shared by reference with the inverse payload).
                expectedTrackId: 't1',
                expectedDeviceIds: [],
            },
        });
    });

    it('is undoable', () => {
        expect(handleAddDevice.undoable).toBe(true);
    });

    it('defers the compiled runtime delta until the project commit succeeds', () => {
        const action = {
            type: 'addDevice',
            payload: { trackId: 't1', deviceType: 'builtin-compressor', deviceId: 'device-1' },
        } as const;
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', devices: [] }] });
        mocks.addDevice.mockReturnValue({ id: 'device-1', parameterValues: { threshold: -12 } });

        const result = handleAddDevice.execute(action);
        if (!result || result instanceof Promise || result.status !== 'written' || !result.afterCommit) {
            throw new Error('Expected a deferred runtime effect');
        }

        expect(mocks.applyDeviceChainRuntimeDelta).not.toHaveBeenCalled();
        result.afterCommit();
        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'add-device' })
        );
        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('t1', 'device-1', 'threshold', -12);
        expect(handleAddDevice.requiresAbortCompensation).toBe(false);
    });
});
