import { describe, it, expect } from 'vitest';

import { createEffectiveAdjustmentLayerSignature } from '../createEffectiveAdjustmentLayerSignature';

type LayerInput = Parameters<typeof createEffectiveAdjustmentLayerSignature>[0]['layers'][number];

function layer(overrides: Partial<LayerInput> = {}): LayerInput {
    return {
        enabled: true,
        affectedTrackIds: [],
        insertionIndex: 0,
        effectType: 'eq',
        parameters: [1, 2],
        regions: [],
        mix: 1,
        ...overrides,
    };
}

const orderedTrackIds = ['t1', 't2', 't3'];

describe('createEffectiveAdjustmentLayerSignature', () => {
    it('returns "[]" when the trackId is not in orderedTrackIds', () => {
        const signature = createEffectiveAdjustmentLayerSignature({
            layers: [layer()],
            orderedTrackIds,
            trackId: 'unknown',
        });
        expect(signature).toBe('[]');
    });

    it('includes a layer that targets the track by affectedTrackIds', () => {
        const signature = createEffectiveAdjustmentLayerSignature({
            layers: [layer({ affectedTrackIds: ['t2'] })],
            orderedTrackIds,
            trackId: 't2',
        });
        const parsed = JSON.parse(signature) as Array<{ effectType: string }>;
        expect(parsed).toHaveLength(1);
        expect(parsed[0]!.effectType).toBe('eq');
    });

    it('excludes a layer whose affectedTrackIds do not include the track', () => {
        const signature = createEffectiveAdjustmentLayerSignature({
            layers: [layer({ affectedTrackIds: ['t1'] })],
            orderedTrackIds,
            trackId: 't2',
        });
        expect(signature).toBe('[]');
    });

    it('includes a global layer (empty affectedTrackIds) when trackIndex >= insertionIndex', () => {
        const signature = createEffectiveAdjustmentLayerSignature({
            layers: [layer({ affectedTrackIds: [], insertionIndex: 1 })],
            orderedTrackIds,
            trackId: 't2',
        });
        // t2 is at index 1, insertionIndex 1 → included.
        expect(JSON.parse(signature)).toHaveLength(1);
    });

    it('excludes a global layer when trackIndex < insertionIndex', () => {
        const signature = createEffectiveAdjustmentLayerSignature({
            layers: [layer({ affectedTrackIds: [], insertionIndex: 2 })],
            orderedTrackIds,
            trackId: 't1',
        });
        // t1 is at index 0, insertionIndex 2 → excluded.
        expect(signature).toBe('[]');
    });

    it('excludes a disabled layer', () => {
        const signature = createEffectiveAdjustmentLayerSignature({
            layers: [layer({ enabled: false, affectedTrackIds: ['t1'] })],
            orderedTrackIds,
            trackId: 't1',
        });
        expect(signature).toBe('[]');
    });

    it('excludes a layer with mix <= 0', () => {
        const signature = createEffectiveAdjustmentLayerSignature({
            layers: [layer({ mix: 0, affectedTrackIds: ['t1'] })],
            orderedTrackIds,
            trackId: 't1',
        });
        expect(signature).toBe('[]');
    });

    it('serializes only effectType, parameters, regions, and mix (not enabled/insertionIndex)', () => {
        const signature = createEffectiveAdjustmentLayerSignature({
            layers: [layer({ affectedTrackIds: ['t1'], parameters: [42], mix: 0.5 })],
            orderedTrackIds,
            trackId: 't1',
        });
        const parsed = JSON.parse(signature) as Array<Record<string, unknown>>;
        expect(parsed[0]!.effectType).toBe('eq');
        expect(parsed[0]!.parameters).toEqual([42]);
        expect(parsed[0]!.mix).toBe(0.5);
        // Internal filter keys are NOT in the signature.
        expect('enabled' in parsed[0]!).toBe(false);
        expect('insertionIndex' in parsed[0]!).toBe(false);
        expect('affectedTrackIds' in parsed[0]!).toBe(false);
    });

    it('orders multiple matching layers by their input order', () => {
        const signature = createEffectiveAdjustmentLayerSignature({
            layers: [
                layer({ effectType: 'eq', affectedTrackIds: ['t1'] }),
                layer({ effectType: 'comp', affectedTrackIds: ['t1'] }),
            ],
            orderedTrackIds,
            trackId: 't1',
        });
        const parsed = JSON.parse(signature) as Array<{ effectType: string }>;
        expect(parsed.map((entry) => entry.effectType)).toEqual(['eq', 'comp']);
    });

    it('produces different signatures for different parameter sets', () => {
        const sigA = createEffectiveAdjustmentLayerSignature({
            layers: [layer({ affectedTrackIds: ['t1'], parameters: [1] })],
            orderedTrackIds,
            trackId: 't1',
        });
        const sigB = createEffectiveAdjustmentLayerSignature({
            layers: [layer({ affectedTrackIds: ['t1'], parameters: [2] })],
            orderedTrackIds,
            trackId: 't1',
        });
        expect(sigA).not.toBe(sigB);
    });
});
