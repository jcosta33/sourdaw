import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    getActiveLayersAtBeat: vi.fn(),
    applyLayers: vi.fn(),
    reset: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getActiveLayersAtBeat: mocks.getActiveLayersAtBeat,
}));

vi.mock('../sharedAdjustmentLayerApplier', () => ({
    getSharedAdjustmentLayerApplier: () => ({ applyLayers: mocks.applyLayers, reset: mocks.reset }),
}));

import { scheduleAdjustmentLayers } from '../scheduleAdjustmentLayers';

describe('scheduleAdjustmentLayers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards active layers at the current beat into the applier', () => {
        const fakeLayer = {
            id: 'layer-eq-1',
            name: 'Chorus EQ',
            effectType: 'eq',
            parameters: [],
            affectedTrackIds: ['t1'],
            insertionIndex: 0,
            regions: [{ id: 'r1', startBeat: 4, endBeat: 8, blend: 1, fadeInBeats: 0, fadeOutBeats: 0 }],
            enabled: true,
            mix: 1,
            color: 'oklch(0.4 0.1 180)',
        };
        mocks.getActiveLayersAtBeat.mockReturnValueOnce([fakeLayer]);
        mocks.applyLayers.mockReturnValueOnce([
            { layerId: 'layer-eq-1', trackId: 't1', effectType: 'eq', blend: 1, parameters: {}, beat: 5 },
        ]);

        const applied = scheduleAdjustmentLayers(5);

        expect(mocks.getActiveLayersAtBeat).toHaveBeenCalledWith(5);
        expect(mocks.applyLayers).toHaveBeenCalledWith({ activeLayers: [fakeLayer], beat: 5 });
        expect(applied).toEqual([
            { layerId: 'layer-eq-1', trackId: 't1', effectType: 'eq', blend: 1, parameters: {}, beat: 5 },
        ]);
    });

    it('ticking through a non-overlapping range emits no applications, then activates inside the region', () => {
        const fakeLayer = {
            id: 'layer-eq-2',
            name: 'Bridge EQ',
            effectType: 'eq',
            parameters: [{ name: 'High Gain', value: 6, min: -12, max: 12, unit: 'dB' }],
            affectedTrackIds: ['hihat'],
            insertionIndex: 0,
            regions: [{ id: 'r1', startBeat: 4, endBeat: 8, blend: 1, fadeInBeats: 0, fadeOutBeats: 0 }],
            enabled: true,
            mix: 1,
            color: 'oklch(0.4 0.1 180)',
        };

        // Beat 2: not in region
        mocks.getActiveLayersAtBeat.mockReturnValueOnce([]);
        mocks.applyLayers.mockReturnValueOnce([]);
        scheduleAdjustmentLayers(2);

        // Beat 5: inside region
        mocks.getActiveLayersAtBeat.mockReturnValueOnce([fakeLayer]);
        mocks.applyLayers.mockReturnValueOnce([
            {
                layerId: 'layer-eq-2',
                trackId: 'hihat',
                effectType: 'eq',
                blend: 1,
                parameters: { 'High Gain': 6 },
                beat: 5,
            },
        ]);
        const appliedAtBeat5 = scheduleAdjustmentLayers(5);

        // Beat 10: past region
        mocks.getActiveLayersAtBeat.mockReturnValueOnce([]);
        mocks.applyLayers.mockReturnValueOnce([]);
        scheduleAdjustmentLayers(10);

        expect(mocks.applyLayers).toHaveBeenCalledTimes(3);
        expect(appliedAtBeat5).toHaveLength(1);
        expect(appliedAtBeat5[0]).toMatchObject({
            layerId: 'layer-eq-2',
            trackId: 'hihat',
            effectType: 'eq',
            parameters: { 'High Gain': 6 },
        });
    });
});
