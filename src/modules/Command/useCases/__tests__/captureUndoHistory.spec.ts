import { describe, expect, it, vi } from 'vitest';

import { createEmptyTree } from '../../models/UndoTree';
import { undoTreeStore, type UndoTreeStoreState } from '../../stores/undoTree';
import { captureUndoHistory } from '../captureUndoHistory';

const { undoStoreValue } = vi.hoisted(() => ({
    undoStoreValue: vi.fn(),
}));

vi.mock('../../stores/undoStore', () => ({
    get undoStore() {
        return {
            get value() {
                return undoStoreValue();
            },
        };
    },
}));

describe('captureUndoHistory', () => {
    it('returns a defensive copy of the current past and future stacks', () => {
        const entry = {
            id: 'undo-1',
            kind: 'action',
            label: 'Move clip',
            action: {},
            inverseAction: {},
            timestamp: 1,
            source: 'manual',
        };
        const storePast = [entry];
        const storeFuture: typeof storePast = [];
        undoStoreValue.mockReturnValue({ past: storePast, future: storeFuture });

        const snapshot = captureUndoHistory();

        expect(snapshot).toEqual({ past: [entry], future: [], undoTree: undoTreeStore.value });
        // Defensive copy: the returned arrays must not be the store's own array
        // objects, or a later push onto the store's `past`/`future` would also
        // mutate an already-captured snapshot.
        expect(snapshot.past).not.toBe(storePast);
        expect(snapshot.future).not.toBe(storeFuture);
    });

    it('preserves each entry object, including its action and inverse action', () => {
        const entry = {
            id: 'undo-2',
            kind: 'action',
            label: 'Delete track',
            action: { type: 'x' },
            inverseAction: { type: 'y' },
            timestamp: 2,
            source: 'manual',
        };
        undoStoreValue.mockReturnValue({ past: [entry], future: [] });

        const snapshot = captureUndoHistory();

        expect(snapshot.past[0]).toBe(entry);
    });

    it('falls back to empty stacks when the store has no value', () => {
        undoStoreValue.mockReturnValue(null);

        expect(captureUndoHistory()).toEqual({ past: [], future: [], undoTree: undoTreeStore.value });
    });

    it('captures the tree mirror state alongside the stacks', () => {
        undoStoreValue.mockReturnValue({ past: [], future: [] });
        const mirrorState: UndoTreeStoreState = { tree: createEmptyTree(), enabled: true };
        undoTreeStore.set(mirrorState);

        const snapshot = captureUndoHistory();

        // The mirror rides along by reference, so a later store write cannot
        // retroactively change what the snapshot captured.
        expect(snapshot.undoTree).toBe(mirrorState);
    });
});
