import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { getTrackStoreState, persistDevicePatch } from '#/modules/Arrangement/useCases';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';

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

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: vi.fn(),
    updateDevicePatch: vi.fn(),
}));

function makeTrackState(
    deviceId: string,
    parameterValues: Record<string, number>
): NonNullable<ReturnType<typeof getTrackStoreState>> {
    return {
        tracks: [
            {
                id: 'track-1',
                name: 'Master',
                kind: 'audio',
                muted: false,
                soloed: false,
                armed: false,
                gain: 1,
                pan: 0,
                color: '#ffffff',
                clips: [],
                devices: [
                    {
                        id: deviceId,
                        name: 'Proof',
                        type: 'proof',
                        bypassed: false,
                        parameterValues,
                    },
                ],
                sends: [],
                midiFx: [],
                frozen: false,
                freezeState: { status: 'unfrozen' },
                parentId: null,
                collapsed: false,
                inputMonitoring: 'auto',
                hidden: false,
                disabled: false,
                height: 80,
                outputId: 'master',
                automationMode: 'read',
                groupId: null,
                soloSafe: false,
                notes: '',
                inputId: null,
                activeAlternativeId: 'track-1-alt-default',
                alternatives: [{ id: 'track-1-alt-default', name: 'Alternative 1', clips: [] }],
                vcaGroupId: null,
                midiOutputTrackId: null,
                followChordTrack: false,
            },
        ],
        selectedTrackId: 'track-1',
        ghostClips: [],
    };
}

describe('setProofTarget', () => {
    beforeEach(() => {
        bridges.clear();
        proofStore.set({});
        vi.clearAllMocks();
        vi.mocked(getTrackStoreState).mockReturnValue(null);
        vi.mocked(resolveEligibleDeviceWriteTarget).mockImplementation((deviceId) => ({
            status: 'eligible',
            trackId: 'track-1',
            deviceId,
        }));
        bridges.set('dev-1', {
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

    it('hydrates the store before applying a target when no bridge is registered yet', () => {
        setProofTarget({ deviceId: 'dev-2', target: 'club' });

        expect(getProofState('dev-2').patch.target).toBe('club');
        expect(getProofState('dev-2').patch.targetLufs).toBe(-6);
        expect(persistDevicePatch).toHaveBeenCalledWith('dev-2', { target_mode: 2, target_lufs: -6 });
        expect(updateDeviceParam).not.toHaveBeenCalled();
    });

    // Before registration a natively carried body already holds the persisted
    // record; the store must still hydrate from it, but setting a target must
    // not fire the ~118-write full sync a restorable row used to trigger on
    // every gesture ahead of the worklet's own registration.
    it('hydrates the store from a restorable row without any engine writes before bridge registration', () => {
        vi.mocked(getTrackStoreState).mockReturnValue(makeTrackState('dev-2', { input_gain: 3.5 }));

        setProofTarget({ deviceId: 'dev-2', target: 'club' });

        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(getProofState('dev-2').patch.inputGain).toBe(3.5);
        expect(getProofState('dev-2').patch.target).toBe('club');
        expect(getProofState('dev-2').patch.targetLufs).toBe(-6);
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

            setProofTarget({ deviceId: 'dev-1', target: 'club' });

            expect(getProofState('dev-1').patch.target).toBe(DEFAULT_PATCH.target);
            expect(persistDevicePatch).not.toHaveBeenCalled();
            expect(updateDeviceParam).not.toHaveBeenCalled();
        }
    );
});
