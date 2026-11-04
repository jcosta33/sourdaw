import { describe, expect, it } from 'vitest';

import { detectTransients } from '../TransientDetection';

function impulses() {
    const samples = new Float32Array(65_536);
    for (const offset of [8_192, 24_576, 40_960, 57_344]) {
        for (let index = 0; index < 80; index++) {
            samples[offset + index] = Math.cos(index * 1.723) * Math.exp(-index / 20);
        }
    }
    return samples;
}

describe('pure spectral-flux source detector', () => {
    it('returns four ascending source offsets with bounded confidence without changing the input', () => {
        const samples = impulses();
        const before = new Float32Array(samples);
        const hits = detectTransients(samples, 16_000, 0.5);
        expect(hits).toHaveLength(4);
        for (const [index, hit] of hits.entries()) {
            expect(Math.abs(hit.sampleOffset - [8_192, 24_576, 40_960, 57_344][index]!)).toBeLessThanOrEqual(2_048);
            expect(hit.sampleOffset).toBeGreaterThan(hits[index - 1]?.sampleOffset ?? -1);
            expect(hit.confidence).toBeGreaterThan(0);
            expect(hit.confidence).toBeLessThanOrEqual(1);
        }
        expect(samples).toEqual(before);
        expect(hits.some((hit) => hit.confidence === 1)).toBe(true);
    });

    it('keeps one global threshold rather than treating quiet segments as independent sources', () => {
        const samples = impulses();
        const split = samples.length / 2;
        for (let frame = split; frame < samples.length; frame++) {
            samples[frame] = samples[frame]! * 0.001;
        }
        expect(detectTransients(samples, 16_000, 0.5)).toHaveLength(2);
        expect(detectTransients(samples.slice(split), 16_000, 0.5)).toHaveLength(2);
    });

    it('returns no hits for silence or a source shorter than one FFT window', () => {
        expect(detectTransients(new Float32Array(65_536), 16_000, 0.5)).toEqual([]);
        expect(detectTransients(new Float32Array(2_047), 16_000, 0.5)).toEqual([]);
    });
});
