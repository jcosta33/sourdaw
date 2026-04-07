import { vi } from 'vitest';

export const createMock = <T extends Record<string, any>>(overrides?: Partial<T>): T => {
    const base = overrides ? { ...overrides } : {};
    return new Proxy(base as T, {
        get(target, prop) {
            if (prop in target) {
                return target[prop as keyof T];
            }
            if (prop === 'then') return undefined;
            
            const mockFn = vi.fn();
            (target as any)[prop] = mockFn;
            return mockFn;
        }
    });
};