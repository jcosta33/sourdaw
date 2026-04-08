import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeToggleUndoTree } from './undoTreeHandlers';

describe('undoTreeHandlers injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('executeToggleUndoTree forwards to toggleUndoTree', async () => {
        const toggleUndoTree = vi.fn();
        injectDependencies(executeToggleUndoTree, { toggleUndoTree });

        await executeToggleUndoTree();

        expect(toggleUndoTree).toHaveBeenCalledTimes(1);
    });
});
