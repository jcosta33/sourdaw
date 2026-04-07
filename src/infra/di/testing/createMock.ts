import { vi, type Mock } from 'vitest';

export type MockObject<T> = {
    [K in keyof T]: T[K] extends (...args: any[]) => any ? Mock<T[K]> : T[K];
};

export const createMock = <T extends Record<string, any>>(overrides?: Partial<T>): MockObject<T> => {
    const base = overrides ? { ...overrides } : {};
    return new Proxy(base as MockObject<T>, {
        get(target, prop) {
            if (prop in target) {
                return target[prop as keyof MockObject<T>];
            }
            if (prop === 'then') return undefined;
            
            const mockFn = vi.fn();
            (target as any)[prop] = mockFn;
            return mockFn;
        }
    });
};