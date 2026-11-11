import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecuteUserAppAction, mockUndo, mockRedo, mockCopy, mockCut, mockSelectAll, mockDeselectAll } = vi.hoisted(
    () => ({
        mockExecuteUserAppAction: vi.fn().mockResolvedValue(undefined),
        mockUndo: vi.fn().mockResolvedValue({ headConsumed: false }),
        mockRedo: vi.fn().mockResolvedValue({ headConsumed: false }),
        mockCopy: vi.fn(),
        mockCut: vi.fn(),
        mockSelectAll: vi.fn(),
        mockDeselectAll: vi.fn(),
    })
);

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: mockExecuteUserAppAction,
    undo: mockUndo,
    redo: mockRedo,
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    copySelectedClip: mockCopy,
    cutSelectedClip: mockCut,
}));
vi.mock('../../selectAllClips', () => ({ selectAllClips: mockSelectAll }));
vi.mock('../../deselectAllClips', () => ({ deselectAllClips: mockDeselectAll }));

import { editCommands } from '../EditCommands';

function runAction(id: string, onCommitted?: () => void): void {
    const cmd = editCommands.find((c) => c.id === id);
    if (!cmd) {
        throw new Error(`Command ${id} not found`);
    }
    if (typeof cmd.action !== 'function') {
        throw new TypeError(`Command ${id} action is not callable`);
    }
    cmd.action(onCommitted);
}

describe('editCommands', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('undo calls the undo function', () => {
        runAction('undo');
        expect(mockUndo).toHaveBeenCalledTimes(1);
    });

    it('redo calls the redo function', () => {
        runAction('redo');
        expect(mockRedo).toHaveBeenCalledTimes(1);
    });

    it('records undo and redo only when they consume a history head', async () => {
        mockUndo.mockResolvedValueOnce({ headConsumed: true });
        mockRedo.mockResolvedValueOnce({ headConsumed: true });
        const undoCommitted = vi.fn();
        const redoCommitted = vi.fn();

        runAction('undo', undoCommitted);
        runAction('redo', redoCommitted);

        await vi.waitFor(() => {
            expect(undoCommitted).toHaveBeenCalledOnce();
            expect(redoCommitted).toHaveBeenCalledOnce();
        });
    });

    it('does not record empty or refused undo and redo attempts', async () => {
        const undoCommitted = vi.fn();
        const redoCommitted = vi.fn();

        runAction('undo', undoCommitted);
        runAction('redo', redoCommitted);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(undoCommitted).not.toHaveBeenCalled();
        expect(redoCommitted).not.toHaveBeenCalled();
    });

    it('copy-clip calls copySelectedClip', () => {
        runAction('copy-clip');
        expect(mockCopy).toHaveBeenCalledTimes(1);
    });

    it('cut-clip dispatches the cutClip app action instead of calling cutSelectedClip directly', () => {
        // The palette entry must route through executeUserAppAction so the cut is
        // captured and undoable (issue #4554); a direct cutSelectedClip() call
        // retires a comped clip's takes with no history entry.
        runAction('cut-clip');
        expect(mockExecuteUserAppAction).toHaveBeenCalledTimes(1);
        expect(mockExecuteUserAppAction).toHaveBeenCalledWith({ type: 'cutClip' });
        expect(mockCut).not.toHaveBeenCalled();
    });

    it('paste-clip dispatches the pasteClip app action instead of calling pasteClip directly', () => {
        // The palette entry must route through executeUserAppAction so the
        // paste is captured and undoable (#4618); a direct pasteClip() call
        // writes the pasted clips with no history entry.
        runAction('paste-clip');
        expect(mockExecuteUserAppAction).toHaveBeenCalledTimes(1);
        expect(mockExecuteUserAppAction).toHaveBeenCalledWith({ type: 'pasteClip' });
    });

    it('select-all calls selectAllClips', () => {
        runAction('select-all');
        expect(mockSelectAll).toHaveBeenCalledTimes(1);
    });

    it('deselect-all calls deselectAllClips and does not advertise a shortcut', () => {
        const cmd = editCommands.find((c) => c.id === 'deselect-all')!;
        runAction('deselect-all');
        expect(mockDeselectAll).toHaveBeenCalledTimes(1);
        expect(cmd.shortcut).toBeUndefined();
    });
});
