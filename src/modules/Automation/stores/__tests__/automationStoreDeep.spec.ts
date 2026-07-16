import { describe, it, expect } from 'vitest';

import { automationStore } from '../automationStore';

describe('automationStore deep', () => {
    it('has initial state', () => {
        expect(automationStore.value).toBeDefined();
        expect(Array.isArray(automationStore.value?.lanes)).toBe(true);
    });
    it('set updates state', () => {
        const original = automationStore.value;
        automationStore.set({ ...original!, lanes: [] });
        expect(automationStore.value?.lanes).toEqual([]);
        if (original) {
            automationStore.set(original);
        }
    });
    it('subscribe receives updates', () => {
        let called = false;
        const unsub = automationStore.subscribe(() => {
            called = true;
        });
        const state = automationStore.value;
        if (state) {
            automationStore.set({ ...state });
        }
        expect(called).toBe(true);
        unsub();
    });
});
