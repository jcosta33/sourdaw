import { describe, expect, it } from 'vitest';

import { createDurableYeastProcessorParams, createYeastProcessorProjection } from '../YeastProcessorProjection';

import type { ProcessorType } from '../ProcessorCatalog';

type ProjectionSource = { id: string; type: ProcessorType; bypassed: boolean; params?: Record<string, number> };

describe('createDurableYeastProcessorParams', () => {
    it('returns a copy of the params when type is not chordMemory', () => {
        const params = { gain: 0.5, mix: 0.8 };

        const result = createDurableYeastProcessorParams('arpeggiator', params);

        expect(result).toEqual({ gain: 0.5, mix: 0.8 });
        expect(result).not.toBe(params);
    });

    it('returns an empty object when params is undefined', () => {
        const result = createDurableYeastProcessorParams('arpeggiator', undefined);

        expect(result).toEqual({});
    });

    it('removes learn and clear keys for chordMemory type', () => {
        const params = { gain: 0.5, learn: 1, clear: 0, depth: 0.3 };

        const result = createDurableYeastProcessorParams('chordMemory', params);

        expect(result).toEqual({ gain: 0.5, depth: 0.3 });
        expect('learn' in result).toBe(false);
        expect('clear' in result).toBe(false);
    });

    it('does not remove learn/clear when they are absent for chordMemory', () => {
        const params = { depth: 0.5 };

        const result = createDurableYeastProcessorParams('chordMemory', params);

        expect(result).toEqual({ depth: 0.5 });
    });
});

describe('createYeastProcessorProjection', () => {
    it('maps each processor to its projection with durable params', () => {
        const processors: ProjectionSource[] = [
            { id: 'p1', type: 'arpeggiator', bypassed: false, params: { rate: 0.5 } },
            { id: 'p2', type: 'chordMemory', bypassed: true, params: { learn: 1, depth: 0.3 } },
        ];

        const result = createYeastProcessorProjection(processors);

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ id: 'p1', type: 'arpeggiator', bypassed: false, params: { rate: 0.5 } });
        // chordMemory strips learn/clear.
        expect(result[1]).toEqual({ id: 'p2', type: 'chordMemory', bypassed: true, params: { depth: 0.3 } });
    });

    it('handles processors with no params', () => {
        const result = createYeastProcessorProjection([{ id: 'p1', type: 'arpeggiator', bypassed: false }]);

        expect(result[0]?.params).toEqual({});
    });

    it('returns an empty array for empty input', () => {
        expect(createYeastProcessorProjection([])).toEqual([]);
    });

    it('preserves bypassed state', () => {
        const result = createYeastProcessorProjection([{ id: 'p1', type: 'arpeggiator', bypassed: true, params: {} }]);

        expect(result[0]?.bypassed).toBe(true);
    });
});
