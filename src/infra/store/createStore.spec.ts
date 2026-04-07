import { describe, it, expect } from 'vitest';
import { createStore } from './createStore';
import { getController } from './internal/getController';

describe('Store', () => {
    it('createStore() exposes only subscribe and get on the public object', () => {
        const store = createStore({ val: 1 });
        expect(store.subscribe).toBeDefined();
        expect(store.get).toBeDefined();
        expect((store as any).set).toBeUndefined();
        expect((store as any).update).toBeUndefined();
    });

    it('get() returns the initial snapshot', () => {
        const store = createStore({ val: 1 });
        expect(store.get()).toEqual({ val: 1 });
    });

    it('getController(store) can set and update the store', () => {
        const store = createStore({ val: 1 });
        const controller = getController(store);
        
        controller.set({ val: 2 });
        expect(store.get()).toEqual({ val: 2 });
        
        controller.update(prev => ({ val: prev.val + 1 }));
        expect(store.get()).toEqual({ val: 3 });
    });

    it('listener is called on write and not called on no-op write', () => {
        const store = createStore({ val: 1 });
        const controller = getController(store);
        
        let fired = 0;
        store.subscribe(() => { fired++; });
        
        controller.set({ val: 2 });
        expect(fired).toBe(1);
        
        const state = store.get();
        controller.set(state); // Same reference
        expect(fired).toBe(1); // Should not fire again
    });

    it('subscribe() returns an unsubscribe function that stops notifications', () => {
        const store = createStore({ val: 1 });
        const controller = getController(store);
        
        let fired = 0;
        const unsub = store.subscribe(() => { fired++; });
        
        controller.set({ val: 2 });
        expect(fired).toBe(1);
        
        unsub();
        controller.set({ val: 3 });
        expect(fired).toBe(1); // Should not fire again
    });

    it('subscribe() does not immediately emit', () => {
        const store = createStore({ val: 1 });
        
        let fired = 0;
        store.subscribe(() => { fired++; });
        
        expect(fired).toBe(0);
    });
});