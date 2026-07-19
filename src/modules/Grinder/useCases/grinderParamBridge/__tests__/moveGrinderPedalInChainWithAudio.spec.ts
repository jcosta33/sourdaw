import { beforeEach, describe, expect, it, vi } from 'vitest';

import { moveGrinderPedalInChain } from '../../../stores/grinderStore';
import { moveGrinderPedalInChainWithAudio } from '../moveGrinderPedalInChainWithAudio';

vi.mock('../../../stores/grinderStore', () => ({
    moveGrinderPedalInChain: vi.fn(),
}));

vi.mock('#/infra/di/inject', () => ({
    inject: () => (fn: any) => fn,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: vi.fn(),
    persistDeviceParam: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: vi.fn(),
    updateDevicePatch: vi.fn(),
}));

const move_pedal_mock = vi.mocked(moveGrinderPedalInChain);

describe('moveGrinderPedalInChainWithAudio', () => {
    const deps = {
        getAllTracks: vi.fn(),
        updateDeviceParam: vi.fn(),
        updateDevicePatch: vi.fn(),
        persistDeviceParam: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should push the reordered pre-chain order params to the audio engine and persist them', () => {
        const device_id = 'device-1';
        deps.getAllTracks.mockReturnValue([{ id: 'track-1', devices: [{ id: device_id, type: 'grinder' }] }]);
        move_pedal_mock.mockReturnValue({
            prePedals: [
                { id: 'dist-1', type: 'distortion', enabled: true, params: {} },
                { id: 'od-1', type: 'overdrive', enabled: true, params: {} },
            ],
            postPedals: [],
        } as any);

        const action = moveGrinderPedalInChainWithAudio(deps as any);
        action(device_id, false, 'distortion', 'left');

        expect(moveGrinderPedalInChain).toHaveBeenCalledWith(device_id, false, 'distortion', 'left');
        expect(deps.updateDeviceParam).toHaveBeenCalledWith('track-1', device_id, 'preDistortionOrder', 0);
        expect(deps.updateDeviceParam).toHaveBeenCalledWith('track-1', device_id, 'preOverdriveOrder', 1);
        expect(deps.persistDeviceParam).toHaveBeenCalledWith(device_id, 'preDistortionOrder', 0);
    });

    it('should read post-chain pedals (not pre) when isPost is true', () => {
        const device_id = 'device-2';
        deps.getAllTracks.mockReturnValue([{ id: 'track-2', devices: [{ id: device_id, type: 'grinder' }] }]);
        move_pedal_mock.mockReturnValue({
            prePedals: [],
            postPedals: [{ id: 'fuzz-1', type: 'fuzz', enabled: true, params: {} }],
        } as any);

        const action = moveGrinderPedalInChainWithAudio(deps as any);
        action(device_id, true, 'fuzz', 'right');

        expect(deps.updateDeviceParam).toHaveBeenCalledWith('track-2', device_id, 'postFuzzOrder', 0);
        // Only post-prefixed keys are sent for a post-chain move.
        expect(deps.updateDeviceParam).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            'preFuzzOrder',
            expect.anything()
        );
    });

    it('should no-op without touching the audio engine when the store reports no swap partner', () => {
        move_pedal_mock.mockReturnValue(null);

        const action = moveGrinderPedalInChainWithAudio(deps as any);
        action('device-3', false, 'overdrive', 'left');

        expect(deps.getAllTracks).not.toHaveBeenCalled();
        expect(deps.updateDeviceParam).not.toHaveBeenCalled();
        expect(deps.persistDeviceParam).not.toHaveBeenCalled();
    });

    it('should no-op without touching the audio engine when the device has no live track ref', () => {
        deps.getAllTracks.mockReturnValue([]);
        move_pedal_mock.mockReturnValue({ prePedals: [], postPedals: [] } as any);

        const action = moveGrinderPedalInChainWithAudio(deps as any);
        action('missing-device', false, 'overdrive', 'left');

        expect(deps.updateDeviceParam).not.toHaveBeenCalled();
        expect(deps.persistDeviceParam).not.toHaveBeenCalled();
    });
});
