import { vi, type Mock } from 'vitest';

export type SpyObject<T> = {
    [K in keyof T]: T[K] extends (...args: any[]) => any ? Mock<T[K]> : T[K];
};

export const spy = <T extends Record<string, any>>(): SpyObject<T> => {
    const cache = new Map<string | symbol, any>();
    return new Proxy({} as SpyObject<T>, {
        get(_target, prop) {
            if (prop === 'then') return undefined;
            if (!cache.has(prop)) {
                cache.set(prop, vi.fn());
            }
            return cache.get(prop);
        }
    });
};