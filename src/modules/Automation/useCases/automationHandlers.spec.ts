import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeInvertAutomation } from './automationHandlers';

describe('automationHandlers injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('executeInvertAutomation forwards laneId', () => {
        const invertAutomation = vi.fn();
        injectDependencies(executeInvertAutomation, { invertAutomation });

        executeInvertAutomation({ type: 'invertAutomation', payload: { laneId: 'lane-1' } });

        expect(invertAutomation).toHaveBeenCalledWith('lane-1');
    });
});
