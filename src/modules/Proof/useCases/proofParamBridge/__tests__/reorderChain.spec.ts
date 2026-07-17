import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

import { getProofState, proofStore } from '../../../stores/proofStore';
import { bridges, type ProofAudioBridge } from '../helpers';
import { reorderChain } from '../reorderChain';

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

describe('reorderChain', () => {
    beforeEach(() => {
        bridges.clear();
        proofStore.set({});
    });

    it('updates the stored chain order and forwards it to the bridge', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        reorderChain({ deviceId: 'dev-1', order: [2, 0, 1, 4, 3] });

        expect(getProofState('dev-1').patch.chainOrder).toEqual([2, 0, 1, 4, 3]);
        expect(bridge.reorderModules).toHaveBeenCalledWith([2, 0, 1, 4, 3]);
    });

    it('updates the store even when no bridge is registered', () => {
        reorderChain({ deviceId: 'no-bridge', order: [4, 3, 2, 1, 0] });
        expect(getProofState('no-bridge').patch.chainOrder).toEqual([4, 3, 2, 1, 0]);
    });
});
