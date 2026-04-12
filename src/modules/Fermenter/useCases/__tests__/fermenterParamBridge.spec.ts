import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadFermenterPatchWithAudio } from '../fermenterParamBridge/loadFermenterPatchWithAudio';
import { setFermenterParamWithAudio } from '../fermenterParamBridge/setFermenterParamWithAudio';

const { getAllTracks, persistDeviceParam } = vi.hoisted(() => ({
    getAllTracks: vi.fn(() => []),
    persistDeviceParam: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: (...args: any[]) => getAllTracks(...args),
    persistDeviceParam: (...args: any[]) => persistDeviceParam(...args),
}));

const { updateDeviceParam } = vi.hoisted(() => ({
    updateDeviceParam: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: (...args: any[]) => updateDeviceParam(...args),
}));

describe('fermenterParamBridge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('setFermenterParamWithAudio does not touch the engine when the device is unknown', () => {
        setFermenterParamWithAudio('missing-device', 'inputGain', 0.5);

        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });

    it('loadFermenterPatchWithAudio does not touch the engine when the device is unknown', () => {
        loadFermenterPatchWithAudio('missing-device', { inputGain: 1 } as never);

        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });
});
