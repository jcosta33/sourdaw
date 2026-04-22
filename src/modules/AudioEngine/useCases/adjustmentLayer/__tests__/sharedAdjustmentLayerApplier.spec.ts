import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    setTrackGain: vi.fn(),
    setTrackPan: vi.fn(),
    applyAdjustmentLayerTick: vi.fn(),
    resetAdjustmentLayers: vi.fn(),
    trackStoreValue: { tracks: [{ id: 't1', gain: 1, pan: 0 }] } as {
        tracks: Array<{ id: string; gain: number; pan: number }>;
    },
}));

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        setTrackGain: mocks.setTrackGain,
        setTrackPan: mocks.setTrackPan,
        applyAdjustmentLayerTick: mocks.applyAdjustmentLayerTick,
        resetAdjustmentLayers: mocks.resetAdjustmentLayers,
    },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue;
        },
    },
}));

import {
    getSharedAdjustmentLayerApplier,
    resetSharedAdjustmentLayerApplierForTest,
} from '../sharedAdjustmentLayerApplier';

describe('sharedAdjustmentLayerApplier engine wiring', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetSharedAdjustmentLayerApplierForTest();
    });

    it('forwards EQ records to the engine runtime via applyAdjustmentLayerTick', () => {
        const applier = getSharedAdjustmentLayerApplier();

        applier.applyLayers({
            activeLayers: [
                {
                    id: 'L1',
                    name: 'EQ',
                    effectType: 'eq',
                    parameters: [{ name: 'High Gain', value: 6, min: -12, max: 12, unit: 'dB' }],
                    affectedTrackIds: ['t1'],
                    insertionIndex: 0,
                    regions: [{ id: 'r1', startBeat: 0, endBeat: 4, blend: 1, fadeInBeats: 0, fadeOutBeats: 0 }],
                    enabled: true,
                    mix: 1,
                    color: '#000',
                },
            ],
            beat: 2,
        });

        expect(mocks.applyAdjustmentLayerTick).toHaveBeenCalledTimes(1);
        const firstCall = mocks.applyAdjustmentLayerTick.mock.calls[0]![0] as Array<{
            layerId: string;
            trackId: string;
            effectType: string;
            blend: number;
        }>;
        expect(firstCall).toHaveLength(1);
        expect(firstCall[0]).toMatchObject({
            layerId: 'L1',
            trackId: 't1',
            effectType: 'eq',
            blend: 1,
        });
    });

    it('does not forward volume or pan records to the engine runtime (MVP path)', () => {
        const applier = getSharedAdjustmentLayerApplier();

        applier.applyLayers({
            activeLayers: [
                {
                    id: 'LV',
                    name: 'Vol',
                    effectType: 'volume',
                    parameters: [{ name: 'Gain', value: -6, min: -60, max: 12, unit: 'dB' }],
                    affectedTrackIds: ['t1'],
                    insertionIndex: 0,
                    regions: [{ id: 'r1', startBeat: 0, endBeat: 4, blend: 1, fadeInBeats: 0, fadeOutBeats: 0 }],
                    enabled: true,
                    mix: 1,
                    color: '#000',
                },
            ],
            beat: 2,
        });

        expect(mocks.setTrackGain).toHaveBeenCalled();
        expect(mocks.applyAdjustmentLayerTick).toHaveBeenCalledTimes(1);
        const forwarded = mocks.applyAdjustmentLayerTick.mock.calls[0]![0] as unknown[];
        expect(forwarded).toEqual([]);
    });

    it('reset clears the engine runtime', () => {
        const applier = getSharedAdjustmentLayerApplier();
        applier.reset();
        expect(mocks.resetAdjustmentLayers).toHaveBeenCalled();
    });
});
