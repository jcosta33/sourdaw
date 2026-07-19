import { describe, it, expect, vi, beforeEach } from 'vitest';

import { redoUnderMutation } from '../../../useCases/redoUnderMutation';
import { undoUnderMutation } from '../../../useCases/undoUnderMutation';
import { handleRedo } from '../handleRedo';
import { handleUndo } from '../handleUndo';

vi.mock('../../../useCases/redoUnderMutation', () => ({
    redoUnderMutation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../useCases/undoUnderMutation', () => ({
    undoUnderMutation: vi.fn().mockResolvedValue(undefined),
}));

describe('undoRedoHandlers', () => {
    beforeEach(() => {
        vi.mocked(redoUnderMutation).mockClear();
        vi.mocked(undoUnderMutation).mockClear();
    });

    it('should execute undo through the Command undo use case', async () => {
        await handleUndo.execute({ type: 'undo' });

        expect(undoUnderMutation).toHaveBeenCalledWith();
        expect(handleUndo.describe({ type: 'undo' })).toEqual({ label: 'Undo' });
        expect(handleUndo.undoable).toBe(false);
    });

    it('should execute redo through the Command redo use case', async () => {
        await handleRedo.execute({ type: 'redo' });

        expect(redoUnderMutation).toHaveBeenCalledWith();
        expect(handleRedo.describe({ type: 'redo' })).toEqual({ label: 'Redo' });
        expect(handleRedo.undoable).toBe(false);
    });
});
