import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { adjustmentLayerStore, type AdjustmentLayerState } from '../../../stores/adjustmentLayer';
import { restoreAdjustmentLayerSnapshot } from '../restoreAdjustmentLayerSnapshot';

function resetAdjustmentLayerStore(): void {
    adjustmentLayerStore.set({ layers: [] });
}

describe('restoreAdjustmentLayerSnapshot', () => {
    beforeEach(resetAdjustmentLayerStore);
    afterEach(resetAdjustmentLayerStore);

    it('restores owner-shaped state without retaining project-data aliases or extra fields', () => {
        const parameterExtra = { mutable: true };
        const parameter = {
            name: 'Low Cut',
            value: 80,
            min: 20,
            max: 500,
            unit: 'Hz',
            ignored: parameterExtra,
        };
        const regionExtra = { mutable: true };
        const region = {
            id: 'region-1',
            startBeat: 0,
            endBeat: 4,
            blend: 1,
            fadeInBeats: 0.25,
            fadeOutBeats: 0.25,
            ignored: regionExtra,
        };
        const layer = {
            id: 'layer-1',
            name: 'Master EQ',
            effectType: 'eq' as const,
            parameters: [parameter],
            affectedTrackIds: ['track-1'],
            insertionIndex: 0,
            regions: [region],
            enabled: true,
            mix: 1,
            color: '#66ccff',
            ignored: 'project-only field',
        };
        const snapshot: AdjustmentLayerState = { layers: [layer] };

        restoreAdjustmentLayerSnapshot(snapshot);

        const restored = adjustmentLayerStore.value?.layers[0];
        expect(restored).toEqual({
            id: 'layer-1',
            name: 'Master EQ',
            effectType: 'eq',
            parameters: [
                {
                    name: 'Low Cut',
                    value: 80,
                    min: 20,
                    max: 500,
                    unit: 'Hz',
                },
            ],
            affectedTrackIds: ['track-1'],
            insertionIndex: 0,
            regions: [
                {
                    id: 'region-1',
                    startBeat: 0,
                    endBeat: 4,
                    blend: 1,
                    fadeInBeats: 0.25,
                    fadeOutBeats: 0.25,
                },
            ],
            enabled: true,
            mix: 1,
            color: '#66ccff',
        });
        expect(restored).not.toBe(layer);
        expect(restored?.parameters).not.toBe(layer.parameters);
        expect(restored?.parameters[0]).not.toBe(parameter);
        expect(restored?.parameters[0]).not.toHaveProperty('ignored');
        expect(restored?.affectedTrackIds).not.toBe(layer.affectedTrackIds);
        expect(restored?.regions).not.toBe(layer.regions);
        expect(restored?.regions[0]).not.toBe(region);
        expect(restored?.regions[0]).not.toHaveProperty('ignored');

        parameter.value = 120;
        parameterExtra.mutable = false;
        layer.affectedTrackIds[0] = 'mutated-track';
        region.blend = 0.5;
        regionExtra.mutable = false;

        expect(restored?.parameters[0]?.value).toBe(80);
        expect(restored?.affectedTrackIds).toEqual(['track-1']);
        expect(restored?.regions[0]?.blend).toBe(1);
    });

    it('clears stale layers when project data omits the snapshot', () => {
        adjustmentLayerStore.set({
            layers: [
                {
                    id: 'stale-layer',
                    name: 'Stale',
                    effectType: 'pan',
                    parameters: [],
                    affectedTrackIds: [],
                    insertionIndex: 0,
                    regions: [],
                    enabled: true,
                    mix: 1,
                    color: '#ffffff',
                },
            ],
        });

        restoreAdjustmentLayerSnapshot(undefined);

        expect(adjustmentLayerStore.value).toEqual({ layers: [] });
    });
});
