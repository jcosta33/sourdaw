import { describe, it, expect, beforeEach, vi } from 'vitest';

import { getTrackStoreState, persistDevicePatch } from '#/modules/Arrangement/useCases';

import { DEFAULT_PATCH, type ProofPatch } from '../../../models/ProofPatch';
import { getProofState, proofStore, setProofAbBypass } from '../../../stores/proofStore';
import { bridges, type ProofAudioBridge } from '../helpers';
import { loadProofPatchWithAudio } from '../loadProofPatchWithAudio';
import { setProofParamWithPatch } from '../setProofParamWithPatch';
import { syncFullPatch } from '../syncFullPatch';

vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: vi.fn(() => null),
    persistDevicePatch: vi.fn(),
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
        expect(persistDevicePatch).toHaveBeenCalledTimes(1);
        expect(persistDevicePatch).toHaveBeenCalledWith(
            DEVICE_ID,
            expect.objectContaining({
                input_gain: DEFAULT_PATCH.inputGain,
                lim_ceiling: -1.5,
                eq_band1_freq: DEFAULT_PATCH.eqBands[1]!.freq,
                dyn_band2_ratio: DEFAULT_PATCH.dynBands[2]!.ratio,
                img_width3: DEFAULT_PATCH.imgBandWidth[3],
                exc_band3_blend: DEFAULT_PATCH.excBands[3]!.blend,
                dither_bits: DEFAULT_PATCH.ditherBits,
                chain_order_4: DEFAULT_PATCH.chainOrder[4],
            })
        );
        expect(Object.keys(vi.mocked(persistDevicePatch).mock.calls[0]?.[1] ?? {})).toHaveLength(122);
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

    it('should rehydrate restored Proof sections before syncing a default patch', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        vi.mocked(getTrackStoreState).mockReturnValue(
            makeTrackState({
                eq_band1_freq: 1200,
                eq_band1_gain: 3.5,
                eq_band1_q: 2.25,
                eq_band1_type: 2,
                eq_band1_channel: 1,
                eq_band1_enabled: 0,
                dyn_xover0: 180,
                dyn_band2_threshold: -10,
                dyn_band2_ratio: 4,
                dyn_band2_attack: 12,
                dyn_band2_release: 220,
                dyn_band2_knee: 8,
                dyn_band2_makeup: 1.5,
                dyn_band2_auto_makeup: 0,
                dyn_band2_bypass: 1,
                img_width2: 1.4,
                img_auto_mono_bass: 0,
                img_mono_bass_freq: 110,
                exc_band3_type: 2,
                exc_band3_drive: 0.7,
                exc_band3_blend: 0.6,
                exc_band3_enabled: 1,
                chain_order_0: 4,
                chain_order_1: 1,
                chain_order_2: 2,
                chain_order_3: 3,
                chain_order_4: 0,
            })
        );

        syncFullPatch(DEVICE_ID);

        const patch = getProofState(DEVICE_ID).patch;
        expect(patch.eqBands[1]).toMatchObject({
            freq: 1200,
            gain: 3.5,
            q: 2.25,
            type: 2,
            channel: 1,
            enabled: false,
        });
        expect(patch.dynCrossoverFreqs[0]).toBe(180);
        expect(patch.dynBands[2]).toMatchObject({
            threshold: -10,
            ratio: 4,
            attack: 12,
            release: 220,
            knee: 8,
            makeup: 1.5,
            autoMakeup: false,
            bypassed: true,
        });
        expect(patch.imgBandWidth[2]).toBe(1.4);
        expect(patch.imgAutoMonoBass).toBe(false);
        expect(patch.imgMonoBassFreq).toBe(110);
        expect(patch.excBands[3]).toMatchObject({ type: 2, drive: 0.7, blend: 0.6, enabled: true });
        expect(patch.chainOrder[0]).toBe(4);

        const calls = paramCalls(bridge);
        expect(calls.get('eq_band1_freq')).toBe(1200);
        expect(calls.get('dyn_xover0')).toBe(180);
        expect(calls.get('dyn_band2_threshold')).toBe(-10);
        expect(calls.get('img_width2')).toBe(1.4);
        expect(calls.get('exc_band3_drive')).toBe(0.7);
        expect(bridge.reorderModules).toHaveBeenCalledWith([4, 1, 2, 3, 0]);
    });

    it('rejects persisted numeric values outside the Proof parameter contract', () => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        vi.mocked(getTrackStoreState).mockReturnValue(
            makeTrackState({
                input_gain: 24.5,
                output_gain: -24,
                eq_band1_freq: 19,
                eq_band1_gain: 18.5,
                eq_band1_q: 0.09,
                dyn_xover0: 20_001,
                dyn_band2_threshold: -60.5,
                dyn_band2_ratio: 20.5,
                dyn_band2_attack: 0.5,
                dyn_band2_release: 2_001,
                dyn_band2_knee: 12.5,
                dyn_band2_makeup: 24.5,
                img_width2: 2.01,
                img_mono_bass_freq: 201,
                exc_band3_drive: -0.01,
                exc_band3_blend: 1.01,
                lim_ceiling: 0.1,
                lim_release: 9,
                lim_lookahead: 0.4,
                dither_bits: 8,
            })
        );

        syncFullPatch(DEVICE_ID);

        const patch = getProofState(DEVICE_ID).patch;
        expect(patch.inputGain).toBe(DEFAULT_PATCH.inputGain);
        expect(patch.outputGain).toBe(-24);
        expect(patch.eqBands[1]).toMatchObject(DEFAULT_PATCH.eqBands[1]!);
        expect(patch.dynCrossoverFreqs[0]).toBe(DEFAULT_PATCH.dynCrossoverFreqs[0]);
        expect(patch.dynBands[2]).toMatchObject(DEFAULT_PATCH.dynBands[2]!);
        expect(patch.imgBandWidth[2]).toBe(DEFAULT_PATCH.imgBandWidth[2]);
        expect(patch.imgMonoBassFreq).toBe(DEFAULT_PATCH.imgMonoBassFreq);
        expect(patch.excBands[3]).toMatchObject(DEFAULT_PATCH.excBands[3]!);
        expect(patch.limCeiling).toBe(DEFAULT_PATCH.limCeiling);
        expect(patch.limRelease).toBe(DEFAULT_PATCH.limRelease);
        expect(patch.limLookahead).toBe(DEFAULT_PATCH.limLookahead);
        expect(patch.ditherBits).toBe(DEFAULT_PATCH.ditherBits);
    });

    it.each([
        { restoredValue: 0, expectedMode: 'off' },
        { restoredValue: 1, expectedMode: 'tpdf' },
        { restoredValue: 2, expectedMode: 'noise_shaped' },
    ] as const)('should rehydrate dither_mode $restoredValue as $expectedMode', ({ restoredValue, expectedMode }) => {
        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        vi.mocked(getTrackStoreState).mockReturnValue(makeTrackState({ dither_mode: restoredValue }));

        syncFullPatch(DEVICE_ID);

        expect(getProofState(DEVICE_ID).patch.ditherMode).toBe(expectedMode);
        expect(paramCalls(bridge).get('dither_mode')).toBe(restoredValue);
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

    it('hydrates saved fields before an edit made ahead of bridge registration', () => {
        vi.mocked(getTrackStoreState).mockReturnValue(
            makeTrackState({
                eq_band1_freq: 1_200,
                lim_ceiling: -4.5,
            })
        );

        setProofParamWithPatch({ deviceId: DEVICE_ID, key: 'inputGain', value: 3 });

        const bridge = makeBridge();
        bridges.set(DEVICE_ID, bridge);
        syncFullPatch(DEVICE_ID);

        const patch = getProofState(DEVICE_ID).patch;
        expect(patch.inputGain).toBe(3);
        expect(patch.eqBands[1]?.freq).toBe(1_200);
        expect(patch.limCeiling).toBe(-4.5);
        const calls = paramCalls(bridge);
        expect(calls.get('input_gain')).toBe(3);
        expect(calls.get('eq_band1_freq')).toBe(1_200);
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
