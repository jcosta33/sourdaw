import { describe, it, expect } from 'vitest';

import { projectStore } from '../projectStore';

describe('projectStore deep', () => {
    it('has state or null', () => {
        const state = projectStore.value;
        expect(state === null || typeof state === 'object').toBe(true);
    });
    it('subscribe fires', () => {
        let called = false;
        const unsub = projectStore.subscribe(() => {
            called = true;
        });
        const s = projectStore.value;
        if (s) {
            projectStore.set({ ...s });
        }
        expect(called).toBe(true);
        unsub();
    });
});
