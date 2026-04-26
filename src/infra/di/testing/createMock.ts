import { vi, type Mock } from 'vitest';

export type MockObject<TShape> = {
    [TKey in keyof TShape]: TShape[TKey] extends (...args: never[]) => unknown ? Mock<TShape[TKey]> : TShape[TKey];
};

export const createMock = <TShape extends Record<string, unknown>>(overrides?: Partial<TShape>): MockObject<TShape> => {
    const base = overrides ? { ...overrides } : {};
    return new Proxy(base as MockObject<TShape>, {
        get(target, prop) {
            if (prop in target) {
                return target[prop as keyof MockObject<TShape>];
            }
            if (prop === 'then') {
                return undefined;
            }

            const mockFn = vi.fn();
            (target as Record<string | symbol, unknown>)[prop] = mockFn;
            return mockFn;
        },
    });
};
