import { describe, it, expect } from 'vitest';

import { createDurableYeastProcessorParams } from '../YeastProcessorProjection';

describe('createDurableYeastProcessorParams', () => {
    it('passes through params unchanged for a non-chordMemory processor', () => {
        const params = { freq: 440, q: 0.7, learn: 1 };
        const durable = createDurableYeastProcessorParams('arpeggiator', params);
        expect(durable).toEqual({ freq: 440, q: 0.7, learn: 1 });
    });

    it('strips the learn param for a chordMemory processor', () => {
        const params = { rate: 0.5, learn: 1, clear: 1, depth: 0.8 };
        const durable = createDurableYeastProcessorParams('chordMemory', params);
        expect('learn' in durable).toBe(false);
        expect('clear' in durable).toBe(false);
        expect(durable).toEqual({ rate: 0.5, depth: 0.8 });
    });

    it('keeps durable params for chordMemory when learn/clear are absent', () => {
        const params = { rate: 0.5, depth: 0.8 };
        const durable = createDurableYeastProcessorParams('chordMemory', params);
        expect(durable).toEqual({ rate: 0.5, depth: 0.8 });
    });

    it('returns an empty object when params is undefined', () => {
        expect(createDurableYeastProcessorParams('arpeggiator', undefined)).toEqual({});
        expect(createDurableYeastProcessorParams('chordMemory', undefined)).toEqual({});
    });

    it('does not mutate the original params object', () => {
        const params = { rate: 0.5, learn: 1, clear: 1 };
        createDurableYeastProcessorParams('chordMemory', params);
        expect(params).toEqual({ rate: 0.5, learn: 1, clear: 1 });
    });
});
