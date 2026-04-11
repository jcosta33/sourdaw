import { describe, it, expect, vi, beforeEach } from 'vitest';
import { undo } from '../undoRedo';
import { undoStore } from '../../stores/undoStore';
import { executeAppAction } from '../executeAppAction';

vi.mock('../../stores/undoStore', () => ({
    undoStore: {
        value: { past: [], future: [] },
        set: vi.fn(),
    },
}));

vi.mock('../executeAppAction', () => ({
    executeAppAction: vi.fn(),
}));

describe('undoRedo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        undoStore.value = { past: [], future: [] };
    });

    it('undo no-ops when past stack is empty', async () => {
        await undo();
        expect(executeAppAction).not.toHaveBeenCalled();
    });
});
