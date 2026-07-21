import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { persistDevicePatch } from '#/modules/Arrangement/useCases';

import { DEFAULT_PATCH } from '../../../models/ProofPatch';
import { getProofState, loadProofPatch, proofStore } from '../../../stores/proofStore';
import { bridges, type ProofAudioBridge } from '../helpers';
import { setProofParamWithPatch } from '../setProofParamWithPatch';

vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: vi.fn(() => null),
    persistDevicePatch: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
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

describe('setProofParamWithPatch', () => {
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

    it('updates the stored patch and persists the mapped scalar engine param', () => {
        const bridge = makeBridge();
        const persisted_patch_values: Array<number | undefined> = [];
        bridges.set('dev-1', bridge);
        vi.mocked(persistDevicePatch).mockImplementation((device_id) => {
            persisted_patch_values.push(getProofState(device_id).patch.limCeiling);
        });

        setProofParamWithPatch({ deviceId: 'dev-1', key: 'limCeiling', value: -2 });

        expect(getProofState('dev-1').patch.limCeiling).toBe(-2);
        expect(bridge.setParam).toHaveBeenCalledWith('lim_ceiling', -2);
        expect(persistDevicePatch).toHaveBeenCalledWith('dev-1', { lim_ceiling: -2 });
        expect(persisted_patch_values).toEqual([-2]);
    });

    it('rejects an out-of-range scalar before any write', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        setProofParamWithPatch({ deviceId: 'dev-1', key: 'limCeiling', value: 1 });

        expect(getProofState('dev-1').patch.limCeiling).toBe(DEFAULT_PATCH.limCeiling);
        expect(bridge.setParam).not.toHaveBeenCalled();
        expect(persistDevicePatch).not.toHaveBeenCalled();
    });

    it('persists a boolean bypass field with the same 0/1 engine convention', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        setProofParamWithPatch({ deviceId: 'dev-1', key: 'eqBypassed', value: true });

        expect(getProofState('dev-1').patch.eqBypassed).toBe(true);
        expect(bridge.setParam).toHaveBeenCalledWith('eq_bypass', 1);
        expect(persistDevicePatch).toHaveBeenCalledWith('dev-1', { eq_bypass: 1 });

        vi.clearAllMocks();

        setProofParamWithPatch({ deviceId: 'dev-1', key: 'eqBypassed', value: false });

        expect(getProofState('dev-1').patch.eqBypassed).toBe(false);
        expect(bridge.setParam).toHaveBeenCalledWith('eq_bypass', 0);
        expect(persistDevicePatch).toHaveBeenCalledWith('dev-1', { eq_bypass: 0 });
    });

    it('persists dither mode with the shared engine integer mapping', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        setProofParamWithPatch({ deviceId: 'dev-1', key: 'ditherMode', value: 'noise_shaped' });

        expect(getProofState('dev-1').patch.ditherMode).toBe('noise_shaped');
        expect(bridge.setParam).toHaveBeenCalledWith('dither_mode', 2);
        expect(persistDevicePatch).toHaveBeenCalledWith('dev-1', { dither_mode: 2 });
    });

    it('forwards a chain-order change through reorderModules', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        setProofParamWithPatch({ deviceId: 'dev-1', key: 'chainOrder', value: [4, 3, 2, 1, 0] });

        expect(getProofState('dev-1').patch.chainOrder).toEqual([4, 3, 2, 1, 0]);
        expect(bridge.reorderModules).toHaveBeenCalledWith([4, 3, 2, 1, 0]);
        expect(persistDevicePatch).toHaveBeenCalledWith('dev-1', {
            chain_order_0: 4,
            chain_order_1: 3,
            chain_order_2: 2,
            chain_order_3: 1,
            chain_order_4: 0,
        });
    });

    it('rejects a chain order that is not a permutation before any write', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        setProofParamWithPatch({ deviceId: 'dev-1', key: 'chainOrder', value: [0, 0, 1, 2, 3] });

        expect(getProofState('dev-1').patch.chainOrder).toEqual(DEFAULT_PATCH.chainOrder);
        expect(bridge.reorderModules).not.toHaveBeenCalled();
        expect(persistDevicePatch).not.toHaveBeenCalled();
    });

    it('persists aggregate section edits with the same parameter names used by the bridge', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        setProofParamWithPatch({ deviceId: 'dev-1', key: 'imgBandWidth', value: [0.1, 0.2, 0.3, 0.4] });

        expect(persistDevicePatch).toHaveBeenCalledWith('dev-1', {
            img_width0: 0.1,
            img_width1: 0.2,
            img_width2: 0.3,
            img_width3: 0.4,
        });
        expect(bridge.setParam).toHaveBeenCalledWith('img_width2', 0.3);
    });

    it('rejects an out-of-range changed band member before any write', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);
        const eqBands = DEFAULT_PATCH.eqBands.map((band, index) => (index === 2 ? { ...band, freq: 1 } : band));

        setProofParamWithPatch({
            deviceId: 'dev-1',
            key: 'eqBands',
            value: eqBands,
            changedParams: [{ bandIndex: 2, field: 'freq' }],
        });

        expect(getProofState('dev-1').patch.eqBands).toEqual(DEFAULT_PATCH.eqBands);
        expect(bridge.setParam).not.toHaveBeenCalled();
        expect(persistDevicePatch).not.toHaveBeenCalled();
    });

    it('previews only changed aggregate params and persists once when the gesture commits', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);
        const bands = getProofState('dev-1').patch.eqBands.map((band, index) =>
            index === 1 ? { ...band, freq: 1_200 } : band
        );

        setProofParamWithPatch({
            deviceId: 'dev-1',
            key: 'eqBands',
            value: bands,
            changedParams: [{ bandIndex: 1, field: 'freq' }],
            isTransient: true,
        });

        expect(getProofState('dev-1').patch.eqBands[1]?.freq).toBe(1_200);
        expect(bridge.setParam).toHaveBeenCalledTimes(1);
        expect(bridge.setParam).toHaveBeenCalledWith('eq_band1_freq', 1_200);
        expect(persistDevicePatch).not.toHaveBeenCalled();

        bridge.setParam.mockClear();
        setProofParamWithPatch({
            deviceId: 'dev-1',
            key: 'eqBands',
            value: bands,
            changedParams: [],
            isTransient: false,
        });

        expect(bridge.setParam).not.toHaveBeenCalled();
        expect(persistDevicePatch).toHaveBeenCalledTimes(1);
        expect(persistDevicePatch).toHaveBeenCalledWith('dev-1', expect.objectContaining({ eq_band1_freq: 1_200 }));
    });

    it('merges a declared aggregate delta into the latest patch', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);
        const staleBands = getProofState('dev-1').patch.dynBands.map((band) => ({ ...band }));
        const concurrentBands = staleBands.map((band, index) => (index === 1 ? { ...band, ratio: 4 } : band));
        setProofParamWithPatch({ deviceId: 'dev-1', key: 'dynBands', value: concurrentBands });
        vi.clearAllMocks();

        const staleEdit = staleBands.map((band, index) => (index === 0 ? { ...band, threshold: -30 } : band));
        setProofParamWithPatch({
            deviceId: 'dev-1',
            key: 'dynBands',
            value: staleEdit,
            changedParams: [{ bandIndex: 0, field: 'threshold' }],
        });

        expect(getProofState('dev-1').patch.dynBands[1]?.ratio).toBe(4);
        expect(persistDevicePatch).toHaveBeenCalledWith('dev-1', expect.objectContaining({ dyn_band1_ratio: 4 }));
        expect(bridge.setParam).toHaveBeenCalledTimes(1);
        expect(bridge.setParam).toHaveBeenCalledWith('dyn_band0_threshold', -30);
    });

    it('persists an aggregate gesture commit without repeating its final engine preview', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);
        const bands = getProofState('dev-1').patch.eqBands.map((band, index) =>
            index === 1 ? { ...band, freq: 1_200 } : band
        );
        const changedParams = [{ bandIndex: 1, field: 'freq' as const }];

        setProofParamWithPatch({
            deviceId: 'dev-1',
            key: 'eqBands',
            value: bands,
            changedParams,
            isTransient: true,
        });
        bridge.setParam.mockClear();

        setProofParamWithPatch({
            deviceId: 'dev-1',
            key: 'eqBands',
            value: bands,
            changedParams,
            isTransient: false,
        });

        expect(bridge.setParam).not.toHaveBeenCalled();
        expect(persistDevicePatch).toHaveBeenCalledTimes(1);
    });

    it('preserves preset identity during preview and clears it on commit', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);
        loadProofPatch({ deviceId: 'dev-1', patch: { ...DEFAULT_PATCH, presetId: 'streaming' } });

        setProofParamWithPatch({
            deviceId: 'dev-1',
            key: 'limCeiling',
            value: -2,
            isTransient: true,
        });

        expect(getProofState('dev-1').patch.presetId).toBe('streaming');

        setProofParamWithPatch({
            deviceId: 'dev-1',
            key: 'limCeiling',
            value: -2,
            isTransient: false,
        });

        expect(getProofState('dev-1').patch.presetId).toBeUndefined();
    });

    it('rejects a non-ascending dynamics crossover edit before any write', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        setProofParamWithPatch({
            deviceId: 'dev-1',
            key: 'dynCrossoverFreqs',
            value: [10_000, 1_000, 8_000],
            changedParams: [{ crossoverIndex: 0 }],
        });

        expect(getProofState('dev-1').patch.dynCrossoverFreqs).toEqual([120, 1_000, 8_000]);
        expect(bridge.setParam).not.toHaveBeenCalled();
        expect(persistDevicePatch).not.toHaveBeenCalled();
    });

    it('still updates the store and persists mapped params when no bridge is registered', () => {
        setProofParamWithPatch({ deviceId: 'no-bridge', key: 'outputGain', value: 5 });
        expect(getProofState('no-bridge').patch.outputGain).toBe(5);
        expect(persistDevicePatch).toHaveBeenCalledWith('no-bridge', { output_gain: 5 });
    });

    it.each(['missing', 'ineligible'] as const)(
        'rejects a %s owner before patch, persistence, or engine effects',
        (status) => {
            const bridge = makeBridge();
            bridges.set('dev-1', bridge);
            vi.mocked(resolveEligibleDeviceWriteTarget).mockReturnValue({ status });

            setProofParamWithPatch({ deviceId: 'dev-1', key: 'limCeiling', value: -2 });

            expect(getProofState('dev-1').patch.limCeiling).toBe(DEFAULT_PATCH.limCeiling);
            expect(persistDevicePatch).not.toHaveBeenCalled();
            expect(bridge.setParam).not.toHaveBeenCalled();
        }
    );

    it('maps dynBypassed to the shared dyn_bypass engine convention', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        setProofParamWithPatch({ deviceId: 'dev-1', key: 'dynBypassed', value: true });

        expect(getProofState('dev-1').patch.dynBypassed).toBe(true);
        expect(bridge.setParam).toHaveBeenCalledWith('dyn_bypass', 1);
        expect(persistDevicePatch).toHaveBeenCalledWith('dev-1', { dyn_bypass: 1 });
    });

    it('maps imgBypassed to the shared img_bypass engine convention', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        setProofParamWithPatch({ deviceId: 'dev-1', key: 'imgBypassed', value: true });

        expect(getProofState('dev-1').patch.imgBypassed).toBe(true);
        expect(bridge.setParam).toHaveBeenCalledWith('img_bypass', 1);
        expect(persistDevicePatch).toHaveBeenCalledWith('dev-1', { img_bypass: 1 });
    });

    it('maps excBypassed to the shared exc_bypass engine convention', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        setProofParamWithPatch({ deviceId: 'dev-1', key: 'excBypassed', value: false });

        expect(getProofState('dev-1').patch.excBypassed).toBe(false);
        expect(bridge.setParam).toHaveBeenCalledWith('exc_bypass', 0);
        expect(persistDevicePatch).toHaveBeenCalledWith('dev-1', { exc_bypass: 0 });
    });

    it('maps imgAutoMonoBass to the shared img_auto_mono_bass engine convention', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        setProofParamWithPatch({ deviceId: 'dev-1', key: 'imgAutoMonoBass', value: false });

        expect(getProofState('dev-1').patch.imgAutoMonoBass).toBe(false);
        expect(bridge.setParam).toHaveBeenCalledWith('img_auto_mono_bass', 0);
        expect(persistDevicePatch).toHaveBeenCalledWith('dev-1', { img_auto_mono_bass: 0 });
    });

    it('passes limRelease through to lim_release unscaled', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        setProofParamWithPatch({ deviceId: 'dev-1', key: 'limRelease', value: 250 });

        expect(getProofState('dev-1').patch.limRelease).toBe(250);
        expect(bridge.setParam).toHaveBeenCalledWith('lim_release', 250);
        expect(persistDevicePatch).toHaveBeenCalledWith('dev-1', { lim_release: 250 });
    });

    it('passes limLookahead through to lim_lookahead unscaled', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        setProofParamWithPatch({ deviceId: 'dev-1', key: 'limLookahead', value: 3 });

        expect(getProofState('dev-1').patch.limLookahead).toBe(3);
        expect(bridge.setParam).toHaveBeenCalledWith('lim_lookahead', 3);
        expect(persistDevicePatch).toHaveBeenCalledWith('dev-1', { lim_lookahead: 3 });
    });

    it('passes imgMonoBassFreq through to img_mono_bass_freq unscaled', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        setProofParamWithPatch({ deviceId: 'dev-1', key: 'imgMonoBassFreq', value: 150 });

        expect(getProofState('dev-1').patch.imgMonoBassFreq).toBe(150);
        expect(bridge.setParam).toHaveBeenCalledWith('img_mono_bass_freq', 150);
        expect(persistDevicePatch).toHaveBeenCalledWith('dev-1', { img_mono_bass_freq: 150 });
    });

    it('passes ditherBits through to dither_bits unscaled', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        setProofParamWithPatch({ deviceId: 'dev-1', key: 'ditherBits', value: 24 });

        expect(getProofState('dev-1').patch.ditherBits).toBe(24);
        expect(bridge.setParam).toHaveBeenCalledWith('dither_bits', 24);
        expect(persistDevicePatch).toHaveBeenCalledWith('dev-1', { dither_bits: 24 });
    });

    it('resyncs every EQ band to the engine on a full-array replacement with no changedParams', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);
        const bands = DEFAULT_PATCH.eqBands.map((band, index) =>
            index === 3 ? { ...band, freq: 900, gain: 2 } : band
        );

        setProofParamWithPatch({ deviceId: 'dev-1', key: 'eqBands', value: bands });

        expect(getProofState('dev-1').patch.eqBands[3]).toEqual({ ...DEFAULT_PATCH.eqBands[3], freq: 900, gain: 2 });
        expect(bridge.setParam).toHaveBeenCalledWith('eq_band3_freq', 900);
        expect(bridge.setParam).toHaveBeenCalledWith('eq_band3_gain', 2);
        // The full sync walks every band, not only the one that changed.
        expect(bridge.setParam).toHaveBeenCalledWith('eq_band0_freq', DEFAULT_PATCH.eqBands[0]!.freq);
        expect(bridge.setParam).toHaveBeenCalledWith('eq_band7_q', DEFAULT_PATCH.eqBands[7]!.q);
    });

    it('resyncs every exciter band to the engine on a full-array replacement with no changedParams', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);
        const bands = DEFAULT_PATCH.excBands.map((band, index) =>
            index === 1 ? { ...band, drive: 0.9, enabled: true } : band
        );

        setProofParamWithPatch({ deviceId: 'dev-1', key: 'excBands', value: bands });

        expect(getProofState('dev-1').patch.excBands[1]).toEqual({
            ...DEFAULT_PATCH.excBands[1],
            drive: 0.9,
            enabled: true,
        });
        expect(bridge.setParam).toHaveBeenCalledWith('exc_band1_drive', 0.9);
        expect(bridge.setParam).toHaveBeenCalledWith('exc_band1_enabled', 1);
        // The full sync walks every band, not only the one that changed.
        expect(bridge.setParam).toHaveBeenCalledWith('exc_band0_type', DEFAULT_PATCH.excBands[0]!.type);
        expect(bridge.setParam).toHaveBeenCalledWith('exc_band3_blend', DEFAULT_PATCH.excBands[3]!.blend);
    });

    it('merges a changed imager band width and drops an unchanged sibling from the delta', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);
        const widths = getProofState('dev-1').patch.imgBandWidth.map((width, index) =>
            index === 2 ? 1.9 : width
        ) as typeof DEFAULT_PATCH.imgBandWidth;

        setProofParamWithPatch({
            deviceId: 'dev-1',
            key: 'imgBandWidth',
            value: widths,
            changedParams: [{ bandIndex: 2 }, { bandIndex: 0 }],
        });

        expect(getProofState('dev-1').patch.imgBandWidth).toEqual([
            DEFAULT_PATCH.imgBandWidth[0],
            DEFAULT_PATCH.imgBandWidth[1],
            1.9,
            DEFAULT_PATCH.imgBandWidth[3],
        ]);
        // bandIndex 0 requested the same value it already had — filtered out of the delta.
        expect(bridge.setParam).toHaveBeenCalledTimes(1);
        expect(bridge.setParam).toHaveBeenCalledWith('img_width2', 1.9);
        expect(persistDevicePatch).toHaveBeenCalledWith('dev-1', expect.objectContaining({ img_width2: 1.9 }));
    });

    it('translates dynBands autoMakeup and bypassed changed-fields to their engine param names', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);
        const bands = getProofState('dev-1').patch.dynBands.map((band, index) => {
            if (index === 0) {
                return { ...band, autoMakeup: false };
            }
            if (index === 1) {
                return { ...band, bypassed: true };
            }
            return band;
        });

        setProofParamWithPatch({
            deviceId: 'dev-1',
            key: 'dynBands',
            value: bands,
            changedParams: [
                { bandIndex: 0, field: 'autoMakeup' },
                { bandIndex: 1, field: 'bypassed' },
            ],
        });

        expect(getProofState('dev-1').patch.dynBands[0]?.autoMakeup).toBe(false);
        expect(getProofState('dev-1').patch.dynBands[1]?.bypassed).toBe(true);
        expect(bridge.setParam).toHaveBeenCalledWith('dyn_band0_auto_makeup', 0);
        expect(bridge.setParam).toHaveBeenCalledWith('dyn_band1_bypass', 1);
    });
});
