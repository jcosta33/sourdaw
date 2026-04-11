/* (c) Copyright Frontify Ltd., all rights reserved. */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { MemoryStorage } from '../MemoryStorage';

describe('MemoryStorage', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('with primitive types', () => {
        let storage: MemoryStorage<string>;

        beforeEach(() => {
            storage = new MemoryStorage<string>();
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
            storage.set('second');

            expect(storage.get()).toBe('second');
        });
    });

    describe('with complex types', () => {
        it('should store and retrieve `Date` objects', () => {
            const storage = new MemoryStorage<Date>();
            const date = new Date('2024-01-01');

            storage.set(date);

            expect(storage.get()).toEqual(date);
        });

        it('should store and retrieve nested objects', () => {
            const storage = new MemoryStorage<{ nested: { data: number[]; meta: { id: string } } }>();
            const data = {
                nested: {
                    data: [1, 2, 3],
                    meta: { id: 'test-id' },
                },
            };

            storage.set(data);

            expect(storage.get()).toEqual(data);
        });

        it('should store and retrieve arrays', () => {
            const storage = new MemoryStorage<number[]>();
            const numbers = [1, 2, 3, 4, 5];

            storage.set(numbers);

            expect(storage.get()).toEqual(numbers);
        });

        it('should store and retrieve `BigInt` values', () => {
            const storage = new MemoryStorage<bigint>();
            const bigIntValue = BigInt('9007199254740991');

            storage.set(bigIntValue);

            expect(storage.get()).toBe(bigIntValue);
        });

        it('should store and retrieve mixed type arrays', () => {
            type MixedArray = (string | number | boolean | null)[];

            const storage = new MemoryStorage<MixedArray>();
            const mixedArray = ['test', 42, true, null];

            storage.set(mixedArray);

            expect(storage.get()).toEqual(mixedArray);
        });

        it('should handle deeply nested arrays', () => {
            type NestedArray = unknown[][];
            const storage = new MemoryStorage<NestedArray>();
            const deepArray = [
                [1, [2, [3, [4]]]],
                [5, [6]],
            ];

            storage.set(deepArray);

            expect(storage.get()).toEqual(deepArray);
        });

        it('should store and retrieve complex objects with methods', () => {
            class TestClass {
                constructor(public value: string) {}
                getValue(): string {
                    return this.value;
                }
            }
            const storage = new MemoryStorage<TestClass>();
            const instance = new TestClass('test');

            storage.set(instance);

            const retrieved = storage.get();
            expect(retrieved).toBeInstanceOf(TestClass);
            expect(retrieved?.getValue()).toBe('test');
        });

        it('should store and retrieve RegExp', () => {
            const storage = new MemoryStorage<RegExp>();
            const regexp = /test/gi;

            storage.set(regexp);
            const retrieved = storage.get();

            expect(retrieved?.source).toBe('test');
            expect(retrieved?.flags).toBe('gi');
            expect(retrieved?.test('TEST')).toBe(true);
        });

        it('should store and retrieve Map', () => {
            const storage = new MemoryStorage<Map<string | number, unknown>>();
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
            const storage = new MemoryStorage<Set<unknown>>();
            const set = new Set(['test', 1, { prop: true }]);

            storage.set(set);
            const retrieved = storage.get();

            expect(retrieved).toBeInstanceOf(Set);
            expect(retrieved?.has('test')).toBe(true);
            expect(retrieved?.has(1)).toBe(true);
            expect(Array.from(retrieved ?? [])).toEqual(['test', 1, { prop: true }]);
        });

        it('should store and retrieve URL', () => {
            const storage = new MemoryStorage<URL>();
            const url = new URL('https://frontify.com/path?query=test#hash');

            storage.set(url);
            const retrieved = storage.get();

            expect(retrieved).toBeInstanceOf(URL);
            expect(retrieved?.href).toBe('https://frontify.com/path?query=test#hash');
            expect(retrieved?.pathname).toBe('/path');
            expect(retrieved?.searchParams.get('query')).toBe('test');
        });

        it('should store and retrieve Error', () => {
            const storage = new MemoryStorage<Error>();
            const error = new Error('Test error');

            storage.set(error);
            const retrieved = storage.get();

            expect(retrieved).toBeInstanceOf(Error);
            expect(retrieved?.message).toBe('Test error');
            expect(retrieved?.stack).toBe(error.stack);
        });

        it('should store Map with complex keys and values', () => {
            const storage = new MemoryStorage<Map<RegExp | Date, Set<string>>>();
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

    describe('edge cases', () => {
        it('should handle undefined properties in objects', () => {
            const storage = new MemoryStorage<{ prop?: string }>();
            const obj = { prop: undefined };

            storage.set(obj);

            expect(storage.get()).toEqual(obj);
        });

        it('should store empty objects', () => {
            const storage = new MemoryStorage<Record<string, never>>();

            storage.set({});

            expect(storage.get()).toEqual({});
        });

        it('should store empty arrays', () => {
            const storage = new MemoryStorage<never[]>();

            storage.set([]);

            expect(storage.get()).toEqual([]);
        });

        it('should handle circular references', () => {
            type CircularType = { prop: string; self?: CircularType };
            const storage = new MemoryStorage<CircularType>();
            const circular: CircularType = { prop: 'value' };
            circular.self = circular;

            storage.set(circular);

            const retrieved = storage.get();

            expect(retrieved?.prop).toBe('value');
            expect(retrieved?.self).toBe(retrieved);
        });
    });
});
