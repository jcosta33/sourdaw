import { describe, it, expect, vi } from 'vitest';

import { deleteSelectedPoints } from '../automationSelection/deleteSelectedPoints';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        pushUndoEntry: vi.fn(),
    },
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...actual,
        executeUserAppAction: vi.fn(),
        pushUndoEntry: mocks.pushUndoEntry,
    };
});

describe('deleteSelectedPoints', () => {
    it('does not call pushUndoEntry when automation state is missing', () => {
        deleteSelectedPoints('lane-x', [1, 2]);

        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });
});
