import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

import { persistDeviceParam, resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';

import { bridges, type ProofAudioBridge } from '../helpers';
import { setProofParam } from '../setProofParam';

vi.mock('#/modules/Arrangement/stores', () => ({
    persistDeviceParam: vi.fn(),
    resolveEligibleDeviceWriteTarget: vi.fn(),
}));

// The door every live Proof write reaches the DSP through, and the only one a
// natively carried body is behind.
vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: vi.fn(),
    updateDevicePatch: vi.fn(),
}));

type MockedProofBridge = {
    [K in keyof ProofAudioBridge]: Mock<ProofAudioBridge[K]>;
};

function makeBridge(): MockedProofBridge {
    return {
        reorderModules: vi.fn<ProofAudioBridge['reorderModules']>(),
        resetIntegrated: vi.fn<ProofAudioBridge['resetIntegrated']>(),
    };
}

describe('setProofParam', () => {
    beforeEach(() => {
        bridges.clear();
        vi.clearAllMocks();
        vi.mocked(resolveEligibleDeviceWriteTarget).mockImplementation((deviceId) => ({
            status: 'eligible',
            trackId: 'track-1',
            deviceId,
        }));
    });

    it('sends the param through the device door and persists it', () => {
        setProofParam({ deviceId: 'dev-1', name: 'lim_ceiling', value: -1.5 });

        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'dev-1', 'lim_ceiling', -1.5);
        expect(persistDeviceParam).toHaveBeenCalledWith('dev-1', 'lim_ceiling', -1.5);
    });

    // A device the native session carries has no worklet bridge of its own, so
    // gating the engine write on one would silence exactly the case this door
    // exists for.
    it('still writes the device when no bridge is registered for it', () => {
        setProofParam({ deviceId: 'unregistered', name: 'input_gain', value: 3 });

        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'unregistered', 'input_gain', 3);
        expect(persistDeviceParam).toHaveBeenCalledWith('unregistered', 'input_gain', 3);
    });

    it('reaches the engine with ab_bypass but never the project', () => {
        setProofParam({ deviceId: 'dev-1', name: 'ab_bypass', value: 1 });

        // A/B compare is a listening aid. Persisted, it reloads as a project
        // whose entire Proof chain is silently bypassed.
        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'dev-1', 'ab_bypass', 1);
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });

    it.each(['missing', 'ineligible'] as const)('rejects a %s owner before engine or persistence effects', (status) => {
        bridges.set('dev-1', makeBridge());
        vi.mocked(resolveEligibleDeviceWriteTarget).mockReturnValue({ status });

        setProofParam({ deviceId: 'dev-1', name: 'lim_ceiling', value: -1.5 });

        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });
});
