import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';

import { clearUndoHistory, pushUndoEntry, undo } from '#/modules/Command/useCases';

import { useUndoAvailability, useUndoState } from '../useUndoState';

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

describe('useUndoAvailability', () => {
    beforeEach(() => {
        clearUndoHistory();
    });

    it('reports neither undo nor redo when history is empty', () => {
        const { result } = renderHook(() => useUndoAvailability());

        expect(result.current).toEqual({ canUndo: false, canRedo: false });
    });

    it('reports undo but not redo once a step exists', () => {
        pushEntry('Add note');

        const { result } = renderHook(() => useUndoAvailability());

        expect(result.current).toEqual({ canUndo: true, canRedo: false });
    });

    it('reports redo but not undo once every step is undone', async () => {
        pushEntry('Add note');
        const { result } = renderHook(() => useUndoAvailability());

        await act(async () => {
            await undo();
        });

        expect(result.current).toEqual({ canUndo: false, canRedo: true });
    });

    it('does not render again when a further step leaves both flags unchanged', () => {
        pushEntry('Add note');
        let renders = 0;
        renderHook(() => {
            renders += 1;
            return useUndoAvailability();
        });
        renders = 0;

        act(() => {
            pushEntry('Move clip');
        });

        expect(renders).toBe(0);
    });
});
