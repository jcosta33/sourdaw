import { describe, it, expect, beforeEach } from 'vitest';

import { createEmptyTree } from '../../../../models/UndoTree';
import { undoTreeStore } from '../../../../stores/undoTree';
import { isUndoTreeEnabled } from '../isUndoTreeEnabled';

describe('isUndoTreeEnabled', () => {
    beforeEach(() => {
        undoTreeStore.set({ tree: createEmptyTree(), enabled: false });
    });

    it('should return false when the tree is disabled', () => {
        expect(isUndoTreeEnabled()).toBe(false);
    });

    it('should return true when the tree is enabled', () => {
        undoTreeStore.set({ tree: createEmptyTree(), enabled: true });
        expect(isUndoTreeEnabled()).toBe(true);
    });

    it('should return false when undoTreeStore value is null', () => {
        undoTreeStore.set(null);
        expect(isUndoTreeEnabled()).toBe(false);
    });
});
