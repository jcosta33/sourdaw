/* (c) Copyright Frontify Ltd., all rights reserved. */

import { createStubInstance } from 'sinon';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Logger } from '../Logger/Logger';

import { LocalStorageStorage } from './Storage/LocalStorageStorage';
import { MemoryStorage } from './Storage/MemoryStorage';
import { type Storage } from './Storage/Storage';
import { Store } from './Store';

describe('Store', () => {
    const loggerDummy = createStubInstance(Logger);
    let storage: Storage<string>;
    let store: Store<string>;

    beforeEach(() => {
        storage = new MemoryStorage();
        vi.spyOn(storage, 'get');
        vi.spyOn(storage, 'set');
        vi.spyOn(storage, 'clear');
        store = new Store(loggerDummy, { storage });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('value', () => {
        it('should return storage value', () => {
            vi.mocked(storage.get).mockReturnValue('test');
            expect(store.value).toBe('test');
            expect(storage.get).toHaveBeenCalled();
        });

        it('should return null when storage is empty', () => {
            vi.mocked(storage.get).mockReturnValue(null);
            expect(store.value).toBeNull();
        });

        it('should return null if storage.get() return null', () => {
            vi.mocked(storage.get).mockReturnValue(null);
            expect(store.value).toBeNull();
        });

        it('should return the initial value when provided', () => {
            store = new Store(loggerDummy, { storage, initialData: 'initial value' });
            expect(store.value).toBe('initial value');
        });

        it('should not overwrite existing data with initial data', () => {
            vi.mocked(storage.get).mockReturnValue('existing value');
            store = new Store(loggerDummy, { storage, initialData: 'initial value' });
            expect(store.value).toBe('existing value');
        });
    });

    describe('set', () => {
        it('should set value in storage and notify subscribers', () => {
            const callback = vi.fn();
            store.subscribe(callback);
            vi.mocked(storage.get).mockReturnValue('new value');

            store.set('new value');

            expect(storage.set).toHaveBeenCalledWith('new value');
            expect(callback).toHaveBeenCalledWith('new value');
        });
    });

    describe('update', () => {
        it('should apply the updater to the current value and notify subscribers', () => {
            const callback = vi.fn();
            store.set('hello');
            store.subscribe(callback);

            store.update((current) => `${current} world`);

            expect(store.value).toBe('hello world');
            expect(callback).toHaveBeenCalledWith('hello world');
        });

        it('should pass null to the updater when the store is empty', () => {
            const updater = vi.fn((_current: string | null) => 'initialised');

            store.update(updater);

            expect(updater).toHaveBeenCalledWith(null);
            expect(store.value).toBe('initialised');
        });

        it('should allow the updater to clear the store by returning null', () => {
            store.set('value');

            store.update(() => null);

            expect(store.value).toBeNull();
        });
    });

    describe('subscribe', () => {
        it('should add subscriber and return unsubscribe function', () => {
            const callback = vi.fn();
            const unsubscribe = store.subscribe(callback);

            store.set('test');
            expect(callback).toHaveBeenCalledWith('test');

            unsubscribe();

            store.set('another test');
            expect(callback).toHaveBeenCalledTimes(1);
        });

        it('should handle multiple subscribers', () => {
            const callback1 = vi.fn();
            const callback2 = vi.fn();
            store.subscribe(callback1);
            store.subscribe(callback2);

            store.set('test');

            expect(callback1).toHaveBeenCalledWith('test');
            expect(callback2).toHaveBeenCalledWith('test');
        });

        it('should handle subscriber errors gracefully', () => {
            const workingCallback = vi.fn();
            const throwingCallback = () => {
                throw new Error('Subscriber error');
            };

            store.subscribe(throwingCallback);
            store.subscribe(workingCallback);
            store.set('test');

            expect(workingCallback).toHaveBeenCalledWith('test');
        });
    });

    describe('clear', () => {
        it('should clear storage and notify subscribers', () => {
            const callback = vi.fn();
            store.subscribe(callback);
            vi.mocked(storage.get).mockReturnValue(null);

            store.clear();

            expect(storage.clear).toHaveBeenCalled();
            expect(callback).toHaveBeenCalledWith(null);
        });
    });

    describe('fallback', () => {
        beforeEach(() => {
            storage = new LocalStorageStorage('test' as any);
            vi.spyOn(storage, 'isSupported');
            vi.mocked(storage.isSupported).mockReturnValue(false);
            store = new Store(loggerDummy, { storage });
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('should store and return storage value', () => {
            store = new Store(loggerDummy, { storage });
            store.set('value');
            expect(store.value).toEqual('value');
        });

        it('should not store the value in localStorage', () => {
            store = new Store(loggerDummy, { storage });
            store.set('value');
            expect(localStorage.getItem('test')).toBeNull();
        });
    });
});
