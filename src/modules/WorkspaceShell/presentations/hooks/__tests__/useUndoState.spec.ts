import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useUndoState } from '../useUndoState';

type UndoState = {
    past: Array<{ label: string }>;
    future: Array<{ label: string }>;
};

const undoState = vi.hoisted(() => ({ value: null as UndoState | null }));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => undoState.value ?? { past: [], future: [] }),
}));

vi.mock('#/modules/Command/stores', () => ({
    undoStore: {
        get value() {
            return undoState.value;
        },
    },
}));

describe('useUndoState', () => {
    beforeEach(() => {
        undoState.value = null;
    });

    it('reports canUndo/canRedo false and null lastAction when history is empty', () => {
        const { result } = renderHook(() => useUndoState());

        expect(result.current.canUndo).toBe(false);
        expect(result.current.canRedo).toBe(false);
        expect(result.current.lastAction).toBeNull();
        expect(result.current.undoCount).toBe(0);
    });

    it('reports canUndo true with the last past entry when history exists', () => {
        undoState.value = {
            past: [{ label: 'Add note' }, { label: 'Move clip' }],
            future: [],
        };

        const { result } = renderHook(() => useUndoState());

        expect(result.current.canUndo).toBe(true);
        expect(result.current.canRedo).toBe(false);
        expect(result.current.lastAction).toEqual({ label: 'Move clip' });
        expect(result.current.undoCount).toBe(2);
    });

    it('reports canRedo true when the future stack has entries', () => {
        undoState.value = {
            past: [{ label: 'Add note' }],
            future: [{ label: 'Redo me' }],
        };

        const { result } = renderHook(() => useUndoState());

        expect(result.current.canUndo).toBe(true);
        expect(result.current.canRedo).toBe(true);
    });

    it('reports canUndo false when only the future stack is populated', () => {
        undoState.value = { past: [], future: [{ label: 'Redo me' }] };

        const { result } = renderHook(() => useUndoState());

        expect(result.current.canUndo).toBe(false);
        expect(result.current.canRedo).toBe(true);
        expect(result.current.lastAction).toBeNull();
    });
});
