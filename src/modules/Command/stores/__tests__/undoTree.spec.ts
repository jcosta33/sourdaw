import { describe, it, expect, beforeEach } from 'vitest';

import { createEmptyTree } from '../../models/UndoTree';
import { type UndoTreeStoreState, undoTreeStore } from '../undoTree';

describe('undoTreeStore', () => {
    beforeEach(() => {
        undoTreeStore.set({ tree: createEmptyTree(), enabled: false });
    });

    it('should have initial state', () => {
        expect(undoTreeStore.value?.enabled).toBe(false);
        expect(undoTreeStore.value?.tree).toBeDefined();
    });

    it('should update state', () => {
        undoTreeStore.update((state: UndoTreeStoreState | null) => ({ ...state!, enabled: true }));
        expect(undoTreeStore.value?.enabled).toBe(true);
    });
});
