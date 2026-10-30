import { describe, expect, it } from 'vitest';

import { applyBiquad } from '../applyBiquad';
import { createKWeightingFilters } from '../createKWeightingFilters';

describe('biquad carried state', () => {
    it('matches the complete batch when a real signal crosses uneven block boundaries', () => {
        const signal = Float64Array.from({ length: 20003 }, (_, i) => Math.sin(i / 17) + (i === 4096 ? 2 : 0));
        const batch = signal.slice();
        const filter = createKWeightingFilters(44100).shelf;
        applyBiquad(batch, filter);
        const state = { x1: 0, x2: 0, y1: 0, y2: 0 };
        const output = new Float64Array(signal.length);
        for (let start = 0; start < signal.length; start += 997) {
            const block = signal.slice(start, start + 997);
            applyBiquad(block, filter, state);
            output.set(block, start);
        }
        expect(output).toEqual(batch);
    });
});
