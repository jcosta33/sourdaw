/* (c) Copyright Frontify Ltd., all rights reserved. */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { LocalStorageStorage } from './LocalStorageStorage';

describe('LocalStorageStorage', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    describe('with primitive types', () => {
        let storage: LocalStorageStorage<string>;

        beforeEach(() => {
            localStorage.clear();
            storage = new LocalStorageStorage<string>('test-key' as any);
        });

        afterEach(() => {
            vi.resetAllMocks();
        });

        it('should return true when calling isSupported()', () => {
            expect(storage.isSupported()).toBe(true);
        });

        it('should return `null` initially', () => {
            expect(storage.get()).toBeNull();
        });

        it('should store and retrieve value', () => {
            storage.set('test');
            expect(storage.get()).toBe('test');
        });

        it('should preserve referential equality when the value does not change', () => {
            const storage = new LocalStorageStorage<{ foo: boolean }>('test-key' as any);
            storage.set({ foo: true });
            expect(storage.get()).toBe(storage.get());
        });

        it('should clear value when setting `null`', () => {
            storage.set('test');
            storage.set(null);
            expect(storage.get()).toBeNull();
        });

        it('should clear stored value', () => {
            storage.set('test');
            storage.clear();
            expect(storage.get()).toBeNull();
        });

        it('should update value on multiple sets', () => {
            storage.set('first');
            expect(storage.get()).toBe('first');
            storage.set('second');
            expect(storage.get()).toBe('second');

            storage.set('third');
            storage.set('fourth');
            expect(storage.get()).toBe('fourth');
        });
    });

    describe('with complex types', () => {
        it('should store and retrieve `Date` objects', () => {
            const storage = new LocalStorageStorage<Date>('date-key' as any);
            const date = new Date('2024-01-01');

            storage.set(date);
            expect(storage.get()?.toISOString()).toBe(date.toISOString());
        });

        it('should store and retrieve nested objects', () => {
            const storage = new LocalStorageStorage<{ nested: { data: number[]; meta: { id: string } } }>(
                'nested-key' as any
            );
            const data = {
                nested: {
                    data: [1, 2, 3],
                    meta: { id: 'test-id' },
                },
            };

            storage.set(data);
            expect(storage.get()).toEqual(data);
        });

        it('should store and retrieve `BigInt` values', () => {
            const storage = new LocalStorageStorage<bigint>('bigint-key' as any);
            const bigIntValue = BigInt('9007199254740991');

            storage.set(bigIntValue);
            expect(storage.get()).toBe(bigIntValue);
        });

        it('should store and retrieve mixed type arrays', () => {
            type MixedArray = (string | number | boolean | null)[];

            const storage = new LocalStorageStorage<MixedArray>('test-key' as any);
            const mixedArray = ['test', 42, true, null];

            storage.set(mixedArray);

            expect(storage.get()).toEqual(mixedArray);
        });

        it('should handle deeply nested arrays', () => {
            type NestedArray = unknown[][];
            const storage = new LocalStorageStorage<NestedArray>('test-key' as any);
            const deepArray = [
                [1, [2, [3, [4]]]],
                [5, [6]],
            ];

            storage.set(deepArray);

            expect(storage.get()).toEqual(deepArray);
        });

        it('should store and retrieve RegExp', () => {
            const storage = new LocalStorageStorage<RegExp>('test-key' as any);
            const regexp = /test/gi;

            storage.set(regexp);
            const retrieved = storage.get();

            expect(retrieved?.source).toBe('test');
            expect(retrieved?.flags).toBe('gi');
            expect(retrieved?.test('TEST')).toBe(true);
        });

        it('should store and retrieve Map', () => {
            const storage = new LocalStorageStorage<Map<string | number, unknown>>('test-key' as any);
            const map = new Map<string | number, unknown>([
                ['string', 'value'],
                [42, { nested: true }],
            ]);

            storage.set(map);
            const retrieved = storage.get();

            expect(retrieved).toBeInstanceOf(Map);
            expect(retrieved?.get('string')).toBe('value');
            expect(retrieved?.get(42)).toEqual({ nested: true });
        });

        it('should store and retrieve Set', () => {
            const storage = new LocalStorageStorage<Set<unknown>>('test-key' as any);
            const set = new Set(['test', 1, { prop: true }]);

            storage.set(set);
            const retrieved = storage.get();

            expect(retrieved).toBeInstanceOf(Set);
            expect(retrieved?.has('test')).toBe(true);
            expect(retrieved?.has(1)).toBe(true);
            expect(Array.from(retrieved ?? [])).toEqual(['test', 1, { prop: true }]);
        });

        it('should store and retrieve URL', () => {
            const storage = new LocalStorageStorage<URL>('test-key' as any);
            const url = new URL('https://frontify.com/path?query=test#hash');

            storage.set(url);
            const retrieved = storage.get();

            expect(retrieved).toBeInstanceOf(URL);
            expect(retrieved?.href).toBe('https://frontify.com/path?query=test#hash');
            expect(retrieved?.pathname).toBe('/path');
            expect(retrieved?.searchParams.get('query')).toBe('test');
        });

        it('should store and retrieve Error', () => {
            const storage = new LocalStorageStorage<Error>('test-key' as any);
            const error = new Error('Test error');

            storage.set(error);
            const retrieved = storage.get();

            expect(retrieved).toBeInstanceOf(Error);
            expect(retrieved?.message).toBe('Test error');
        });

        it('should store Map with complex keys and values', () => {
            const storage = new LocalStorageStorage<Map<RegExp | Date, Set<string>>>('test-key' as any);
            const map = new Map<RegExp | Date, Set<string>>([
                [/test/i, new Set(['a', 'b'])],
                [new Date('2024-01-01'), new Set(['c', 'd'])],
            ]);

            storage.set(map);
            const retrieved = storage.get();

            expect(retrieved).toBeInstanceOf(Map);
            expect(Array.from(retrieved?.entries() ?? [])).toHaveLength(2);
            const [[regExp, setA], [date, setB]] = Array.from(retrieved?.entries() ?? []);
            expect(regExp).toBeInstanceOf(RegExp);
            expect(date).toBeInstanceOf(Date);
            expect(setA).toBeInstanceOf(Set);
            expect(setB).toBeInstanceOf(Set);
        });
    });

    describe('localStorage interactions', () => {
        it('should use the provided key for storage', () => {
            const key = 'custom-key';
            const storage = new LocalStorageStorage<string>(key as any);

            storage.set('test');

            expect(localStorage.getItem(key)).toBeTruthy();
        });

        it('should handle localStorage errors', () => {
            // Spy on console.error to suppress error logs in test output
            vi.spyOn(console, 'error').mockImplementation(() => {});

            const storage = new LocalStorageStorage<string>('error-key' as any);
            // jsdom: spying on `localStorage.setItem` may not intercept calls; prototype is reliable.
            vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
                throw new Error('Storage full');
            });

            expect(() => storage.set('test')).toThrow('Storage full');
        });

        it('should handle corrupted localStorage data', () => {
            const key = 'key';
            localStorage.setItem(key, 'some initial value');

            const storage = new LocalStorageStorage<string>(key as any);
            expect(storage.get()).toBe('some initial value');
        });

        it('should persist data between storage instances', () => {
            const key = 'persist-key';
            const firstStorage = new LocalStorageStorage<string>(key as any);
            firstStorage.set('test');

            const secondStorage = new LocalStorageStorage<string>(key as any);
            expect(secondStorage.get()).toBe('test');
        });
    });

    describe('edge cases', () => {
        it('should handle circular references', () => {
            type CircularType = { prop: string; self?: CircularType };
            const storage = new LocalStorageStorage<CircularType>('circular-key' as any);
            const circular: CircularType = { prop: 'value' };
            circular.self = circular;

            storage.set(circular);

            const retrieved = storage.get();

            expect(retrieved?.prop).toBe('value');
            expect(retrieved?.self).toBe(retrieved);
        });
    });

    describe('fallback', () => {
        let storage: LocalStorageStorage<string>;

        beforeEach(() => {
            Object.defineProperty(window, 'originalLocalStorage', {
                value: window.localStorage,
            });
            Object.defineProperty(window, 'localStorage', {
                value: null,
            });
            storage = new LocalStorageStorage<string>('test-key' as any);
        });

        afterEach(() => {
            vi.resetAllMocks();
            Object.defineProperty(window, 'localStorage', {
                value: (window as Window & typeof globalThis & { originalLocalStorage: typeof window.localStorage })
                    .originalLocalStorage,
            });
        });

        it('should return false when calling window.localStorage throws', () => {
            Object.defineProperty(window, 'localStorage', {
                get: () => {
                    throw new Error('Security error');
                },
                configurable: true,
            });

            expect(storage.isSupported()).toBe(false);
        });

        it('should return false when calling isSupported()', () => {
            expect(storage.isSupported()).toBe(false);
        });

        it('should throw an error when storage availability is not checked and localStorage is throwing.', () => {
            storage = new LocalStorageStorage<string>('test-key' as any);
            expect(() => storage.set('test')).toThrowError();
        });
    });
});
