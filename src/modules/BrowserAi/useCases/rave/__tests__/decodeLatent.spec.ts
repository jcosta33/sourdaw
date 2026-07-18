import { describe, expect, it } from 'vitest';

import { decodeLatent } from '../decodeLatent';

describe('decodeLatent', () => {
    it('should return an empty buffer when there are no vectors', () => {
        const out = decodeLatent([], 48_000);
        expect(out.length).toBe(0);
    });

    it('should allocate one 20ms frame per vector at the given sample rate', () => {
        const sampleRate = 48_000;
        const frameSize = Math.floor(sampleRate * 0.02);
        const vectors = [
            { values: [1, 0.5], timeSec: 0 },
            { values: [-0.25, 0], timeSec: 0.02 },
        ];
        const out = decodeLatent(vectors, sampleRate);
        expect(out.length).toBe(vectors.length * frameSize);
        expect(Number.isFinite(out[0])).toBe(true);
    });
});
