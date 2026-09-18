import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { updateDevicePatch } from '#/modules/AudioEngine/useCases';

import { getProofState, proofStore } from '../../../stores/proofStore';
import { bridges, type ProofAudioBridge } from '../helpers';
import { reorderChain } from '../reorderChain';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    resolveEligibleDeviceWriteTarget: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
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

describe('reorderChain', () => {
    beforeEach(() => {
        bridges.clear();
        proofStore.set({});
        vi.clearAllMocks();
        vi.mocked(resolveEligibleDeviceWriteTarget).mockImplementation((deviceId) => ({
            status: 'eligible',
            trackId: 'track-1',
            deviceId,
        }));
    });

    it('updates the stored chain order and sends it to both carriers', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        reorderChain({ deviceId: 'dev-1', order: [2, 0, 1, 4, 3] });

        expect(getProofState('dev-1').patch.chainOrder).toEqual([2, 0, 1, 4, 3]);
        expect(bridge.reorderModules).toHaveBeenCalledWith([2, 0, 1, 4, 3]);
        expect(updateDevicePatch).toHaveBeenCalledWith('track-1', 'dev-1', {
            chain_order_0: 2,
            chain_order_1: 0,
            chain_order_2: 1,
            chain_order_3: 4,
            chain_order_4: 3,
        });
    });

    it('sends the order to the device even when no bridge is registered', () => {
        reorderChain({ deviceId: 'no-bridge', order: [4, 3, 2, 1, 0] });

        expect(getProofState('no-bridge').patch.chainOrder).toEqual([4, 3, 2, 1, 0]);
        expect(updateDevicePatch).toHaveBeenCalledWith('track-1', 'no-bridge', {
            chain_order_0: 4,
            chain_order_1: 3,
            chain_order_2: 2,
            chain_order_3: 1,
            chain_order_4: 0,
        });
    });
});
