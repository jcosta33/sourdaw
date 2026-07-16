import { describe, it, expect } from 'vitest';

import { trackStore } from '../trackStore';

describe('trackStore deep', () => {
    it('has initial state with tracks array', () => {
        const state = trackStore.value;
        expect(state).toBeDefined();
        expect(Array.isArray(state?.tracks)).toBe(true);
    });
    it('supports subscribe', () => {
        let called = false;
        const unsub = trackStore.subscribe(() => {
            called = true;
        });
        const s = trackStore.value;
        if (s) {
            trackStore.set({ ...s });
        }
        expect(called).toBe(true);
        unsub();
    });
    it('selectedTrackId is null or string', () => {
        const state = trackStore.value;
        const id = state?.selectedTrackId;
        expect(id === null || typeof id === 'string').toBe(true);
    });
});
