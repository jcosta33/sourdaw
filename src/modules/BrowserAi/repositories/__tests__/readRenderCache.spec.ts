import { describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { readRenderCache } from '../readRenderCache';

describe('readRenderCache', () => {
    it('returns audio from the locked persistent cache', async () => {
        const audio = new Float32Array([0.25, -0.5, 1]);
        const accessRenderCache = vi.fn().mockResolvedValue(audio);
        injectDependencies(readRenderCache, { logger: {}, accessRenderCache });
        expect(await readRenderCache({ cacheKey: 'a'.repeat(64) })).toBe(audio);
        expect(accessRenderCache).toHaveBeenCalledWith({ cacheKey: 'a'.repeat(64) });
    });

    it('returns a miss when cache storage is unavailable', async () => {
        injectDependencies(readRenderCache, {
            logger: {},
            accessRenderCache: vi.fn().mockRejectedValue(new Error('OPFS unavailable')),
        });
        expect(await readRenderCache({ cacheKey: 'a'.repeat(64) })).toBeNull();
    });
});
