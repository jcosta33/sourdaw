import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecuteUserAppAction, mockUndo, mockRedo, mockCopy, mockCut, mockPaste, mockSelectAll, mockDeselectAll } =
    vi.hoisted(() => ({
        mockExecuteUserAppAction: vi.fn().mockResolvedValue(undefined),
        mockUndo: vi.fn().mockResolvedValue(undefined),
        mockRedo: vi.fn().mockResolvedValue(undefined),
        mockCopy: vi.fn(),
        mockCut: vi.fn(),
        mockPaste: vi.fn(),
        mockSelectAll: vi.fn(),
        mockDeselectAll: vi.fn(),
    }));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: mockExecuteUserAppAction,
    undo: mockUndo,
    redo: mockRedo,
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    copySelectedClip: mockCopy,
    cutSelectedClip: mockCut,
    pasteClip: mockPaste,
}));
vi.mock('../../selectAllClips', () => ({ selectAllClips: mockSelectAll }));
vi.mock('../../deselectAllClips', () => ({ deselectAllClips: mockDeselectAll }));

import { editCommands } from '../EditCommands';

function runAction(id: string): void {
    const cmd = editCommands.find((c) => c.id === id);
    if (!cmd) {
        throw new Error(`Command ${id} not found`);
    }
    if (typeof cmd.action !== 'function') {
        throw new TypeError(`Command ${id} action is not callable`);
    }
    cmd.action();
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

    it('paste-clip calls pasteClip', () => {
        runAction('paste-clip');
        expect(mockPaste).toHaveBeenCalledTimes(1);
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
