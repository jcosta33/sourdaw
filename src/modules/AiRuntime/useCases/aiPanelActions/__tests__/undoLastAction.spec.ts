import { describe, it, expect, vi, beforeEach } from 'vitest';

import { undoLastAction } from '../undoLastAction';

const mocks = vi.hoisted(() => ({
    undo: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    undo: mocks.undo,
}));

describe('undoLastAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('calls undo from Command module', () => {
        undoLastAction();
        expect(mocks.undo).toHaveBeenCalledTimes(1);
    });
});
