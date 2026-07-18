import { describe, it, expect } from 'vitest';

import { workspaceStore } from '../workspaceStore';

describe('workspaceStore deep', () => {
    it('has initial state', () => {
        expect(workspaceStore.value).toBeDefined();
        expect(typeof workspaceStore.value?.sidebarOpen).toBe('boolean');
        expect(typeof workspaceStore.value?.mixerOpen).toBe('boolean');
    });
    it('subscribe fires', () => {
        let called = false;
        const unsub = workspaceStore.subscribe(() => {
            called = true;
        });
        const s = workspaceStore.value;
        if (s) {
            workspaceStore.set({ ...s });
        }
        expect(called).toBe(true);
        unsub();
    });
});
