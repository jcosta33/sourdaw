import { describe, it, expect, vi } from 'vitest';

import { type AdjustmentLayer } from '#/modules/Arrangement/stores';

import { createAdjustmentLayerApplier, type TrackGainPanApplier } from '../adjustmentLayerApplier';

function makeGainPanApplierMock(): TrackGainPanApplier & {
    calls: Array<{ op: string; trackId: string; layerId: string; value?: number }>;
} {
    const calls: Array<{ op: string; trackId: string; layerId: string; value?: number }> = [];
    return {
        calls,
        setGainOverride: (trackId, layerId, value) =>
            calls.push({ op: 'setGain', trackId, layerId, value }),
        clearGainOverride: (trackId, layerId) => calls.push({ op: 'clearGain', trackId, layerId }),
        setPanOverride: (trackId, layerId, value) =>
            calls.push({ op: 'setPan', trackId, layerId, value }),
        clearPanOverride: (trackId, layerId) => calls.push({ op: 'clearPan', trackId, layerId }),
    };
}

const baseLayer = (overrides: Partial<AdjustmentLayer>): AdjustmentLayer => ({
    id: 'L',
    name: 'Test',
    effectType: 'eq',
    parameters: [],
    affectedTrackIds: [],
    insertionIndex: 0,
    regions: [],
    enabled: true,
    mix: 1,
    color: '#000',
    ...overrides,
});

describe('createAdjustmentLayerApplier', () => {
    it('applies to all tracks at or below insertionIndex when affectedTrackIds is empty', () => {
        const gainPan = makeGainPanApplierMock();
        const onApplied = vi.fn();
        const applier = createAdjustmentLayerApplier({
            gainPanApplier: gainPan,
            getAllTrackIds: () => ['t0', 't1', 't2'],
            onApplied,
        });

        const layer = baseLayer({ effectType: 'eq', insertionIndex: 1, regions: [] });
        applier.applyLayers({ activeLayers: [layer], beat: 0 });

        expect(onApplied).toHaveBeenCalledTimes(2);
        const trackIds = onApplied.mock.calls.map((c) => c[0].trackId);
        expect(trackIds).toEqual(['t1', 't2']);
    });

    it('calls setGainOverride for volume layers and rolls back on deactivation', () => {
        const gainPan = makeGainPanApplierMock();
        const applier = createAdjustmentLayerApplier({
            gainPanApplier: gainPan,
            getAllTrackIds: () => ['t1'],
        });

        const layer = baseLayer({
            effectType: 'volume',
            parameters: [{ name: 'Gain', value: -6, min: -60, max: 12, unit: 'dB' }],
            affectedTrackIds: ['t1'],
            regions: [{ id: 'r1', startBeat: 0, endBeat: 4, blend: 1, fadeInBeats: 0, fadeOutBeats: 0 }],
        });

        applier.applyLayers({ activeLayers: [layer], beat: 2 });
        const firstCall = gainPan.calls[0]!;
        expect(firstCall.op).toBe('setGain');
        expect(firstCall.trackId).toBe('t1');
        expect(firstCall.value).toBeCloseTo(Math.pow(10, -6 / 20), 3);

        // Move playhead outside region — should clear the gain override
        applier.applyLayers({ activeLayers: [layer], beat: 10 });
        const lastCall = gainPan.calls[gainPan.calls.length - 1]!;
        expect(lastCall.op).toBe('clearGain');
        expect(lastCall.trackId).toBe('t1');
    });

    it('computes a linear fade-in envelope across fadeInBeats', () => {
        const gainPan = makeGainPanApplierMock();
        const applied: Array<{ beat: number; blend: number }> = [];
        const applier = createAdjustmentLayerApplier({
            gainPanApplier: gainPan,
            getAllTrackIds: () => ['t1'],
            onApplied: (r) => applied.push({ beat: r.beat, blend: r.blend }),
        });

        const layer = baseLayer({
            effectType: 'eq',
            affectedTrackIds: ['t1'],
            regions: [{ id: 'r1', startBeat: 0, endBeat: 4, blend: 1, fadeInBeats: 1, fadeOutBeats: 0 }],
        });

        applier.applyLayers({ activeLayers: [layer], beat: 0 });
        applier.applyLayers({ activeLayers: [layer], beat: 0.5 });
        applier.applyLayers({ activeLayers: [layer], beat: 1 });
        applier.applyLayers({ activeLayers: [layer], beat: 2 });

        // beat=0 has envelope 0 → no record emitted
        expect(applied[0]!.beat).toBeCloseTo(0.5, 3);
        expect(applied[0]!.blend).toBeCloseTo(0.5, 3);
        expect(applied[1]!.blend).toBeCloseTo(1, 3);
        expect(applied[2]!.blend).toBeCloseTo(1, 3);
    });

    it('merges blends from overlapping regions and caps at 1', () => {
        const gainPan = makeGainPanApplierMock();
        const applied: Array<{ blend: number }> = [];
        const applier = createAdjustmentLayerApplier({
            gainPanApplier: gainPan,
            getAllTrackIds: () => ['t1'],
            onApplied: (r) => applied.push({ blend: r.blend }),
        });

        const layer = baseLayer({
            effectType: 'eq',
            affectedTrackIds: ['t1'],
            regions: [
                { id: 'r1', startBeat: 0, endBeat: 4, blend: 0.5, fadeInBeats: 0, fadeOutBeats: 0 },
                { id: 'r2', startBeat: 2, endBeat: 6, blend: 0.5, fadeInBeats: 0, fadeOutBeats: 0 },
            ],
        });

        applier.applyLayers({ activeLayers: [layer], beat: 3 });

        expect(applied[0]!.blend).toBeCloseTo(1, 3);
    });

    it('ignores disabled layers', () => {
        const gainPan = makeGainPanApplierMock();
        const onApplied = vi.fn();
        const applier = createAdjustmentLayerApplier({
            gainPanApplier: gainPan,
            getAllTrackIds: () => ['t1'],
            onApplied,
        });

        const layer = baseLayer({
            enabled: false,
            affectedTrackIds: ['t1'],
            regions: [{ id: 'r1', startBeat: 0, endBeat: 4, blend: 1, fadeInBeats: 0, fadeOutBeats: 0 }],
        });

        applier.applyLayers({ activeLayers: [layer], beat: 1 });

        expect(onApplied).not.toHaveBeenCalled();
    });
});
