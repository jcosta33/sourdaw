import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

import { persistDeviceParam } from '#/modules/Arrangement/stores';

import { bridges, type ProofAudioBridge } from '../helpers';
import { setProofParam } from '../setProofParam';

vi.mock('#/modules/Arrangement/stores', () => ({
    persistDeviceParam: vi.fn(),
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
});
