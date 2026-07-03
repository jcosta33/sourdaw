import { describe, it, expect, beforeEach, vi } from 'vitest';

import { getTrackStoreState } from '#/modules/Arrangement/useCases';

import { DEFAULT_PATCH, type ProofPatch } from '../../../models/ProofPatch';
import { getProofState, proofStore, setProofAbBypass } from '../../../stores/proofStore';
import { bridges, type ProofAudioBridge } from '../helpers';
import { loadProofPatchWithAudio } from '../loadProofPatchWithAudio';
import { syncFullPatch } from '../syncFullPatch';

vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: vi.fn(() => null),
}));

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

function paramCalls(bridge: ReturnType<typeof makeBridge>): Map<string, number> {
    const map = new Map<string, number>();
    for (const [name, value] of bridge.setParam.mock.calls) {
        map.set(name as string, value as number);
    }
    return map;
}

function makeTrackState(parameterValues: Record<string, number>): NonNullable<ReturnType<typeof getTrackStoreState>> {
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
                        id: DEVICE_ID,
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

const DEVICE_ID = 'dev-1';

describe('loadProofPatchWithAudio', () => {
    beforeEach(() => {
        bridges.clear();
        proofStore.set({});
        vi.clearAllMocks();
        vi.mocked(getTrackStoreState).mockReturnValue(null);
    });

    it('loads the patch into the store and sends the full patch to the engine', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        const patch: ProofPatch = {
            ...DEFAULT_PATCH,
            name: 'Streaming Master',
            presetId: 'streaming',
            limCeiling: -1.5,
        };

        loadProofPatchWithAudio({ deviceId: DEVICE_ID, patch });

        // Store now holds the loaded patch (identity preserved).
        expect(getProofState(DEVICE_ID).patch.presetId).toBe('streaming');
        expect(getProofState(DEVICE_ID).patch.limCeiling).toBe(-1.5);

        // The engine receives the scalar params and the chain reorder.
        const calls = paramCalls(bridge);
        expect(calls.get('lim_ceiling')).toBe(-1.5);
        expect(calls.get('input_gain')).toBe(DEFAULT_PATCH.inputGain);
        expect(bridge.reorderModules).toHaveBeenCalledWith(DEFAULT_PATCH.chainOrder);
    });

    it('should rehydrate restored scalar device params before syncing a default Proof patch', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        vi.mocked(getTrackStoreState).mockReturnValue(
            makeTrackState({
                input_gain: 3.5,
                eq_bypass: 1,
                exc_bypass: 0,
                lim_ceiling: -3.25,
                dither_mode: 2,
                dither_bits: 24,
                target_lufs: -9,
            })
        );

        syncFullPatch(DEVICE_ID);

        const patch = getProofState(DEVICE_ID).patch;
        expect(patch.inputGain).toBe(3.5);
        expect(patch.eqBypassed).toBe(true);
        expect(patch.excBypassed).toBe(false);
        expect(patch.limCeiling).toBe(-3.25);
        expect(patch.ditherMode).toBe('noise_shaped');
        expect(patch.ditherBits).toBe(24);
        expect(patch.targetLufs).toBe(DEFAULT_PATCH.targetLufs);

        const calls = paramCalls(bridge);
        expect(calls.get('input_gain')).toBe(3.5);
        expect(calls.get('eq_bypass')).toBe(1);
        expect(calls.get('exc_bypass')).toBe(0);
        expect(calls.get('lim_ceiling')).toBe(-3.25);
        expect(calls.get('dither_mode')).toBe(2);
        expect(calls.get('dither_bits')).toBe(24);
        expect(bridge.reorderModules).toHaveBeenCalledWith(DEFAULT_PATCH.chainOrder);
    });

    it('should rehydrate restored scalars when runtime-only state already created the Proof entry', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        setProofAbBypass({ deviceId: DEVICE_ID, abBypass: true });
        vi.mocked(getTrackStoreState).mockReturnValue(
            makeTrackState({
                input_gain: 2.25,
                lim_ceiling: -4.5,
            })
        );

        syncFullPatch(DEVICE_ID);

        const patch = getProofState(DEVICE_ID).patch;
        expect(patch.inputGain).toBe(2.25);
        expect(patch.limCeiling).toBe(-4.5);
        expect(getProofState(DEVICE_ID).abBypass).toBe(true);

        const calls = paramCalls(bridge);
        expect(calls.get('ab_bypass')).toBe(1);
        expect(calls.get('input_gain')).toBe(2.25);
        expect(calls.get('lim_ceiling')).toBe(-4.5);
    });

    // ── Fix 7: ab_bypass is forwarded on a full sync ──
    it('forwards the runtime A/B compare flag (ab_bypass) on a full sync', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        // Seed an active A/B compare, then run a full sync as preset load would.
        setProofAbBypass({ deviceId: DEVICE_ID, abBypass: true });

        syncFullPatch(DEVICE_ID);

        expect(paramCalls(bridge).get('ab_bypass')).toBe(1);
    });

    it('forwards ab_bypass as 0 when compare is inactive', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        setProofAbBypass({ deviceId: DEVICE_ID, abBypass: false });

        syncFullPatch(DEVICE_ID);

        expect(paramCalls(bridge).get('ab_bypass')).toBe(0);
    });

    it('is a no-op on the engine when no bridge is registered, but still loads the store', () => {
        const patch: ProofPatch = { ...DEFAULT_PATCH, name: 'Local only' };
        expect(() => loadProofPatchWithAudio({ deviceId: 'no-bridge', patch })).not.toThrow();
        expect(getProofState('no-bridge').patch.name).toBe('Local only');
    });
});
