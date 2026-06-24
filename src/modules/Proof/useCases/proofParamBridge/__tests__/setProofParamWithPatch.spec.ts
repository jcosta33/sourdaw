import { describe, it, expect, beforeEach, vi } from 'vitest';

import { getProofState, proofStore } from '../../../stores/proofStore';
import { bridges, type ProofAudioBridge } from '../helpers';
import { setProofParamWithPatch } from '../setProofParamWithPatch';

function makeBridge(): ProofAudioBridge & {
    setParam: ReturnType<typeof vi.fn>;
    reorderModules: ReturnType<typeof vi.fn>;
} {
    return {
        setParam: vi.fn(),
        reorderModules: vi.fn(),
        resetIntegrated: vi.fn(),
    };
}

describe('setProofParamWithPatch', () => {
    beforeEach(() => {
        bridges.clear();
        proofStore.set({});
    });

    it('updates the stored patch and forwards the mapped engine param', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        setProofParamWithPatch({ deviceId: 'dev-1', key: 'limCeiling', value: -2 });

        expect(getProofState('dev-1').patch.limCeiling).toBe(-2);
        expect(bridge.setParam).toHaveBeenCalledWith('lim_ceiling', -2);
    });

    it('maps a boolean bypass field to the 0/1 engine convention', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        setProofParamWithPatch({ deviceId: 'dev-1', key: 'eqBypassed', value: true });

        expect(getProofState('dev-1').patch.eqBypassed).toBe(true);
        expect(bridge.setParam).toHaveBeenCalledWith('eq_bypass', 1);
    });

    it('forwards a chain-order change through reorderModules', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        setProofParamWithPatch({ deviceId: 'dev-1', key: 'chainOrder', value: [4, 3, 2, 1, 0] });

        expect(getProofState('dev-1').patch.chainOrder).toEqual([4, 3, 2, 1, 0]);
        expect(bridge.reorderModules).toHaveBeenCalledWith([4, 3, 2, 1, 0]);
    });

    it('still updates the store when no bridge is registered', () => {
        setProofParamWithPatch({ deviceId: 'no-bridge', key: 'outputGain', value: 5 });
        expect(getProofState('no-bridge').patch.outputGain).toBe(5);
    });
});
