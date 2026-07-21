import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetDeviceParameter } from '../handleSetDeviceParameter';

const mocks = vi.hoisted(() => ({
    setDeviceParameter: vi.fn(),
}));

vi.mock('../../../useCases/device/setDeviceParameter/setDeviceParameter', () => ({
    setDeviceParameter: mocks.setDeviceParameter,
}));

describe('handleSetDeviceParameter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates the authoritative mutation once and reports a write', () => {
        mocks.setDeviceParameter.mockReturnValue(true);

        const result = handleSetDeviceParameter.execute({
            type: 'setDeviceParameter',
            payload: { deviceId: 'd1', paramId: 'gain', value: 0.5 },
        });

        expect(mocks.setDeviceParameter).toHaveBeenCalledWith('d1', 'gain', 0.5);
        expect(mocks.setDeviceParameter).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ status: 'written' });
    });

    it('reports no-write when the authoritative use case rejects the owner', () => {
        mocks.setDeviceParameter.mockReturnValue(false);

        const result = handleSetDeviceParameter.execute({
            type: 'setDeviceParameter',
            payload: { deviceId: 'd1', paramId: 'gain', value: 0.5 },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('provides a description reflecting the parameter', () => {
        const desc = handleSetDeviceParameter.describe({
            type: 'setDeviceParameter',
            payload: { deviceId: 'd1', paramId: 'gain', value: 0.5 },
        });
        expect(desc.label).toBe('Set gain');
    });

    it('is undoable', () => {
        expect(handleSetDeviceParameter.undoable).toBe(true);
    });
});
