import { describe, it, expect, vi } from 'vitest';

import { createStore } from './createStore';

describe('createStore', () => {
    it('exposes value, set, update, clear, hydrate, subscribe, subscribeReact, getSnapshot', () => {
        const store = createStore({ initialData: { count: 0 } });
        expect(typeof store.set).toBe('function');
        expect(typeof store.update).toBe('function');
        expect(typeof store.clear).toBe('function');
        expect(typeof store.hydrate).toBe('function');
        expect(typeof store.subscribe).toBe('function');
        expect(typeof store.subscribeReact).toBe('function');
        expect(typeof store.getSnapshot).toBe('function');
    });

    it('value returns the initial state', () => {
        const store = createStore({ initialData: { count: 42 } });
        expect(store.value).toEqual({ count: 42 });
    });

    it('listener is called on write', () => {
        const store = createStore({ initialData: { count: 0 } });
        const listener = vi.fn();

        store.subscribe(listener);
        store.update((prev) => (prev ? { count: prev.count + 1 } : null));

        expect(listener).toHaveBeenCalledTimes(1);
        expect(store.value).toEqual({ count: 1 });
    });

    it('listener is always called on set (no Object.is check — storage owns identity)', () => {
        const state = { count: 0 };
        const store = createStore({ initialData: state });
        const listener = vi.fn();

        store.subscribe(listener);
        store.set(state);

        // The old Store always notified — no Object.is check
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe stops notifications', () => {
        const store = createStore({ initialData: { count: 0 } });
        const listener = vi.fn();

        const unsubscribe = store.subscribe(listener);
        unsubscribe();

        store.update((prev) => (prev ? { count: prev.count + 1 } : null));
        expect(listener).not.toHaveBeenCalled();
    });

    it('subscribe does not eagerly emit', () => {
        const store = createStore({ initialData: { count: 0 } });
        const listener = vi.fn();
        store.subscribe(listener);
        expect(listener).not.toHaveBeenCalled();
    });

    it('value returns the same reference until a write replaces it', () => {
        const store = createStore({ initialData: { count: 0 } });
        const snap1 = store.value;
        const snap2 = store.value;
        expect(snap1).toBe(snap2);

        store.set({ count: 1 });
        const snap3 = store.value;
        expect(snap3).not.toBe(snap1);
    });
});
