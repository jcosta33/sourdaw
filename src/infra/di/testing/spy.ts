import { vi } from 'vitest';

export const spy = <T extends Record<string, any>>(): T => {
    const cache = new Map<string | symbol, any>();
    return new Proxy({} as T, {
        get(_target, prop) {
            if (prop === 'then') return undefined;
            if (!cache.has(prop)) {
                cache.set(prop, vi.fn());
            }
            return cache.get(prop);
        }
    });
};