import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeDetachPatternInstance } from './patternInstanceHandlers';

describe('patternInstanceHandlers injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('executeDetachPatternInstance forwards clip id', async () => {
        const detachPatternInstance = vi.fn();
        injectDependencies(executeDetachPatternInstance, { detachPatternInstance });

        await executeDetachPatternInstance({ payload: { clipId: 'c1' } });

        expect(detachPatternInstance).toHaveBeenCalledWith('c1');
    });
});
