import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { persistDevicePatch } from '#/modules/Arrangement/useCases';

import { DEFAULT_PATCH, type ProofTarget } from '../../../models/ProofPatch';
import { getProofState, loadProofPatch, proofStore } from '../../../stores/proofStore';
import { bridges } from '../helpers';
import { setProofTarget } from '../setProofTarget';

vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: vi.fn(() => null),
    persistDevicePatch: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    resolveEligibleDeviceWriteTarget: vi.fn(),
}));

describe('setProofTarget', () => {
    beforeEach(() => {
        bridges.clear();
        proofStore.set({});
        vi.clearAllMocks();
        vi.mocked(resolveEligibleDeviceWriteTarget).mockImplementation((deviceId) => ({
            status: 'eligible',
            trackId: 'track-1',
            deviceId,
        }));
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

    it('runs a full engine resync before applying a target when no bridge is registered yet', () => {
        setProofTarget({ deviceId: 'dev-2', target: 'club' });

        expect(getProofState('dev-2').patch.target).toBe('club');
        expect(getProofState('dev-2').patch.targetLufs).toBe(-6);
        expect(persistDevicePatch).toHaveBeenCalledWith('dev-2', { target_mode: 2, target_lufs: -6 });
    });

    it('rejects a target change when the underlying patch is already invalid', () => {
        loadProofPatch({ deviceId: 'dev-1', patch: { ...DEFAULT_PATCH, limCeiling: 999 } });

        setProofTarget({ deviceId: 'dev-1', target: 'cd' });

        expect(getProofState('dev-1').patch.target).toBe(DEFAULT_PATCH.target);
        expect(getProofState('dev-1').patch.targetLufs).toBe(DEFAULT_PATCH.targetLufs);
        expect(persistDevicePatch).not.toHaveBeenCalled();
    });

    it.each(['missing', 'ineligible'] as const)(
        'rejects a %s owner before sync, store, or persistence effects',
        (status) => {
            vi.mocked(resolveEligibleDeviceWriteTarget).mockReturnValue({ status });
            const bridge = bridges.get('dev-1');

            setProofTarget({ deviceId: 'dev-1', target: 'club' });

            expect(getProofState('dev-1').patch.target).toBe(DEFAULT_PATCH.target);
            expect(persistDevicePatch).not.toHaveBeenCalled();
            expect(bridge?.setParam).not.toHaveBeenCalled();
        }
    );
});
