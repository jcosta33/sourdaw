import { beforeEach, describe, expect, it, vi } from 'vitest';

import { persistDevicePatch } from '#/modules/Arrangement/useCases';

import { DEFAULT_PATCH, type ProofTarget } from '../../../models/ProofPatch';
import { getProofState, proofStore } from '../../../stores/proofStore';
import { bridges } from '../helpers';
import { setProofTarget } from '../setProofTarget';

vi.mock('#/modules/Arrangement/useCases', () => ({
    persistDevicePatch: vi.fn(),
}));

describe('setProofTarget', () => {
    beforeEach(() => {
        bridges.clear();
        proofStore.set({});
        vi.clearAllMocks();
        bridges.set('dev-1', {
            setParam: vi.fn(),
            reorderModules: vi.fn(),
            resetIntegrated: vi.fn(),
        });
    });

    it('rejects a malformed runtime target before any write', () => {
        const malformedTarget = 'unknown' as ProofTarget;

        setProofTarget({ deviceId: 'dev-1', target: malformedTarget });

        expect(getProofState('dev-1').patch.target).toBe(DEFAULT_PATCH.target);
        expect(getProofState('dev-1').patch.targetLufs).toBe(DEFAULT_PATCH.targetLufs);
        expect(persistDevicePatch).not.toHaveBeenCalled();
    });
});
