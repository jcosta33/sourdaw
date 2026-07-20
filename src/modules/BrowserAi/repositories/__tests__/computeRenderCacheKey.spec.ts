import { describe, it, expect } from 'vitest';

import { computeRenderCacheKey } from '../computeRenderCacheKey';

function bufferFrom(bytes: number[]): ArrayBuffer {
    return new Uint8Array(bytes).buffer;
}

describe('computeRenderCacheKey', () => {
    it('produces a 64-character hex digest', async () => {
        const key = await computeRenderCacheKey({
            modelId: 'model-a',
            inputData: bufferFrom([1, 2, 3]),
            qualityParams: 'q1',
        });

        expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic for the same inputs', async () => {
        const input = { modelId: 'model-a', inputData: bufferFrom([1, 2, 3]), qualityParams: 'q1', seed: 7 };

        const first = await computeRenderCacheKey(input);
        const second = await computeRenderCacheKey(input);

        expect(first).toBe(second);
    });

    it('changes when the seed changes', async () => {
        const base = { modelId: 'model-a', inputData: bufferFrom([1, 2, 3]), qualityParams: 'q1' };

        const withoutSeed = await computeRenderCacheKey(base);
        const withSeed = await computeRenderCacheKey({ ...base, seed: 42 });

        expect(withoutSeed).not.toBe(withSeed);
    });

    it('changes when the input data changes', async () => {
        const first = await computeRenderCacheKey({
            modelId: 'model-a',
            inputData: bufferFrom([1, 2, 3]),
            qualityParams: 'q1',
        });
        const second = await computeRenderCacheKey({
            modelId: 'model-a',
            inputData: bufferFrom([1, 2, 4]),
            qualityParams: 'q1',
        });

        expect(first).not.toBe(second);
    });
});
