import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeSearchSamples } from './batchFeatureHandlers';

describe('batchFeatureHandlers injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('executeSearchSamples forwards query', async () => {
        const searchSamples = vi.fn();
        injectDependencies(executeSearchSamples, { searchSamples });

        await executeSearchSamples({ payload: { query: 'kick' } });

        expect(searchSamples).toHaveBeenCalledWith('kick');
    });
});
