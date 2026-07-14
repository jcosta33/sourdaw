import { describe, it, expect, beforeEach, vi } from 'vitest';

import { persistDevicePatch } from '#/modules/Arrangement/useCases';

import { DEFAULT_PATCH } from '../../../models/ProofPatch';
import { getProofState, loadProofPatch, proofStore } from '../../../stores/proofStore';
import { bridges, type ProofAudioBridge } from '../helpers';
import { setProofParamWithPatch } from '../setProofParamWithPatch';

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

describe('setProofParamWithPatch', () => {
    beforeEach(() => {
        bridges.clear();
        proofStore.set({});
        vi.clearAllMocks();
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
});
