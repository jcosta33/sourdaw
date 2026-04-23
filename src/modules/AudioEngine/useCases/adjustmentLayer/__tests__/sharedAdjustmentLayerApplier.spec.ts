import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const subscribers = new Set<() => void>();
    return {
        setTrackGain: vi.fn(),
        setTrackPan: vi.fn(),
        applyAdjustmentLayerTick: vi.fn(),
        resetAdjustmentLayers: vi.fn(),
        trackStoreValue: { tracks: [{ id: 't1', gain: 1, pan: 0 }] } as {
            tracks: Array<{ id: string; gain: number; pan: number }>;
        },
        subscribers,
        notifyTrackStore: () => {
            for (const cb of subscribers) {
                cb();
            }
        },
    };
});

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
        subscribe: (cb: () => void) => {
            mocks.subscribers.add(cb);
            return () => {
                mocks.subscribers.delete(cb);
            };
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

    it('re-reads the user fader value when trackStore mutates while a volume layer is active', () => {
        mocks.trackStoreValue = { tracks: [{ id: 't1', gain: 0.5, pan: 0 }] };
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

        const initialCall = mocks.setTrackGain.mock.calls.at(-1);
        expect(initialCall?.[0]).toBe('t1');
        const initialGain = initialCall?.[1] as number;

        mocks.setTrackGain.mockClear();
        mocks.trackStoreValue = { tracks: [{ id: 't1', gain: 0.9, pan: 0 }] };
        mocks.notifyTrackStore();

        const refreshedCall = mocks.setTrackGain.mock.calls.at(-1);
        expect(refreshedCall?.[0]).toBe('t1');
        const refreshedGain = refreshedCall?.[1] as number;

        const initialBaseRatio = initialGain / 0.5;
        const refreshedBaseRatio = refreshedGain / 0.9;
        expect(refreshedBaseRatio).toBeCloseTo(initialBaseRatio, 5);
        expect(refreshedGain).toBeGreaterThan(initialGain);
    });
});
