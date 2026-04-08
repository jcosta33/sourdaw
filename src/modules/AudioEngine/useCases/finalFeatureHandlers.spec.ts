import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeToggleNodeView } from './finalFeatureHandlers';

describe('finalFeatureHandlers injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('executeToggleNodeView forwards to toggleNodeView', async () => {
        const toggleNodeView = vi.fn();
        injectDependencies(executeToggleNodeView, { toggleNodeView });

        await executeToggleNodeView();

        expect(toggleNodeView).toHaveBeenCalledTimes(1);
    });
});
