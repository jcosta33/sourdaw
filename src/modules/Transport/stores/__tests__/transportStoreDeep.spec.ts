import { describe, it, expect } from 'vitest';

import { transportStore } from '../transportStore';

describe('transportStore deep', () => {
    it('has initial state with tempo', () => {
        expect(transportStore.value).toBeDefined();
        expect(typeof transportStore.value?.tempo).toBe('number');
        expect(transportStore.value?.tempo).toBeGreaterThan(0);
    });
    it('isPlaying is boolean', () => {
        expect(typeof transportStore.value?.isPlaying).toBe('boolean');
    });
    it('subscribe fires', () => {
        let called = false;
        const unsub = transportStore.subscribe(() => {
            called = true;
        });
        const s = transportStore.value;
        if (s) {
            transportStore.set({ ...s });
        }
        expect(called).toBe(true);
        unsub();
    });
});
