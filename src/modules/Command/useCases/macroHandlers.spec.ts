import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeDeleteMacro } from './macroHandlers';

describe('macroHandlers injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('executeDeleteMacro forwards macro id', async () => {
        const deleteMacro = vi.fn();
        injectDependencies(executeDeleteMacro, { deleteMacro });

        await executeDeleteMacro({ payload: { macroId: 'm1' } });

        expect(deleteMacro).toHaveBeenCalledWith('m1');
    });
});
