import { describe, it, expect, vi, beforeEach } from 'vitest';

import { redo } from '../../../useCases/redo';
import { undo } from '../../../useCases/undo';
import { handleRedo } from '../handleRedo';
import { handleUndo } from '../handleUndo';

vi.mock('../../../useCases/redo', () => ({
    redo: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../useCases/undo', () => ({
    undo: vi.fn().mockResolvedValue(undefined),
}));

describe('undoRedoHandlers', () => {
    beforeEach(() => {
        vi.mocked(redo).mockClear();
        vi.mocked(undo).mockClear();
    });

    it('should execute undo through the Command undo use case', async () => {
        await handleUndo.execute({ type: 'undo' });

        expect(undo).toHaveBeenCalledWith();
        expect(handleUndo.describe({ type: 'undo' })).toEqual({ label: 'Undo' });
        expect(handleUndo.undoable).toBe(false);
    });

    it('should execute redo through the Command redo use case', async () => {
        await handleRedo.execute({ type: 'redo' });

        expect(redo).toHaveBeenCalledWith();
        expect(handleRedo.describe({ type: 'redo' })).toEqual({ label: 'Redo' });
        expect(handleRedo.undoable).toBe(false);
    });
});
