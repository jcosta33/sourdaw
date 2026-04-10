import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { deleteSelectedPoints } from './automationSelection';

describe('deleteSelectedPoints', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not call pushUndoEntry when automation state is missing', () => {
        const pushUndoEntry = vi.fn();
        injectDependencies(deleteSelectedPoints, { pushUndoEntry });

        deleteSelectedPoints('lane-x', [1, 2]);

        expect(pushUndoEntry).not.toHaveBeenCalled();
    });
});
