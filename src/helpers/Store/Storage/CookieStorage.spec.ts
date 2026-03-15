/* (c) Copyright Frontify Ltd., all rights reserved. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Cookie } from 'Utility/Cookie';

import { CookieStorage } from './CookieStorage';

describe(CookieStorage.name, () => {
    describe('with primitive types', () => {
        let storage: CookieStorage<string>;

        beforeEach(() => {
            storage = new CookieStorage<string>('primitive-type');
            storage.clear();
        });

        it('should save and retrieve string', () => {
            const storage = new CookieStorage<string>('primitive-type');
            const value = 'Hello, World!';

            storage.set(value);

            expect(storage.get()).toBe(value);
        });

        it('should save and retrieve number', () => {
            const storage = new CookieStorage<number>('primitive-type');
            const value = 32;

            storage.set(value);

            expect(storage.get()).toBe(value);
        });

        it('should save and retrieve boolean', () => {
            const storage = new CookieStorage<boolean>('primitive-type');
            const value = true;

            storage.set(value);

            expect(storage.get()).toBe(value);
        });

        it('should return `null` initially', () => {
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
        it('should store and retrieve nested objects', () => {
            const storage = new CookieStorage<{ nested: { data: number[]; meta: { id: string } } }>('nested-object');
            const data = {
                nested: {
                    data: [1, 2, 3],
                    meta: { id: 'meta-id' },
                },
            };

            storage.set(data);

            expect(storage.get()).toEqual(data);
        });

        it('should store and retrieve mixed type arrays', () => {
            type MixedArray = (string | number | boolean | null)[];

            const storage = new CookieStorage<MixedArray>('mixed-array');
            const mixedArray = ['test', 42, true, null];

            storage.set(mixedArray);

            expect(storage.get()).toEqual(mixedArray);
        });
    });

    describe('CookieStorage interactions', () => {
        it('should get correct value from cookie', () => {
            const key = 'key';
            const value = 'some initial value';

            document.cookie = `${key}=${encodeURIComponent(JSON.stringify(value))};`;

            const storage = new CookieStorage<string>(key);
            expect(storage.get()).toBe(value);
        });

        it('should persist data between storage instances', () => {
            const key = 'persist-key';
            const value = 'persistent value';
            const firstStorage = new CookieStorage<string>(key);
            firstStorage.set(value);

            const secondStorage = new CookieStorage<string>(key);
            expect(secondStorage.get()).toBe(value);
        });
    });

    describe('fallback', () => {
        let storage: CookieStorage<string>;
        let originalCookieDescriptor: PropertyDescriptor | undefined;

        beforeEach(() => {
            originalCookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
            Object.defineProperty(document, 'cookie', {
                value: null,
            });
            storage = new CookieStorage<string>('fallback-key');
        });

        afterEach(() => {
            if (originalCookieDescriptor) {
                Object.defineProperty(document, 'cookie', originalCookieDescriptor);
            }
            vi.restoreAllMocks();
        });

        it('should return false when calling isSupported()', () => {
            expect(storage.isSupported()).toBe(false);
        });

        it('should return null when JSON parse throws', () => {
            vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
                throw new Error('Security error');
            });
            expect(storage.get()).toBeNull();
        });
    });

    describe('with options', () => {
        it('should pass options to Cookie.set', () => {
            const setSpy = vi.spyOn(Cookie, 'set').mockImplementation(() => {});
            const date = new Date();
            const storage = new CookieStorage<string>('options-test', {
                sameSite: 'Strict',
                path: '/app',
                domain: 'frontify.internal',
                validityDate: date,
            });

            const value = 'test-value';
            storage.set(value);

            expect(setSpy).toHaveBeenCalledWith('options-test', JSON.stringify(value), {
                sameSite: 'Strict',
                path: '/app',
                domain: 'frontify.internal',
                expires: date,
            });
        });
    });
});
