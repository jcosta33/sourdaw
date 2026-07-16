import { describe, it, expect } from 'vitest';

import { midiStore } from '../midiStore';

describe('midiStore deep', () => {
    it('has initial state', () => {
        expect(midiStore.value).toBeDefined();
        expect(midiStore.value?.notesByClipId).toBeDefined();
    });
    it('subscribe fires on set', () => {
        let called = false;
        const unsub = midiStore.subscribe(() => {
            called = true;
        });
        const s = midiStore.value;
        if (s) {
            midiStore.set({ ...s });
        }
        expect(called).toBe(true);
        unsub();
    });
});
