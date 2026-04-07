import { vi, type Mock } from 'vitest';

export type SpyObject<TShape> = {
    [TKey in keyof TShape]: TShape[TKey] extends (...args: any[]) => any ? Mock<TShape[TKey]> : TShape[TKey];
};

export const spy = <TShape extends Record<string, any>>(): SpyObject<TShape> => {
    const spyCache = new Map<string | symbol, any>();
    return new Proxy({} as SpyObject<TShape>, {
        get(_target, prop) {
            if (prop === 'then') {
                return undefined;
            }
            if (!spyCache.has(prop)) {
                spyCache.set(prop, vi.fn());
            }
            return spyCache.get(prop);
        },
    });
};
