import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { undo } from './undoRedo';

describe('undoRedo injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('undo no-ops when past stack is empty', async () => {
        const executeAppAction = vi.fn();
        const undoStore = {
            value: { past: [] as never[], future: [] as never[] },
            set: vi.fn(),
        };
        injectDependencies(undo, { undoStore, executeAppAction });

        await undo();

        expect(executeAppAction).not.toHaveBeenCalled();
    });
});
