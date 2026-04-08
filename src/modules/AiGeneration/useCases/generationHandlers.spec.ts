import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeExtractGroove } from './generationHandlers';

describe('generationHandlers injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('executeExtractGroove forwards clip id', () => {
        const extractGroove = vi.fn();
        injectDependencies(executeExtractGroove, { extractGroove });

        executeExtractGroove({ type: 'extractGroove', payload: { clipId: 'c1' } });

        expect(extractGroove).toHaveBeenCalledWith('c1');
    });
});
