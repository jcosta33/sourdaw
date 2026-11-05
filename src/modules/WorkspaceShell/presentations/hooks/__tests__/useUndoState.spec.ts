import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';

import { clearUndoHistory, pushUndoEntry, undo } from '#/modules/Command/useCases';

import { useUndoState } from '../useUndoState';

function pushEntry(label: string, groupId?: string): void {
    pushUndoEntry(
        label,
        () => undefined,
        () => undefined,
        groupId ? { groupId } : undefined
    );
}

describe('useUndoState', () => {
    beforeEach(() => {
        clearUndoHistory();
    });

    it('reports canUndo/canRedo false and null lastAction when history is empty', () => {
        const { result } = renderHook(() => useUndoState());

        expect(result.current.canUndo).toBe(false);
        expect(result.current.canRedo).toBe(false);
        expect(result.current.lastAction).toBeNull();
        expect(result.current.undoCount).toBe(0);
    });

    it('reports canUndo true with the last past step when history exists', () => {
        pushEntry('Add note');
        pushEntry('Move clip');

        const { result } = renderHook(() => useUndoState());

        expect(result.current.canUndo).toBe(true);
        expect(result.current.canRedo).toBe(false);
        expect(result.current.lastAction?.label).toBe('Move clip');
        expect(result.current.undoCount).toBe(2);
    });

    it('counts a grouped gesture as the one undo step a single undo reverts', () => {
        pushEntry('Drag part 1', 'drag');
        pushEntry('Drag part 2', 'drag');
        pushEntry('Drag part 3', 'drag');
        pushEntry('Rename track');

        const { result } = renderHook(() => useUndoState());

        expect(result.current.undoCount).toBe(2);
        expect(result.current.lastAction?.label).toBe('Rename track');
    });

    it('reports canRedo true, and canUndo false once every step is undone', async () => {
        pushEntry('Add note', 'g');
        pushEntry('Add note', 'g');
        const { result } = renderHook(() => useUndoState());
        expect(result.current.undoCount).toBe(1);

        await act(async () => {
            await undo();
        });

        expect(result.current.canUndo).toBe(false);
        expect(result.current.canRedo).toBe(true);
        expect(result.current.lastAction).toBeNull();
        expect(result.current.undoCount).toBe(0);
    });
});
