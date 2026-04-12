import { describe, it, expect, beforeEach } from 'vitest';

import { createEmptyTree } from '../../../../models/UndoTree';
import { undoTreeStore } from '../../../../stores/undoTree';
import { toggleUndoTree } from '../toggleUndoTree';

describe('toggleUndoTree', () => {
    beforeEach(() => {
        undoTreeStore.set({ tree: createEmptyTree(), enabled: false });
    });

    it('should flip enabled from false to true', () => {
        toggleUndoTree();
        expect(undoTreeStore.value?.enabled).toBe(true);
    });

    it('should flip enabled from true to false', () => {
        undoTreeStore.set({ tree: createEmptyTree(), enabled: true });
        toggleUndoTree();
        expect(undoTreeStore.value?.enabled).toBe(false);
    });

    it('should not throw when store value is null', () => {
        undoTreeStore.set(null);
        toggleUndoTree();
        expect(undoTreeStore.value).toBeNull();
    });
});
