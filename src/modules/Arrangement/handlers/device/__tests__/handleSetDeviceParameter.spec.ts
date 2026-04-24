import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetDeviceParameter } from '../handleSetDeviceParameter';

const mocks = vi.hoisted(() => ({
    updateDeviceParam: vi.fn(),
    setDeviceParameter: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: mocks.updateDeviceParam,
}));

vi.mock('../../../useCases/device/setDeviceParameter/setDeviceParameter', () => ({
    setDeviceParameter: mocks.setDeviceParameter,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleSetDeviceParameter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('sets the parameter and updates the audio engine', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1' }] }],
        });

        void handleSetDeviceParameter.execute({
            type: 'setDeviceParameter',
            payload: { deviceId: 'd1', paramId: 'gain', value: 0.5 },
        });

        expect(mocks.setDeviceParameter).toHaveBeenCalledWith('d1', 'gain', 0.5);
        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'gain', 0.5);
    });

    it('updates audio engine with empty string track ID if track cannot be found', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

        void handleSetDeviceParameter.execute({
            type: 'setDeviceParameter',
            payload: { deviceId: 'd1', paramId: 'gain', value: 0.5 },
        });

        expect(mocks.setDeviceParameter).toHaveBeenCalledWith('d1', 'gain', 0.5);
        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('', 'd1', 'gain', 0.5);
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
