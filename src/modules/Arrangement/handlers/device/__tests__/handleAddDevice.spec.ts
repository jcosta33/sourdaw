import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAddDevice } from '../handleAddDevice';

const mocks = vi.hoisted(() => ({
    addDevice: vi.fn(),
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
            payload: { deviceId: expect.stringMatching(/^device-/) },
        });
    });

    it('is undoable', () => {
        expect(handleAddDevice.undoable).toBe(true);
    });
});
