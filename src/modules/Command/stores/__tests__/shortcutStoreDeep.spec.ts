import { describe, it, expect } from 'vitest';

import { shortcutStore } from '../shortcutStore';

describe('shortcutStore deep', () => {
    it('has initial state', () => {
        const state = shortcutStore.value;
        expect(state).toBeDefined();
        expect(Array.isArray(state?.definitions)).toBe(true);
    });
    it('definitions contain known shortcuts', () => {
        const state = shortcutStore.value;
        if (state) {
            const ids = state.definitions.map((d) => d.id);
            expect(ids).toContain('transport.togglePlayback');
            expect(ids).toContain('editing.undo');
            expect(ids).toContain('editing.redo');
            expect(ids).toContain('workspace.toggleCommandPalette');
        }
    });
    it('customMappings is an object', () => {
        const state = shortcutStore.value;
        expect(typeof state?.customMappings).toBe('object');
    });
    it('subscribe fires on set', () => {
        let called = false;
        const unsub = shortcutStore.subscribe(() => {
            called = true;
        });
        const s = shortcutStore.value;
        if (s) {
            shortcutStore.set({ ...s });
        }
        expect(called).toBe(true);
        unsub();
    });
});
