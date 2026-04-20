import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleRemoveDevice } from '../handleRemoveDevice';

const mocks = vi.hoisted(() => ({
    removeDevice: vi.fn(),
}));

vi.mock('../../../useCases/device/removeDevice', () => ({
    removeDevice: mocks.removeDevice,
}));

describe('handleRemoveDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes removeDevice with the provided payload', () => {
        void handleRemoveDevice.execute({
            type: 'removeDevice',
            payload: { deviceId: 'd1' },
        });

        expect(mocks.removeDevice).toHaveBeenCalledWith('d1');
    });

    it('provides a description', () => {
        const desc = handleRemoveDevice.describe({
            type: 'removeDevice',
            payload: { deviceId: 'd1' },
        });
        expect(desc.label).toBe('Remove device');
    });

    it('is undoable', () => {
        expect(handleRemoveDevice.undoable).toBe(true);
    });
});
