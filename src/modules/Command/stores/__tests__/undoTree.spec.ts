import { describe, it, expect, beforeEach } from 'vitest';
import { undoTreeStore } from '../undoTree';

describe('undoTreeStore', () => {
    beforeEach(() => {
        undoTreeStore.set({ tree: { rootId: 'r1', currentNodeId: 'r1', nodes: {} } as any, enabled: false });
    });

    it('should have initial state', () => {
        expect(undoTreeStore.value?.enabled).toBe(false);
        expect(undoTreeStore.value?.tree).toBeDefined();
    });

    it('should update state', () => {
        undoTreeStore.update((s) => ({ ...s!, enabled: true }));
        expect(undoTreeStore.value?.enabled).toBe(true);
    });
});
