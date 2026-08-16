import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

import { persistDeviceParam, resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';

import { bridges, type ProofAudioBridge } from '../helpers';
import { setProofParam } from '../setProofParam';

vi.mock('#/modules/Arrangement/stores', () => ({
    persistDeviceParam: vi.fn(),
    resolveEligibleDeviceWriteTarget: vi.fn(),
}));

type MockedProofBridge = {
    [K in keyof ProofAudioBridge]: Mock<ProofAudioBridge[K]>;
};

function makeBridge(): MockedProofBridge {
    return {
        setParam: vi.fn<ProofAudioBridge['setParam']>(),
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

    it('forwards the param to the registered bridge and persists it', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        setProofParam({ deviceId: 'dev-1', name: 'lim_ceiling', value: -1.5 });

        expect(bridge.setParam).toHaveBeenCalledWith('lim_ceiling', -1.5);
        expect(persistDeviceParam).toHaveBeenCalledWith('dev-1', 'lim_ceiling', -1.5);
    });

    it('still persists when no bridge is registered for the device', () => {
        setProofParam({ deviceId: 'unregistered', name: 'input_gain', value: 3 });

        expect(persistDeviceParam).toHaveBeenCalledWith('unregistered', 'input_gain', 3);
    });

    it('reaches the engine with ab_bypass but never the project', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        setProofParam({ deviceId: 'dev-1', name: 'ab_bypass', value: 1 });

        // A/B compare is a listening aid. Persisted, it reloads as a project
        // whose entire Proof chain is silently bypassed.
        expect(bridge.setParam).toHaveBeenCalledWith('ab_bypass', 1);
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });

    it.each(['missing', 'ineligible'] as const)('rejects a %s owner before bridge or persistence effects', (status) => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);
        vi.mocked(resolveEligibleDeviceWriteTarget).mockReturnValue({ status });

        setProofParam({ deviceId: 'dev-1', name: 'lim_ceiling', value: -1.5 });

        expect(bridge.setParam).not.toHaveBeenCalled();
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });
});
