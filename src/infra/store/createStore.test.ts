import { describe, it, expect, vi } from 'vitest';
import { createStore } from './createStore';
import { getController } from './internal/getController';

describe('createStore', () => {
    it('returns an object with only subscribe and get', () => {
        const store = createStore({ count: 0 });
        expect(Object.keys(store).sort()).toEqual(['get', 'subscribe']);
        expect(typeof store.subscribe).toBe('function');
        expect(typeof store.get).toBe('function');
        expect((store as any).update).toBeUndefined();
    });

    it('get returns the initial state', () => {
        const store = createStore({ count: 42 });
        expect(store.get()).toEqual({ count: 42 });
    });

    it('listener is called on write', () => {
        const store = createStore({ count: 0 });
        const controller = getController(store);
        const listener = vi.fn();
        
        store.subscribe(listener);
        controller.update(prev => ({ count: prev.count + 1 }));
        
        expect(listener).toHaveBeenCalledTimes(1);
        expect(store.get()).toEqual({ count: 1 });
    });

    it('listener is not called on no-op write', () => {
        const state = { count: 0 };
        const store = createStore(state);
        const controller = getController(store);
        const listener = vi.fn();
        
        store.subscribe(listener);
        controller.set(state);
        
        expect(listener).not.toHaveBeenCalled();
    });

    it('unsubscribe stops notifications', () => {
        const store = createStore({ count: 0 });
        const controller = getController(store);
        const listener = vi.fn();
        
        const unsubscribe = store.subscribe(listener);
        unsubscribe();
        
        controller.update(prev => ({ count: prev.count + 1 }));
        expect(listener).not.toHaveBeenCalled();
    });

    it('subscribe does not eagerly emit', () => {
        const store = createStore({ count: 0 });
        const listener = vi.fn();
        store.subscribe(listener);
        expect(listener).not.toHaveBeenCalled();
    });

    it('get returns the same reference until a write replaces it', () => {
        const store = createStore({ count: 0 });
        const snap1 = store.get();
        const snap2 = store.get();
        expect(snap1).toBe(snap2);

        const controller = getController(store);
        controller.set({ count: 1 });
        const snap3 = store.get();
        expect(snap3).not.toBe(snap1);
    });
});
